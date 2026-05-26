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
  type SwitchMode,
  type SwitchSession,
  type Switchport,
  type Vlan,
  defaultVlanName,
  formatVlanList,
  fullSwitchportName,
  isReservedVlan,
  isValidVlanId,
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
      if (doForm) return dispatchDo(session, result.command, result.args, raw, opts);
      return dispatch(session, result.command, result.args, raw.trim(), opts);
    }
  }
}

function dispatchDo(
  prev: SwitchSession,
  command: string[],
  args: Record<string, string>,
  raw: string,
  opts: ApplyOptions | undefined,
): ApplyResult {
  const inner = dispatch(prev, command, args, raw.trim(), opts);
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
      return enterInterface(s, args.iface);

    case 'vlan':
      return enterVlan(s, args.id);

    case 'name':
      return setVlanName(s, args.name);

    case 'switchport':
      return handleSwitchport(s, command, args);

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
      // Switchports don't carry a description field in our state shape (Session
      // 1 keeps the model minimal); accept the command, no-op the storage.
      return { session: s, output: [] };

    case 'shutdown':
      return setSwitchportAdmin(s, false);

    case 'no':
      return negate(s, command, args);

    case 'show':
      return show(s, command, args, opts);

    case 'write':
      return { session: s, output: out('Building configuration...', '[OK]') };

    default:
      return { session: s, output: err('% Unknown command.') };
  }
}

function enterInterface(s: SwitchSession, token: string): ApplyResult {
  const id = normaliseSwitchportId(token);
  if (!id) {
    return { session: s, output: err(`% Invalid input detected at "${token}".`) };
  }
  if (!s.device.switchports[id]) {
    return { session: s, output: err(`% Invalid interface ${fullSwitchportName(id)}`) };
  }
  s.mode = 'config-if';
  s.currentInterface = id;
  s.currentVlan = null;
  return { session: s, output: [] };
}

function enterVlan(s: SwitchSession, idArg: string): ApplyResult {
  const id = Number.parseInt(idArg, 10);
  if (!isValidVlanId(id) || String(id) !== idArg) {
    return { session: s, output: err(`% Invalid input detected at "${idArg}".`) };
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
  const port = s.device.switchports[s.currentInterface];
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

  if (command[1] === 'trunk') return handleSwitchportTrunk(s, port, command, args);

  if (command[1] === 'access' && command[2] === 'vlan') {
    const idArg = args.id;
    const id = Number.parseInt(idArg, 10);
    if (!isValidVlanId(id) || String(id) !== idArg) {
      return { session: s, output: err(`% Invalid input detected at "${idArg}".`) };
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
function handleSwitchportTrunk(
  s: SwitchSession,
  port: Switchport,
  command: string[],
  args: Record<string, string>,
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
        return { session: s, output: err(`% Invalid input detected at "${args.list}".`) };
      }
      const current = port.trunkAllowedVlans === 'all' ? allVlans() : [...port.trunkAllowedVlans];
      const next = op === 'add' ? unionSorted(current, parsed) : differenceSorted(current, parsed);
      port.trunkAllowedVlans = next;
      return { session: s, output: [] };
    }
    // Bare `switchport trunk allowed vlan <list>` — replace.
    const parsed = parseVlanList(args.list ?? '');
    if (!parsed) {
      return { session: s, output: err(`% Invalid input detected at "${args.list}".`) };
    }
    port.trunkAllowedVlans = parsed;
    return { session: s, output: [] };
  }

  if (command[2] === 'native' && command[3] === 'vlan') {
    const idArg = args.id;
    const id = Number.parseInt(idArg, 10);
    if (!isValidVlanId(id) || String(id) !== idArg) {
      return { session: s, output: err(`% Invalid input detected at "${idArg}".`) };
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
): ApplyResult {
  switch (command[1]) {
    case 'shutdown':
      return setSwitchportAdmin(s, true);
    case 'hostname':
      s.device.hostname = 'Switch';
      return { session: s, output: [] };
    case 'vlan': {
      const idArg = args.id;
      const id = Number.parseInt(idArg, 10);
      if (!isValidVlanId(id) || String(id) !== idArg) {
        return { session: s, output: err(`% Invalid input detected at "${idArg}".`) };
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
  if (what === 'running-config') {
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
  lines.push('!');
  lines.push('end');
  return out(...lines);
}

/** Helper for outside callers (e.g., the switch adapter) — duplicate of the
 *  Vlan type re-exported so a caller iterating the database has a typed shape. */
export type { Vlan };
