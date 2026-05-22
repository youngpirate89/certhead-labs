import { describe, it, expect } from 'vitest';
import { applyCommand, contextHelp } from './interpret';
import { createSession, buildDevice, prompt, type Session } from './state';

function fresh(): Session {
  return createSession(buildDevice({ id: 'R1', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] }));
}

/** Run a sequence of lines, threading the session. */
function run(start: Session, lines: string[]): Session {
  return lines.reduce((s, line) => applyCommand(s, line).session, start);
}

describe('IOS interpreter — mode stack', () => {
  it('moves user -> priv on enable', () => {
    const { session } = applyCommand(fresh(), 'enable');
    expect(session.mode).toBe('priv');
    expect(prompt(session)).toBe('R1#');
  });

  it('enters config then config-if and back out', () => {
    const s = run(fresh(), ['enable', 'configure terminal', 'interface gi0/0']);
    expect(s.mode).toBe('config-if');
    expect(s.currentInterface).toBe('Gi0/0');
    expect(prompt(s)).toBe('R1(config-if)#');

    const exited = applyCommand(s, 'exit').session;
    expect(exited.mode).toBe('config');
    expect(exited.currentInterface).toBeNull();

    expect(applyCommand(s, 'end').session.mode).toBe('priv');
  });

  it('accepts abbreviated keywords (conf t, int gi0/0, no shut)', () => {
    const s = run(fresh(), ['en', 'conf t', 'int gi0/0', 'no shut']);
    expect(s.mode).toBe('config-if');
    expect(s.device.interfaces['Gi0/0'].adminUp).toBe(true);
  });
});

describe('IOS interpreter — interface configuration', () => {
  it('assigns IP and mask', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
    ]);
    expect(s.device.interfaces['Gi0/0'].ip).toBe('192.168.1.1');
    expect(s.device.interfaces['Gi0/0'].mask).toBe('255.255.255.0');
  });

  it('emits a link-up message on no shutdown only when state changes', () => {
    const s = run(fresh(), ['enable', 'configure terminal', 'interface gi0/0']);
    const first = applyCommand(s, 'no shutdown');
    expect(first.output.some((o) => /changed state to up/.test(o.text))).toBe(true);
    const second = applyCommand(first.session, 'no shutdown');
    expect(second.output).toHaveLength(0);
  });

  it('clears IP with no ip address and brings down with shutdown', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 10.0.0.1 255.0.0.0',
      'no shutdown',
      'shutdown',
      'no ip address',
    ]);
    expect(s.device.interfaces['Gi0/0'].adminUp).toBe(false);
    expect(s.device.interfaces['Gi0/0'].ip).toBeNull();
  });

  it('rejects an invalid mask and a bad interface', () => {
    const cfg = run(fresh(), ['enable', 'configure terminal', 'interface gi0/0']);
    expect(applyCommand(cfg, 'ip address 192.168.1.1 255.255.0.255').output[0].kind).toBe('error');

    const bad = applyCommand(run(fresh(), ['enable', 'configure terminal']), 'interface gi9/9');
    expect(bad.output[0].kind).toBe('error');
    expect(bad.session.mode).toBe('config'); // did not enter
  });
});

describe('IOS interpreter — resolution errors and show', () => {
  it('reports ambiguous, invalid, and incomplete', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    expect(applyCommand(priv, 'show i').output[0].text).toMatch(/Ambiguous/);
    expect(applyCommand(priv, 'frobnicate').output[0].text).toMatch(/Invalid input/);
    expect(applyCommand(priv, 'show').output[0].text).toMatch(/Incomplete/);
  });

  it('renders show ip interface brief with configured state', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'end',
    ]);
    const text = applyCommand(s, 'show ip interface brief')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/GigabitEthernet0\/0\s+192\.168\.1\.1/);
    expect(text).toMatch(/Gi0\/0|GigabitEthernet0\/0/);
  });

  it('does not mutate the input session', () => {
    const s = applyCommand(fresh(), 'enable').session;
    const before = structuredClone(s);
    applyCommand(s, 'configure terminal');
    expect(s).toEqual(before);
  });

  it('records canonical command form in resolvedHistory while keeping raw', () => {
    const s = run(fresh(), ['en', 'conf t', 'int gi0/0']);
    // Raw history preserves what the user typed.
    expect(s.history).toEqual(['en', 'conf t', 'int gi0/0']);
    // Resolved history has abbreviations expanded — interface arg keeps its
    // raw token (it's an argument value, not a keyword).
    expect(s.resolvedHistory).toEqual([
      'enable',
      'configure terminal',
      'interface gi0/0',
    ]);
  });
});

describe('IOS interpreter — ? context help', () => {
  it('lists user-mode commands for `?` at the prompt', () => {
    const lines = contextHelp(fresh(), '').map((o) => o.text);
    const text = lines.join('\n');
    expect(text).toMatch(/enable\s+Turn on privileged commands/);
    expect(text).toMatch(/show\s+Display running system information/);
    expect(text).toMatch(/exit\s+Exit from the EXEC/);
  });

  it('lists priv-mode commands including configure, show, write', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    const text = contextHelp(priv, '').map((o) => o.text).join('\n');
    expect(text).toMatch(/configure/);
    expect(text).toMatch(/disable/);
    expect(text).toMatch(/write/);
  });

  it('lists children of a partial line (`show ` with trailing space)', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    const text = contextHelp(priv, 'show ').map((o) => o.text).join('\n');
    expect(text).toMatch(/interfaces\s+Interface status and configuration/);
    expect(text).toMatch(/ip/);
    expect(text).toMatch(/running-config\s+Current operating configuration/);
    expect(text).toMatch(/version\s+System hardware and software status/);
  });

  it('filters children by partial token (no trailing space)', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    const text = contextHelp(priv, 'show i').map((o) => o.text).join('\n');
    expect(text).toMatch(/interfaces/);
    expect(text).toMatch(/ip/);
    expect(text).not.toMatch(/version/);
    expect(text).not.toMatch(/running-config/);
  });

  it('resolves abbreviated tokens before listing children (`sh ?` -> show children)', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    const text = contextHelp(priv, 'sh ').map((o) => o.text).join('\n');
    expect(text).toMatch(/interfaces/);
    expect(text).toMatch(/running-config/);
  });

  it('shows <iface> when an argument is expected', () => {
    const cfg = applyCommand(
      applyCommand(fresh(), 'enable').session,
      'configure terminal',
    ).session;
    const text = contextHelp(cfg, 'interface ').map((o) => o.text).join('\n');
    expect(text).toMatch(/<iface>/);
  });

  it('shows <cr> when the line is a complete runnable command followed by a space', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    const text = contextHelp(priv, 'show version ').map((o) => o.text).join('\n');
    expect(text).toMatch(/<cr>/);
  });

  it('treats a no-space partial that matches a keyword exactly as a candidate, not <cr>', () => {
    const priv = applyCommand(fresh(), 'enable').session;
    const text = contextHelp(priv, 'show version').map((o) => o.text).join('\n');
    expect(text).toMatch(/version\s+System hardware/);
    expect(text).not.toMatch(/<cr>/);
  });

  it('rejects an unrecognized token with an error line', () => {
    const out = contextHelp(fresh(), 'frobnicate ');
    expect(out[0].kind).toBe('error');
    expect(out[0].text).toMatch(/Unrecognized/);
  });

  it('does not mutate the session', () => {
    const s = applyCommand(fresh(), 'enable').session;
    const before = structuredClone(s);
    contextHelp(s, 'show ');
    expect(s).toEqual(before);
  });
});
