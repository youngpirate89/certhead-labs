import { tokenize, resolve, complete } from '@/engine/parser';
import { grammarFor } from './grammar';
import {
  type AclEntry,
  type DhcpPool,
  type Mode,
  type NatStatement,
  type OspfNeighborRole,
  type SyslogTrapLevel,
  type Session,
  type SubInterface,
  nextEngineSeq,
  normaliseInterface,
  fullInterfaceName,
  isSubInterfaceId,
  isValidIpv4,
  isValidIpv6Prefix,
  isValidMask,
  isValidRouteMask,
  parentInterfaceId,
  prompt as promptFor,
  routingTable,
  deriveRouterId,
  ospfNetworkType,
  OSPF_DEFAULT_HELLO_INTERVAL,
  OSPF_DEFAULT_DEAD_INTERVAL,
} from './state';
import { matchingNetwork } from './ospf';
import {
  type Route,
  ipInSubnet,
  ipToInt,
  longestPrefixMatch,
  maskLength,
  networkAddress,
} from './routing';
import type {
  AdapterContext,
  ApplyOptions,
  CommandOutput,
  ApplyResult as GenericApplyResult,
} from '../types';
import { canReach, type FailPoint, type FailReason } from '@/engine/reachability';

// Re-exported from the shared adapter contracts; kept here as a named export so
// existing call-sites (`import { CommandOutput } from '@/engine/adapters/ios/interpret'`)
// keep working without churn while the canonical home is `../types`.
export type { CommandOutput } from '../types';
export type ApplyResult = GenericApplyResult<Session>;

const err = (text: string): CommandOutput[] => [{ kind: 'error', text }];
const out = (...lines: string[]): CommandOutput[] =>
  lines.map((text) => ({ kind: 'output', text }));

/** Config-family modes — the contexts where `do <exec-cmd>` is accepted. */
function isConfigFamily(mode: Mode): boolean {
  return (
    mode === 'config' ||
    mode === 'config-if' ||
    mode === 'config-subif' ||
    mode === 'config-router' ||
    mode === 'config-dhcp' ||
    mode === 'config-ext-nacl' ||
    mode === 'config-line'
  );
}

/**
 * Render an IOS-authentic invalid-input error: a caret line aligned under the
 * offending token in the echoed command, followed by the canonical message.
 *
 * The terminal renders an echoed input line as `${prompt} ${text}` (one literal
 * space between prompt and text). The caret column therefore equals
 * `promptStr.length + 1 + charOffset`, where `charOffset` is the offending
 * token's start position within the user's typed line.
 */
function invalidInputOutput(promptStr: string, charOffset: number): CommandOutput[] {
  const renderedPromptLen = promptStr.length + 1;
  const caretLine = ' '.repeat(renderedPromptLen + charOffset) + '^';
  return [
    { kind: 'error', text: caretLine },
    { kind: 'error', text: "% Invalid input detected at '^' marker." },
  ];
}

/**
 * Error-rendering context threaded from {@link applyCommand} into the dispatch
 * handlers so handler-level argument validation can emit the same IOS-authentic
 * caret + message as the resolver's invalid-input path.
 *
 * `argOffsets` maps each resolved argument's declared name (e.g. `mask`,
 * `target`) to the char offset of its token within the user's typed line —
 * computed from the resolver's per-arg token index mapped through the
 * tokenizer's per-token offsets. The offsets are measured against the SANITIZED
 * command string the parser actually saw (smart-punctuation already normalized
 * 1:1 upstream in the terminal's onChange), so the caret column is stable.
 */
interface ErrCtx {
  readonly promptStr: string;
  readonly argOffsets: Readonly<Record<string, number>>;
}

/**
 * Emit the IOS invalid-input error with a caret under the named argument's
 * token. Single sink for handler-level validation failures — every converted
 * call site funnels through here so the rendering stays identical to the
 * resolver path. `argName` must be a resolved argument present in
 * `ec.argOffsets`; if it is somehow absent the caret falls back to the start of
 * the typed line rather than throwing (deterministic, never crashes a lab).
 */
function badInput(ec: ErrCtx, argName: string): CommandOutput[] {
  return invalidInputOutput(ec.promptStr, ec.argOffsets[argName] ?? 0);
}

/**
 * Apply a raw command line to a session, returning a NEW session (the input is
 * never mutated) plus the output to print. Fully deterministic.
 *
 * In config-family modes (config, config-if) a leading `do` token is treated
 * as "run the rest as a privileged-EXEC command, then stay in this mode" —
 * the IOS `do` shortcut. `do` in user/priv modes is itself invalid input.
 *
 * `opts.record === false` runs the command for its side effects (mode
 * transitions, device-state mutation) but suppresses the history pushes —
 * used by `Lab.setup` seeding so pre-configured starting state doesn't show
 * up in `history` / `resolvedHistory` and cannot satisfy verification-style
 * objectives that match on command history.
 */
export function applyCommand(
  session: Session,
  raw: string,
  ctx?: AdapterContext,
  opts?: ApplyOptions,
): ApplyResult {
  const { tokens, offsets } = tokenize(raw);
  if (tokens.length === 0) return { session, output: [] };

  const promptStr = promptFor(session);

  // `do <exec-cmd>` in config-family modes: resolve the remainder against the
  // privileged-EXEC grammar without changing the mode or prompt.
  let grammar = grammarFor(session.mode);
  let activeTokens: readonly string[] = tokens;
  let activeOffsets: readonly number[] = offsets;
  let doForm = false;

  if (session.mode === 'config' && /^banner\s+motd\s+/i.test(raw.trim())) {
    return applyMotdBanner(session, raw.trim(), opts);
  }

  if (isConfigFamily(session.mode) && tokens[0] === 'do') {
    if (tokens.length === 1) {
      // Caret just past the `do` token — no remainder to resolve.
      return {
        session,
        output: invalidInputOutput(promptStr, offsets[0] + tokens[0].length),
      };
    }
    doForm = true;
    grammar = grammarFor('priv');
    activeTokens = tokens.slice(1);
    activeOffsets = offsets.slice(1);
  }

  const result = resolve(activeTokens, grammar);

  switch (result.kind) {
    case 'empty':
      return { session, output: [] };
    case 'ambiguous':
      return { session, output: err(`% Ambiguous command: "${result.token}"`) };
    case 'invalid':
      return {
        session,
        output: invalidInputOutput(promptStr, activeOffsets[result.position]),
      };
    case 'incomplete':
      return { session, output: err('% Incomplete command.') };
    case 'complete': {
      // Map each resolved arg's token index through the active per-token
      // offsets so handlers can caret an offending argument by name.
      const argOffsets: Record<string, number> = {};
      for (const [name, idx] of Object.entries(result.argPositions)) {
        argOffsets[name] = activeOffsets[idx];
      }
      const ec: ErrCtx = { promptStr, argOffsets };
      if (doForm) return dispatchDo(session, result.command, result.args, raw, ec, ctx, opts);
      return dispatch(session, result.command, result.args, raw.trim(), ec, ctx, opts);
    }
  }
}

function applyMotdBanner(session: Session, raw: string, opts?: ApplyOptions): ApplyResult {
  const caretC = raw.match(/^banner\s+motd\s+\^C(.*)\^C$/i);
  const oneChar = raw.match(/^banner\s+motd\s+([^\s])(.*)\1$/i);
  const message = caretC?.[1] ?? oneChar?.[2];
  if (message === undefined) return { session, output: err('% Incomplete command.') };
  const s: Session = structuredClone(session);
  if (opts?.record !== false) {
    s.history.push(raw);
    s.resolvedHistory.push('banner motd');
  }
  s.device.security.motdBanner = message;
  return { session: s, output: [] };
}

/**
 * Execute a `do <exec-cmd>` form: run the resolved command against the
 * privileged-EXEC dispatcher, but DO NOT let it change the mode, current
 * interface, or other "context" state. History is recorded with `do` preserved
 * (raw as typed; canonical with `do` prefix in resolvedHistory).
 *
 * When `opts.record === false` the inner dispatch skipped its push entirely,
 * so the resolvedHistory rewrite must also be skipped — otherwise it would
 * corrupt a prior entry (the `last` index would point at unrelated history).
 */
function dispatchDo(
  prev: Session,
  command: string[],
  args: Record<string, string>,
  raw: string,
  ec: ErrCtx,
  ctx: AdapterContext | undefined,
  opts: ApplyOptions | undefined,
): ApplyResult {
  const inner = dispatch(prev, command, args, raw.trim(), ec, ctx, opts);
  const record = opts?.record !== false;
  const last = inner.session.resolvedHistory.length - 1;
  const fixed: Session = {
    ...inner.session,
    mode: prev.mode,
    currentInterface: prev.currentInterface,
    resolvedHistory: record
      ? inner.session.resolvedHistory.map((cmd, i) =>
          i === last ? `do ${cmd}` : cmd,
        )
      : inner.session.resolvedHistory,
  };
  return { session: fixed, output: inner.output };
}

/**
 * Tab-complete the last token of an in-progress line.
 *
 * Mirrors real IOS:
 *   - unique prefix match → expand to the full keyword and append a space
 *   - ambiguous prefix    → DO NOTHING (Tab is not for listing candidates;
 *                            that's what `?` is for)
 *   - no partial (empty line or trailing whitespace) → nothing to complete
 *   - argument position   → nothing (Tab doesn't autocomplete arg values)
 *
 * Returns the replacement line on a unique completion, or null if the input
 * should be left alone. Earlier tokens are preserved as-typed (we don't expand
 * abbreviations the user didn't ask to expand).
 */
export function tabComplete(session: Session, line: string): string | null {
  if (line.length === 0 || /\s$/.test(line)) return null;

  const allTokens = line.split(/\s+/).filter(Boolean);
  if (allTokens.length === 0) return null;

  const partial = allTokens[allTokens.length - 1];
  const resolved = allTokens.slice(0, -1);

  const result = complete(resolved, grammarFor(session.mode), partial);
  if (result.kind !== 'ok' || result.completions.length !== 1) return null;

  const keyword = result.completions[0].keyword;
  return [...resolved, keyword].join(' ') + ' ';
}

/**
 * Render IOS-style `?` context help for an in-progress line (without the `?`).
 *
 * Mirrors real IOS formatting:
 *   - children resolved at the current position, with help text
 *   - `<arg-name>` when the position expects a free-form argument
 *   - `<cr>` when the current line is itself a runnable command
 *
 * Pure: does not mutate the session. The terminal layer calls this on every
 * `?` keypress and prints the result inline, preserving the input buffer.
 */
export function contextHelp(session: Session, partialLine: string): CommandOutput[] {
  // Detect partial-vs-complete-token state. A trailing space means all visible
  // tokens are resolved and we want the next-keyword list. No trailing space
  // means the last token is being typed — it filters the candidate list.
  const trimmed = partialLine.replace(/\s+$/, '');
  const trailingSpace = partialLine !== trimmed || partialLine.length === 0;
  const allTokens = trimmed.length === 0 ? [] : trimmed.split(/\s+/);

  let resolved: string[];
  let partial: string;
  if (trailingSpace || allTokens.length === 0) {
    resolved = allTokens;
    partial = '';
  } else {
    resolved = allTokens.slice(0, -1);
    partial = allTokens[allTokens.length - 1];
  }

  const result = complete(resolved, grammarFor(session.mode), partial);

  if (result.kind === 'ambiguous') {
    return err(`% Ambiguous command: "${result.token}"`);
  }
  if (result.kind === 'invalid') {
    return err(`% Unrecognized command`);
  }

  const lines: string[] = [];
  const maxLen = result.completions.reduce((m, c) => Math.max(m, c.keyword.length), 0);
  for (const c of result.completions) {
    const kw = c.keyword.padEnd(maxLen);
    lines.push(c.help ? `  ${kw}  ${c.help}` : `  ${kw}`);
  }
  if (result.expectsArgument && result.argumentName) {
    lines.push(`  <${result.argumentName}>`);
  }
  if (result.atTerminal) {
    lines.push('  <cr>');
  }
  if (lines.length === 0) {
    return err('% No help available');
  }
  return out(...lines);
}

