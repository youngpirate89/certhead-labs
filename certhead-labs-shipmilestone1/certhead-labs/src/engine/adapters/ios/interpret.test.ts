import { describe, it, expect } from 'vitest';
import { applyCommand } from './interpret';
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
});
