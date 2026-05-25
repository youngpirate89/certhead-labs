import { tokenize, resolve, complete } from '@/engine/parser';
import { grammarFor } from './grammar';
import {
  type Mode,
  type Session,
  normaliseInterface,
  fullInterfaceName,
  isValidIpv4,
  isValidMask,
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
  return mode === 'config' || mode === 'config-if' || mode === 'config-router';
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

    case 'description':
      if (s.currentInterface) s.device.interfaces[s.currentInterface].description = args.text;
      return { session: s, output: [] };

    case 'shutdown':
      return setAdmin(s, false);

    case 'no':
      return negate(s, command, args);

    case 'ip':
      // command[1] differentiates ip address (config-if) from ip route (config).
      if (command[1] === 'address') return setIpAddress(s, args.ip, args.mask);
      if (command[1] === 'route') return addStaticRoute(s, args.prefix, args.mask, args.target);
      return { session: s, output: err('% Incomplete command.') };

    case 'show':
      return show(s, command);

    case 'write':
      return { session: s, output: out('Building configuration...', '[OK]') };

    default:
      return { session: s, output: err('% Unknown command.') };
  }
}

function enterInterface(s: Session, token: string): ApplyResult {
  const id = normaliseInterface(token);
  if (!id) return { session: s, output: err(`% Invalid input detected at "${token}".`) };
  if (!s.device.interfaces[id]) {
    return { session: s, output: err(`% Invalid interface ${fullInterfaceName(id)}`) };
  }
  s.mode = 'config-if';
  s.currentInterface = id;
  return { session: s, output: [] };
}

function setIpAddress(s: Session, ip: string, mask: string): ApplyResult {
  if (!isValidIpv4(ip)) return { session: s, output: err(`% Invalid input detected at "${ip}".`) };
  if (!isValidMask(mask)) return { session: s, output: err('% Invalid subnet mask.') };
  if (s.currentInterface) {
    s.device.interfaces[s.currentInterface].ip = ip;
    s.device.interfaces[s.currentInterface].mask = mask;
  }
  return { session: s, output: [] };
}

function setAdmin(s: Session, up: boolean): ApplyResult {
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
      // `no ip address` (config-if): clear the interface's IP.
      if (s.currentInterface) {
        s.device.interfaces[s.currentInterface].ip = null;
        s.device.interfaces[s.currentInterface].mask = null;
      }
      return { session: s, output: [] };
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

function show(s: Session, command: string[]): ApplyResult {
  // command = ['show', ...]
  const what = command[1];
  if (what === 'ip') {
    // `show ip interface brief` vs `show ip route` vs `show ip ospf [neighbor]`.
    if (command[2] === 'route') return { session: s, output: out(...showIpRoute(s)) };
    if (command[2] === 'ospf') {
      if (command[3] === 'neighbor') {
        return { session: s, output: out(...showIpOspfNeighbor(s)) };
      }
      return { session: s, output: out(...showIpOspf(s)) };
    }
    return { session: s, output: out(...showIpIntBrief(s)) };
  }
  if (what === 'interfaces') return { session: s, output: out(...showInterfaces(s)) };
  if (what === 'version') return { session: s, output: out(...showVersion(s)) };
  if (what === 'running-config') return { session: s, output: out(...showRunningConfig(s)) };
  return { session: s, output: err('% Incomplete command.') };
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
  const rows = Object.values(s.device.interfaces).map((i) => {
    const ip = i.ip ?? 'unassigned';
    const method = i.ip ? 'manual' : 'unset';
    const status = i.adminUp ? 'up' : 'administratively down';
    // Protocol column tracks line-protocol state. Admin-down forces it down;
    // otherwise it follows the lab-session-refreshed protocolUp (false when
    // the cabled peer is admin-down — real IOS shows up/down in that case).
    const proto = i.adminUp && i.protocolUp ? 'up' : 'down';
    return (
      i.name.padEnd(23) +
      ip.padEnd(16) +
      'YES '.padEnd(4) +
      method.padEnd(7) +
      status.padEnd(22) +
      proto
    );
  });
  return [header, ...rows];
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

function showVersion(s: Session): string[] {
  return [
    `Cisco IOS Software, ${s.device.platform} Software`,
    `${s.device.hostname} uptime is 0 minutes`,
    'System image simulated by CertHead Labs',
  ];
}

function showRunningConfig(s: Session): string[] {
  const lines = ['Building configuration...', '', '!', `hostname ${s.device.hostname}`, '!'];
  for (const i of Object.values(s.device.interfaces)) {
    lines.push(`interface ${i.name}`);
    if (i.description) lines.push(` description ${i.description}`);
    if (i.ip && i.mask) lines.push(` ip address ${i.ip} ${i.mask}`);
    else lines.push(' no ip address');
    if (!i.adminUp) lines.push(' shutdown');
    lines.push('!');
  }
  lines.push('end');
  return lines;
}