function dispatch(
  prev: Session,
  command: string[],
  args: Record<string, string>,
  raw: string,
  ec: ErrCtx,
  ctx: AdapterContext | undefined,
  opts: ApplyOptions | undefined,
): ApplyResult {
  const s: Session = structuredClone(prev);
  if (opts?.record !== false) {
    s.history.push(raw);
    s.resolvedHistory.push(command.join(' '));
  }
  const head = command[0];

  switch (head) {
    case 'enable':
      if (command[1] === 'secret') return setEnableSecret(s, args.secret);
      if (s.mode === 'user') s.mode = 'priv';
      return { session: s, output: [] };

    case 'disable':
      s.mode = 'user';
      return { session: s, output: [] };

    case 'configure':
      s.mode = 'config';
      return {
        session: s,
        output: out('Enter configuration commands, one per line. End with CNTL/Z.'),
      };

    case 'exit':
      if (s.mode === 'config-if') {
        s.mode = 'config';
        s.currentInterface = null;
      } else if (s.mode === 'config-subif') {
        s.mode = 'config';
        s.activeSubIfId = null;
      } else if (s.mode === 'config-router') {
        s.mode = 'config';
      } else if (s.mode === 'config-dhcp') {
        s.mode = 'config';
        s.activeDhcpPool = null;
      } else if (s.mode === 'config-ext-nacl') {
        s.mode = 'config';
        s.activeAcl = null;
      } else if (s.mode === 'config-line') {
        s.mode = 'config';
        s.activeLine = null;
      } else if (s.mode === 'config') {
        s.mode = 'priv';
      } else if (s.mode === 'priv') {
        s.mode = 'user';
      }
      return { session: s, output: [] };

    case 'end':
      s.mode = 'priv';
      s.currentInterface = null;
      s.activeSubIfId = null;
      s.activeDhcpPool = null;
      s.activeAcl = null;
      s.activeLine = null;
      return { session: s, output: [] };

    case 'router':
      // command = ['router', 'ospf'], args.pid = process id
      if (command[1] === 'ospf') return enterRouterOspf(s, args.pid, ec);
      return { session: s, output: err('% Unknown command.') };

    case 'hostname':
      s.device.hostname = args.name;
      return { session: s, output: [] };

    case 'username':
      return setLocalUser(s, args.username, args.secret);

    case 'ntp':
      if (command[1] === 'server') return addNtpServer(s, args.server, ec);
      return { session: s, output: err('% Unknown command.') };

    case 'logging':
      if (command[1] === 'host') return addSyslogHost(s, args.host, ec);
      if (command[1] === 'trap') return setSyslogTrapLevel(s, args.level, ec);
      return { session: s, output: err('% Unknown command.') };

    case 'service':
      if (command[1] === 'timestamps' && command[2] === 'log' && command[3] === 'datetime' && command[4] === 'msec') {
        return setServiceTimestampsLogDatetimeMsec(s);
      }
      return { session: s, output: err('% Unknown command.') };

    case 'crypto':
      if (command[1] === 'key' && command[2] === 'generate' && command[3] === 'rsa') {
        return generateRsaKey(s, args.modulus, ec);
      }
      return { session: s, output: err('% Unknown command.') };

    case 'line':
      if (command[1] === 'vty') return enterLineVty(s, args.start, args.end, ec);
      return { session: s, output: err('% Unknown command.') };

    case 'interface':
      return enterInterface(s, args.iface, ec);

    case 'encapsulation':
      // command shape in config-subif: ['encapsulation', 'dot1q'], args.vlan
      if (command[1] === 'dot1q') return setEncapsulationDot1q(s, args.vlan, ec);
      return { session: s, output: err('% Unknown command.') };

    case 'description':
      if (s.currentInterface) s.device.interfaces[s.currentInterface].description = args.text;
      return { session: s, output: [] };

    case 'shutdown':
      return setAdmin(s, false);

    case 'no':
      return negate(s, command, args, ec);

    case 'ipv6':
      if (command[1] === 'address') return setIpv6Address(s, args.prefix, ec);
      if (command[1] === 'route') return addIpv6StaticRoute(s, args.prefix, args.nextHop, ec);
      return { session: s, output: err('% Incomplete command.') };

    case 'ip':
      // command[1] differentiates ip address (config-if) from ip route (config)
      // from ip access-group (config-if). All three share the `ip` keyword.
      if (command[1] === 'address') return setIpAddress(s, args.ip, args.mask, ec);
      if (command[1] === 'route') return addStaticRoute(s, args.prefix, args.mask, args.target, args.ad, ec);
      if (command[1] === 'domain-name') return setDomainName(s, args.domain);
      if (command[1] === 'access-group') {
        return setAccessGroup(s, args.number, command[3] as 'in' | 'out', ec);
      }
      if (command[1] === 'dhcp') {
        if (command[2] === 'pool') return enterDhcpPool(s, args.name);
        if (command[2] === 'excluded-address') return addDhcpExcluded(s, args.start, args.end, ec);
      }
      if (command[1] === 'nat') {
        // config-if: `ip nat inside|outside` marks the interface's NAT role.
        // config:    `ip nat inside source list <acl> interface <iface> overload`
        //            registers a PAT statement. Mode disambiguates which
        //            grammar produced the path; the grammar tree already
        //            enforces the rest, so the handler trusts args.{acl,iface}
        //            will be present on the config path.
        if (s.mode === 'config-if' && (command[2] === 'inside' || command[2] === 'outside')) {
          return setNatRole(s, command[2]);
        }
        if (s.mode === 'config' && command[2] === 'inside') {
          return addNatStatement(s, args.acl, args.iface, ec);
        }
      }
      if (command[1] === 'access-list' && command[2] === 'extended') {
        return enterExtAcl(s, args.name);
      }
      if (command[1] === 'helper-address') {
        return setHelperAddress(s, args.ip, ec);
      }
      if (command[1] === 'ospf') {
        if (command[2] === 'hello-interval') return setOspfTimer(s, 'hello', args.seconds, ec);
        if (command[2] === 'dead-interval') return setOspfTimer(s, 'dead', args.seconds, ec);
        if (command[2] === 'authentication' && command[3] === 'message-digest') {
          return setOspfAuthMessageDigest(s);
        }
        if (command[2] === 'message-digest-key') {
          return setOspfMd5Key(s, args['key-id'], args.key, ec);
        }
      }
      return { session: s, output: err('% Incomplete command.') };

    case 'permit':
    case 'deny':
      // Only reachable from config-ext-nacl (the grammar exposes permit/deny
      // here). Other modes' permit/deny resolve elsewhere or fail at parse.
      return addExtAclEntry(s, head, command, args, ec);

    case 'network':
      // In config-router this is an OSPF network statement; in config-dhcp it's
      // the pool's network/mask. Discriminate on the active mode.
      if (s.mode === 'config-dhcp') return setDhcpNetwork(s, args.ip, args.mask, ec);
      return addOspfNetwork(s, args.prefix, args.wildcard, args.area, ec);

    case 'passive-interface':
      // Only reachable from config-router (grammar exposes it nowhere else).
      // The argument is a free-form iface token — normalise + validate.
      return setPassiveInterface(s, args.iface, true, ec);

    case 'default-information':
      // `default-information originate [always]` in config-router (Lab 21).
      // command[1] === 'originate'; command[2] === 'always' when present.
      return setDefaultInformation(s, command[2] === 'always', true);

    case 'default-router':
      return setDhcpDefaultRouter(s, args.ip, ec);

    case 'dns-server':
      return setDhcpDnsServer(s, args.ip, ec);

    case 'lease':
      return setDhcpLease(s, args.days, ec);

    case 'access-list':
      // command = ['access-list', '<num>', 'permit'|'deny', ...source-form]
      return addAclEntry(s, args.number, command[2] as 'permit' | 'deny', command, args, ec);

    case 'login':
      if (command[1] === 'local') return setVtyLoginLocal(s);
      return { session: s, output: err('% Unknown command.') };

    case 'transport':
      if (command[1] === 'input') return setVtyTransportInput(s, command[2] as 'ssh' | 'telnet' | 'all' | 'none');
      return { session: s, output: err('% Unknown command.') };

    case 'show':
      return show(s, command, args);

    case 'ping':
      return ping(s, args.target, ctx);

    case 'write':
      return { session: s, output: out('Building configuration...', '[OK]') };

    default:
      return { session: s, output: err('% Unknown command.') };
  }
}


// ---------- device hardening / management-plane support ----------

function setDomainName(s: Session, domain: string): ApplyResult {
  s.device.security.domainName = domain;
  return { session: s, output: [] };
}

function setLocalUser(s: Session, username: string, secret: string): ApplyResult {
  s.device.security.users.set(username, { username, secret });
  return { session: s, output: [] };
}

function setEnableSecret(s: Session, secret: string): ApplyResult {
  s.device.security.enableSecret = secret;
  return { session: s, output: [] };
}

function generateRsaKey(s: Session, modulusText: string | undefined, ec: ErrCtx): ApplyResult {
  const modulus = Number.parseInt(modulusText ?? '', 10);
  if (!Number.isInteger(modulus) || modulus < 512) {
    return { session: s, output: badInput(ec, 'modulus') };
  }
  s.device.security.cryptoKeyModulus = modulus;
  return {
    session: s,
    output: out(`% The key modulus size is ${modulus} bits`, '% Generating RSA keys ... [OK]'),
  };
}

function enterLineVty(s: Session, startText: string | undefined, endText: string | undefined, ec: ErrCtx): ApplyResult {
  const start = Number.parseInt(startText ?? '', 10);
  const end = Number.parseInt(endText ?? '', 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start !== 0 || end !== 4) {
    return { session: s, output: badInput(ec, 'start') };
  }
  s.mode = 'config-line';
  s.activeLine = 'vty';
  return { session: s, output: [] };
}

function setVtyLoginLocal(s: Session): ApplyResult {
  if (s.mode !== 'config-line' || s.activeLine !== 'vty') return { session: s, output: err('% Invalid line context.') };
  s.device.security.vtyLoginLocal = true;
  return { session: s, output: [] };
}

function setVtyTransportInput(s: Session, value: 'ssh' | 'telnet' | 'all' | 'none'): ApplyResult {
  if (s.mode !== 'config-line' || s.activeLine !== 'vty') return { session: s, output: err('% Invalid line context.') };
  s.device.security.vtyTransportInput = value;
  return { session: s, output: [] };
}

export function isSshReady(s: Session, username: string): boolean {
  const sec = s.device.security;
  return Boolean(
    sec.domainName &&
      sec.enableSecret &&
      sec.users.has(username) &&
      sec.cryptoKeyModulus !== null &&
      sec.vtyLoginLocal &&
      sec.vtyTransportInput === 'ssh',
  );
}

function hasSshHardening(s: Session): boolean {
  const sec = s.device.security;
  return Boolean(
    sec.domainName ||
      sec.enableSecret ||
      sec.users.size > 0 ||
      sec.cryptoKeyModulus !== null ||
      sec.vtyLoginLocal ||
      sec.vtyTransportInput !== 'all' ||
      sec.motdBanner !== null,
  );
}

// ---------- management services support ----------

const SYSLOG_TRAP_LEVELS = new Set<SyslogTrapLevel>([
  'emergencies',
  'alerts',
  'critical',
  'errors',
  'warnings',
  'notifications',
  'informational',
  'debugging',
]);

function addNtpServer(s: Session, server: string | undefined, ec: ErrCtx): ApplyResult {
  if (!server || !isValidIpv4(server)) return { session: s, output: badInput(ec, 'server') };
  s.device.ntp.servers.set(server, { server, configuredAt: nextEngineSeq() });
  return { session: s, output: [] };
}

function addSyslogHost(s: Session, host: string | undefined, ec: ErrCtx): ApplyResult {
  if (!host || !isValidIpv4(host)) return { session: s, output: badInput(ec, 'host') };
  s.device.syslog.hosts.set(host, { host, configuredAt: nextEngineSeq() });
  return { session: s, output: [] };
}

function setSyslogTrapLevel(s: Session, levelText: string | undefined, ec: ErrCtx): ApplyResult {
  const level = levelText as SyslogTrapLevel | undefined;
  if (!level || !SYSLOG_TRAP_LEVELS.has(level)) return { session: s, output: badInput(ec, 'level') };
  s.device.syslog.trapLevel = level;
  return { session: s, output: [] };
}

function setServiceTimestampsLogDatetimeMsec(s: Session): ApplyResult {
  s.device.syslog.serviceTimestampsLogDatetimeMsec = true;
  return { session: s, output: [] };
}

function hasManagementServices(s: Session): boolean {
  return Boolean(
    s.device.ntp.servers.size > 0 ||
      s.device.syslog.hosts.size > 0 ||
      s.device.syslog.trapLevel !== null ||
      s.device.syslog.serviceTimestampsLogDatetimeMsec,
  );
}

// ---------- ping (privileged EXEC) ----------

/** Render a successful Windows-style ping block. Mirrors the PC adapter's
 *  output (pc.ts `renderPing`) so the look is identical regardless of which
 *  device originates the ping — same 4 packets, same statistics line. */
function pingSuccessLines(target: string): CommandOutput[] {
  return [
    { kind: 'output', text: '' },
    { kind: 'output', text: `Pinging ${target} with 32 bytes of data:` },
    { kind: 'output', text: `Reply from ${target}: bytes=32 time<1ms TTL=64` },
    { kind: 'output', text: `Reply from ${target}: bytes=32 time<1ms TTL=64` },
    { kind: 'output', text: `Reply from ${target}: bytes=32 time<1ms TTL=64` },
    { kind: 'output', text: `Reply from ${target}: bytes=32 time<1ms TTL=64` },
    { kind: 'output', text: '' },
    { kind: 'output', text: `Ping statistics for ${target}:` },
    { kind: 'output', text: '    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)' },
  ];
}

/** Render a failed ping with the trailing `[sim]` annotation. */
function pingFailureLines(target: string, failedAt: FailPoint): CommandOutput[] {
  return [
    { kind: 'output', text: '' },
    { kind: 'output', text: `Pinging ${target} with 32 bytes of data:` },
    { kind: 'error', text: 'Request timed out.' },
    { kind: 'error', text: 'Request timed out.' },
    { kind: 'error', text: 'Request timed out.' },
    { kind: 'error', text: 'Request timed out.' },
    { kind: 'output', text: '' },
    { kind: 'output', text: `Ping statistics for ${target}:` },
    { kind: 'error', text: '    Packets: Sent = 4, Received = 0, Lost = 4 (100% loss)' },
    { kind: 'system', text: `[sim] ${failureSentence(failedAt, target)}` },
  ];
}

/** FailReason → English sentence. Mirrors pc.ts `failureDetail` so the two
 *  ping origins read identically; if you add a FailReason, add a case here AND
 *  in pc.ts. The first letter is upper-cased so the line reads as a complete
 *  sentence regardless of which branch produced it. */
function failureSentence(failedAt: FailPoint, target: string): string {
  const { reason, direction, deviceId, iface, acl, vlan, trunk, vlanAllow } = failedAt;
  const place = iface ? `${deviceId} ${iface}` : deviceId;
  const body = failureBody(reason, place, deviceId, direction, target, acl, vlan, trunk, vlanAllow);
  return body.charAt(0).toUpperCase() + body.slice(1);
}

function failureBody(
  reason: FailReason,
  place: string,
  deviceId: string,
  direction: 'forward' | 'return',
  target: string,
  acl: FailPoint['acl'],
  vlan: FailPoint['vlan'],
  trunk: FailPoint['trunk'],
  vlanAllow: FailPoint['vlanAllow'],
): string {
  switch (reason) {
    case 'no-route':
      return direction === 'forward'
        ? `${deviceId} has no route to ${target}.`
        : `${deviceId} has no return route to the source.`;
    case 'source-no-ip':
      return 'the source has no IP address configured.';
    case 'source-nic-down':
      return 'the source NIC has no link to a neighbor.';
    case 'no-gateway':
      return 'no default gateway is set, or the gateway is outside the local subnet.';
    case 'egress-down':
      return `${place} is administratively down.`;
    case 'next-hop-unreachable':
      return `the next-hop on ${place} is not in that interface's subnet.`;
    case 'link-peer-down':
      return `${place}'s link partner is administratively down.`;
    case 'link-subnet-mismatch':
      return `the subnets on the two ends of the link at ${place} do not match.`;
    case 'dest-nic-down':
      return 'the destination NIC has no link.';
    case 'dest-unreachable':
      return 'the destination is unreachable (no responding interface).';
    case 'routing-loop':
      return 'static routes form a loop — packets never arrive.';
    case 'acl-deny':
      if (!acl) return `${place} denied the packet via an access list.`;
      return `traffic from ${acl.sourceIp} is denied by ACL ${acl.aclNumber} on ${place} (${acl.aclDirection}).`;
    case 'vlan-mismatch':
      if (!vlan) return `${place} blocked the packet at the VLAN boundary.`;
      return `${vlan.aId} and ${vlan.bId} are on different VLANs (${vlan.aVlan} and ${vlan.bVlan}) — inter-VLAN routing is not configured.`;
    case 'trunk-not-configured':
      if (!trunk) return `${place} is not configured as a trunk.`;
      return `the link between ${trunk.aDevice} ${trunk.aIface} and ${trunk.bDevice} ${trunk.bIface} is not configured as a trunk — VLANs cannot pass between switches.`;
    case 'trunk-link-down':
      if (!trunk) return `${place} trunk link is down.`;
      return `the trunk link between ${trunk.aDevice} ${trunk.aIface} and ${trunk.bDevice} ${trunk.bIface} is down — a port is shut or its line protocol is down.`;
    case 'vlan-not-allowed':
      if (!vlanAllow) return `${place} blocked the packet at the trunk boundary.`;
      return `VLAN ${vlanAllow.vlanId} is not in the allowed VLAN list on ${place}.`;
  }
}

/** Resolve the egress interface IP for `target` in `s`'s routing table —
 *  matches IOS, which uses the egress interface as the ping source. Returns
 *  null when no usable egress exists; canReach will then fall back to its
 *  default first-interface pick (and likely diagnose the same no-route). */
function pingSourceIp(s: Session, target: string): string | null {
  const route = longestPrefixMatch(routingTable(s), target);
  if (!route) return null;
  let egressId: string | null = route.egressIface ?? null;
  if (egressId === null && route.nextHop) {
    for (const i of Object.values(s.device.interfaces)) {
      if (!i.ip || !i.mask) continue;
      const net = networkAddress(i.ip, i.mask);
      if (ipInSubnet(route.nextHop, net, i.mask)) {
        egressId = i.id;
        break;
      }
    }
  }
  if (!egressId) return null;
  if (isSubInterfaceId(egressId)) {
    return s.device.subInterfaces[egressId]?.ip ?? null;
  }
  return s.device.interfaces[egressId]?.ip ?? null;
}

/** Handle `ping <target>`. In config / config-if modes the grammar steers
 *  here too so we can emit a tailored redirect rather than a parser error. */
