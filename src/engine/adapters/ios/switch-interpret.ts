/**
 * Switch command dispatcher — mirrors interpret.ts for routers.
 *
 * Resolves a raw command line against the active mode's grammar, then
 * dispatches by the resolved head keyword(s). Pure: returns a NEW session,
 * never mutates the input.
 *
 * `opts.record === false` runs the command for its side effects but
 * suppresses the history pushes — used by Lab.setup seeding so pre-configured
 * state does not pre-satisfy verification objectives.
 */
import { tokenize, resolve, complete } from '@/engine/parser';
import { switchGrammarFor } from './switch-grammar';
import {
  type LacpMode,
  type PortChannel,
  type SwitchMode,
  type SwitchSession,
  type Switchport,
  type Vlan,
  ROOT_PRIMARY_PRIORITY,
  defaultVlanName,
  formatVlanList,
  fullSwitchportName,
  isReservedVlan,
  isValidChannelGroup,
  isValidVlanId,
  makePortChannel,
  makeSpanningTreeVlan,
  normalisePortChannelId,
  normaliseSwitchportId,
  parseVlanList,
  switchPrompt,
} from './switch-state';
import type {
  ApplyOptions,
  CommandOutput,
  ApplyResult as GenericApplyResult,
} from '../types';

export type ApplyResult = GenericApplyResult<SwitchSession>;

const err = (text: string): CommandOutput[] => [{ kind: 'error', text }];
const out = (...lines: string[]): CommandOutput[] =>
  lines.map((text) => ({ kind: 'output', text }));

function isConfigFamily(mode: SwitchMode): boolean {
  return mode === 'config' || mode === 'config-if' || mode === 'config-vlan';
}

/** IOS-authentic invalid-input caret error (same renderer as routers). */
function invalidInputOutput(promptStr: string, charOffset: number): CommandOutput[] {
  const renderedPromptLen = promptStr.length + 1;
  const caretLine = ' '.repeat(renderedPromptLen + charOffset) + '^';
  return [
    { kind: 'error', text: caretLine },
    { kind: 'error', text: "% Invalid input detected at '^' marker." },
  ];
}

/**
 * Error-rendering context threaded into the switch dispatch handlers so
 * handler-level argument validation emits the same caret + message as the
 * resolver's invalid-input path. Mirrors the router adapter's ErrCtx —
 * `argOffsets` maps each resolved argument's name to its token's char offset
 * within the (sanitized) typed line.
 */
interface ErrCtx {
  readonly promptStr: string;
  readonly argOffsets: Readonly<Record<string, number>>;
}

/** Emit the IOS invalid-input caret error under the named argument's token.
 *  Single sink for switch handler-level validation failures. */
function badInput(ec: ErrCtx, argName: string): CommandOutput[] {
  return invalidInputOutput(ec.promptStr, ec.argOffsets[argName] ?? 0);
}

export function applySwitchCommand(
  session: SwitchSession,
  raw: string,
  opts?: ApplyOptions,
): ApplyResult {
  const { tokens, offsets } = tokenize(raw);
  if (tokens.length === 0) return { session, output: [] };

  const promptStr = switchPrompt(session);

  let grammar = switchGrammarFor(session.mode);
  let activeTokens: readonly string[] = tokens;
  let activeOffsets: readonly number[] = offsets;
  let doForm = false;

  if (isConfigFamily(session.mode) && tokens[0] === 'do') {
    if (tokens.length === 1) {
      return {
        session,
        output: invalidInputOutput(promptStr, offsets[0] + tokens[0].length),
      };
    }
    doForm = true;
    grammar = switchGrammarFor('priv');
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
      const argOffsets: Record<string, number> = {};
      for (const [name, idx] of Object.entries(result.argPositions)) {
        argOffsets[name] = activeOffsets[idx];
      }
      const ec: ErrCtx = { promptStr, argOffsets };
      if (doForm) return dispatchDo(session, result.command, result.args, raw, ec, opts);
      return dispatch(session, result.command, result.args, raw.trim(), ec, opts);
    }
  }
}

function dispatchDo(
  prev: SwitchSession,
  command: string[],
  args: Record<string, string>,
  raw: string,
  ec: ErrCtx,
  opts: ApplyOptions | undefined,
): ApplyResult {
  const inner = dispatch(prev, command, args, raw.trim(), ec, opts);
  const record = opts?.record !== false;
  const last = inner.session.resolvedHistory.length - 1;
  const fixed: SwitchSession = {
    ...inner.session,
    mode: prev.mode,
    currentInterface: prev.currentInterface,
    currentVlan: prev.currentVlan,
    resolvedHistory: record
      ? inner.session.resolvedHistory.map((cmd, i) =>
          i === last ? `do ${cmd}` : cmd,
        )
      : inner.session.resolvedHistory,
  };
  return { session: fixed, output: inner.output };
}

export function tabCompleteSwitch(session: SwitchSession, line: string): string | null {
  if (line.length === 0 || /\s$/.test(line)) return null;
  const allTokens = line.split(/\s+/).filter(Boolean);
  if (allTokens.length === 0) return null;
  const partial = allTokens[allTokens.length - 1];
  const resolved = allTokens.slice(0, -1);
  const result = complete(resolved, switchGrammarFor(session.mode), partial);
  if (result.kind !== 'ok' || result.completions.length !== 1) return null;
  const keyword = result.completions[0].keyword;
  return [...resolved, keyword].join(' ') + ' ';
}

