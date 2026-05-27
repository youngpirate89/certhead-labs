/**
 * Lab 11 — NAT/PAT objective coverage.
 *
 * Drives Lab 11 from a fresh session, ticking off each objective in turn.
 * Each test exercises ONE objective's check function against the relevant
 * state so a regression names the broken objective directly.
 */
import { describe, it, expect } from 'vitest';
import { lab11NatPat } from './lab-11-nat-pat';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import type { LabState, HistoryView } from '@/engine/types';

function runOn(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  let cur = ls;
  if (cur.activeDeviceId !== deviceId) cur = { ...cur, activeDeviceId: deviceId };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

/** Run every objective against the current session and return the boolean
 *  list — same shape the UI panel renders. Lets a single assertion cover
 *  "all six pass" without coupling to objective text. */
function checkAll(ls: LabSession): boolean[] {
  const state: LabState = {};
  for (const [id, dev] of Object.entries(ls.devices)) {
    if (dev.kind === 'router') state[id] = dev.device;
  }
  const history: HistoryView = Object.fromEntries(
    Object.entries(ls.devices).map(([id, dev]) => [
      id,
      { raw: dev.history, resolved: dev.resolvedHistory },
    ]),
  );
  return lab11NatPat.objectives.map((o) => o.check(state, history, ls));
}

/** Apply the full solution sequence. */
function applyFullSolution(ls: LabSession): LabSession {
  let next = runOn(ls, 'R1', [
    'enable',
    'configure terminal',
    'access-list 1 permit 192.168.1.0 0.0.0.255',
    'interface Gi0/0',
    'ip nat inside',
    'exit',
    'interface Gi0/1',
    'ip nat outside',
    'exit',
    'ip nat inside source list 1 interface GigabitEthernet0/1 overload',
    'end',
    'show ip nat translations',
  ]);
  next = runOn(next, 'PC-A', ['ping 203.0.113.2']);
  return next;
}

// ---------- Objective-by-objective tests ----------

describe('Lab 11 — objective: acl', () => {
  it('false on fresh session', () => {
    const ls = initLabSession(lab11NatPat);
    expect(checkAll(ls)[0]).toBe(false);
  });

  it('true after access-list 1 permit 192.168.1.0 0.0.0.255', () => {
    let ls = initLabSession(lab11NatPat);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
    ]);
    expect(checkAll(ls)[0]).toBe(true);
  });
});

describe('Lab 11 — objective: nat-inside', () => {
  it('false on fresh session', () => {
    expect(checkAll(initLabSession(lab11NatPat))[1]).toBe(false);
  });

  it('true after ip nat inside on Gi0/0', () => {
    let ls = initLabSession(lab11NatPat);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'ip nat inside',
    ]);
    expect(checkAll(ls)[1]).toBe(true);
  });
});

describe('Lab 11 — objective: nat-outside', () => {
  it('false on fresh session', () => {
    expect(checkAll(initLabSession(lab11NatPat))[2]).toBe(false);
  });

  it('true after ip nat outside on Gi0/1', () => {
    let ls = initLabSession(lab11NatPat);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface Gi0/1',
      'ip nat outside',
    ]);
    expect(checkAll(ls)[2]).toBe(true);
  });
});

describe('Lab 11 — objective: overload', () => {
  it('false on fresh session', () => {
    expect(checkAll(initLabSession(lab11NatPat))[3]).toBe(false);
  });

  it('true after the overload statement is applied', () => {
    let ls = initLabSession(lab11NatPat);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'ip nat inside source list 1 interface Gi0/1 overload',
    ]);
    expect(checkAll(ls)[3]).toBe(true);
  });
});

describe('Lab 11 — objective: reachable', () => {
  it('false on fresh session (no ping run, NAT not configured)', () => {
    expect(checkAll(initLabSession(lab11NatPat))[4]).toBe(false);
  });

  it('false even after NAT config, until the learner actually runs ping', () => {
    let ls = initLabSession(lab11NatPat);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'interface Gi0/0',
      'ip nat inside',
      'exit',
      'interface Gi0/1',
      'ip nat outside',
      'exit',
      'ip nat inside source list 1 interface Gi0/1 overload',
    ]);
    expect(checkAll(ls)[4]).toBe(false);
  });

  it('true after full NAT config + a successful ping from PC-A', () => {
    const ls = applyFullSolution(initLabSession(lab11NatPat));
    expect(checkAll(ls)[4]).toBe(true);
  });
});

describe('Lab 11 — objective: verify', () => {
  it('false before show ip nat translations is run', () => {
    let ls = initLabSession(lab11NatPat);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'interface Gi0/0',
      'ip nat inside',
      'exit',
      'interface Gi0/1',
      'ip nat outside',
      'exit',
      'ip nat inside source list 1 interface Gi0/1 overload',
    ]);
    expect(checkAll(ls)[5]).toBe(false);
  });

  it('true after show ip nat translations with a non-empty table', () => {
    const ls = applyFullSolution(initLabSession(lab11NatPat));
    expect(checkAll(ls)[5]).toBe(true);
  });

  it('false when show runs before the translation table has any entries', () => {
    // No NAT config yet → table empty → show does NOT stamp the gate.
    let ls = initLabSession(lab11NatPat);
    ls = runOn(ls, 'R1', ['enable', 'show ip nat translations']);
    expect(checkAll(ls)[5]).toBe(false);
  });
});

describe('Lab 11 — full solution', () => {
  it('all 6 objectives pass after the full solution sequence', () => {
    const ls = applyFullSolution(initLabSession(lab11NatPat));
    expect(checkAll(ls)).toEqual([true, true, true, true, true, true]);
  });
});