function ping(
  s: Session,
  target: string | undefined,
  ctx: AdapterContext | undefined,
): ApplyResult {
  if (s.mode === 'config' || s.mode === 'config-if') {
    return {
      session: s,
      output: [
        {
          kind: 'system',
          text: "% Ping is available in privileged EXEC mode. Type 'exit' to return.",
        },
      ],
    };
  }
  if (!target) return { session: s, output: err('% Incomplete command.') };
  if (!isValidIpv4(target)) {
    return { session: s, output: err('% Invalid IP address') };
  }
  if (!ctx?.lab) {
    // Adapter-level tests can drive applyCommand without a LabSession; rather
    // than crash we surface a clear error so the test sees the right shape.
    return { session: s, output: err('Ping requires a lab context.') };
  }
  const sourceIp = pingSourceIp(s, target);
  // Router-originated ping is ICMP — pass the protocol so extended `deny icmp`
  // ACLs (Lab 12) fire identically here as for PC ping.
  const result = canReach(ctx.lab, s.device.id, target, sourceIp ?? undefined, 'icmp');
  if (result.ok) {
    return { session: s, output: pingSuccessLines(target) };
  }
  return { session: s, output: pingFailureLines(target, result.failedAt) };
}

function enterInterface(s: Session, token: string, ec: ErrCtx): ApplyResult {
  const id = normaliseInterface(token);
  if (!id) return { session: s, output: badInput(ec, 'iface') };
  if (isSubInterfaceId(id)) {
    const parent = parentInterfaceId(id);
    if (!s.device.interfaces[parent]) {
      // Stay in config — parent must exist before a subif can be created.
      return {
        session: s,
        output: err(`% Parent interface ${fullInterfaceName(parent)} not found`),
      };
    }
    if (!s.device.subInterfaces[id]) {
      // Lazy creation on first entry — matches IOS, which materialises the
      // subif as soon as `interface Gi0/0.<n>` is typed. defaults: no
      // encapsulation, no ip. The subif has no independent admin state — its
      // line state follows the parent, derived by the LabSession refresh pass.
      const sub: SubInterface = {
        id,
        parentId: parent,
        dot1qVlan: null,
        ip: null,
        mask: null,
        protocolUp: false,
      };
      s.device.subInterfaces[id] = sub;
    }
    s.mode = 'config-subif';
    s.activeSubIfId = id;
    s.currentInterface = null;
    return { session: s, output: [] };
  }
  if (!s.device.interfaces[id]) {
    return { session: s, output: err(`% Invalid interface ${fullInterfaceName(id)}`) };
  }
  s.mode = 'config-if';
  s.currentInterface = id;
  s.activeSubIfId = null;
  return { session: s, output: [] };
}

/** `encapsulation dot1q <vlan>` on a subinterface. Range 1-4094. */
function setEncapsulationDot1q(s: Session, vlanArg: string, ec: ErrCtx): ApplyResult {
  if (s.mode !== 'config-subif' || !s.activeSubIfId) {
    // Unreachable mode guard: the grammar exposes `encapsulation` only in
    // config-subif, so a wrong-mode `encapsulation` resolves to the parser's
    // invalid-input caret before reaching here. Left as a bare message — the
    // offending token is a resolved keyword, not an argument with an offset.
    return { session: s, output: err('% Invalid input detected at "encapsulation".') };
  }
  const vlan = Number.parseInt(vlanArg, 10);
  if (!Number.isFinite(vlan) || String(vlan) !== vlanArg) {
    return { session: s, output: badInput(ec, 'vlan') };
  }
  if (vlan < 1 || vlan > 4094) {
    return { session: s, output: err('% VLAN id out of range') };
  }
  s.device.subInterfaces[s.activeSubIfId].dot1qVlan = vlan;
  // Arm the verify gate: re-stamp on each subif L3-config action (encap OR ip,
  // whichever runs last) so `show ip interface brief` can satisfy a verify-
  // style objective. A subif has no per-subif `no shutdown` to key off anymore
  // (line state follows the parent), so the config actions are the trigger.
  s.subIfConfiguredAt[s.activeSubIfId] = nextEngineSeq();
  return { session: s, output: [] };
}

function setIpAddress(s: Session, ip: string, mask: string, ec: ErrCtx): ApplyResult {
  if (!isValidIpv4(ip)) return { session: s, output: badInput(ec, 'ip') };
  if (!isValidMask(mask)) return { session: s, output: err('% Invalid subnet mask.') };
  if (s.mode === 'config-subif' && s.activeSubIfId) {
    const sub = s.device.subInterfaces[s.activeSubIfId];
    sub.ip = ip;
    sub.mask = mask;
    // Arm the verify gate (see setEncapsulationDot1q): re-stamp on this L3-config
    // action so the ip-before-encap order still completes verify-brief.
    s.subIfConfiguredAt[s.activeSubIfId] = nextEngineSeq();
    return { session: s, output: [] };
  }
  if (s.currentInterface) {
    s.device.interfaces[s.currentInterface].ip = ip;
    s.device.interfaces[s.currentInterface].mask = mask;
  }
  return { session: s, output: [] };
}

function setIpv6Address(s: Session, prefix: string, ec: ErrCtx): ApplyResult {
  if (!isValidIpv6Prefix(prefix)) return { session: s, output: badInput(ec, 'prefix') };
  if (s.currentInterface) {
    const list = s.device.interfaces[s.currentInterface].ipv6Addresses;
    if (!list.includes(prefix.toLowerCase())) list.push(prefix.toLowerCase());
  }
  return { session: s, output: [] };
}

function clearIpv6Addresses(s: Session): ApplyResult {
  if (s.currentInterface) s.device.interfaces[s.currentInterface].ipv6Addresses = [];
  return { session: s, output: [] };
}

function isValidIpv6Address(value: string): boolean {
  return value.includes(':') && /^[0-9a-f:]+$/i.test(value);
}

function addIpv6StaticRoute(
  s: Session,
  prefix: string,
  nextHop: string,
  ec: ErrCtx,
): ApplyResult {
  if (!isValidIpv6Prefix(prefix)) return { session: s, output: badInput(ec, 'prefix') };
  if (!isValidIpv6Address(nextHop)) return { session: s, output: badInput(ec, 'nextHop') };
  const route = {
    prefix: prefix.toLowerCase(),
    nextHop: nextHop.toLowerCase(),
    configuredAt: nextEngineSeq(),
  };
  const dupeIdx = s.ipv6StaticRoutes.findIndex(
    (r) => r.prefix === route.prefix && r.nextHop === route.nextHop,
  );
  if (dupeIdx < 0) s.ipv6StaticRoutes.push(route);
  else s.ipv6StaticRoutes[dupeIdx] = route;
  return { session: s, output: [] };
}

function removeIpv6StaticRoute(
  s: Session,
  prefix: string,
  nextHop: string,
  ec: ErrCtx,
): ApplyResult {
  if (!isValidIpv6Prefix(prefix)) return { session: s, output: badInput(ec, 'prefix') };
  if (!isValidIpv6Address(nextHop)) return { session: s, output: badInput(ec, 'nextHop') };
  const before = s.ipv6StaticRoutes.length;
  s.ipv6StaticRoutes = s.ipv6StaticRoutes.filter(
    (r) => !(r.prefix === prefix.toLowerCase() && r.nextHop === nextHop.toLowerCase()),
  );
  if (s.ipv6StaticRoutes.length === before) return { session: s, output: err('% Not found.') };
  return { session: s, output: [] };
}

function setAdmin(s: Session, up: boolean): ApplyResult {
  if (s.mode === 'config-subif' && s.activeSubIfId) {
    // A dot1Q subinterface has no independent admin state — its line state
    // follows the physical parent. Real IOS swallows `[no] shutdown` on a
    // subif; accept it as a harmless no-op (not required, not an error).
    return { session: s, output: [] };
  }
  if (!s.currentInterface) return { session: s, output: [] };
  const iface = s.device.interfaces[s.currentInterface];
  const changed = iface.adminUp !== up;
  iface.adminUp = up;
  if (up && changed) {
    const name = iface.name;
    return {
      session: s,
      output: [
        { kind: 'system', text: `%LINK-3-UPDOWN: Interface ${name}, changed state to up` },
        {
          kind: 'system',
          text: `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to up`,
        },
      ],
    };
  }
  return { session: s, output: [] };
}

function negate(
  s: Session,
  command: string[],
  args: Record<string, string>,
  ec: ErrCtx,
): ApplyResult {
  // command = ['no', ...]
  // In config-ext-nacl mode, `no <sequence>` removes an entry — the grammar
  // captures the sequence under args.sequence and command[1] is the bare
  // sequence number rather than a known keyword. Detect that path first so
  // we don't fall into the keyword switch below.
  if (s.mode === 'config-ext-nacl' && args.sequence !== undefined) {
    return removeExtAclEntry(s, args.sequence, ec);
  }
  switch (command[1]) {
    case 'shutdown':
      return setAdmin(s, true);
    case 'ipv6':
      if (command[2] === 'address') return clearIpv6Addresses(s);
      if (command[2] === 'route') return removeIpv6StaticRoute(s, args.prefix, args.nextHop, ec);
      return { session: s, output: err('% Incomplete command.') };
    case 'hostname':
      s.device.hostname = 'Router';
      return { session: s, output: [] };
    case 'ip':
      if (command[2] === 'route') {
        return removeStaticRoute(s, args.prefix, args.mask, args.target, ec);
      }
      if (command[2] === 'access-group') {
        return clearAccessGroup(s, args.number, command[4] as 'in' | 'out', ec);
      }
      if (command[2] === 'dhcp') {
        if (command[3] === 'pool') return removeDhcpPool(s, args.name);
        if (command[3] === 'excluded-address') {
          return removeDhcpExcluded(s, args.start, args.end, ec);
        }
      }
      if (command[2] === 'nat') {
        // Mode-disambiguated mirror of the positive form. config-if removes
        // the interface marking; config removes the matching PAT statement.
        if (s.mode === 'config-if' && (command[3] === 'inside' || command[3] === 'outside')) {
          return clearNatRole(s, command[3]);
        }
        if (s.mode === 'config' && command[3] === 'inside') {
          return removeNatStatement(s, args.acl, args.iface, ec);
        }
      }
      if (command[2] === 'access-list' && command[3] === 'extended') {
        return removeExtAcl(s, args.name);
      }
      if (command[2] === 'helper-address') {
        return clearHelperAddress(s);
      }
      if (command[2] === 'ospf') {
        if (command[3] === 'hello-interval') return clearOspfTimer(s, 'hello');
        if (command[3] === 'dead-interval') return clearOspfTimer(s, 'dead');
        if (command[3] === 'authentication') return clearOspfAuthMessageDigest(s);
        if (command[3] === 'message-digest-key') return clearOspfMd5Key(s);
      }
      // `no ip address`:
      //   - in config-subif → clear the active subinterface's IP+mask
      //   - in config-if    → clear the active physical interface's IP+mask
      if (s.mode === 'config-subif' && s.activeSubIfId) {
        const sub = s.device.subInterfaces[s.activeSubIfId];
        sub.ip = null;
        sub.mask = null;
      } else if (s.currentInterface) {
        s.device.interfaces[s.currentInterface].ip = null;
        s.device.interfaces[s.currentInterface].mask = null;
      }
      return { session: s, output: [] };
    case 'encapsulation':
      // `no encapsulation dot1q <vlan>` — clear the active subif's dot1q tag.
      // The vlan argument is required by the grammar but IOS doesn't validate
      // it matches the current tag; we follow that and simply clear.
      if (s.mode === 'config-subif' && s.activeSubIfId) {
        s.device.subInterfaces[s.activeSubIfId].dot1qVlan = null;
      }
      return { session: s, output: [] };
    case 'access-list':
      return removeAcl(s, args.number, ec);
    case 'network':
      // `no network` discriminates by mode the same way the positive form does
      // (config-router → OSPF network; config-dhcp → pool network).
      if (s.mode === 'config-dhcp') return clearDhcpNetwork(s);
      return removeOspfNetwork(s, args.prefix, args.wildcard, args.area, ec);
    case 'passive-interface':
      // Mirror the positive form — only valid in config-router.
      return setPassiveInterface(s, args.iface, false, ec);
    case 'default-information':
      // `no default-information originate` — stop originating the default.
      // `always` is part of the positive form only; `no` clears both flags.
      return setDefaultInformation(s, false, false);
    case 'default-router':
      return clearDhcpDefaultRouter(s);
    case 'dns-server':
      return clearDhcpDnsServer(s);
    case 'lease':
      return clearDhcpLease(s);
    default:
      return { session: s, output: err('% Incomplete command.') };
  }
}

/** Parse the `ip route <prefix> <mask> <target>` target as either a next-hop
 *  IP or an egress-interface id. Returns null if it parses as neither. */
function parseRouteTarget(
  s: Session,
  target: string,
): { nextHop: string } | { egressIface: string } | null {
  if (isValidIpv4(target)) return { nextHop: target };
  const ifaceId = normaliseInterface(target);
  if (ifaceId && s.device.interfaces[ifaceId]) return { egressIface: ifaceId };
  return null;
}

function addStaticRoute(
  s: Session,
  prefix: string,
  mask: string,
  target: string,
  adArg: string | undefined,
  ec: ErrCtx,
): ApplyResult {
  if (!isValidIpv4(prefix)) {
    return { session: s, output: badInput(ec, 'prefix') };
  }
  if (!isValidRouteMask(mask)) return { session: s, output: err('% Invalid subnet mask.') };
  const t = parseRouteTarget(s, target);
  if (!t) return { session: s, output: badInput(ec, 'target') };
  // Optional trailing AD token (Lab 16: floating static routes). When absent
  // the route gets the IOS default of 1; when present it must be an integer
  // 1..255 — anything else is a hard parse error matching real IOS.
  let adminDistance = 1;
  if (adArg !== undefined) {
    const n = Number.parseInt(adArg, 10);
    if (!Number.isFinite(n) || String(n) !== adArg || n < 1 || n > 255) {
      return { session: s, output: badInput(ec, 'ad') };
    }
    adminDistance = n;
  }
  // Normalize the prefix to the actual network address so longest-prefix-match
  // works correctly even if the user typed a host bit set.
  const network = networkAddress(prefix, mask);
  const route: Route = {
    prefix: network,
    mask,
    ...t,
    source: 'static',
    adminDistance,
  };
  // Same (prefix, mask, target) re-entered: replace in place — real IOS
  // overwrites the existing entry's AD rather than stacking duplicates. A
  // floating backup ALWAYS has a different next-hop than the primary, so
  // this path only fires on idempotent re-entry, never on floating adds.
  const dupeIdx = s.staticRoutes.findIndex(
    (r) =>
      r.prefix === route.prefix &&
      r.mask === route.mask &&
      r.nextHop === route.nextHop &&
      r.egressIface === route.egressIface,
  );
  if (dupeIdx < 0) s.staticRoutes.push(route);
  else s.staticRoutes[dupeIdx] = route;
  return { session: s, output: [] };
}

function removeStaticRoute(
  s: Session,
  prefix: string,
  mask: string,
  target: string,
  ec: ErrCtx,
): ApplyResult {
  // Split the prefix/mask validation so the caret lands on the actual
  // offending token (IOS stops at the first one it can't parse).
  if (!isValidIpv4(prefix)) return { session: s, output: badInput(ec, 'prefix') };
  if (!isValidRouteMask(mask)) return { session: s, output: badInput(ec, 'mask') };
  const t = parseRouteTarget(s, target);
  if (!t) return { session: s, output: badInput(ec, 'target') };
  const network = networkAddress(prefix, mask);
  const before = s.staticRoutes.length;
  s.staticRoutes = s.staticRoutes.filter(
    (r) =>
      !(
        r.prefix === network &&
        r.mask === mask &&
        r.nextHop === ('nextHop' in t ? t.nextHop : undefined) &&
        r.egressIface === ('egressIface' in t ? t.egressIface : undefined)
      ),
  );
  if (s.staticRoutes.length === before) {
    return { session: s, output: err('% Not found.') };
  }
  return { session: s, output: [] };
}