export function contextHelpSwitch(session: SwitchSession, partialLine: string): CommandOutput[] {
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

  const result = complete(resolved, switchGrammarFor(session.mode), partial);

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
  prev: SwitchSession,
  command: string[],
  args: Record<string, string>,
  raw: string,
  ec: ErrCtx,
  opts: ApplyOptions | undefined,
): ApplyResult {
  const s: SwitchSession = structuredClone(prev);
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
      } else if (s.mode === 'config-vlan') {
        s.mode = 'config';
        s.currentVlan = null;
      } else if (s.mode === 'config') {
        s.mode = 'priv';
      } else if (s.mode === 'priv') {
        s.mode = 'user';
      }
      return { session: s, output: [] };

    case 'end':
      s.mode = 'priv';
      s.currentInterface = null;
      s.currentVlan = null;
      return { session: s, output: [] };

    case 'hostname':
      s.device.hostname = args.name;
      return { session: s, output: [] };

    case 'interface':
      if (command[1] === 'port-channel') return enterPortChannel(s, args.id, ec);
      return enterInterface(s, args.iface, ec);

    case 'vlan':
      return enterVlan(s, args.id, ec);

    case 'name':
      return setVlanName(s, args.name);

    case 'switchport':
      return handleSwitchport(s, command, args, ec);

    case 'channel-group':
      return setChannelGroup(s, args.id, command[3] as LacpMode, ec);

    case 'spanning-tree':
      if (s.mode === 'config-if') return setInterfaceSpanningTree(s, command);
      return setSpanningTree(s, command, args, ec);

    case 'ip':
      // `ip address <ip> <mask>` on a switchport — explicitly rejected on L2.
      if (command[1] === 'address') {
        return {
          session: s,
          output: err('% IP addresses may not be configured on L2 links'),
        };
      }
      return { session: s, output: err('% Incomplete command.') };

    case 'description':
      {
        const port = currentPhysicalSwitchport(s);
        if (port) port.description = args.text;
      }
      return { session: s, output: [] };

    case 'shutdown':
      return setSwitchportAdmin(s, false);

    case 'no':
      return negate(s, command, args, ec);

    case 'show':
      return show(s, command, args, ec, opts);

    case 'write':
      return { session: s, output: out('Building configuration...', '[OK]') };

    default:
      return { session: s, output: err('% Unknown command.') };
  }
}

function enterInterface(s: SwitchSession, token: string, ec: ErrCtx): ApplyResult {
  const id = normaliseSwitchportId(token);
  if (!id) {
    const po = normalisePortChannelId(token);
    if (po !== null) return enterPortChannel(s, String(po), ec);
    return { session: s, output: badInput(ec, 'iface') };
  }
  if (!s.device.switchports[id]) {
    return { session: s, output: err(`% Invalid interface ${fullSwitchportName(id)}`) };
  }
  s.mode = 'config-if';
  s.currentInterface = id;
  s.currentVlan = null;
  return { session: s, output: [] };
}

function enterPortChannel(s: SwitchSession, idArg: string, ec: ErrCtx): ApplyResult {
  const id = Number.parseInt(idArg, 10);
  if (String(id) !== idArg || !isValidChannelGroup(id)) {
    return { session: s, output: badInput(ec, 'id') };
  }
  if (!s.device.portChannels.has(id)) {
    s.device.portChannels.set(id, makePortChannel(id));
  }
  s.mode = 'config-if';
  s.currentInterface = `Po${id}`;
  s.currentVlan = null;
  return { session: s, output: [] };
}

function currentSwitchportTarget(s: SwitchSession): Switchport | PortChannel | null {
  if (s.currentInterface === null) return null;
  const po = normalisePortChannelId(s.currentInterface);
  if (po !== null) return s.device.portChannels.get(po) ?? null;
  return s.device.switchports[s.currentInterface] ?? null;
}

function currentPhysicalSwitchport(s: SwitchSession): Switchport | null {
  if (s.currentInterface === null) return null;
  return s.device.switchports[s.currentInterface] ?? null;
}

function ensurePortChannel(s: SwitchSession, id: number): PortChannel {
  let po = s.device.portChannels.get(id);
  if (!po) {
    po = makePortChannel(id);
    s.device.portChannels.set(id, po);
  }
  return po;
}

/** `channel-group <id> mode active|passive|on` on a physical switchport.
 *  Assigns the port to an EtherChannel group and records the LACP mode. The
 *  logical Port-channel interface is auto-created on first reference (real IOS
 *  does the same). Whether the group actually bundles is a DERIVED, cross-
 *  device decision computed by recomputeEtherchannel in the refresh pass — this
 *  handler only records intent. Rejected on a Port-channel interface (the group
 *  is a property of member ports, not of the aggregator). */
function setChannelGroup(
  s: SwitchSession,
  idArg: string,
  mode: LacpMode,
  ec: ErrCtx,
): ApplyResult {
  const port = currentPhysicalSwitchport(s);
  if (!port) {
    return {
      session: s,
      output: err('% Channel-group can only be configured on a physical interface.'),
    };
  }
  const id = Number.parseInt(idArg, 10);
  if (String(id) !== idArg || !isValidChannelGroup(id)) {
    return { session: s, output: badInput(ec, 'id') };
  }
  ensurePortChannel(s, id);
  port.channelGroup = id;
  port.lacpMode = mode;
  return { session: s, output: [] };
}


function setInterfaceSpanningTree(s: SwitchSession, command: string[]): ApplyResult {
  const port = currentPhysicalSwitchport(s);
  if (!port) return { session: s, output: [] };
  if (command[1] === 'portfast') {
    port.stpPortfast = true;
    return { session: s, output: [] };
  }
  if (command[1] === 'bpduguard' && command[2] === 'enable') {
    port.bpduGuard = true;
    return { session: s, output: [] };
  }
  return { session: s, output: err('% Incomplete command.') };
}

function setSpanningTree(
  s: SwitchSession,
  command: string[],
  args: Record<string, string>,
  ec: ErrCtx,
): ApplyResult {
  const vlanId = Number.parseInt(args.id, 10);
  if (!isValidVlanId(vlanId) || String(vlanId) !== args.id || isReservedVlan(vlanId)) {
    return { session: s, output: badInput(ec, 'id') };
  }
  if (!s.device.vlans.has(vlanId)) {
    s.device.vlans.set(vlanId, { id: vlanId, name: defaultVlanName(vlanId), active: true });
  }
  if (command[3] === 'priority') {
    const priority = Number.parseInt(args.priority, 10);
    if (String(priority) !== args.priority || priority < 0 || priority > 61440 || priority % 4096 !== 0) {
      return { session: s, output: badInput(ec, 'priority') };
    }
    s.device.spanningTree.set(vlanId, { vlanId, priority, rootRole: null });
    return { session: s, output: [] };
  }
  if (command[3] === 'root') {
    const role = command[4] === 'primary' ? 'primary' : 'secondary';
    s.device.spanningTree.set(vlanId, makeSpanningTreeVlan(vlanId, role));
    return { session: s, output: [] };
  }
  return { session: s, output: err('% Incomplete command.') };
}

