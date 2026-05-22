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
} from './state';
import type { CommandOutput, ApplyResult as GenericApplyResult } from '../types';

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
  return mode === 'config' || mode === 'config-if';
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
 */
export function applyCommand(session: Session, raw: string): ApplyResult {
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
      if (doForm) return dispatchDo(session, result.command, result.args, raw);
      return dispatch(session, result.command, result.args, raw.trim());
    }
  }
}

/**
 * Execute a `do <exec-cmd>` form: run the resolved command against the
 * privileged-EXEC dispatcher, but DO NOT let it change the mode, current
 * interface, or other "context" state. History is recorded with `do` preserved
 * (raw as typed; canonical with `do` prefix in resolvedHistory).
 */
function dispatchDo(
  prev: Session,
  command: string[],
  args: Record<string, string>,
  raw: string,
): ApplyResult {
  const inner = dispatch(prev, command, args, raw.trim());
  // Restore mode + currentInterface so the prompt stays in the config-family
  // context. Replace the just-pushed resolvedHistory entry with the do-form.
  const last = inner.session.resolvedHistory.length - 1;
  const fixed: Session = {
    ...inner.session,
    mode: prev.mode,
    currentInterface: prev.currentInterface,
    resolvedHistory: inner.session.resolvedHistory.map((cmd, i) =>
      i === last ? `do ${cmd}` : cmd,
    ),
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
): ApplyResult {
  const s: Session = structuredClone(prev);
  s.history.push(raw);
  s.resolvedHistory.push(command.join(' '));
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
      return negate(s, command);

    case 'ip':
      return setIpAddress(s, args.ip, args.mask);

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

function negate(s: Session, command: string[]): ApplyResult {
  // command = ['no', ...]
  switch (command[1]) {
    case 'shutdown':
      return setAdmin(s, true);
    case 'hostname':
      s.device.hostname = 'Router';
      return { session: s, output: [] };
    case 'ip':
      if (s.currentInterface) {
        s.device.interfaces[s.currentInterface].ip = null;
        s.device.interfaces[s.currentInterface].mask = null;
      }
      return { session: s, output: [] };
    default:
      return { session: s, output: err('% Incomplete command.') };
  }
}

function show(s: Session, command: string[]): ApplyResult {
  // command = ['show', ...]
  const what = command[1];
  if (what === 'ip') return { session: s, output: out(...showIpIntBrief(s)) };
  if (what === 'interfaces') return { session: s, output: out(...showInterfaces(s)) };
  if (what === 'version') return { session: s, output: out(...showVersion(s)) };
  if (what === 'running-config') return { session: s, output: out(...showRunningConfig(s)) };
  return { session: s, output: err('% Incomplete command.') };
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
    const proto = i.adminUp ? 'up' : 'down';
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
    const proto = i.adminUp ? 'up' : 'down';
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