function enterRouterOspf(s: Session, pidArg: string, ec: ErrCtx): ApplyResult {
  const pid = Number.parseInt(pidArg, 10);
  if (!Number.isFinite(pid) || pid < 1 || pid > 65535 || String(pid) !== pidArg) {
    return { session: s, output: badInput(ec, 'pid') };
  }
  s.mode = 'config-router';
  // First entry into the process: stamp the process id and derive router-id.
  // Re-entering with the same pid is idempotent. Re-entering with a
  // DIFFERENT pid would replace it in real IOS; the engine matches that.
  if (s.device.ospf.process !== pid) {
    s.device.ospf.process = pid;
    s.device.ospf.routerId = deriveRouterId(s.device);
    // Changing process id clears any prior network statements + neighbors —
    // real IOS would refuse to start a second process, but for the engine
    // we keep the model simple: only one OSPF process at a time.
    s.device.ospf.networks = [];
    s.device.ospf.neighbors = new Map();
    s.device.ospf.passive = new Set();
    s.device.ospf.defaultInfoOriginate = false;
    s.device.ospf.defaultInfoAlways = false;
  }
  return { session: s, output: [] };
}

/** Validate a wildcard mask — bits set in `wildcard` are "match any" bits.
 *  Accept any dotted-quad whose octets are 0-255; unlike subnet masks IOS
 *  does not require a contiguous mask. */
function isValidWildcard(value: string): boolean {
  return isValidIpv4(value);
}

function addOspfNetwork(
  s: Session,
  prefix: string,
  wildcard: string,
  areaArg: string,
  ec: ErrCtx,
): ApplyResult {
  if (!isValidIpv4(prefix)) {
    return { session: s, output: badInput(ec, 'prefix') };
  }
  if (!isValidWildcard(wildcard)) {
    return { session: s, output: badInput(ec, 'wildcard') };
  }
  const area = Number.parseInt(areaArg, 10);
  if (!Number.isFinite(area) || area < 0 || String(area) !== areaArg) {
    return { session: s, output: badInput(ec, 'area') };
  }
  // Dedup — identical entries collapse, matching IOS.
  const dupe = s.device.ospf.networks.find(
    (n) => n.prefix === prefix && n.wildcard === wildcard && n.area === area,
  );
  if (!dupe) {
    s.device.ospf.networks = [
      ...s.device.ospf.networks,
      { prefix, wildcard, area },
    ];
    // Router-id may not have been derivable when the process was created (no
    // IPs yet). Re-derive on each network statement so a topology that gets
    // IPs after `router ospf` still ends up with a valid id.
    if (s.device.ospf.routerId === null) {
      s.device.ospf.routerId = deriveRouterId(s.device);
    }
  }
  return { session: s, output: [] };
}

/** `[no] passive-interface <iface>` in config-router. Add or remove the
 *  iface from the OSPF passive set. Validates that the named iface exists on
 *  this router so a typo surfaces an IOS-style error rather than silently
 *  growing the set. Subinterfaces are accepted (Lab 09 ROAS); the lookup
 *  walks both physical and dot1Q maps and stores the canonical id either way. */
function setPassiveInterface(
  s: Session,
  token: string,
  mark: boolean,
  ec: ErrCtx,
): ApplyResult {
  if (s.mode !== 'config-router') {
    // Unreachable mode guard: the grammar exposes `passive-interface` only in
    // config-router, so a wrong-mode use hits the parser's invalid-input caret
    // before reaching here. Left as a bare message — the offending token is a
    // resolved keyword, not an argument with an offset.
    return { session: s, output: err('% Invalid input detected at "passive-interface".') };
  }
  const id = normaliseInterface(token);
  if (!id) return { session: s, output: badInput(ec, 'iface') };
  const exists =
    s.device.interfaces[id] !== undefined ||
    s.device.subInterfaces[id] !== undefined;
  if (!exists) {
    return { session: s, output: err(`% Invalid interface ${fullInterfaceName(id)}`) };
  }
  if (mark) s.device.ospf.passive.add(id);
  else s.device.ospf.passive.delete(id);
  return { session: s, output: [] };
}

/** `[no] default-information originate [always]` in config-router (Lab 21).
 *  Sets the OSPF process to redistribute a default route. `enable` is true for
 *  the positive form, false for `no`. `always` only ever accompanies the
 *  positive form; the negate path clears both flags. No mode guard needed —
 *  the grammar exposes this only in config-router, so a wrong-mode use fails at
 *  the parser before reaching here (same posture as setPassiveInterface). */
function setDefaultInformation(s: Session, always: boolean, enable: boolean): ApplyResult {
  s.device.ospf.defaultInfoOriginate = enable;
  s.device.ospf.defaultInfoAlways = enable && always;
  return { session: s, output: [] };
}

function removeOspfNetwork(
  s: Session,
  prefix: string,
  wildcard: string,
  areaArg: string,
  ec: ErrCtx,
): ApplyResult {
  // Split the combined validation so the caret lands on the offending token.
  if (!isValidIpv4(prefix)) return { session: s, output: badInput(ec, 'prefix') };
  if (!isValidWildcard(wildcard)) return { session: s, output: badInput(ec, 'wildcard') };
  const area = Number.parseInt(areaArg, 10);
  if (!Number.isFinite(area) || area < 0) {
    return { session: s, output: badInput(ec, 'area') };
  }
  const before = s.device.ospf.networks.length;
  s.device.ospf.networks = s.device.ospf.networks.filter(
    (n) => !(n.prefix === prefix && n.wildcard === wildcard && n.area === area),
  );
  if (s.device.ospf.networks.length === before) {
    return { session: s, output: err('% Not found.') };
  }
  return { session: s, output: [] };
}

// ---------- DHCP server: pool config + excluded addresses ----------

/** `ip dhcp pool <name>` — creates the pool if absent, enters config-dhcp. */
function enterDhcpPool(s: Session, name: string): ApplyResult {
  if (!name) return { session: s, output: err('% Pool name required.') };
  if (!s.device.dhcpPools.has(name)) {
    s.device.dhcpPools.set(name, {
      name,
      network: null,
      mask: null,
      defaultRouter: null,
      dnsServer: null,
      leaseDays: null,
    });
  }
  s.mode = 'config-dhcp';
  s.activeDhcpPool = name;
  return { session: s, output: [] };
}

function removeDhcpPool(s: Session, name: string): ApplyResult {
  if (!name) return { session: s, output: err('% Pool name required.') };
  s.device.dhcpPools.delete(name);
  return { session: s, output: [] };
}

/** `ip dhcp excluded-address <start> [end]` — `end` is optional (single host). */
function addDhcpExcluded(
  s: Session,
  start: string,
  end: string | undefined,
  ec: ErrCtx,
): ApplyResult {
  if (!isValidIpv4(start)) {
    return { session: s, output: badInput(ec, 'start') };
  }
  const resolvedEnd = end ?? start;
  if (!isValidIpv4(resolvedEnd)) {
    // Only reachable when `end` was explicitly supplied (an absent end defaults
    // to the already-validated start), so the caret targets the `end` token.
    return { session: s, output: badInput(ec, 'end') };
  }
  if (ipToInt(resolvedEnd) < ipToInt(start)) {
    return { session: s, output: err('% End address must be >= start address.') };
  }
  // Dedup identical (start, end) entries so script replay doesn't accumulate.
  const dupe = s.device.dhcpExcluded.find(
    (r) => r.start === start && r.end === resolvedEnd,
  );
  if (!dupe) s.device.dhcpExcluded.push({ start, end: resolvedEnd });
  return { session: s, output: [] };
}

function removeDhcpExcluded(
  s: Session,
  start: string,
  end: string | undefined,
  ec: ErrCtx,
): ApplyResult {
  if (!isValidIpv4(start)) {
    return { session: s, output: badInput(ec, 'start') };
  }
  const resolvedEnd = end ?? start;
  const before = s.device.dhcpExcluded.length;
  s.device.dhcpExcluded = s.device.dhcpExcluded.filter(
    (r) => !(r.start === start && r.end === resolvedEnd),
  );
  if (s.device.dhcpExcluded.length === before) {
    return { session: s, output: err('% Not found.') };
  }
  return { session: s, output: [] };
}

/** Pull the active DHCP pool for mutation in config-dhcp mode. Returns null
 *  if the mode/active id is somehow desynchronised — the caller emits a
 *  generic IOS error in that case, which should not happen in practice
 *  because the grammar only surfaces these commands in config-dhcp. */
function activeDhcpPool(s: Session): DhcpPool | null {
  if (s.mode !== 'config-dhcp' || !s.activeDhcpPool) return null;
  return s.device.dhcpPools.get(s.activeDhcpPool) ?? null;
}

function setDhcpNetwork(s: Session, ip: string, mask: string, ec: ErrCtx): ApplyResult {
  const pool = activeDhcpPool(s);
  if (!pool) return { session: s, output: err('% No active DHCP pool.') };
  if (!isValidIpv4(ip)) return { session: s, output: badInput(ec, 'ip') };
  if (!isValidMask(mask)) return { session: s, output: err('% Invalid subnet mask.') };
  // Normalize the network address — IOS accepts a host IP and silently
  // applies the mask; we mirror that so `network 192.168.1.123 255.255.255.0`
  // stores `192.168.1.0`.
  pool.network = networkAddress(ip, mask);
  pool.mask = mask;
  return { session: s, output: [] };
}

function clearDhcpNetwork(s: Session): ApplyResult {
  const pool = activeDhcpPool(s);
  if (!pool) return { session: s, output: err('% No active DHCP pool.') };
  pool.network = null;
  pool.mask = null;
  return { session: s, output: [] };
}

function setDhcpDefaultRouter(s: Session, ip: string, ec: ErrCtx): ApplyResult {
  const pool = activeDhcpPool(s);
  if (!pool) return { session: s, output: err('% No active DHCP pool.') };
  if (!isValidIpv4(ip)) return { session: s, output: badInput(ec, 'ip') };
  pool.defaultRouter = ip;
  return { session: s, output: [] };
}

function clearDhcpDefaultRouter(s: Session): ApplyResult {
  const pool = activeDhcpPool(s);
  if (!pool) return { session: s, output: err('% No active DHCP pool.') };
  pool.defaultRouter = null;
  return { session: s, output: [] };
}

function setDhcpDnsServer(s: Session, ip: string, ec: ErrCtx): ApplyResult {
  const pool = activeDhcpPool(s);
  if (!pool) return { session: s, output: err('% No active DHCP pool.') };
  if (!isValidIpv4(ip)) return { session: s, output: badInput(ec, 'ip') };
  pool.dnsServer = ip;
  return { session: s, output: [] };
}

function clearDhcpDnsServer(s: Session): ApplyResult {
  const pool = activeDhcpPool(s);
  if (!pool) return { session: s, output: err('% No active DHCP pool.') };
  pool.dnsServer = null;
  return { session: s, output: [] };
}

function setDhcpLease(s: Session, daysArg: string, ec: ErrCtx): ApplyResult {
  const pool = activeDhcpPool(s);
  if (!pool) return { session: s, output: err('% No active DHCP pool.') };
  const days = Number.parseInt(daysArg, 10);
  if (!Number.isFinite(days) || String(days) !== daysArg || days < 0) {
    return { session: s, output: badInput(ec, 'days') };
  }
  pool.leaseDays = days;
  return { session: s, output: [] };
}

function clearDhcpLease(s: Session): ApplyResult {
  const pool = activeDhcpPool(s);
  if (!pool) return { session: s, output: err('% No active DHCP pool.') };
  pool.leaseDays = null;
  return { session: s, output: [] };
}

/** Parse the standard-ACL number argument. Range is 1-99 (extended is out of
 *  scope; the spec calls it explicitly). Returns null and emits the IOS error
 *  caller-side. */
function parseAclNumber(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || String(n) !== raw) return null;
  if (n < 1 || n > 99) return null;
  return n;
}

/** Apply an `access-list <n> permit|deny ...` line: append an entry to the
 *  numbered ACL (creating it if absent), with a sequence auto-assigned in 10s
 *  matching IOS behavior. Dedup is intentionally NOT performed — IOS will
 *  happily stack identical entries; the lab pedagogy benefits from learners
 *  seeing exactly what they typed in the show output. */
function addAclEntry(
  s: Session,
  numberArg: string,
  action: 'permit' | 'deny',
  command: string[],
  args: Record<string, string>,
  ec: ErrCtx,
): ApplyResult {
  const number = parseAclNumber(numberArg);
  if (number === null) {
    return { session: s, output: badInput(ec, 'number') };
  }
  // command shape:
  //   ['access-list', '<n>', 'permit'|'deny', 'any']
  //   ['access-list', '<n>', 'permit'|'deny', 'host', '<ip>']
  //   ['access-list', '<n>', 'permit'|'deny', '<src>', '<wildcard>']
  const sourceForm = command[3];
  let source: string;
  let wildcard: string | null;
  if (sourceForm === 'any') {
    source = '0.0.0.0';
    wildcard = '255.255.255.255';
  } else if (sourceForm === 'host') {
    if (!isValidIpv4(args.source)) {
      return { session: s, output: badInput(ec, 'source') };
    }
    source = args.source;
    wildcard = null;
  } else {
    // Bare-network form: <src> <wildcard>
    if (!isValidIpv4(args.source)) {
      return { session: s, output: badInput(ec, 'source') };
    }
    if (!isValidIpv4(args.wildcard)) {
      return { session: s, output: badInput(ec, 'wildcard') };
    }
    source = args.source;
    wildcard = args.wildcard;
  }

  let acl = s.device.acls.get(number);
  if (!acl) {
    acl = { number, type: 'standard', entries: [] };
    s.device.acls.set(number, acl);
  }
  const nextSequence = (acl.entries.length + 1) * 10;
  const entry: AclEntry = { sequence: nextSequence, action, source, wildcard };
  acl.entries.push(entry);
  return { session: s, output: [] };
}

/** Remove an entire numbered ACL with `no access-list <n>`. Real IOS errors if
 *  the ACL doesn't exist; we silently no-op to keep teardown-by-script idempotent
 *  (pedagogy doesn't care, and an error would surprise students reading scripts). */
function removeAcl(s: Session, numberArg: string, ec: ErrCtx): ApplyResult {
  const number = parseAclNumber(numberArg);
  if (number === null) {
    return { session: s, output: badInput(ec, 'number') };
  }
  s.device.acls.delete(number);
  return { session: s, output: [] };
}

/** Parse an ACL binding token — accepts a standard ACL number (1-99) or a
 *  named extended ACL identifier (any non-empty string). Numbered IDs are
 *  returned as numbers; names pass through as strings. The downstream
 *  evaluator looks the id up in `device.acls` with the appropriate key type. */
function parseAclId(raw: string): string | number | null {
  if (!raw) return null;
  // Try numbered standard first — if the token parses cleanly as 1-99, use it
  // as a number (so an existing numbered ACL lookup keys match by Number).
  // Out-of-range numbers (e.g. 100) still fall through to a name to keep the
  // surface generic; pedagogically that's fine — the lookup just won't hit
  // an existing ACL and the binding is a no-op.
  const asNumber = parseAclNumber(raw);
  if (asNumber !== null) return asNumber;
  // Names cannot be pure numbers (IOS forbids); the regex enforces that an
  // identifier starts with a letter or underscore. Any other token shape is
  // invalid.
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(raw)) return null;
  return raw;
}

/** Bind an ACL to the current interface in the given direction
 *  (`ip access-group <n|name> in|out`). No-ops if no interface is selected. */