function enterVlan(s: SwitchSession, idArg: string, ec: ErrCtx): ApplyResult {
  const id = Number.parseInt(idArg, 10);
  if (!isValidVlanId(id) || String(id) !== idArg) {
    return { session: s, output: badInput(ec, 'id') };
  }
  if (isReservedVlan(id)) {
    return {
      session: s,
      output: err(
        '% VLAN ids 1002-1005 are reserved for Token Ring and FDDI and cannot be configured',
      ),
    };
  }
  if (!s.device.vlans.has(id)) {
    s.device.vlans.set(id, { id, name: defaultVlanName(id), active: true });
  }
  s.mode = 'config-vlan';
  s.currentVlan = id;
  s.currentInterface = null;
  return { session: s, output: [] };
}

function setVlanName(s: SwitchSession, name: string): ApplyResult {
  if (s.currentVlan === null) return { session: s, output: [] };
  const v = s.device.vlans.get(s.currentVlan);
  if (!v) return { session: s, output: [] };
  v.name = name;
  return { session: s, output: [] };
}

function handleSwitchport(
  s: SwitchSession,
  command: string[],
  args: Record<string, string>,
  ec: ErrCtx,
): ApplyResult {
  // command shape:
  //   ['switchport', 'mode', 'access']
  //   ['switchport', 'mode', 'trunk' | 'dynamic', ...]
  //   ['switchport', 'access', 'vlan', '<id>']
  if (s.currentInterface === null) {
    // Switchport commands only meaningful inside config-if. Grammar guards
    // this at the structural level (no `switchport` in config), but the
    // dispatch is defensive too.
    return { session: s, output: [] };
  }
  // Target is either a physical switchport or a logical Port-channel — both
  // carry the same mode/access/trunk config fields, so the handler is shared.
  const port = currentSwitchportTarget(s);
  if (!port) return { session: s, output: [] };

  if (command[1] === 'mode') {
    const desired = command[2];
    if (desired === 'access') {
      port.mode = 'access';
      return { session: s, output: [] };
    }
    if (desired === 'trunk') {
      port.mode = 'trunk';
      return { session: s, output: [] };
    }
    // `dynamic auto/desirable` still rejected — DTP negotiation is not
    // modeled and a silent accept-as-trunk would mislead the learner.
    return {
      session: s,
      output: err('% Dynamic switchport modes are not supported in this lab.'),
    };
  }

  if (command[1] === 'trunk') return handleSwitchportTrunk(s, port, command, args, ec);

  if (command[1] === 'port-security') return handlePortSecurity(s, command, args, ec);

  if (command[1] === 'access' && command[2] === 'vlan') {
    const idArg = args.id;
    const id = Number.parseInt(idArg, 10);
    if (!isValidVlanId(id) || String(id) !== idArg) {
      return { session: s, output: badInput(ec, 'id') };
    }
    if (isReservedVlan(id)) {
      return {
        session: s,
        output: err(
          '% VLAN ids 1002-1005 are reserved for Token Ring and FDDI and cannot be configured',
        ),
      };
    }
    // Real IOS: assigning a port to a VLAN that doesn't exist prints the
    // message and silently creates the VLAN. Same behavior here.
    let output: CommandOutput[] = [];
    if (!s.device.vlans.has(id)) {
      s.device.vlans.set(id, { id, name: defaultVlanName(id), active: true });
      output = [
        { kind: 'system', text: '% Access VLAN does not exist, will be created' },
      ];
    }
    port.accessVlan = id;
    return { session: s, output };
  }

  return { session: s, output: err('% Incomplete command.') };
}

/** Dispatch every `switchport trunk …` form. The grammar already shapes the
 *  command array; we route on command[2]/command[3] and capture the typed
 *  list (or VLAN id) from `args`. IOS-faithful behavior:
 *    - `allowed vlan <list>`     → replace
 *    - `allowed vlan add <list>` → union
 *    - `allowed vlan remove <list>` → difference
 *    - `allowed vlan all`        → reset sentinel
 *    - `allowed vlan none`       → empty list
 *    - `native vlan <id>`        → set native VLAN
 *
 *  Trunk subcommands are accepted regardless of current mode — IOS lets you
 *  stage trunk config on an access port; the settings only take effect once
 *  `switchport mode trunk` is applied. Our model holds the same data so the
 *  next mode flip surfaces the staged values without re-typing them. */
function ensurePortSecurity(port: Switchport) {
  if (!port.portSecurity) {
    port.portSecurity = {
      enabled: true,
      maximum: 1,
      violationMode: 'shutdown',
      sticky: false,
      secureMac: null,
      violation: false,
      lastSourceAddress: null,
    };
  }
  port.portSecurity.enabled = true;
  return port.portSecurity;
}

