import { tokenize, resolve, complete } from '@/engine/parser';
import { grammarFor } from './grammar';
import {
  type AclEntry,
  type Mode,
  type Session,
  type SubInterface,
  nextEngineSeq,
  normaliseInterface,
  fullInterfaceName,
  isSubInterfaceId,
  isValidIpv4,
  isValidMask,
  parentInterfaceId,
  prompt as promptFor,
  routingTable,
  deriveRouterId,
} from './state';
import { type Route, maskLength, networkAddress } from './routing';
import type {
  ApplyOptions,
  CommandOutput,
  ApplyResult as GenericApplyResult,
} from '../types';

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
    mode === 'config-router'
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
      if (doForm) return dispatchDo(session, result.command, result.args, raw, opts);
      return dispatch(session, result.command, result.args, raw.trim(), opts);
    }
  }
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
  opts: ApplyOptions | undefined,
): ApplyResult {
  const inner = dispatch(prev, command, args, raw.trim(), opts);
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
      return { session: s, output: [] };

    case 'router':
      // command = ['router', 'ospf'], args.pid = process id
      if (command[1] === 'ospf') return enterRouterOspf(s, args.pid);
      return { session: s, output: err('% Unknown command.') };

    case 'network':
      return addOspfNetwork(s, args.prefix, args.wildcard, args.area);

    case 'hostname':
      s.device.hostname = args.name;
      return { session: s, output: [] };

    case 'interface':
      return enterInterface(s, args.iface);

    case 'encapsulation':
      // command shape in config-subif: ['encapsulation', 'dot1q'], args.vlan
      if (command[1] === 'dot1q') return setEncapsulationDot1q(s, args.vlan);
      return { session: s, output: err('% Unknown command.') };

    case 'description':
      if (s.currentInterface) s.device.interfaces[s.currentInterface].description = args.text;
      return { session: s, output: [] };

    case 'shutdown':
      return setAdmin(s, false);

    case 'no':
      return negate(s, command, args);

    case 'ip':
      // command[1] differentiates ip address (config-if) from ip route (config)
      // from ip access-group (config-if). All three share the `ip` keyword.
      if (command[1] === 'address') return setIpAddress(s, args.ip, args.mask);
      if (command[1] === 'route') return addStaticRoute(s, args.prefix, args.mask, args.target);
      if (command[1] === 'access-group') {
        return setAccessGroup(s, args.number, command[3] as 'in' | 'out');
      }
      return { session: s, output: err('% Incomplete command.') };

    case 'access-list':
      // command = ['access-list', '<num>', 'permit'|'deny', ...source-form]
      return addAclEntry(s, args.number, command[2] as 'permit' | 'deny', command, args);

    case 'show':
      return show(s, command, args);

    case 'write':
      return { session: s, output: out('Building configuration...', '[OK]') };

    default:
      return { session: s, output: err('% Unknown command.') };
  }
}