function setAccessGroup(
  s: Session,
  idArg: string,
  direction: 'in' | 'out',
  ec: ErrCtx,
): ApplyResult {
  const aclId = parseAclId(idArg);
  if (aclId === null) {
    return { session: s, output: badInput(ec, 'number') };
  }
  if (!s.currentInterface) return { session: s, output: [] };
  s.device.interfaces[s.currentInterface].accessGroups[direction] = aclId;
  return { session: s, output: [] };
}

/** Unbind an ACL from the current interface (`no ip access-group <n|name>
 *  in|out`). IOS clears the binding regardless of the supplied id — but the
 *  syntax requires the id; we honor that with a soft check that mismatches
 *  still clear (matches real IOS, which is lenient). */
function clearAccessGroup(
  s: Session,
  idArg: string,
  direction: 'in' | 'out',
  ec: ErrCtx,
): ApplyResult {
  const aclId = parseAclId(idArg);
  if (aclId === null) {
    return { session: s, output: badInput(ec, 'number') };
  }
  if (!s.currentInterface) return { session: s, output: [] };
  const iface = s.device.interfaces[s.currentInterface];
  if (iface.accessGroups[direction] === aclId) {
    iface.accessGroups[direction] = null;
  }
  return { session: s, output: [] };
}

// ---------- DHCP relay: ip helper-address <ip> (config-if) ----------

/** Set the active interface's DHCP relay target. Grammar only exposes this in
 *  config-if so currentInterface must be set; defensive guard mirrors the
 *  NAT-role handlers above. */
function setHelperAddress(s: Session, ip: string, ec: ErrCtx): ApplyResult {
  if (!isValidIpv4(ip)) {
    return { session: s, output: badInput(ec, 'ip') };
  }
  if (!s.currentInterface) return { session: s, output: [] };
  s.device.interfaces[s.currentInterface].helperAddress = ip;
  return { session: s, output: [] };
}

/** Clear the active interface's DHCP relay target. */
function clearHelperAddress(s: Session): ApplyResult {
  if (!s.currentInterface) return { session: s, output: [] };
  s.device.interfaces[s.currentInterface].helperAddress = undefined;
  return { session: s, output: [] };
}

// ---------- OSPF interface timers: ip ospf hello-interval|dead-interval <n>
//            (config-if) — Lab 19 ----------

/** Set the active interface's OSPF hello or dead interval (1..65535 sec, the
 *  IOS range). Stored as an explicit override; the recompute layer and show
 *  commands treat an unset field as the protocol default. Grammar exposes this
 *  only in config-if so currentInterface is set — guard defensively like the
 *  NAT/helper handlers so a desynced session no-ops rather than crashing. */
function setOspfTimer(
  s: Session,
  which: 'hello' | 'dead',
  raw: string,
  ec: ErrCtx,
): ApplyResult {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return { session: s, output: badInput(ec, 'seconds') };
  }
  if (!s.currentInterface) return { session: s, output: [] };
  const iface = s.device.interfaces[s.currentInterface];
  if (which === 'hello') iface.ospfHelloInterval = n;
  else iface.ospfDeadInterval = n;
  return { session: s, output: [] };
}

/** Reset the active interface's OSPF hello or dead interval to the protocol
 *  default by clearing the override (`no ip ospf hello-interval`). */
function clearOspfTimer(s: Session, which: 'hello' | 'dead'): ApplyResult {
  if (!s.currentInterface) return { session: s, output: [] };
  const iface = s.device.interfaces[s.currentInterface];
  if (which === 'hello') iface.ospfHelloInterval = undefined;
  else iface.ospfDeadInterval = undefined;
  return { session: s, output: [] };
}

// ---------- OSPF interface authentication: ip ospf authentication
//            message-digest + ip ospf message-digest-key <id> md5 <key>
//            (config-if) — Lab 20 ----------

/** Enable MD5 (message-digest) authentication on the active interface
 *  (`ip ospf authentication message-digest`). Grammar exposes this only in
 *  config-if; guard defensively like the timer handlers. */
function setOspfAuthMessageDigest(s: Session): ApplyResult {
  if (!s.currentInterface) return { session: s, output: [] };
  s.device.interfaces[s.currentInterface].ospfAuthMessageDigest = true;
  return { session: s, output: [] };
}

/** Disable MD5 authentication on the active interface
 *  (`no ip ospf authentication`) — clears the message-digest flag. The key
 *  itself is left intact, matching IOS (the `message-digest-key` line and the
 *  `authentication` line are independent). */
function clearOspfAuthMessageDigest(s: Session): ApplyResult {
  if (!s.currentInterface) return { session: s, output: [] };
  s.device.interfaces[s.currentInterface].ospfAuthMessageDigest = undefined;
  return { session: s, output: [] };
}

/** Set the active interface's OSPF MD5 key (`ip ospf message-digest-key
 *  <key-id> md5 <key>`). key-id is 1..255 (the IOS range); the key string is
 *  taken verbatim. One key per interface is modeled — a second
 *  message-digest-key replaces the first. */
function setOspfMd5Key(s: Session, rawKeyId: string, key: string, ec: ErrCtx): ApplyResult {
  const keyId = Number(rawKeyId);
  if (!Number.isInteger(keyId) || keyId < 1 || keyId > 255) {
    return { session: s, output: badInput(ec, 'key-id') };
  }
  if (!s.currentInterface) return { session: s, output: [] };
  const iface = s.device.interfaces[s.currentInterface];
  iface.ospfMd5KeyId = keyId;
  iface.ospfMd5Key = key;
  return { session: s, output: [] };
}

/** Remove the active interface's OSPF MD5 key (`no ip ospf message-digest-key
 *  <key-id>`). IOS keys the removal by key-id; with a single modeled key we
 *  clear it unconditionally (the grammar still requires the key-id token). */
function clearOspfMd5Key(s: Session): ApplyResult {
  if (!s.currentInterface) return { session: s, output: [] };
  const iface = s.device.interfaces[s.currentInterface];
  iface.ospfMd5KeyId = undefined;
  iface.ospfMd5Key = undefined;
  return { session: s, output: [] };
}

// ---------- NAT: ip nat inside|outside (config-if) + ip nat inside source list
//            <acl> interface <iface> overload (config) ----------

/** Mark the active interface as a NAT boundary in the given direction. The
 *  grammar only exposes this in config-if, so currentInterface must be set —
 *  we still guard defensively so a desynced session reads as a no-op rather
 *  than crashing. */
function setNatRole(s: Session, role: 'inside' | 'outside'): ApplyResult {
  if (!s.currentInterface) return { session: s, output: [] };
  s.device.interfaces[s.currentInterface].natRole = role;
  return { session: s, output: [] };
}

/** Remove the active interface's NAT marking. Real IOS scopes `no ip nat
 *  inside` to clear ONLY when the role matches — `no ip nat outside` on an
 *  inside-marked iface is a silent no-op. We match that to avoid surprising
 *  the learner whose `no` removes a different role than they typed. */
function clearNatRole(s: Session, role: 'inside' | 'outside'): ApplyResult {
  if (!s.currentInterface) return { session: s, output: [] };
  const iface = s.device.interfaces[s.currentInterface];
  if (iface.natRole === role) iface.natRole = undefined;
  return { session: s, output: [] };
}

/** Add `ip nat inside source list <acl> interface <iface> overload`. Replaces
 *  any existing statement bound to the same outside interface so re-running
 *  the command is idempotent — matches Lab 06's ACL-replay friendliness. */
function addNatStatement(
  s: Session,
  aclArg: string,
  ifaceArg: string,
  ec: ErrCtx,
): ApplyResult {
  const aclId = parseAclNumber(aclArg);
  if (aclId === null) {
    return { session: s, output: badInput(ec, 'acl') };
  }
  const ifaceId = normaliseInterface(ifaceArg);
  if (!ifaceId || !s.device.interfaces[ifaceId]) {
    return { session: s, output: err(`% Invalid interface ${ifaceArg}`) };
  }
  s.device.natStatements = s.device.natStatements.filter(
    (st) => st.outsideInterface !== ifaceId,
  );
  const statement: NatStatement = {
    type: 'inside-source-list-overload',
    aclId,
    outsideInterface: ifaceId,
  };
  s.device.natStatements.push(statement);
  return { session: s, output: [] };
}

/** Remove the matching `ip nat inside source list ... overload` statement.
 *  Soft `% Not found.` when nothing matches — same shape as the static-route
 *  / OSPF-network negations. */
function removeNatStatement(
  s: Session,
  aclArg: string,
  ifaceArg: string,
  ec: ErrCtx,
): ApplyResult {
  const aclId = parseAclNumber(aclArg);
  if (aclId === null) {
    return { session: s, output: badInput(ec, 'acl') };
  }
  const ifaceId = normaliseInterface(ifaceArg);
  if (!ifaceId) {
    return { session: s, output: err(`% Invalid interface ${ifaceArg}`) };
  }
  const before = s.device.natStatements.length;
  s.device.natStatements = s.device.natStatements.filter(
    (st) => !(st.aclId === aclId && st.outsideInterface === ifaceId),
  );
  if (s.device.natStatements.length === before) {
    return { session: s, output: err('% Not found.') };
  }
  return { session: s, output: [] };
}

// ---------- Named extended ACLs (Lab 12: `ip access-list extended <name>`) ---

/** Well-known TCP/UDP port names that IOS accepts after `eq` on an extended
 *  ACL. Numeric ports pass through as-is; this map is consulted only when the
 *  user types a name. Not exhaustive — covers the CCNA-relevant set. */
const ACL_PORT_NAMES: Record<string, number> = {
  ftp: 21,
  ssh: 22,
  telnet: 23,
  smtp: 25,
  dns: 53,
  www: 80,
  http: 80,
  https: 443,
};

/** Accept either a numeric port (1-65535) or one of the well-known names in
 *  ACL_PORT_NAMES. Returns the resolved port, or null on invalid input. */
function parseAclPort(raw: string): number | null {
  const named = ACL_PORT_NAMES[raw.toLowerCase()];
  if (named !== undefined) return named;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || String(n) !== raw) return null;
  if (n < 1 || n > 65535) return null;
  return n;
}

/** `ip access-list extended <name>` from config — create the ACL if absent
 *  and enter config-ext-nacl mode for the named ACL. If a same-named ACL
 *  already exists with a different type, refuse (matches IOS behavior). */
function enterExtAcl(s: Session, name: string): ApplyResult {
  if (!name) return { session: s, output: err('% Incomplete command.') };
  const existing = s.device.acls.get(name);
  if (existing && existing.type !== 'extended') {
    return {
      session: s,
      output: err(`% Access-list ${name} already exists with a different type.`),
    };
  }
  if (!existing) {
    s.device.acls.set(name, { name, type: 'extended', entries: [] });
  }
  s.mode = 'config-ext-nacl';
  s.activeAcl = name;
  return { session: s, output: [] };
}

/** `no ip access-list extended <name>` from config — drop the entire ACL. */
function removeExtAcl(s: Session, name: string): ApplyResult {
  if (!name) return { session: s, output: err('% Incomplete command.') };
  s.device.acls.delete(name);
  return { session: s, output: [] };
}

/** Parse the src or dst form (any | host <ip> | <ip> <wildcard>) out of the
 *  resolver's captured args. Args are namespaced per side ('src-ip', etc.) so
 *  the same parser can drive both source and destination. Returns the
 *  canonical (ip, wildcard) pair, or an error string on invalid IPs. */
function parseExtTuple(
  args: Record<string, string>,
  side: 'src' | 'dst',
): { ip: string; wildcard: string } | { errorArg: string } {
  const ipKey = `${side}-ip`;
  const wcKey = `${side}-wildcard`;
  const rawIp = args[ipKey];
  const rawWc = args[wcKey];
  if (rawIp === undefined) {
    // `any` — neither arg was captured.
    return { ip: '0.0.0.0', wildcard: '255.255.255.255' };
  }
  if (!isValidIpv4(rawIp)) {
    // Return the offending arg's grammar name so the caller carets it.
    return { errorArg: ipKey };
  }
  if (rawWc === undefined) {
    // `host <ip>` — the IP was captured under host, no wildcard arg.
    return { ip: rawIp, wildcard: '0.0.0.0' };
  }
  if (!isValidIpv4(rawWc)) {
    return { errorArg: wcKey };
  }
  return { ip: rawIp, wildcard: rawWc };
}

/** Append a permit/deny entry to the active extended ACL. Only valid in
 *  config-ext-nacl mode — the grammar already enforces that, but we
 *  defensively guard for safety in tests that might drive applyCommand
 *  bypassing the mode check. Sequences auto-increment in 10s. */
function addExtAclEntry(
  s: Session,
  action: 'permit' | 'deny',
  command: string[],
  args: Record<string, string>,
  ec: ErrCtx,
): ApplyResult {
  if (s.mode !== 'config-ext-nacl' || !s.activeAcl) {
    return { session: s, output: err('% No active extended ACL.') };
  }
  const acl = s.device.acls.get(s.activeAcl);
  if (!acl || acl.type !== 'extended') {
    return { session: s, output: err('% Invalid ACL state.') };
  }
  // Protocol arrives as a grammar keyword child (ip/tcp/udp/icmp), so the
  // resolver places it at command[1]. Older revisions captured it as a free-
  // form argument under `args.protocol`; the resolver guarantees the
  // structural-children form now, so the cast is safe.
  const protocol = command[1] as 'ip' | 'tcp' | 'udp' | 'icmp';

  const src = parseExtTuple(args, 'src');
  if ('errorArg' in src) return { session: s, output: badInput(ec, src.errorArg) };
  const dst = parseExtTuple(args, 'dst');
  if ('errorArg' in dst) return { session: s, output: badInput(ec, dst.errorArg) };

  // Optional `eq <port>`. Grammar captures it as args.port whenever the user
  // typed `eq <port>`; we surface a clean IOS-style error when the protocol
  // doesn't support ports (icmp/ip) or the port itself doesn't parse.
  let dstPort: number | undefined;
  if (command.includes('eq')) {
    if (protocol === 'icmp' || protocol === 'ip') {
      return {
        session: s,
        output: err(`% eq keyword not supported for protocol ${protocol}`),
      };
    }
    const port = parseAclPort(args.port);
    if (port === null) {
      return { session: s, output: badInput(ec, 'port') };
    }
    dstPort = port;
  }

  const nextSeq =
    acl.entries.length === 0
      ? 10
      : acl.entries[acl.entries.length - 1].sequence + 10;
  const entry: AclEntry = {
    sequence: nextSeq,
    action,
    // Mirror srcIp/srcWildcard into the legacy source/wildcard fields so
    // readers that only inspect those (older code paths, show output for
    // standard rendering) still see sensible values. Extended-only
    // consumers read srcIp/srcWildcard/dstIp/dstWildcard/protocol directly.
    source: src.ip,
    wildcard: src.wildcard,
    protocol,
    srcIp: src.ip,
    srcWildcard: src.wildcard,
    dstIp: dst.ip,
    dstWildcard: dst.wildcard,
    ...(dstPort !== undefined ? { dstPort } : {}),
  };
  acl.entries.push(entry);
  return { session: s, output: [] };
}

/** `no <sequence>` in config-ext-nacl — remove the entry with that line
 *  number. Soft no-op if no matching entry (IOS silently accepts). */
function removeExtAclEntry(s: Session, seqArg: string, ec: ErrCtx): ApplyResult {
  if (s.mode !== 'config-ext-nacl' || !s.activeAcl) {
    return { session: s, output: err('% No active extended ACL.') };
  }
  const acl = s.device.acls.get(s.activeAcl);
  if (!acl || acl.type !== 'extended') {
    return { session: s, output: err('% Invalid ACL state.') };
  }
  const seq = Number.parseInt(seqArg, 10);
  if (!Number.isFinite(seq) || String(seq) !== seqArg) {
    return { session: s, output: badInput(ec, 'sequence') };
  }
  acl.entries = acl.entries.filter((e) => e.sequence !== seq);
  return { session: s, output: [] };
}

