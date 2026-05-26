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
  type Vlan,
  defaultVlanName,
  fullSwitchportName,
  isReservedVlan,
  isValidVlanId,
  normaliseSwitchportId,
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
      return show(s, command, args);

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
    // Trunk and dynamic land in Session 2 — until then they're recognised but
    // not honored; we tell the learner explicitly so a typo'd intent gets
    // surfaced rather than silently being accepted as access.
    return {
      session: s,
      output: err(
        '% Trunk and dynamic switchport modes are not supported in this lab.',
      ),
    };
  }

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
      return { session: s, output: [] };
    default:
      return { session: s, output: err('% Incomplete command.') };
  }
}

function show(
  s: SwitchSession,
  command: string[],
  args: Record<string, string>,
): ApplyResult {
  const what = command[1];
  if (what === 'vlan' && (command[2] === undefined || command[2] === 'brief')) {
    // Bare `show vlan` and `show vlan brief` render the same table — IOS
    // prints a longer per-VLAN block for the bare form, but the brief table
    // covers everything our Session 1 model knows and is what students need.
    return { session: s, output: out(...showVlanBrief(s)) };
  }
  if (what === 'interfaces') {
    if (command[3] === 'switchport' && args.iface) {
      return showInterfacesSwitchport(s, args.iface);
    }
    if (args.iface) return showInterfacesOne(s, args.iface);
    return { session: s, output: out(...showInterfacesAll(s)) };
  }
  if (what === 'version') return { session: s, output: out(...showVersion(s)) };
  if (what === 'running-config') {
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

/** IOS `show interfaces <iface> switchport` — minimal block with the four
 *  lines a CCNA student looks at. */
function showInterfacesSwitchport(s: SwitchSession, ifaceToken: string): ApplyResult {
  const id = normaliseSwitchportId(ifaceToken);
  if (!id || !s.device.switchports[id]) {
    return { session: s, output: err(`% Invalid interface ${ifaceToken}`) };
  }
  const port = s.device.switchports[id];
  const vlan = s.device.vlans.get(port.accessVlan);
  const vlanLabel = vlan ? `${port.accessVlan} (${vlan.name})` : `${port.accessVlan}`;
  const defaultVlan = s.device.vlans.get(1);
  const nativeLabel = defaultVlan ? `1 (${defaultVlan.name})` : '1';
  const lines = [
    `Name: ${port.id}`,
    'Switchport: Enabled',
    `Administrative Mode: ${formatModeLabel(port.mode)}`,
    `Operational Mode: ${formatModeLabel(port.mode)}`,
    `Access Mode VLAN: ${vlanLabel}`,
    `Trunking Native Mode VLAN: ${nativeLabel}`,
  ];
  return { session: s, output: out(...lines) };
}

function formatModeLabel(mode: 'access' | 'trunk' | 'dynamic'): string {
  if (mode === 'access') return 'static access';
  if (mode === 'trunk') return 'trunk';
  return 'dynamic auto';
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
    if (port.mode === 'access') lines.push(' switchport mode access');
    if (port.accessVlan !== 1) {
      lines.push(` switchport access vlan ${port.accessVlan}`);
    }
    if (!port.adminUp) lines.push(' shutdown');
    lines.push('!');
  }
  lines.push('end');
  return lines;
}

/** Helper for outside callers (e.g., the switch adapter) — duplicate of the
 *  Vlan type re-exported so a caller iterating the database has a typed shape. */
export type { Vlan };