function enterInterface(s: Session, token: string): ApplyResult {
  const id = normaliseInterface(token);
  if (!id) return { session: s, output: err(`% Invalid input detected at "${token}".`) };
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
      // encapsulation, no ip, admin-down (subifs come up only on no shutdown).
      const sub: SubInterface = {
        id,
        parentId: parent,
        dot1qVlan: null,
        ip: null,
        mask: null,
        adminUp: false,
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
function setEncapsulationDot1q(s: Session, vlanArg: string): ApplyResult {
  if (s.mode !== 'config-subif' || !s.activeSubIfId) {
    return { session: s, output: err('% Invalid input detected at "encapsulation".') };
  }
  const vlan = Number.parseInt(vlanArg, 10);
  if (!Number.isFinite(vlan) || String(vlan) !== vlanArg) {
    return { session: s, output: err(`% Invalid input detected at "${vlanArg}".`) };
  }
  if (vlan < 1 || vlan > 4094) {
    return { session: s, output: err('% VLAN id out of range') };
  }
  s.device.subInterfaces[s.activeSubIfId].dot1qVlan = vlan;
  return { session: s, output: [] };
}

function setIpAddress(s: Session, ip: string, mask: string): ApplyResult {
  if (!isValidIpv4(ip)) return { session: s, output: err(`% Invalid input detected at "${ip}".`) };
  if (!isValidMask(mask)) return { session: s, output: err('% Invalid subnet mask.') };
  if (s.mode === 'config-subif' && s.activeSubIfId) {
    const sub = s.device.subInterfaces[s.activeSubIfId];
    sub.ip = ip;
    sub.mask = mask;
    return { session: s, output: [] };
  }
  if (s.currentInterface) {
    s.device.interfaces[s.currentInterface].ip = ip;
    s.device.interfaces[s.currentInterface].mask = mask;
  }
  return { session: s, output: [] };
}

function setAdmin(s: Session, up: boolean): ApplyResult {
  if (s.mode === 'config-subif' && s.activeSubIfId) {
    return setSubIfAdmin(s, up);
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

/** `[no] shutdown` on the active subinterface. Subif protocol-up resolves to
 *  adminUp AND parent physical's protocolUp; the lab-session refresh pass
 *  re-derives protocolUp after every command, so we set adminUp here and a
 *  provisional protocolUp matching IOS expectations — the refresh corrects
 *  it for the real link-state shortly after. Verify-style objectives compare
 *  `lastShowIpIntBrief` against the per-subif `subIfConfiguredAt` stamp set
 *  here, so the `no shutdown` IS the moment that arms the verify gate. */
function setSubIfAdmin(s: Session, up: boolean): ApplyResult {
  const subId = s.activeSubIfId;
  if (!subId) return { session: s, output: [] };
  const sub = s.device.subInterfaces[subId];
  const changed = sub.adminUp !== up;
  sub.adminUp = up;
  const parent = s.device.interfaces[sub.parentId];
  const parentUp = parent ? parent.adminUp && parent.protocolUp : false;
  sub.protocolUp = up && parentUp;
  if (up && changed) {
    // Stamp so a later `show ip interface brief` can satisfy a verify-style
    // objective for THIS subif. `shutdown` clears the stamp — verifying after
    // a shutdown should not count. Uses the engine's monotonic seq counter
    // (not Date.now()) so the ordering is bulletproof even when commands run
    // in the same millisecond under test.
    s.subIfConfiguredAt[subId] = nextEngineSeq();
    const name = fullInterfaceName(subId);
    const lines: { kind: 'system'; text: string }[] = [
      { kind: 'system', text: `%LINK-5-CHANGED: Interface ${name}, changed state to up` },
    ];
    if (sub.protocolUp) {
      lines.push({
        kind: 'system',
        text: `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to up`,
      });
    }
    return { session: s, output: lines };
  }
  if (!up && changed) {
    delete s.subIfConfiguredAt[subId];
    const name = fullInterfaceName(subId);
    return {
      session: s,
      output: [
        {
          kind: 'system',
          text: `%LINK-5-CHANGED: Interface ${name}, changed state to administratively down`,
        },
        {
          kind: 'system',
          text: `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to down`,
        },
      ],
    };
  }
  return { session: s, output: [] };
}

function negate(s: Session, command: string[], args: Record<string, string>): ApplyResult {
  // command = ['no', ...]
  switch (command[1]) {
    case 'shutdown':
      return setAdmin(s, true);
    case 'hostname':
      s.device.hostname = 'Router';
      return { session: s, output: [] };
    case 'ip':
      if (command[2] === 'route') {
        return removeStaticRoute(s, args.prefix, args.mask, args.target);
      }
      if (command[2] === 'access-group') {
        return clearAccessGroup(s, args.number, command[4] as 'in' | 'out');
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
      return removeAcl(s, args.number);
    case 'network':
      return removeOspfNetwork(s, args.prefix, args.wildcard, args.area);
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
): ApplyResult {
  if (!isValidIpv4(prefix)) {
    return { session: s, output: err(`% Invalid input detected at "${prefix}".`) };
  }
  if (!isValidMask(mask)) return { session: s, output: err('% Invalid subnet mask.') };
  const t = parseRouteTarget(s, target);
  if (!t) return { session: s, output: err(`% Invalid input detected at "${target}".`) };
  // Normalize the prefix to the actual network address so longest-prefix-match
  // works correctly even if the user typed a host bit set.
  const network = networkAddress(prefix, mask);
  const route: Route = {
    prefix: network,
    mask,
    ...t,
    source: 'static',
    adminDistance: 1,
  };
  // Deduplicate: identical entries do not stack.
  const dupe = s.staticRoutes.find(
    (r) =>
      r.prefix === route.prefix &&
      r.mask === route.mask &&
      r.nextHop === route.nextHop &&
      r.egressIface === route.egressIface,
  );
  if (!dupe) s.staticRoutes.push(route);
  return { session: s, output: [] };
}

function removeStaticRoute(
  s: Session,
  prefix: string,
  mask: string,
  target: string,
): ApplyResult {
  if (!isValidIpv4(prefix) || !isValidMask(mask)) {
    return { session: s, output: err('% Invalid input.') };
  }
  const t = parseRouteTarget(s, target);
  if (!t) return { session: s, output: err(`% Invalid input detected at "${target}".`) };
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

function enterRouterOspf(s: Session, pidArg: string): ApplyResult {
  const pid = Number.parseInt(pidArg, 10);
  if (!Number.isFinite(pid) || pid < 1 || pid > 65535 || String(pid) !== pidArg) {
    return { session: s, output: err(`% Invalid input detected at "${pidArg}".`) };
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
): ApplyResult {
  if (!isValidIpv4(prefix)) {
    return { session: s, output: err(`% Invalid input detected at "${prefix}".`) };
  }
  if (!isValidWildcard(wildcard)) {
    return { session: s, output: err(`% Invalid input detected at "${wildcard}".`) };
  }
  const area = Number.parseInt(areaArg, 10);
  if (!Number.isFinite(area) || area < 0 || String(area) !== areaArg) {
    return { session: s, output: err(`% Invalid input detected at "${areaArg}".`) };
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

function removeOspfNetwork(
  s: Session,
  prefix: string,
  wildcard: string,
  areaArg: string,
): ApplyResult {
  if (!isValidIpv4(prefix) || !isValidWildcard(wildcard)) {
    return { session: s, output: err('% Invalid input.') };
  }
  const area = Number.parseInt(areaArg, 10);
  if (!Number.isFinite(area) || area < 0) {
    return { session: s, output: err('% Invalid input.') };
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
): ApplyResult {
  const number = parseAclNumber(numberArg);
  if (number === null) {
    return { session: s, output: err(`% Invalid input detected at "${numberArg}".`) };
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
      return { session: s, output: err(`% Invalid input detected at "${args.source}".`) };
    }
    source = args.source;
    wildcard = null;
  } else {
    // Bare-network form: <src> <wildcard>
    if (!isValidIpv4(args.source)) {
      return { session: s, output: err(`% Invalid input detected at "${args.source}".`) };
    }
    if (!isValidIpv4(args.wildcard)) {
      return { session: s, output: err(`% Invalid input detected at "${args.wildcard}".`) };
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
function removeAcl(s: Session, numberArg: string): ApplyResult {
  const number = parseAclNumber(numberArg);
  if (number === null) {
    return { session: s, output: err(`% Invalid input detected at "${numberArg}".`) };
  }
  s.device.acls.delete(number);
  return { session: s, output: [] };
}

/** Bind an ACL to the current interface in the given direction
 *  (`ip access-group <n> in|out`). No-ops if no interface is selected. */
function setAccessGroup(
  s: Session,
  numberArg: string,
  direction: 'in' | 'out',
): ApplyResult {
  const number = parseAclNumber(numberArg);
  if (number === null) {
    return { session: s, output: err(`% Invalid input detected at "${numberArg}".`) };
  }
  if (!s.currentInterface) return { session: s, output: [] };
  s.device.interfaces[s.currentInterface].accessGroups[direction] = number;
  return { session: s, output: [] };
}

/** Unbind an ACL from the current interface (`no ip access-group <n> in|out`).
 *  IOS clears the binding regardless of the supplied number — but the syntax
 *  requires the number; we honor that with a soft check that mismatches still
 *  clear (matches real IOS, which is lenient). */
function clearAccessGroup(
  s: Session,
  numberArg: string,
  direction: 'in' | 'out',
): ApplyResult {
  const number = parseAclNumber(numberArg);
  if (number === null) {
    return { session: s, output: err(`% Invalid input detected at "${numberArg}".`) };
  }
  if (!s.currentInterface) return { session: s, output: [] };
  const iface = s.device.interfaces[s.currentInterface];
  if (iface.accessGroups[direction] === number) {
    iface.accessGroups[direction] = null;
  }
  return { session: s, output: [] };
}

function show(
  s: Session,
  command: string[],
  args: Record<string, string>,
): ApplyResult {
  // command = ['show', ...]
  const what = command[1];
  if (what === 'access-lists') return { session: s, output: out(...showAccessLists(s)) };
  if (what === 'ip') {
    // `show ip interface brief` vs `show ip interface <iface>` vs route vs ospf.
    if (command[2] === 'route') return { session: s, output: out(...showIpRoute(s)) };
    if (command[2] === 'ospf') {
      if (command[3] === 'neighbor') {
        return { session: s, output: out(...showIpOspfNeighbor(s)) };
      }
      return { session: s, output: out(...showIpOspf(s)) };
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
  if (what === 'version') return { session: s, output: out(...showVersion(s)) };
  if (what === 'running-config') {
    if (command[2] === 'interface' && args.iface) {
      return showRunningConfigInterface(s, args.iface);
    }
    return { session: s, output: out(...showRunningConfig(s)) };
  }
  return { session: s, output: err('% Incomplete command.') };
}

/** Render `show access-lists`. Empty case matches IOS verbatim. */
function showAccessLists(s: Session): string[] {
  if (s.device.acls.size === 0) {
    return ['There are no access lists.'];
  }
  const lines: string[] = [];
  for (const acl of s.device.acls.values()) {
    lines.push(`Standard IP access list ${acl.number}`);
    for (const e of acl.entries) {
      lines.push(formatAclEntryLine(e));
    }
  }
  return lines;
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

function showIpRoute(s: Session): string[] {
  const lines: string[] = [
    'Codes: C - connected, S - static, O - OSPF',
    '',
  ];
  const table = routingTable(s);
  if (table.length === 0) {
    lines.push('No routes installed.');
    return lines;
  }
  // Group by classful network for an IOS-realistic header, but keep it
  // simple — one line per route, no "is variably subnetted" verbiage.
  for (const r of table) {
    const cidr = maskLength(r.mask);
    const code = routeCode(r.source);
    if (r.source === 'connected') {
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
 *  model timers, so Dead Time is the static placeholder `00:00:38`. For p2p
 *  links the DR/BDR election is skipped, so the State column omits the
 *  `/ROLE` suffix (the spec example shows `FULL/  -` — a literal `-` to mean
 *  "no DR election"; we keep that exact rendering). */
function showIpOspfNeighbor(s: Session): string[] {
  if (s.device.ospf.neighbors.size === 0) {
    return ['No OSPF neighbors found.'];
  }
  const header =
    'Neighbor ID'.padEnd(16) +
    'Pri'.padEnd(6) +
    'State'.padEnd(20) +
    'Dead Time'.padEnd(12) +
    'Address'.padEnd(16) +
    'Interface';
  const lines = [header];
  for (const [neighborId, n] of s.device.ospf.neighbors) {
    lines.push(
      neighborId.padEnd(16) +
        '1'.padEnd(6) +
        `${n.state}/  -`.padEnd(20) +
        '00:00:38'.padEnd(12) +
        n.address.padEnd(16) +
        fullInterfaceName(n.interface),
    );
  }
  return lines;
}

/** Render `show ip ospf` — process summary. Minimal but standard-looking. */
function showIpOspf(s: Session): string[] {
  const o = s.device.ospf;
  if (o.process === null) {
    return ['% OSPF instance not configured.'];
  }
  const id = o.routerId ?? '0.0.0.0';
  const areas = uniqueAreas(s).length;
  return [
    `Routing Process "ospf ${o.process}" with ID ${id}`,
    'Supports only single TOS(TOS0) routes',
    `Number of areas in this router is ${areas}. ${areas} normal 0 stub 0 nssa`,
  ];
}

function uniqueAreas(s: Session): number[] {
  const seen = new Set<number>();
  for (const n of s.device.ospf.networks) seen.add(n.area);
  return [...seen];
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
      rows.push(
        formatIntBriefRow(fullInterfaceName(sub.id), sub.ip, sub.adminUp, sub.protocolUp),
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
    if (!sub.adminUp) lines.push(' shutdown');
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
    if (i.accessGroups.in !== null) lines.push(` ip access-group ${i.accessGroups.in} in`);
    if (i.accessGroups.out !== null) lines.push(` ip access-group ${i.accessGroups.out} out`);
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
      if (!sub.adminUp) lines.push(' shutdown');
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
  // ACL lines appear after interfaces / routes — matches IOS ordering. Each
  // entry collapses to its source form (any / host / network+wildcard).
  for (const acl of s.device.acls.values()) {
    for (const e of acl.entries) {
      lines.push(`access-list ${acl.number} ${e.action} ${aclEntryRunConfig(e)}`);
    }
  }
  if (s.device.acls.size > 0) lines.push('!');
  lines.push('end');
  return lines;
}

/** Render an ACL entry's source-form for `show running-config`. */
function aclEntryRunConfig(e: AclEntry): string {
  if (e.source === '0.0.0.0' && e.wildcard === '255.255.255.255') return 'any';
  if (e.wildcard === null) return `host ${e.source}`;
  return `${e.source} ${e.wildcard}`;
}