/** Render `show ip nat translations`. Empty case mirrors IOS verbatim. Each
 *  entry is the PAT (overload) form — no port tracking, so port columns
 *  display `---`. The translation table is rebuilt by the LabSession's NAT
 *  refresh pass after every state mutation; this handler reads it as-is. */
function showIpNatTranslations(s: Session): string[] {
  if (s.device.natTranslations.size === 0) {
    return ['% There are no entries in the NAT table.'];
  }
  const lines: string[] = [
    'Pro Inside global         Inside local          Outside local         Outside global',
  ];
  for (const t of s.device.natTranslations.values()) {
    lines.push(
      '--- ' +
        t.insideGlobal.padEnd(22) +
        t.insideLocal.padEnd(22) +
        '---'.padEnd(22) +
        '---',
    );
  }
  return lines;
}

/** Render `show ip nat statistics`. Counts of marked interfaces + the active
 *  translation total. Hits is derived from active translations × 4 so the
 *  number scales with how many PCs are translating — close enough for a
 *  recognisable display without modeling per-packet counters. */
function showIpNatStatistics(s: Session): string[] {
  const outsideIfaces: string[] = [];
  const insideIfaces: string[] = [];
  for (const i of Object.values(s.device.interfaces)) {
    if (i.natRole === 'outside') outsideIfaces.push(i.name);
    if (i.natRole === 'inside') insideIfaces.push(i.name);
  }
  const total = s.device.natTranslations.size;
  const lines: string[] = [
    `Total active translations: ${total} (0 static, ${total} dynamic; 0 extended)`,
    'Outside interfaces:',
  ];
  if (outsideIfaces.length === 0) lines.push('  (none)');
  else for (const n of outsideIfaces) lines.push(`  ${n}`);
  lines.push('Inside interfaces:');
  if (insideIfaces.length === 0) lines.push('  (none)');
  else for (const n of insideIfaces) lines.push(`  ${n}`);
  lines.push(`Hits: ${total * 4}  Misses: 0`);
  return lines;
}

function show(
  s: Session,
  command: string[],
  args: Record<string, string>,
): ApplyResult {
  // command = ['show', ...]
  const what = command[1];
  if (what === 'access-lists') {
    // Stamp the verify gate when at least one ACL exists — same shape as
    // lastShowDhcpBinding / lastShowNatTranslations: an empty-table run prints
    // the "no access lists" line but doesn't satisfy a verify objective
    // (the learner has to land at least one ACL definition first).
    if (s.device.acls.size > 0) s.lastShowAccessLists = nextEngineSeq();
    return { session: s, output: out(...showAccessLists(s)) };
  }
  if (what === 'ipv6') {
    if (command[2] === 'interface' && command[3] === 'brief') {
      return { session: s, output: out(...showIpv6InterfaceBrief(s)) };
    }
    if (command[2] === 'route') {
      if (s.ipv6StaticRoutes.length > 0) s.lastShowIpv6Route = nextEngineSeq();
      return { session: s, output: out(...showIpv6Route(s)) };
    }
    return { session: s, output: err('% Incomplete command.') };
  }
  if (what === 'ip') {
    // `show ip interface brief` vs `show ip interface <iface>` vs route vs ospf.
    if (command[2] === 'route') return { session: s, output: out(...showIpRoute(s)) };
    if (command[2] === 'ssh') return { session: s, output: out(...showIpSsh(s)) };
    if (command[2] === 'ospf') {
      if (command[3] === 'neighbor') {
        return { session: s, output: out(...showIpOspfNeighbor(s)) };
      }
      if (command[3] === 'interface') {
        return { session: s, output: out(...showIpOspfInterface(s, args.iface)) };
      }
      // Bare `show ip ospf`. Stamp the verify gate only when at least one
      // interface is passive — mirrors lastShowAccessLists / lastShowDhcpBinding:
      // an observe-before-configure run prints the header without a passive
      // entry and must NOT satisfy a verify objective. The learner has to add
      // passive-interface first, then re-run the show. (Lab 17.)
      if (s.device.ospf.passive.size > 0) s.lastShowIpOspf = nextEngineSeq();
      return { session: s, output: out(...showIpOspf(s)) };
    }
    if (command[2] === 'dhcp') {
      if (command[3] === 'pool') return { session: s, output: out(...showIpDhcpPool(s)) };
      if (command[3] === 'binding') {
        const hasBindings = s.device.dhcpBindings.size > 0;
        // Stamp the verify-objective gate only when the show ran AFTER at
        // least one binding existed. An empty-binding run shows the % line
        // but doesn't satisfy the gate — the learner needs the configure
        // step to land first (mirrors lastShowInterfacesTrunk semantics).
        if (hasBindings) s.lastShowDhcpBinding = nextEngineSeq();
        return { session: s, output: out(...showIpDhcpBinding(s)) };
      }
      if (command[3] === 'conflict') {
        return { session: s, output: out(...showIpDhcpConflict()) };
      }
    }
    if (command[2] === 'nat') {
      if (command[3] === 'translations') {
        // Only stamp the verify gate when the table actually has content —
        // an empty-table run prints the IOS "no entries" line but does NOT
        // satisfy a verify objective (matches lastShowDhcpBinding semantics).
        const hasTranslations = s.device.natTranslations.size > 0;
        if (hasTranslations) s.lastShowNatTranslations = nextEngineSeq();
        return { session: s, output: out(...showIpNatTranslations(s)) };
      }
      if (command[3] === 'statistics') {
        return { session: s, output: out(...showIpNatStatistics(s)) };
      }
    }
    if (command[2] === 'interface') {
      if (command[3] === 'brief') {
        // Stamp at command-eval time — verify-style objectives (`verify-brief`
        // in Lab 09) read this against `subIfConfiguredAt` to require the
        // show to run AFTER the subif came up. Mirrors `lastShowInterfacesTrunk`
        // on switches (Lab 08). Engine seq, not Date.now() — see state.ts.
        s.lastShowIpIntBrief = nextEngineSeq();
        return { session: s, output: out(...showIpIntBrief(s)) };
      }
      if (args.iface) return showIpInterfaceOne(s, args.iface);
    }
    return { session: s, output: out(...showIpIntBrief(s)) };
  }
  if (what === 'interfaces') {
    if (args.iface) return showInterfacesOne(s, args.iface);
    return { session: s, output: out(...showInterfaces(s)) };
  }
  if (what === 'ntp') {
    if (command[2] === 'status') {
      if (s.device.ntp.servers.size > 0) s.lastShowNtpStatus = nextEngineSeq();
      return { session: s, output: out(...showNtpStatus(s)) };
    }
    if (command[2] === 'associations') {
      if (s.device.ntp.servers.size > 0) s.lastShowNtpAssociations = nextEngineSeq();
      return { session: s, output: out(...showNtpAssociations(s)) };
    }
  }
  if (what === 'logging') {
    if (hasManagementServices(s)) s.lastShowLogging = nextEngineSeq();
    return { session: s, output: out(...showLogging(s)) };
  }
  if (what === 'version') return { session: s, output: out(...showVersion(s)) };
  if (what === 'running-config') {
    if (command[2] === 'interface' && args.iface) {
      return showRunningConfigInterface(s, args.iface);
    }
    if (hasSshHardening(s) || hasManagementServices(s)) s.lastShowRunningConfig = nextEngineSeq();
    return { session: s, output: out(...showRunningConfig(s)) };
  }
  return { session: s, output: err('% Incomplete command.') };
}

/** Render `show access-lists`. Empty case matches IOS verbatim. Standard and
 *  extended ACLs render under different headers — numbered standard uses the
 *  ACL number; extended uses the named identifier (Lab 12 only ships named
 *  extended). */
function showAccessLists(s: Session): string[] {
  if (s.device.acls.size === 0) {
    return ['There are no access lists.'];
  }
  const lines: string[] = [];
  for (const acl of s.device.acls.values()) {
    if (acl.type === 'extended') {
      lines.push(`Extended IP access list ${acl.name ?? acl.number}`);
      for (const e of acl.entries) {
        lines.push(formatExtAclEntryLine(e));
      }
    } else {
      const id = acl.number ?? acl.name;
      lines.push(`Standard IP access list ${id}`);
      for (const e of acl.entries) {
        lines.push(formatAclEntryLine(e));
      }
    }
  }
  return lines;
}

/** Render a single extended-ACL entry in `show access-lists` format.
 *
 *  IOS form:
 *    `    10 deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10`
 *    `    20 permit ip any any`
 *    `    30 permit tcp host 10.0.0.1 any eq www`
 *
 *  Normalisations match the IOS display:
 *    - source/dest pair (0.0.0.0, 255.255.255.255) → `any`
 *    - source/dest with wildcard 0.0.0.0 → `host <ip>`
 *    - otherwise → `<ip> <wildcard>`
 *  `dstPort` omitted when absent. */
function formatExtAclEntryLine(e: AclEntry): string {
  const seq = String(e.sequence).padStart(2, ' ');
  const action = e.action;
  const protocol = e.protocol ?? 'ip';
  const src = formatExtTuple(e.srcIp ?? e.source, e.srcWildcard ?? '0.0.0.0');
  const dst = formatExtTuple(e.dstIp ?? '0.0.0.0', e.dstWildcard ?? '0.0.0.0');
  const eq = e.dstPort !== undefined ? ` eq ${e.dstPort}` : '';
  return `    ${seq} ${action} ${protocol} ${src} ${dst}${eq}`;
}

/** (ip, wildcard) → IOS short form: `any` | `host <ip>` | `<ip> <wildcard>`. */
function formatExtTuple(ip: string, wildcard: string): string {
  if (ip === '0.0.0.0' && wildcard === '255.255.255.255') return 'any';
  if (wildcard === '0.0.0.0') return `host ${ip}`;
  return `${ip} ${wildcard}`;
}

/** Single entry in `show access-lists` format.
 *
 *  IOS form:
 *    `    10 permit 192.168.1.0, wildcard bits 0.0.0.255`
 *    `    20 deny   host 192.168.1.10`
 *    `    30 permit any`
 *
 *  We collapse the host case to `host <ip>` and the any case to `any` because
 *  the lab pedagogy reads cleaner when entries echo back the exact form the
 *  learner typed (the spec's example shows the bare-network form with
 *  wildcard bits — both forms appear). The padded action keeps columns
 *  aligned at glance. */
function formatAclEntryLine(e: AclEntry): string {
  const seq = String(e.sequence).padStart(2, ' ');
  const action = e.action.padEnd(6, ' ');
  let body: string;
  if (e.source === '0.0.0.0' && e.wildcard === '255.255.255.255') {
    body = 'any';
  } else if (e.wildcard === null) {
    body = `host ${e.source}`;
  } else {
    body = `${e.source}, wildcard bits ${e.wildcard}`;
  }
  return `    ${seq} ${action} ${body}`;
}

/** Render `show ip interface <iface>`. Minimal: line-protocol state, addressing,
 *  and the two ACL-group lines the lab needs to verify bindings. */
function showIpInterfaceOne(s: Session, ifaceToken: string): ApplyResult {
  const id = normaliseInterface(ifaceToken);
  if (!id || !s.device.interfaces[id]) {
    return { session: s, output: err(`% Invalid interface ${ifaceToken}`) };
  }
  const i = s.device.interfaces[id];
  const state = i.adminUp ? 'up' : 'administratively down';
  const proto = i.adminUp && i.protocolUp ? 'up' : 'down';
  const lines: string[] = [
    `${i.name} is ${state}, line protocol is ${proto}`,
  ];
  if (i.ip && i.mask) {
    lines.push(`  Internet address is ${i.ip}/${maskToCidr(i.mask)}`);
  } else {
    lines.push('  Internet protocol processing disabled');
  }
  const inLine = i.accessGroups.in === null ? 'not set' : `is ${i.accessGroups.in}`;
  const outLine = i.accessGroups.out === null ? 'not set' : `is ${i.accessGroups.out}`;
  lines.push(`  Inbound  access list ${inLine}`);
  lines.push(`  Outbound access list ${outLine}`);
  return { session: s, output: out(...lines) };
}

function showNtpStatus(s: Session): string[] {
  const first = s.device.ntp.servers.values().next().value as { server: string } | undefined;
  if (!first) return ['Clock is unsynchronized, no NTP servers configured'];
  return [
    `Clock is synchronized, stratum 2, reference is ${first.server}`,
    'nominal freq is 250.0000 Hz, actual freq is 250.0000 Hz',
    'precision is 2**24',
    'reference time is 00:00:00.000 UTC Mon Jan 1 2001',
  ];
}

function showIpSsh(s: Session): string[] {
  const sec = s.device.security;
  const enabled = Boolean(sec.domainName && sec.cryptoKeyModulus !== null && sec.vtyTransportInput === 'ssh');
  if (!enabled) {
    return [
      'SSH Disabled - version 2.0',
      '% Please create RSA keys to enable SSH (configure a domain name first).',
    ];
  }

  return [
    'SSH Enabled - version 2.0',
    'Authentication timeout: 120 secs; Authentication retries: 3',
    'Minimum expected Diffie Hellman key size : 1024 bits',
    'IOS Keys in SECSH format(ssh-rsa, base64 encoded):',
    `ssh-rsa ${sec.cryptoKeyModulus}-bit RSA key for ${s.device.hostname}.${sec.domainName}`,
    'Authentication methods:publickey,keyboard-interactive,password',
    'Authentication Publickey Algorithms:x509v3-ssh-rsa,ssh-rsa',
  ];
}

function showNtpAssociations(s: Session): string[] {
  const lines = [
    '  address         ref clock       st   when   poll reach  delay  offset   disp',
  ];
  if (s.device.ntp.servers.size === 0) return [...lines, '  No NTP associations configured.'];
  for (const server of s.device.ntp.servers.values()) {
    lines.push(`*~${server.server.padEnd(15)} .GPS.           1     12     64   377  1.000   0.000  1.000`);
  }
  return lines;
}

function showLogging(s: Session): string[] {
  const lines = [
    'Syslog logging: enabled',
    `Console logging: disabled`,
    `Monitor logging: disabled`,
    `Trap logging: level ${s.device.syslog.trapLevel ?? 'informational'}`,
    `Log Buffer (4096 bytes):`,
  ];
  if (s.device.syslog.serviceTimestampsLogDatetimeMsec) {
    lines.push('Timestamp logging messages: datetime msec');
  }
  if (s.device.syslog.hosts.size === 0) {
    lines.push('No remote logging hosts configured.');
  } else {
    for (const host of s.device.syslog.hosts.values()) lines.push(`Logging to ${host.host}`);
  }
  return lines;
}

function showIpv6Route(s: Session): string[] {
  const lines = ['IPv6 Routing Table - static routes'];
  const connected = Object.values(s.device.interfaces).flatMap((iface) =>
    iface.ipv6Addresses.map((prefix) => `C   ${prefix} is directly connected, ${fullInterfaceName(iface.id)}`),
  );
  const statics = s.ipv6StaticRoutes.map((r) => `S   ${r.prefix} [1/0] via ${r.nextHop}`);
  if (connected.length === 0 && statics.length === 0) return [...lines, 'No IPv6 routes installed.'];
  return [...lines, ...connected, ...statics];
}