function normaliseMac(mac: string): string | null {
  const hex = mac.replace(/[.:-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`;
}

function handlePortSecurity(
  s: SwitchSession,
  command: string[],
  args: Record<string, string>,
  ec: ErrCtx,
): ApplyResult {
  const port = currentPhysicalSwitchport(s);
  if (!port) return { session: s, output: [] };
  const ps = ensurePortSecurity(port);

  if (command.length === 2) return { session: s, output: [] };

  if (command[2] === 'maximum') {
    const max = Number.parseInt(args.maximum, 10);
    if (String(max) !== args.maximum || max < 1 || max > 132) {
      return { session: s, output: badInput(ec, 'maximum') };
    }
    ps.maximum = max;
    return { session: s, output: [] };
  }

  if (command[2] === 'mac-address') {
    const macArg = args.mac;
    if (command[3] === 'sticky' && macArg === undefined) {
      ps.sticky = true;
      return { session: s, output: [] };
    }
    const mac = normaliseMac(macArg);
    if (!mac) return { session: s, output: badInput(ec, 'mac') };
    ps.secureMac = mac;
    ps.sticky = command[3] === 'sticky';
    ps.violation = false;
    ps.lastSourceAddress = null;
    return { session: s, output: [] };
  }

  return { session: s, output: [] };
}

function handleSwitchportTrunk(
  s: SwitchSession,
  port: Switchport | PortChannel,
  command: string[],
  args: Record<string, string>,
  ec: ErrCtx,
): ApplyResult {
  if (command[2] === 'allowed' && command[3] === 'vlan') {
    const op = command[4];
    if (op === 'all') {
      port.trunkAllowedVlans = 'all';
      return { session: s, output: [] };
    }
    if (op === 'none') {
      port.trunkAllowedVlans = [];
      return { session: s, output: [] };
    }
    if (op === 'add' || op === 'remove') {
      const parsed = parseVlanList(args.list ?? '');
      if (!parsed) {
        return { session: s, output: badInput(ec, 'list') };
      }
      const current = port.trunkAllowedVlans === 'all' ? allVlans() : [...port.trunkAllowedVlans];
      const next = op === 'add' ? unionSorted(current, parsed) : differenceSorted(current, parsed);
      port.trunkAllowedVlans = next;
      return { session: s, output: [] };
    }
    // Bare `switchport trunk allowed vlan <list>` — replace.
    const parsed = parseVlanList(args.list ?? '');
    if (!parsed) {
      return { session: s, output: badInput(ec, 'list') };
    }
    port.trunkAllowedVlans = parsed;
    return { session: s, output: [] };
  }

  if (command[2] === 'native' && command[3] === 'vlan') {
    const idArg = args.id;
    const id = Number.parseInt(idArg, 10);
    if (!isValidVlanId(id) || String(id) !== idArg) {
      return { session: s, output: badInput(ec, 'id') };
    }
    if (isReservedVlan(id)) {
      return {
        session: s,
        output: err(
          '% VLAN ids 1002-1005 are reserved for Token Ring and FDDI and cannot be configured',
        ),
      };
    }
    port.nativeVlan = id;
    return { session: s, output: [] };
  }

  return { session: s, output: err('% Incomplete command.') };
}

function allVlans(): number[] {
  const out: number[] = [];
  for (let i = 1; i <= 4094; i++) {
    if (i >= 1002 && i <= 1005) continue;
    out.push(i);
  }
  return out;
}

function unionSorted(a: readonly number[], b: readonly number[]): number[] {
  const set = new Set<number>(a);
  for (const n of b) set.add(n);
  return Array.from(set).sort((x, y) => x - y);
}

function differenceSorted(a: readonly number[], b: readonly number[]): number[] {
  const drop = new Set<number>(b);
  return a.filter((n) => !drop.has(n));
}

function setSwitchportAdmin(s: SwitchSession, up: boolean): ApplyResult {
  if (s.currentInterface === null) return { session: s, output: [] };
  const port = s.device.switchports[s.currentInterface];
  if (!port) return { session: s, output: [] };
  const changed = port.adminUp !== up;
  if (!up && port.portSecurity?.enabled && port.portSecurity.secureMac) {
    port.portSecurity.violation = true;
    port.portSecurity.lastSourceAddress = port.portSecurity.lastSourceAddress ?? '00aa.bbbb.cccc';
  }
  if (!up && port.bpduGuard) {
    port.bpduGuardViolation = true;
    port.errDisabled = true;
  }
  if (up && port.portSecurity?.enabled && port.portSecurity.violation) {
    port.adminUp = false;
    return { session: s, output: [] };
  }
  if (up && port.errDisabled) {
    return { session: s, output: [] };
  }
  port.adminUp = up;
  if (up && changed) {
    return {
      session: s,
      output: [
        { kind: 'system', text: `%LINK-3-UPDOWN: Interface ${port.name}, changed state to up` },
        {
          kind: 'system',
          text: `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${port.name}, changed state to up`,
        },
      ],
    };
  }
  return { session: s, output: [] };
}

function negate(
  s: SwitchSession,
  command: string[],
  args: Record<string, string>,
  ec: ErrCtx,
): ApplyResult {
  switch (command[1]) {
    case 'shutdown':
      return setSwitchportAdmin(s, true);
    case 'spanning-tree': {
      const port = currentPhysicalSwitchport(s);
      if (port && command[2] === 'bpduguard' && command[3] === 'enable') {
        port.bpduGuard = false;
        port.bpduGuardViolation = false;
        port.errDisabled = false;
        return { session: s, output: [] };
      }
      if (port && command[2] === 'portfast') {
        port.stpPortfast = false;
        return { session: s, output: [] };
      }
      return { session: s, output: [] };
    }
    case 'channel-group': {
      // `no channel-group [<id>]` — remove the port from its EtherChannel
      // group. Clears the membership + LACP mode; the derived `bundled` flag
      // is reset here too and reconfirmed by the next refresh pass.
      const port = currentPhysicalSwitchport(s);
      if (port) {
        port.channelGroup = null;
        port.lacpMode = null;
        port.bundled = false;
      }
      return { session: s, output: [] };
    }
    case 'hostname':
      s.device.hostname = 'Switch';
      return { session: s, output: [] };
    case 'vlan': {
      const idArg = args.id;
      const id = Number.parseInt(idArg, 10);
      if (!isValidVlanId(id) || String(id) !== idArg) {
        return { session: s, output: badInput(ec, 'id') };
      }
      if (id === 1) {
        return { session: s, output: err('% Default VLAN 1 may not be deleted.') };
      }
      if (isReservedVlan(id)) {
        // Reserved VLANs are silently un-deletable in IOS; emit a friendly
        // sentence instead of pretending it succeeded.
        return {
          session: s,
          output: err('% Reserved VLAN range (1002-1005) cannot be deleted.'),
        };
      }
      if (!s.device.vlans.has(id)) {
        return { session: s, output: [] };
      }
      // Any port assigned to the deleted VLAN reverts to VLAN 1 — real IOS
      // moves them to an "inactive" pool, but our model only knows about
      // active VLANs in the database; reverting to default keeps the model
      // self-consistent and matches student expectations.
      s.device.vlans.delete(id);
      for (const port of Object.values(s.device.switchports)) {
        if (port.accessVlan === id) port.accessVlan = 1;
      }
      return { session: s, output: [] };
    }
    case 'switchport':
      // `no switchport access vlan` — reset to VLAN 1.
      if (
        s.currentInterface &&
        command[2] === 'access' &&
        command[3] === 'vlan'
      ) {
        const port = s.device.switchports[s.currentInterface];
        if (port) port.accessVlan = 1;
        return { session: s, output: [] };
      }
      if (
        s.currentInterface &&
        command[2] === 'port-security' &&
        command[3] === 'mac-address'
      ) {
        const port = s.device.switchports[s.currentInterface];
        const mac = args.mac ? normaliseMac(args.mac) : null;
        if (!mac) return { session: s, output: badInput(ec, 'mac') };
        if (port?.portSecurity && port.portSecurity.secureMac === mac) {
          port.portSecurity.secureMac = null;
          port.portSecurity.sticky = false;
          port.portSecurity.violation = false;
          port.portSecurity.lastSourceAddress = null;
        }
        return { session: s, output: [] };
      }
      // `no switchport trunk allowed vlan` — reset to the IOS default (all).
      if (
        s.currentInterface &&
        command[2] === 'trunk' &&
        command[3] === 'allowed' &&
        command[4] === 'vlan'
      ) {
        const port = s.device.switchports[s.currentInterface];
        if (port) port.trunkAllowedVlans = 'all';
        return { session: s, output: [] };
      }
      // `no switchport trunk native vlan` — reset to VLAN 1.
      if (
        s.currentInterface &&
        command[2] === 'trunk' &&
        command[3] === 'native' &&
        command[4] === 'vlan'
      ) {
        const port = s.device.switchports[s.currentInterface];
        if (port) port.nativeVlan = 1;
        return { session: s, output: [] };
      }
      return { session: s, output: [] };
    default:
      return { session: s, output: err('% Incomplete command.') };
  }
}

function show(
  s: SwitchSession,
  command: string[],
  args: Record<string, string>,
  ec: ErrCtx,
  opts: ApplyOptions | undefined,
): ApplyResult {
  const what = command[1];
  if (what === 'vlan' && (command[2] === undefined || command[2] === 'brief')) {
    // Bare `show vlan` and `show vlan brief` render the same table — IOS
    // prints a longer per-VLAN block for the bare form, but the brief table
    // covers everything our Session 1 model knows and is what students need.
    return { session: s, output: out(...showVlanBrief(s)) };
  }
  if (what === 'interfaces') {
    // `show interfaces trunk` — keyword child, NOT a per-iface form.
    if (command[2] === 'status') {
      if (opts?.record !== false) {
        s.lastShowInterfacesStatus = snapshotInterfacesStatus(s);
      }
      return { session: s, output: out(...showInterfacesStatus(s)) };
    }
    if (command[2] === 'trunk') {
      // Stamp a snapshot of which local ports were in trunk mode AT THIS
      // INSTANT, so verify-style objectives can require the observation to
      // happen while the trunk was already up. Mirrors lastPing's contract:
      // gated on opts?.record so seed runs don't pre-satisfy the objective.
      if (opts?.record !== false) {
        const trunkPortIds = Object.values(s.device.switchports)
          .filter((p) => p.mode === 'trunk')
          .map((p) => p.id);
        s.lastShowInterfacesTrunk = { trunkPortIds };
      }
      return { session: s, output: out(...showInterfacesTrunk(s)) };
    }
    if (command[3] === 'switchport' && args.iface) {
      return showInterfacesSwitchport(s, args.iface);
    }
    if (args.iface) return showInterfacesOne(s, args.iface);
    return { session: s, output: out(...showInterfacesAll(s)) };
  }
  if (what === 'version') return { session: s, output: out(...showVersion(s)) };
  if (what === 'port-security' && command[2] === 'interface' && args.iface) {
    return showPortSecurityInterface(s, args.iface);
  }
  if (what === 'spanning-tree' && command[2] === 'vlan' && args.id) {
    const vlanId = Number.parseInt(args.id, 10);
    if (!isValidVlanId(vlanId) || String(vlanId) !== args.id || isReservedVlan(vlanId)) {
      return { session: s, output: badInput(ec, 'id') };
    }
    if (opts?.record !== false) {
      s.lastShowSpanningTreeVlans = { vlanIds: [vlanId] };
    }
    return { session: s, output: out(...showSpanningTreeVlan(s, vlanId)) };
  }
  if (what === 'etherchannel' && command[2] === 'summary') {
    // Stamp which channel-groups were bundled the instant the learner ran the
    // command — verify objectives read this snapshot (mirrors lastPing /
    // lastShowInterfacesTrunk) so a verify run BEFORE the bundle forms can't
    // auto-complete the objective once it comes up later. Gated on
    // opts?.record so seed runs don't pre-satisfy it.
    if (opts?.record !== false) {
      const bundledGroups = [...s.device.portChannels.values()]
        .filter((po) => po.bundled)
        .map((po) => po.id);
      s.lastShowEtherchannelSummary = { bundledGroups };
    }
    return { session: s, output: out(...showEtherchannelSummary(s)) };
  }
  if (what === 'running-config') {
    if (command[2] === 'interface' && command[3] === 'port-channel' && args.id) {
      return { session: s, output: showRunningPortChannel(s, args.id) };
    }
    if (command[2] === 'interface' && args.iface) {
      return { session: s, output: showRunningInterface(s, args.iface) };
    }
    return { session: s, output: out(...showRunningConfig(s)) };
  }
  return { session: s, output: err('% Incomplete command.') };
}

// ---------------------------------------------------------------------------
// Show renderers
// ---------------------------------------------------------------------------

/** IOS `show vlan brief` — four-column table.
 *
 *  Columns: VLAN id (4), Name (32), Status (9), Ports (rest, comma-separated
 *  with `, ` separator). Ports list every access-mode switchport assigned to
 *  that VLAN, in interface declaration order (insertion order on the
 *  switchports record). Only active VLANs are shown. */
function showVlanBrief(s: SwitchSession): string[] {
  const header =
    'VLAN'.padEnd(5) + 'Name'.padEnd(33) + 'Status'.padEnd(10) + 'Ports';
  const sep = '---- '.padEnd(5) + '-'.repeat(32).padEnd(33) + '-'.repeat(9).padEnd(10) + '-'.repeat(31);
  const lines: string[] = [header, sep];
  for (const vlan of s.device.vlans.values()) {
    if (!vlan.active) continue;
    const ports = portsInVlan(s, vlan.id);
    const portText = ports.join(', ');
    lines.push(
      vlan.id.toString().padEnd(5) +
        vlan.name.padEnd(33) +
        'active'.padEnd(10) +
        portText,
    );
  }
  return lines;
}

/** Return the canonical interface ids of every access-mode switchport whose
 *  accessVlan matches the given VLAN. Iteration follows the switchports
 *  insertion order so the output reads deterministically. */
function portsInVlan(s: SwitchSession, vlanId: number): string[] {
  return Object.values(s.device.switchports)
    .filter((p) => p.mode === 'access' && p.accessVlan === vlanId)
    .map((p) => p.id);
}

/** IOS `show interfaces <iface> switchport` — minimal block with the lines a
 *  CCNA student looks at. Trunk-mode ports add the Trunking Native VLAN +
 *  Trunking VLANs Enabled lines per the IOS trunk format. */
function showInterfacesSwitchport(s: SwitchSession, ifaceToken: string): ApplyResult {
  const id = normaliseSwitchportId(ifaceToken);
  if (!id || !s.device.switchports[id]) {
    return { session: s, output: err(`% Invalid interface ${ifaceToken}`) };
  }
  const port = s.device.switchports[id];
  const vlan = s.device.vlans.get(port.accessVlan);
  const vlanLabel = vlan ? `${port.accessVlan} (${vlan.name})` : `${port.accessVlan}`;
  const nativeVlan = s.device.vlans.get(port.nativeVlan);
  const nativeLabel =
    port.nativeVlan === 1 && nativeVlan
      ? `1 (${nativeVlan.name})`
      : nativeVlan
        ? `${port.nativeVlan} (${nativeVlan.name})`
        : `${port.nativeVlan}`;
  const lines: string[] = [
    `Name: ${port.id}`,
    'Switchport: Enabled',
    `Administrative Mode: ${formatModeLabel(port.mode)}`,
    `Operational Mode: ${formatModeLabel(port.mode)}`,
    `Access Mode VLAN: ${vlanLabel}`,
    `Trunking Native Mode VLAN: ${nativeLabel}`,
  ];
  if (port.mode === 'trunk') {
    const allowed =
      port.trunkAllowedVlans === 'all'
        ? 'ALL'
        : port.trunkAllowedVlans.length === 0
          ? 'NONE'
          : formatVlanList(port.trunkAllowedVlans);
    lines.push(`Trunking VLANs Enabled: ${allowed}`);
  }
  return { session: s, output: out(...lines) };
}

function formatModeLabel(mode: 'access' | 'trunk' | 'dynamic'): string {
  if (mode === 'access') return 'static access';
  if (mode === 'trunk') return 'trunk';
  return 'dynamic auto';
}

/** IOS `show interfaces trunk` — four-section table covering every port
 *  currently in trunk mode. Sections:
 *    1. Port / Mode / Encapsulation / Status / Native vlan
 *    2. Port / Vlans allowed on trunk
 *    3. Port / Vlans allowed and active in management domain
 *    4. Port / Vlans in spanning tree forwarding state and not pruned
 *
 *  We don't model STP, so section 4 mirrors section 3 (every active+allowed
 *  VLAN is "in forwarding state and not pruned"). Matches the IOS output
 *  format documented in the Catalyst VLAN configuration guides. */
function showInterfacesTrunk(s: SwitchSession): string[] {
  const trunkPorts = Object.values(s.device.switchports).filter(
    (p) => p.mode === 'trunk',
  );
  if (trunkPorts.length === 0) {
    return ['There are no trunk interfaces.'];
  }
  const portCol = 12;
  const modeCol = 13;
  const encapCol = 15;
  const statusCol = 14;

  const lines: string[] = [];
  lines.push(
    'Port'.padEnd(portCol) +
      'Mode'.padEnd(modeCol) +
      'Encapsulation'.padEnd(encapCol) +
      'Status'.padEnd(statusCol) +
      'Native vlan',
  );
  for (const port of trunkPorts) {
    const status = port.adminUp && port.protocolUp ? 'trunking' : 'not-trunking';
    lines.push(
      port.id.padEnd(portCol) +
        'on'.padEnd(modeCol) +
        '802.1q'.padEnd(encapCol) +
        status.padEnd(statusCol) +
        port.nativeVlan,
    );
  }

  lines.push('');
  lines.push('Port'.padEnd(portCol) + 'Vlans allowed on trunk');
  for (const port of trunkPorts) {
    const allowed =
      port.trunkAllowedVlans === 'all'
        ? '1-4094'
        : port.trunkAllowedVlans.length === 0
          ? 'none'
          : formatVlanList(port.trunkAllowedVlans);
    lines.push(port.id.padEnd(portCol) + allowed);
  }

  const activeVlanIds = activeAllowedVlans(s);

  lines.push('');
  lines.push('Port'.padEnd(portCol) + 'Vlans allowed and active in management domain');
  for (const port of trunkPorts) {
    const intersected = intersectAllowedWithActive(port, activeVlanIds);
    lines.push(port.id.padEnd(portCol) + (intersected.length ? formatVlanList(intersected) : 'none'));
  }

  lines.push('');
  lines.push('Port'.padEnd(portCol) + 'Vlans in spanning tree forwarding state and not pruned');
  for (const port of trunkPorts) {
    const intersected = intersectAllowedWithActive(port, activeVlanIds);
    lines.push(port.id.padEnd(portCol) + (intersected.length ? formatVlanList(intersected) : 'none'));
  }

  return lines;
}

/** Sorted list of every VLAN id currently active in the switch's database. */
function activeAllowedVlans(s: SwitchSession): number[] {
  const out: number[] = [];
  for (const v of s.device.vlans.values()) {
    if (v.active && !isReservedVlan(v.id)) out.push(v.id);
  }
  return out.sort((a, b) => a - b);
}

function intersectAllowedWithActive(
  port: Switchport,
  active: readonly number[],
): number[] {
  if (port.trunkAllowedVlans === 'all') return [...active];
  const allow = new Set<number>(port.trunkAllowedVlans);
  return active.filter((id) => allow.has(id));
}

/** Minimal `show interfaces <iface>` — admin state + line protocol. Switches
 *  don't have an IP per interface, so the block is shorter than the router
 *  version. */
function showInterfacesOne(s: SwitchSession, ifaceToken: string): ApplyResult {
  const id = normaliseSwitchportId(ifaceToken);
  if (!id || !s.device.switchports[id]) {
    return { session: s, output: err(`% Invalid interface ${ifaceToken}`) };
  }
  const port = s.device.switchports[id];
  const state = port.adminUp ? 'up' : 'administratively down';
  const proto = port.adminUp && port.protocolUp ? 'up' : 'down';
  return {
    session: s,
    output: out(
      `${port.name} is ${state}, line protocol is ${proto}`,
      `  Hardware is ${s.device.platform}`,
    ),
  };
}

function showInterfacesAll(s: SwitchSession): string[] {
  return Object.values(s.device.switchports).flatMap((port) => {
    const state = port.adminUp ? 'up' : 'administratively down';
    const proto = port.adminUp && port.protocolUp ? 'up' : 'down';
    return [`${port.name} is ${state}, line protocol is ${proto}`];
  });
}

function showInterfacesStatus(s: SwitchSession): string[] {
  const lines = ['Port      Name               Status       Vlan       Duplex  Speed Type'];
  for (const port of Object.values(s.device.switchports)) {
    const status = port.errDisabled || (!port.adminUp && port.portSecurity?.violation) ? 'err-disabled' : port.protocolUp ? 'connected' : 'notconnect';
    const vlan = port.mode === 'access' ? String(port.accessVlan) : 'trunk';
    lines.push(
      port.id.padEnd(10) +
        (port.description ?? '').slice(0, 18).padEnd(19) +
        status.padEnd(13) +
        vlan.padEnd(11) +
        'auto'.padEnd(8) +
        'auto'.padEnd(6) +
        '10/100BaseTX',
    );
  }
  return lines;
}

function snapshotInterfacesStatus(s: SwitchSession): SwitchSession['lastShowInterfacesStatus'] {
  const connectedPortIds: string[] = [];
  const errDisabledPortIds: string[] = [];
  for (const port of Object.values(s.device.switchports)) {
    if (port.errDisabled || (!port.adminUp && port.portSecurity?.violation)) {
      errDisabledPortIds.push(port.id);
    } else if (port.protocolUp) {
      connectedPortIds.push(port.id);
    }
  }
  return { connectedPortIds, errDisabledPortIds };
}

function showPortSecurityInterface(s: SwitchSession, ifaceToken: string): ApplyResult {
  const id = normaliseSwitchportId(ifaceToken);
  if (!id || !s.device.switchports[id]) {
    return { session: s, output: err(`% Invalid interface ${ifaceToken}`) };
  }
  const port = s.device.switchports[id];
  const ps = port.portSecurity;
  if (!ps?.enabled) {
    return { session: s, output: out(`Port Security              : Disabled`) };
  }
  const portStatus = ps.violation ? 'Secure-shutdown' : port.protocolUp ? 'Secure-up' : 'Secure-down';
  return {
    session: s,
    output: out(
      `Port Security              : Enabled`,
      `Port Status                : ${portStatus}`,
      `Violation Mode             : Shutdown`,
      `Maximum MAC Addresses      : ${ps.maximum}`,
      `Total MAC Addresses        : ${ps.secureMac ? 1 : 0}`,
      `Configured MAC Addresses   : ${ps.secureMac && !ps.sticky ? 1 : 0}`,
      `Sticky MAC Addresses       : ${ps.secureMac && ps.sticky ? 1 : 0}`,
      `Last Source Address:Vlan   : ${ps.lastSourceAddress ?? '0000.0000.0000'}:${port.accessVlan}`,
      `Security Violation Count   : ${ps.violation ? 1 : 0}`,
    ),
  };
}


function showSpanningTreeVlan(s: SwitchSession, vlanId: number): string[] {
  const stp = s.device.spanningTree.get(vlanId) ?? makeSpanningTreeVlan(vlanId);
  const bridgeId = bridgeIdFor(s.device.id);
  const rootPriority =
    stp.rootRole === 'secondary' ? ROOT_PRIMARY_PRIORITY : stp.priority;
  const rootAddress = stp.rootRole === 'secondary' ? '0011.2233.0001' : bridgeId;
  const rootLine = stp.rootRole === 'primary' ? ['            This bridge is the root'] : [];
  const forwardingPorts = Object.values(s.device.switchports).filter(
    (p) => p.adminUp && p.protocolUp && (p.mode === 'trunk' || p.accessVlan === vlanId),
  );
  const lines: string[] = [
    `VLAN${vlanId.toString().padStart(4, '0')}`,
    '  Spanning tree enabled protocol ieee',
    `  Root ID    Priority    ${rootPriority + vlanId}`,
    `             Address     ${rootAddress}`,
    ...rootLine,
    `  Bridge ID  Priority    ${stp.priority + vlanId}  (priority ${stp.priority} sys-id-ext ${vlanId})`,
    `             Address     ${bridgeId}`,
    '             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec',
    '',
    'Interface           Role Sts Cost      Prio.Nbr Type',
    '------------------- ---- --- --------- -------- --------------------------------',
  ];
  if (forwardingPorts.length === 0) {
    lines.push('No interfaces are forwarding for this VLAN.');
    return lines;
  }
  for (const [index, port] of forwardingPorts.entries()) {
    let role = 'Desg';
    let status = 'FWD';
    if (stp.rootRole === 'secondary' && index === 0) {
      role = 'Root';
    } else if (stp.rootRole === null && index === 0) {
      role = 'Root';
    } else if (stp.rootRole === null && index > 0) {
      role = 'Altn';
      status = 'BLK';
    }
    lines.push(`${port.id.padEnd(19)} ${role.padEnd(4)} ${status} 19        128.1    P2p`);
  }
  return lines;
}

function bridgeIdFor(deviceId: string): string {
  const digits = deviceId.replace(/\D/g, '') || '1';
  const n = Number.parseInt(digits, 10) % 10000;
  return `0011.2233.${n.toString().padStart(4, '0')}`;
}

function showVersion(s: SwitchSession): string[] {
  return [
    `Cisco IOS Software, ${s.device.platform} Software`,
    `${s.device.hostname} uptime is 0 minutes`,
    'System image simulated by CertHead Labs',
  ];
}

/** IOS `show running-config` — includes the VLAN database and per-port
 *  switchport stanza. VLAN 1 and reserved VLANs are omitted (they're created
 *  implicitly and clutter the output otherwise). */
function showRunningConfig(s: SwitchSession): string[] {
  const lines = ['Building configuration...', '', '!', `hostname ${s.device.hostname}`, '!'];
  for (const vlan of s.device.vlans.values()) {
    if (vlan.id === 1) continue;
    if (isReservedVlan(vlan.id)) continue;
    lines.push(`vlan ${vlan.id}`);
    // Always emit the name line — matches IOS, which shows the auto-generated
    // VLAN0010 form when the user never set a name.
    lines.push(` name ${vlan.name}`);
  }
  if (s.device.vlans.size > 1) lines.push('!');
  for (const port of Object.values(s.device.switchports)) {
    lines.push(`interface ${port.name}`);
    // Always emit `switchport mode access` for ports in access mode — both
    // because we don't model 'default dynamic' and because a learner running
    // `show running-config` after `switchport mode access` needs to see the
    // line they just typed in the output.
    if (port.mode === 'access') {
      lines.push(' switchport mode access');
      if (port.accessVlan !== 1) {
        lines.push(` switchport access vlan ${port.accessVlan}`);
      }
    } else if (port.mode === 'trunk') {
      lines.push(' switchport mode trunk');
      // Per official IOS behaviour: omit `switchport trunk allowed vlan`
      // when set to the default 'all'. Same for native VLAN at default 1.
      if (port.trunkAllowedVlans !== 'all') {
        const list = port.trunkAllowedVlans.length === 0 ? 'none' : formatVlanList(port.trunkAllowedVlans);
        lines.push(` switchport trunk allowed vlan ${list}`);
      }
      if (port.nativeVlan !== 1) {
        lines.push(` switchport trunk native vlan ${port.nativeVlan}`);
      }
    }
    if (port.stpPortfast) lines.push(' spanning-tree portfast');
    if (port.bpduGuard) lines.push(' spanning-tree bpduguard enable');
    if (!port.adminUp) lines.push(' shutdown');
    lines.push('!');
  }
  lines.push('end');
  return lines;
}

/** IOS `show running-config interface <iface>` — single-port stanza.
 *
 *  Diverges intentionally from the bulk `show running-config`: this form is
 *  EXPLICIT-EVERYTHING. The bulk render omits defaults so the output stays
 *  scannable; the per-interface form is the diagnostic surface a learner
 *  reaches for to confirm the trunk's allowed/native VLANs match expectation,
 *  so it always emits all relevant lines (e.g. `switchport trunk allowed
 *  vlan 1-4094` even when at default).
 *
 *  Real IOS technically omits defaults here too, but the lab learner is the
 *  audience: hiding "1-4094" mid-troubleshoot teaches them less than seeing
 *  the actual operational state. */
function showRunningInterface(s: SwitchSession, ifaceToken: string): CommandOutput[] {
  const id = normaliseSwitchportId(ifaceToken);
  if (!id || !s.device.switchports[id]) {
    return err(`% Invalid interface ${ifaceToken}`);
  }
  const port = s.device.switchports[id];
  const lines: string[] = ['Building configuration...', '!', `interface ${port.name}`];
  if (port.mode === 'access') {
    lines.push(' switchport mode access');
    lines.push(` switchport access vlan ${port.accessVlan}`);
  } else if (port.mode === 'trunk') {
    lines.push(' switchport mode trunk');
    const allowed =
      port.trunkAllowedVlans === 'all'
        ? '1-4094'
        : port.trunkAllowedVlans.length === 0
          ? 'none'
          : formatVlanList(port.trunkAllowedVlans);
    lines.push(` switchport trunk allowed vlan ${allowed}`);
    lines.push(` switchport trunk native vlan ${port.nativeVlan}`);
  }
  if (!port.adminUp) lines.push(' shutdown');
  if (port.stpPortfast) lines.push(' spanning-tree portfast');
  if (port.bpduGuard) lines.push(' spanning-tree bpduguard enable');
  lines.push('!');
  lines.push('end');
  return out(...lines);
}

/** IOS `show etherchannel summary` — the verify surface for an EtherChannel
 *  lab. Renders the standard flags legend, the channel-group/aggregator
 *  counts, and one row per Port-channel:
 *
 *    Group  Port-channel  Protocol    Ports
 *    1      Po1(SU)       LACP        Fa0/1(P)   Fa0/2(P)
 *
 *  Port-channel suffix: S (Layer2) always; U (in use) when bundled, else D
 *  (down). Member suffix: P (bundled), D (admin-down), or I (stand-alone — in
 *  the group but not bundled, e.g. an incompatible-mode peer). Protocol is
 *  LACP when any member runs active/passive, or `-` for static `on` mode. */
function showEtherchannelSummary(s: SwitchSession): string[] {
  const lines: string[] = [
    'Flags:  D - down        P - bundled in port-channel',
    '        I - stand-alone s - suspended',
    '        H - Hot-standby (LACP only)',
    '        R - Layer3      S - Layer2',
    '        U - in use      f - failed to allocate aggregator',
    '',
    '        M - not in use, minimum links not met',
    '        u - unsuitable for bundling',
    '        w - waiting to be aggregated',
    '        d - default port',
    '',
  ];

  const groups = [...s.device.portChannels.values()].sort((a, b) => a.id - b.id);
  const inUse = groups.filter((po) => po.bundled).length;
  lines.push(`Number of channel-groups in use: ${inUse}`);
  lines.push(`Number of aggregators:           ${groups.length}`);
  lines.push('');
  lines.push(
    'Group  Port-channel  Protocol    Ports',
    '------+-------------+-----------+' + '-'.repeat(47),
  );

  for (const po of groups) {
    const members = Object.values(s.device.switchports).filter(
      (p) => p.channelGroup === po.id,
    );
    const protocol = members.some(
      (p) => p.lacpMode === 'active' || p.lacpMode === 'passive',
    )
      ? 'LACP'
      : '-';
    const poLabel = `Po${po.id}(S${po.bundled ? 'U' : 'D'})`;
    const portCells = members.map((p) => {
      const flag = !p.adminUp ? 'D' : p.bundled ? 'P' : 'I';
      return `${p.id}(${flag})`;
    });
    lines.push(
      `${String(po.id).padEnd(7)}${poLabel.padEnd(14)}${protocol.padEnd(12)}${portCells.join('   ')}`,
    );
  }

  return lines;
}

/** IOS `show running-config interface Port-channel <id>` — single Port-channel
 *  stanza. Like the per-physical-interface form, this is explicit-everything so
 *  a learner can confirm the aggregator's trunk/access config mid-troubleshoot. */
function showRunningPortChannel(s: SwitchSession, idArg: string): CommandOutput[] {
  const id = Number.parseInt(idArg, 10);
  const po = Number.isInteger(id) ? s.device.portChannels.get(id) : undefined;
  if (!po) {
    return err(`% Invalid interface Port-channel${idArg}`);
  }
  const lines: string[] = ['Building configuration...', '!', `interface ${po.name}`];
  if (po.mode === 'access') {
    lines.push(' switchport mode access');
    lines.push(` switchport access vlan ${po.accessVlan}`);
  } else if (po.mode === 'trunk') {
    lines.push(' switchport mode trunk');
    const allowed =
      po.trunkAllowedVlans === 'all'
        ? '1-4094'
        : po.trunkAllowedVlans.length === 0
          ? 'none'
          : formatVlanList(po.trunkAllowedVlans);
    lines.push(` switchport trunk allowed vlan ${allowed}`);
    lines.push(` switchport trunk native vlan ${po.nativeVlan}`);
  }
  lines.push('!');
  lines.push('end');
  return out(...lines);
}

/** Helper for outside callers (e.g., the switch adapter) — duplicate of the
 *  Vlan type re-exported so a caller iterating the database has a typed shape. */
export type { Vlan };