function showIpRoute(s: Session): string[] {
  // RIB view: per (prefix, mask) display only the lowest-AD entry. Losers
  // stay in routingTable() so LPM can promote them once a better route is
  // withdrawn — the floating-static teaching point of Lab 16. Stable on
  // tie: the earliest insertion at the winning AD wins, matching §5.
  const full = routingTable(s);
  const winnerIdxByKey = new Map<string, number>();
  full.forEach((r, idx) => {
    const key = `${r.prefix}/${r.mask}`;
    const cur = winnerIdxByKey.get(key);
    if (cur === undefined || r.adminDistance < full[cur].adminDistance) {
      winnerIdxByKey.set(key, idx);
    }
  });
  const winners = new Set(winnerIdxByKey.values());
  const table = full.filter((_, idx) => winners.has(idx));

  // OSPF external default (Lab 21): when an `O*E2` default is installed, IOS
  // adds the E2 legend to the Codes block and prints a "Gateway of last
  // resort" header. Scoped to the OSPF-originated default so static-default
  // labs (15/16) keep their existing, simpler header verbatim.
  const extDefault = table.find(
    (r) =>
      r.source === 'ospf' &&
      r.ospfExternal === true &&
      r.prefix === '0.0.0.0' &&
      r.mask === '0.0.0.0',
  );
  const lines: string[] = ['Codes: C - connected, S - static, O - OSPF'];
  if (extDefault) {
    lines.push('       E2 - OSPF external type 2, * - candidate default');
  }
  lines.push('');
  if (extDefault?.nextHop) {
    lines.push(`Gateway of last resort is ${extDefault.nextHop} to network 0.0.0.0`);
    lines.push('');
  }
  if (table.length === 0) {
    lines.push('No routes installed.');
    return lines;
  }
  // Group by classful network for an IOS-realistic header, but keep it
  // simple — one line per route, no "is variably subnetted" verbiage.
  for (const r of table) {
    const cidr = maskLength(r.mask);
    const code = routeCode(r.source);
    if (r.source === 'ospf' && r.ospfExternal && r.nextHop && r.egressIface) {
      // External Type-2 default from `default-information originate`. The code
      // column is `O*E2` (4 chars + 1 space) so the prefix still aligns at the
      // same column as the single-letter codes' `${code}    ` (1 + 4).
      const ifaceName = fullInterfaceName(r.egressIface);
      const metric = r.metric ?? 1;
      lines.push(
        `O*E2 ${r.prefix}/${cidr} [${r.adminDistance}/${metric}] via ${r.nextHop}, ${ifaceName}`,
      );
    } else if (r.source === 'connected') {
      const ifaceName = r.egressIface
        ? fullInterfaceName(r.egressIface)
        : 'unknown';
      lines.push(`${code}    ${r.prefix}/${cidr} is directly connected, ${ifaceName}`);
    } else if (r.source === 'ospf' && r.nextHop && r.egressIface) {
      const ifaceName = fullInterfaceName(r.egressIface);
      const metric = r.metric ?? 1;
      lines.push(
        `${code}    ${r.prefix}/${cidr} [${r.adminDistance}/${metric}] via ${r.nextHop}, ${ifaceName}`,
      );
    } else if (r.nextHop) {
      lines.push(`${code}    ${r.prefix}/${cidr} [${r.adminDistance}/0] via ${r.nextHop}`);
    } else if (r.egressIface) {
      const ifaceName = fullInterfaceName(r.egressIface);
      lines.push(`${code}    ${r.prefix}/${cidr} [${r.adminDistance}/0] is directly connected, ${ifaceName}`);
    }
  }
  return lines;
}

function routeCode(source: 'connected' | 'static' | 'ospf'): string {
  switch (source) {
    case 'connected': return 'C';
    case 'static': return 'S';
    case 'ospf': return 'O';
  }
}


/** Render `show ip ospf neighbor` — IOS-style table.
 *
 *  Columns: Neighbor ID, Pri, State, Dead Time, Address, Interface. We do not
 *  model timers, so Dead Time is the static placeholder `00:00:38`. On a
 *  broadcast (Ethernet) segment the State column carries the elected role —
 *  `FULL/DR`, `FULL/BDR`, `FULL/DROTHER`. On a point-to-point link no election
 *  runs, so it renders the IOS placeholder `FULL/  -` (literal `-`). */
function showIpOspfNeighbor(s: Session): string[] {
  // IOS prints the header row even when the neighbor table is empty — an
  // empty table reads as "header, no data rows" rather than a friendly
  // "no neighbors" sentence. Lab 13's diagnostic flow relies on the learner
  // seeing the empty header to recognize that adjacency hasn't formed.
  const header =
    'Neighbor ID'.padEnd(16) +
    'Pri'.padEnd(6) +
    'State'.padEnd(20) +
    'Dead Time'.padEnd(12) +
    'Address'.padEnd(16) +
    'Interface';
  const lines = [header];
  for (const [neighborId, n] of s.device.ospf.neighbors) {
    // Broadcast: the elected role suffixes the state (FULL/DR). Point-to-point
    // (role undefined): the IOS `/  -` placeholder.
    const stateCol = n.role ? `${n.state}/${n.role}` : `${n.state}/  -`;
    lines.push(
      neighborId.padEnd(16) +
        '1'.padEnd(6) +
        stateCol.padEnd(20) +
        '00:00:38'.padEnd(12) +
        n.address.padEnd(16) +
        fullInterfaceName(n.interface),
    );
  }
  return lines;
}

/** Render `show ip ospf` — process summary. Minimal but standard-looking.
 *  When at least one interface is `passive-interface`, append the IOS-style
 *  "Passive Interface(s):" block so the learner can confirm the marking
 *  landed (Lab 17 teaching point). */
function showIpOspf(s: Session): string[] {
  const o = s.device.ospf;
  if (o.process === null) {
    return ['% OSPF instance not configured.'];
  }
  const id = o.routerId ?? '0.0.0.0';
  const areas = uniqueAreas(s).length;
  const lines = [
    `Routing Process "ospf ${o.process}" with ID ${id}`,
    'Supports only single TOS(TOS0) routes',
  ];
  // Originating a default route makes the router an ASBR — IOS prints this
  // line and notes the default origination. (Lab 21.) [CONFIRMED-BY-SOURCE:
  // Cisco IOS `show ip ospf` — a router redistributing/originating a default
  // is flagged "It is an autonomous system boundary router".]
  if (o.defaultInfoOriginate) {
    lines.push('It is an autonomous system boundary router');
    lines.push(
      o.defaultInfoAlways
        ? 'Originate Default Route (always)'
        : 'Originate Default Route',
    );
  }
  lines.push(
    `Number of areas in this router is ${areas}. ${areas} normal 0 stub 0 nssa`,
  );
  if (o.passive.size > 0) {
    lines.push('Passive Interface(s):');
    for (const ifaceId of o.passive) {
      lines.push(`  ${fullInterfaceName(ifaceId)}`);
    }
  }
  return lines;
}

/** Render `show ip ospf interface [<iface>]` — per-interface OSPF settings.
 *  The line that matters for Lab 19 is `Timer intervals configured, Hello N,
 *  Dead N, ...`: comparing it on both ends reveals the timer mismatch. With no
 *  iface argument we list every OSPF-enabled interface (covered by a network
 *  statement) in declaration order; with one, we scope to it. Network Type is
 *  driven off the interface hardware type — Ethernet (Gi/Fa) reports BROADCAST
 *  and prints the elected State/DR/BDR block; an up broadcast interface with no
 *  neighbor elects itself DR with no backup. [CONFIRMED-BY-SOURCE: Cisco
 *  13689-17 — verbatim broadcast output incl. "No backup designated router on
 *  this network" when alone.] */
function showIpOspfInterface(s: Session, ifaceToken?: string): string[] {
  const o = s.device.ospf;
  if (o.process === null) return ['% OSPF instance not configured.'];

  let ids: string[];
  if (ifaceToken !== undefined) {
    const id = normaliseInterface(ifaceToken);
    if (!id || !s.device.interfaces[id]) return [`% Invalid interface ${ifaceToken}`];
    ids = [id];
  } else {
    ids = Object.keys(s.device.interfaces).filter((id) => {
      const i = s.device.interfaces[id];
      return i.ip !== null && matchingNetwork(o.networks, i.ip) !== null;
    });
  }

  const lines: string[] = [];
  for (const id of ids) {
    const i = s.device.interfaces[id];
    const state = i.adminUp ? 'up' : 'administratively down';
    const proto = i.adminUp && i.protocolUp ? 'up' : 'down';
    const net = i.ip ? matchingNetwork(o.networks, i.ip) : null;
    if (!net) {
      lines.push(`${i.name} is ${state}, line protocol is ${proto}`);
      lines.push('  OSPF not enabled on this interface');
      continue;
    }
    const hello = i.ospfHelloInterval ?? OSPF_DEFAULT_HELLO_INTERVAL;
    const dead = i.ospfDeadInterval ?? OSPF_DEFAULT_DEAD_INTERVAL;
    const localRid = o.routerId ?? i.ip ?? '0.0.0.0';
    const netType = ospfNetworkType(id);
    lines.push(`${i.name} is ${state}, line protocol is ${proto}`);
    if (i.ip && i.mask) {
      lines.push(`  Internet Address ${i.ip}/${maskToCidr(i.mask)}, Area ${net.area}`);
    }
    lines.push(
      `  Process ID ${o.process}, Router ID ${localRid}, Network Type ${netType}, Cost: 1`,
    );
    // Broadcast segments render the elected State + DR/BDR identities. We
    // reconstruct them from the neighbor table (the role stored there is the
    // neighbor's role, so the local role is its complement). With no neighbor,
    // an up broadcast interface elects itself DR and reports no backup.
    if (netType === 'BROADCAST') {
      lines.push(...broadcastDrBdrLines(s, id, localRid, i.ip ?? '0.0.0.0', proto === 'up'));
    }
    lines.push(
      `  Timer intervals configured, Hello ${hello}, Dead ${dead}, Wait ${dead}, Retransmit 5`,
    );
    // Auth state — the second diagnostic surface for Lab 20. IOS prints the
    // message-digest banner plus the youngest key id when MD5 auth is enabled.
    if (i.ospfAuthMessageDigest) {
      lines.push('  Message digest authentication enabled');
      if (i.ospfMd5KeyId !== undefined) {
        lines.push(`    Youngest key id is ${i.ospfMd5KeyId}`);
      }
    }
  }
  // OSPF configured but no interface is covered by a network statement.
  if (lines.length === 0) return ['% OSPF instance not configured.'];
  return lines;
}

/** The State / Designated Router / Backup Designated Router lines for a
 *  broadcast OSPF interface, derived from the neighbor table (the role stored
 *  there is the neighbor's role, so the local role is its complement). A down
 *  interface has no election; an up interface with no neighbor elects itself
 *  DR and reports no backup. */
function broadcastDrBdrLines(
  s: Session,
  ifaceId: string,
  localRid: string,
  localIp: string,
  up: boolean,
): string[] {
  if (!up) {
    return ['  Transmit Delay is 1 sec, State DOWN, Priority 1'];
  }
  let neighbor: { rid: string; ip: string; role: OspfNeighborRole } | undefined;
  for (const [rid, n] of s.device.ospf.neighbors) {
    if (n.interface === ifaceId && n.role) {
      neighbor = { rid, ip: n.address, role: n.role };
      break;
    }
  }
  if (!neighbor) {
    return [
      '  Transmit Delay is 1 sec, State DR, Priority 1',
      `  Designated Router (ID) ${localRid}, Interface address ${localIp}`,
      '  No backup designated router on this network',
    ];
  }
  // Two-router segment: the local role is the complement of the neighbor's.
  const localRole: OspfNeighborRole = neighbor.role === 'DR' ? 'BDR' : 'DR';
  const dr = neighbor.role === 'DR' ? neighbor : { rid: localRid, ip: localIp };
  const bdr = neighbor.role === 'BDR' ? neighbor : { rid: localRid, ip: localIp };
  return [
    `  Transmit Delay is 1 sec, State ${localRole}, Priority 1`,
    `  Designated Router (ID) ${dr.rid}, Interface address ${dr.ip}`,
    `  Backup Designated router (ID) ${bdr.rid}, Interface address ${bdr.ip}`,
  ];
}

function uniqueAreas(s: Session): number[] {
  const seen = new Set<number>();
  for (const n of s.device.ospf.networks) seen.add(n.area);
  return [...seen];
}

/** Render `show ip dhcp pool`. Empty case mirrors IOS verbatim. Each pool
 *  prints a four-line stanza: network/mask, default gateway, DNS, lease. */
function showIpDhcpPool(s: Session): string[] {
  if (s.device.dhcpPools.size === 0) {
    return ['No DHCP pools configured.'];
  }
  const lines: string[] = [];
  let first = true;
  for (const pool of s.device.dhcpPools.values()) {
    if (!first) lines.push('');
    first = false;
    lines.push(`Pool ${pool.name} :`);
    if (pool.network && pool.mask) {
      lines.push(` Network           : ${pool.network} ${pool.mask}`);
    } else {
      lines.push(' Network           : not configured');
    }
    lines.push(` Default router    : ${pool.defaultRouter ?? 'not configured'}`);
    lines.push(` DNS server        : ${pool.dnsServer ?? 'not configured'}`);
    const leaseDays = pool.leaseDays ?? 1;
    lines.push(` Lease             : ${leaseDays} days 0 hours 0 minutes`);
  }
  return lines;
}

/** Render `show ip dhcp binding`. The IP-address column is left-aligned at
 *  width 17 (matches IOS's column layout — wide enough for /16 octets); the
 *  Client-ID/Hardware-address/User-name column uses the clientId verbatim
 *  (the engine doesn't model MACs). Lease expiration is `--` for our
 *  ephemeral bindings; Type is always `Automatic` (no manual reservations). */
function showIpDhcpBinding(s: Session): string[] {
  if (s.device.dhcpBindings.size === 0) {
    return ['% There is no binding.'];
  }
  const lines: string[] = [
    'IP address       Client-ID/              Lease expiration        Type',
    '                 Hardware address/',
    '                 User name',
  ];
  for (const b of s.device.dhcpBindings.values()) {
    lines.push(
      `${b.ip.padEnd(17)}${b.clientId.padEnd(24)}--                      Automatic`,
    );
  }
  return lines;
}

/** Render `show ip dhcp conflict`. Static — the engine doesn't model
 *  conflicts. Matches the IOS empty-table output verbatim. */
function showIpDhcpConflict(): string[] {
  return [
    'IP address        Detection method   Detection time          VRF',
    '% There are no entries in the database.',
  ];
}

function showIpv6InterfaceBrief(s: Session): string[] {
  const lines: string[] = [];
  for (const i of Object.values(s.device.interfaces)) {
    const state = i.adminUp && i.protocolUp ? 'up/up' : i.adminUp ? 'up/down' : 'administratively down/down';
    if (i.ipv6Addresses.length === 0) {
      lines.push(`${i.name.padEnd(23)} [${state}]`);
      lines.push('    unassigned');
      continue;
    }
    for (const address of i.ipv6Addresses) {
      lines.push(`${i.name.padEnd(23)} [${state}]`);
      lines.push(`    ${address}`);
    }
  }
  return lines;
}

function showIpIntBrief(s: Session): string[] {
  const header =
    'Interface'.padEnd(23) +
    'IP-Address'.padEnd(16) +
    'OK?'.padEnd(4) +
    'Method'.padEnd(7) +
    'Status'.padEnd(22) +
    'Protocol';
  // Group subifs under their parent so the output reads like real IOS — parent
  // first, then its dot1Q subifs in numeric VLAN-tag order.
  const subsByParent = new Map<string, string[]>();
  for (const subId of Object.keys(s.device.subInterfaces)) {
    const parent = s.device.subInterfaces[subId].parentId;
    const list = subsByParent.get(parent) ?? [];
    list.push(subId);
    subsByParent.set(parent, list);
  }
  const subOrder = (a: string, b: string): number => {
    const ta = s.device.subInterfaces[a].dot1qVlan ?? Number.MAX_SAFE_INTEGER;
    const tb = s.device.subInterfaces[b].dot1qVlan ?? Number.MAX_SAFE_INTEGER;
    return ta - tb;
  };
  const rows: string[] = [];
  for (const i of Object.values(s.device.interfaces)) {
    rows.push(formatIntBriefRow(i.name, i.ip, i.adminUp, i.adminUp && i.protocolUp));
    const subs = subsByParent.get(i.id);
    if (!subs) continue;
    for (const subId of subs.slice().sort(subOrder)) {
      const sub = s.device.subInterfaces[subId];
      // Subif line state follows the parent (`i`): both columns derive from the
      // parent — Status mirrors its admin state and Protocol its up/up state, so
      // a shut parent renders the subif "down". Derived live here (not from the
      // stored sub.protocolUp) so the render is correct even in adapter-only
      // unit tests that don't run the LabSession refresh pass.
      rows.push(
        formatIntBriefRow(fullInterfaceName(sub.id), sub.ip, i.adminUp, i.adminUp && i.protocolUp),
      );
    }
  }
  return [header, ...rows];
}

function formatIntBriefRow(
  name: string,
  ip: string | null,
  adminUp: boolean,
  protocolUp: boolean,
): string {
  const ipCol = ip ?? 'unassigned';
  const method = ip ? 'manual' : 'unset';
  const status = adminUp ? 'up' : 'administratively down';
  const proto = protocolUp ? 'up' : 'down';
  return (
    name.padEnd(23) +
    ipCol.padEnd(16) +
    'YES '.padEnd(4) +
    method.padEnd(7) +
    status.padEnd(22) +
    proto
  );
}

function maskToCidr(mask: string): number {
  return mask
    .split('.')
    .reduce((bits, octet) => bits + ((parseInt(octet, 10).toString(2).match(/1/g) ?? []).length), 0);
}

function showInterfaces(s: Session): string[] {
  return Object.values(s.device.interfaces).flatMap((i) => {
    const state = i.adminUp ? 'up' : 'administratively down';
    const proto = i.adminUp && i.protocolUp ? 'up' : 'down';
    const lines = [`${i.name} is ${state}, line protocol is ${proto}`];
    if (i.ip && i.mask) lines.push(`  Internet address is ${i.ip}/${maskToCidr(i.mask)}`);
    else lines.push('  Internet protocol processing disabled');
    return lines;
  });
}

/** Deterministic synthetic MAC: last 4 hex digits from the iface's terminal
 *  slot number, so Gi0/2 → `0000.0000.0002`. Stable per-iface for the lab's
 *  lifetime; identifies the port in the output without requiring a real MAC
 *  pool (this is a simulator, not a network — see CLAUDE.md constraint #2). */
function syntheticMac(ifaceId: string): string {
  const last = ifaceId.split('/').pop() ?? '0';
  const n = Number.parseInt(last, 10);
  const hex = (Number.isFinite(n) ? n : 0).toString(16).padStart(4, '0');
  return `0000.0000.${hex}`;
}

function showInterfacesOne(s: Session, ifaceToken: string): ApplyResult {
  const id = normaliseInterface(ifaceToken);
  if (!id) return { session: s, output: err(`% Invalid interface ${ifaceToken}`) };
  if (isSubInterfaceId(id)) {
    // Lab 09 doesn't require the detailed per-subif block — keeping the
    // detailed renderer scoped to physical interfaces avoids inventing IOS
    // output that nobody validates against. Redirect the learner to the
    // commands that DO show subif state. (Work order §2.6.)
    return {
      session: s,
      output: err(
        `% show interfaces ${ifaceToken} is not implemented in this lab scope. Use \`show ip interface brief\` or \`show running-config interface ${ifaceToken}\`.`,
      ),
    };
  }
  if (!s.device.interfaces[id]) {
    return { session: s, output: err(`% Invalid interface ${ifaceToken}`) };
  }
  const i = s.device.interfaces[id];
  const state = i.adminUp ? 'up' : 'administratively down';
  const proto = i.adminUp && i.protocolUp ? 'up' : 'down';
  const lines: string[] = [
    `${i.name} is ${state}, line protocol is ${proto}`,
    `  Hardware is ${s.device.platform}, address is ${syntheticMac(id)}`,
  ];
  if (i.description) lines.push(`  Description: ${i.description}`);
  if (i.ip && i.mask) {
    lines.push(`  Internet address is ${i.ip}/${maskToCidr(i.mask)}`);
  } else {
    lines.push('  Internet protocol processing disabled');
  }
  lines.push('  MTU 1500 bytes, BW 1000000 Kbit/sec, DLY 10 usec');
  lines.push('  Encapsulation ARPA, loopback not set');
  lines.push('  Keepalive set (10 sec)');
  lines.push('  Full-duplex, 1000Mb/s, link type is auto, media type is RJ45');
  return { session: s, output: out(...lines) };
}

function showRunningConfigInterface(s: Session, ifaceToken: string): ApplyResult {
  const id = normaliseInterface(ifaceToken);
  if (!id) return { session: s, output: err(`% Invalid interface ${ifaceToken}`) };
  if (isSubInterfaceId(id)) {
    const sub = s.device.subInterfaces[id];
    if (!sub) return { session: s, output: err(`% Invalid interface ${ifaceToken}`) };
    const lines: string[] = [`interface ${fullInterfaceName(sub.id)}`];
    if (sub.dot1qVlan !== null) lines.push(` encapsulation dot1Q ${sub.dot1qVlan}`);
    if (sub.ip && sub.mask) lines.push(` ip address ${sub.ip} ${sub.mask}`);
    else lines.push(' no ip address');
    // No ` shutdown` line — a subif has no independent admin state (line
    // state follows the parent physical).
    lines.push('!');
    return { session: s, output: out(...lines) };
  }
  if (!s.device.interfaces[id]) {
    return { session: s, output: err(`% Invalid interface ${ifaceToken}`) };
  }
  const i = s.device.interfaces[id];
  const lines: string[] = [`interface ${i.name}`];
  if (i.description) lines.push(` description ${i.description}`);
  if (i.ip && i.mask) lines.push(` ip address ${i.ip} ${i.mask}`);
  else lines.push(' no ip address');
  if (i.helperAddress) lines.push(` ip helper-address ${i.helperAddress}`);
  if (i.accessGroups.in !== null) lines.push(` ip access-group ${i.accessGroups.in} in`);
  if (i.accessGroups.out !== null) lines.push(` ip access-group ${i.accessGroups.out} out`);
  if (i.natRole === 'inside') lines.push(' ip nat inside');
  else if (i.natRole === 'outside') lines.push(' ip nat outside');
  if (i.ospfHelloInterval !== undefined) lines.push(` ip ospf hello-interval ${i.ospfHelloInterval}`);
  if (i.ospfDeadInterval !== undefined) lines.push(` ip ospf dead-interval ${i.ospfDeadInterval}`);
  if (i.ospfMd5KeyId !== undefined && i.ospfMd5Key !== undefined) {
    lines.push(` ip ospf message-digest-key ${i.ospfMd5KeyId} md5 ${i.ospfMd5Key}`);
  }
  if (i.ospfAuthMessageDigest) lines.push(' ip ospf authentication message-digest');
  if (!i.adminUp) lines.push(' shutdown');
  lines.push('!');
  return { session: s, output: out(...lines) };
}

function showVersion(s: Session): string[] {
  return [
    `Cisco IOS Software, ${s.device.platform} Software`,
    `${s.device.hostname} uptime is 0 minutes`,
    'System image simulated by CertHead Labs',
  ];
}

function showRunningConfig(s: Session): string[] {
  const lines = ['Building configuration...', '', '!', `hostname ${s.device.hostname}`, '!'];
  const sec = s.device.security;
  if (s.device.syslog.serviceTimestampsLogDatetimeMsec) lines.push('service timestamps log datetime msec', '!');
  if (sec.enableSecret) lines.push(`enable secret ${sec.enableSecret}`, '!');
  for (const user of sec.users.values()) lines.push(`username ${user.username} secret ${user.secret}`);
  if (sec.users.size > 0) lines.push('!');
  if (sec.domainName) lines.push(`ip domain-name ${sec.domainName}`, '!');
  if (sec.motdBanner) lines.push(`banner motd ^C${sec.motdBanner}^C`, '!');
  if (sec.cryptoKeyModulus !== null) lines.push(`crypto key generate rsa modulus ${sec.cryptoKeyModulus}`, '!');
  for (const host of s.device.syslog.hosts.values()) lines.push(`logging host ${host.host}`);
  if (s.device.syslog.trapLevel !== null) lines.push(`logging trap ${s.device.syslog.trapLevel}`);
  if (s.device.syslog.hosts.size > 0 || s.device.syslog.trapLevel !== null) lines.push('!');
  for (const server of s.device.ntp.servers.values()) lines.push(`ntp server ${server.server}`);
  if (s.device.ntp.servers.size > 0) lines.push('!');
  // Group subifs under their parent for the dump — IOS prints each subif as
  // its own `interface Gi0/0.10` stanza, in numeric VLAN-tag order, directly
  // after the parent physical's stanza.
  const subsByParent = new Map<string, string[]>();
  for (const subId of Object.keys(s.device.subInterfaces)) {
    const parent = s.device.subInterfaces[subId].parentId;
    const list = subsByParent.get(parent) ?? [];
    list.push(subId);
    subsByParent.set(parent, list);
  }
  for (const i of Object.values(s.device.interfaces)) {
    lines.push(`interface ${i.name}`);
    if (i.description) lines.push(` description ${i.description}`);
    if (i.ip && i.mask) lines.push(` ip address ${i.ip} ${i.mask}`);
    else lines.push(' no ip address');
    if (i.helperAddress) lines.push(` ip helper-address ${i.helperAddress}`);
    if (i.accessGroups.in !== null) lines.push(` ip access-group ${i.accessGroups.in} in`);
    if (i.accessGroups.out !== null) lines.push(` ip access-group ${i.accessGroups.out} out`);
    if (i.natRole === 'inside') lines.push(' ip nat inside');
    else if (i.natRole === 'outside') lines.push(' ip nat outside');
    if (i.ospfHelloInterval !== undefined) lines.push(` ip ospf hello-interval ${i.ospfHelloInterval}`);
    if (i.ospfDeadInterval !== undefined) lines.push(` ip ospf dead-interval ${i.ospfDeadInterval}`);
    if (i.ospfMd5KeyId !== undefined && i.ospfMd5Key !== undefined) {
      lines.push(` ip ospf message-digest-key ${i.ospfMd5KeyId} md5 ${i.ospfMd5Key}`);
    }
    if (i.ospfAuthMessageDigest) lines.push(' ip ospf authentication message-digest');
    if (!i.adminUp) lines.push(' shutdown');
    lines.push('!');
    const subs = subsByParent.get(i.id);
    if (!subs) continue;
    subs.sort(
      (a, b) =>
        (s.device.subInterfaces[a].dot1qVlan ?? Number.MAX_SAFE_INTEGER) -
        (s.device.subInterfaces[b].dot1qVlan ?? Number.MAX_SAFE_INTEGER),
    );
    for (const subId of subs) {
      const sub = s.device.subInterfaces[subId];
      lines.push(`interface ${fullInterfaceName(sub.id)}`);
      if (sub.dot1qVlan !== null) lines.push(` encapsulation dot1Q ${sub.dot1qVlan}`);
      if (sub.ip && sub.mask) lines.push(` ip address ${sub.ip} ${sub.mask}`);
      else lines.push(' no ip address');
      // No ` shutdown` line — subif line state follows the parent physical.
      lines.push('!');
    }
  }
  // Static routes appear between interface blocks and `end` — matches real
  // IOS ordering and ensures a learner running `show running-config` after
  // setup sees the seeded `ip route` lines (cold-audit Fix 5). Per-route
  // target syntax: next-hop IP if set, otherwise the egress interface name.
  for (const r of s.staticRoutes) {
    if (r.source !== 'static') continue;
    const target = r.nextHop ?? (r.egressIface ? fullInterfaceName(r.egressIface) : '');
    if (!target) continue;
    lines.push(`ip route ${r.prefix} ${r.mask} ${target}`);
  }
  if (s.staticRoutes.some((r) => r.source === 'static')) {
    lines.push('!');
  }
  // ACL lines appear after interfaces / routes — matches IOS ordering.
  // Standard numbered ACLs render as `access-list N action ...`; named
  // extended ACLs render as a multi-line `ip access-list extended NAME`
  // stanza, with each entry on its own indented line (Lab 12).
  for (const acl of s.device.acls.values()) {
    if (acl.type === 'extended') {
      lines.push(`ip access-list extended ${acl.name ?? acl.number}`);
      for (const e of acl.entries) {
        lines.push(` ${e.action} ${extEntryRunConfig(e)}`);
      }
    } else {
      for (const e of acl.entries) {
        lines.push(`access-list ${acl.number ?? acl.name} ${e.action} ${aclEntryRunConfig(e)}`);
      }
    }
  }
  if (s.device.acls.size > 0) lines.push('!');
  // NAT statements appear after the ACL block — matches IOS ordering, where
  // the global `ip nat inside source list ... overload` line sits below the
  // access-list it references (Lab 11). `outsideInterface` is the canonical
  // short id; expand via fullInterfaceName so the line reads with the full
  // IOS name (GigabitEthernet0/1) like every other interface reference in
  // this dump and real running-config — the interface NAT roles render in
  // their own stanzas above.
  for (const stmt of s.device.natStatements) {
    lines.push(
      `ip nat inside source list ${stmt.aclId} interface ${fullInterfaceName(stmt.outsideInterface)} overload`,
    );
  }
  if (s.device.natStatements.length > 0) lines.push('!');
  // OSPF block — emitted when the process is configured. Network statements
  // first (preserved insertion order), then passive-interface lines (Lab 17).
  // Matches the order a learner would have typed them and lets the solution
  // disclosure read like a real `show running-config` capture.
  if (s.device.ospf.process !== null) {
    lines.push(`router ospf ${s.device.ospf.process}`);
    for (const n of s.device.ospf.networks) {
      lines.push(` network ${n.prefix} ${n.wildcard} area ${n.area}`);
    }
    for (const ifaceId of s.device.ospf.passive) {
      lines.push(` passive-interface ${fullInterfaceName(ifaceId)}`);
    }
    if (s.device.ospf.defaultInfoOriginate) {
      lines.push(
        s.device.ospf.defaultInfoAlways
          ? ' default-information originate always'
          : ' default-information originate',
      );
    }
    lines.push('!');
  }
  if (sec.vtyLoginLocal || sec.vtyTransportInput !== 'all') {
    lines.push('line vty 0 4');
    if (sec.vtyLoginLocal) lines.push(' login local');
    if (sec.vtyTransportInput !== 'all') lines.push(` transport input ${sec.vtyTransportInput}`);
    lines.push('!');
  }
  lines.push('end');
  return lines;
}

/** Render an ACL entry's source-form for `show running-config`. */
function aclEntryRunConfig(e: AclEntry): string {
  if (e.source === '0.0.0.0' && e.wildcard === '255.255.255.255') return 'any';
  if (e.wildcard === null) return `host ${e.source}`;
  return `${e.source} ${e.wildcard}`;
}

/** Render an EXTENDED ACL entry's body (protocol + src + dst + eq) for the
 *  `ip access-list extended NAME` stanza in `show running-config`. */
function extEntryRunConfig(e: AclEntry): string {
  const protocol = e.protocol ?? 'ip';
  const src = formatExtTuple(e.srcIp ?? e.source, e.srcWildcard ?? '0.0.0.0');
  const dst = formatExtTuple(e.dstIp ?? '0.0.0.0', e.dstWildcard ?? '0.0.0.0');
  const eq = e.dstPort !== undefined ? ` eq ${e.dstPort}` : '';
  return `${protocol} ${src} ${dst}${eq}`;
}
