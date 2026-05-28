/**
 * Lab 12 — Named Extended ACL objective coverage.
 *
 * Drives Lab 12 from a fresh session, ticking off each of the six objectives.
 * Each test exercises ONE objective's check against the relevant state so a
 * regression names the broken objective directly. Mirrors Lab 11's test
 * structure for consistency.
 */
import { describe, it, expect } from 'vitest';
import { lab12ExtendedAcl } from './lab-12-extended-acl';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import type { LabState, HistoryView } from '@/engine/types';

function runOn(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  let cur = ls;
  if (cur.activeDeviceId !== deviceId) cur = { ...cur, activeDeviceId: deviceId };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

/** Run every objective against the current session and return the boolean
 *  list — same shape the UI panel renders. */
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
  return lab12ExtendedAcl.objectives.map((o) => o.check(state, history, ls));
}

/** Configure BLOCK-ICMP correctly and apply on Gi0/0 in. */
function applyAclConfig(ls: LabSession): LabSession {
  return runOn(ls, 'R1', [
    'enable',
    'configure terminal',
    'ip access-list extended BLOCK-ICMP',
    'deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10',
    'permit ip any any',
    'exit',
    'interface Gi0/0',
    'ip access-group BLOCK-ICMP in',
    'exit',
  ]);
}

function applyFullSolution(ls: LabSession): LabSession {
  let next = applyAclConfig(ls);
  next = runOn(next, 'R1', ['end', 'show access-lists']);
  next = runOn(next, 'PC-A', ['ping 192.168.2.10']);
  return next;
}

// ---------- Objective-by-objective tests ----------

describe('Lab 12 — objective: acl-deny', () => {
  it('false on fresh session', () => {
    expect(checkAll(initLabSession(lab12ExtendedAcl))[0]).toBe(false);
  });

  it('true after adding the deny icmp entry', () => {
    let ls = initLabSession(lab12ExtendedAcl);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'ip access-list extended BLOCK-ICMP',
      'deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10',
    ]);
    expect(checkAll(ls)[0]).toBe(true);
  });
});

describe('Lab 12 — objective: acl-permit', () => {
  it('false on fresh session', () => {
    expect(checkAll(initLabSession(lab12ExtendedAcl))[1]).toBe(false);
  });

  it('true after permit ip any any', () => {
    let ls = initLabSession(lab12ExtendedAcl);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'ip access-list extended BLOCK-ICMP',
      'permit ip any any',
    ]);
    expect(checkAll(ls)[1]).toBe(true);
  });
});

describe('Lab 12 — objective: acl-order', () => {
  it('false on fresh session', () => {
    expect(checkAll(initLabSession(lab12ExtendedAcl))[2]).toBe(false);
  });

  it('true when deny is before permit', () => {
    let ls = initLabSession(lab12ExtendedAcl);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'ip access-list extended BLOCK-ICMP',
      'deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10',
      'permit ip any any',
    ]);
    expect(checkAll(ls)[2]).toBe(true);
  });

  it('false when permit is added BEFORE deny — order is wrong', () => {
    let ls = initLabSession(lab12ExtendedAcl);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'ip access-list extended BLOCK-ICMP',
      'permit ip any any',
      'deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10',
    ]);
    expect(checkAll(ls)[2]).toBe(false);
  });
});

describe('Lab 12 — objective: apply', () => {
  it('false on fresh session', () => {
    expect(checkAll(initLabSession(lab12ExtendedAcl))[3]).toBe(false);
  });

  it('true after ip access-group BLOCK-ICMP in on Gi0/0', () => {
    let ls = initLabSession(lab12ExtendedAcl);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'ip access-list extended BLOCK-ICMP',
      'permit ip any any',
      'exit',
      'interface Gi0/0',
      'ip access-group BLOCK-ICMP in',
    ]);
    expect(checkAll(ls)[3]).toBe(true);
  });

  it('false if ACL is bound outbound instead of inbound', () => {
    let ls = initLabSession(lab12ExtendedAcl);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'ip access-list extended BLOCK-ICMP',
      'permit ip any any',
      'exit',
      'interface Gi0/0',
      'ip access-group BLOCK-ICMP out',
    ]);
    expect(checkAll(ls)[3]).toBe(false);
  });
});

describe('Lab 12 — objective: blocked', () => {
  it('false on fresh session (no ping run yet)', () => {
    expect(checkAll(initLabSession(lab12ExtendedAcl))[4]).toBe(false);
  });

  it('false after ACL config without the learner actually pinging', () => {
    const ls = applyAclConfig(initLabSession(lab12ExtendedAcl));
    expect(checkAll(ls)[4]).toBe(false);
  });

  it('true after correct ACL config AND ping from PC-A times out', () => {
    let ls = applyAclConfig(initLabSession(lab12ExtendedAcl));
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    expect(checkAll(ls)[4]).toBe(true);
  });

  it('false when ping succeeds (ACL doesn\'t block)', () => {
    // No ACL applied — ping succeeds; the objective remains false.
    let ls = initLabSession(lab12ExtendedAcl);
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    expect(checkAll(ls)[4]).toBe(false);
  });
});

describe('Lab 12 — objective: verify', () => {
  it('false before show access-lists is run', () => {
    const ls = applyAclConfig(initLabSession(lab12ExtendedAcl));
    expect(checkAll(ls)[5]).toBe(false);
  });

  it('true after show access-lists with at least one ACL defined', () => {
    let ls = applyAclConfig(initLabSession(lab12ExtendedAcl));
    ls = runOn(ls, 'R1', ['end', 'show access-lists']);
    expect(checkAll(ls)[5]).toBe(true);
  });

  it('false when show access-lists runs with no ACLs defined', () => {
    let ls = initLabSession(lab12ExtendedAcl);
    ls = runOn(ls, 'R1', ['enable', 'show access-lists']);
    expect(checkAll(ls)[5]).toBe(false);
  });
});

describe('Lab 12 — full solution', () => {
  it('all 6 objectives pass after the full solution sequence', () => {
    const ls = applyFullSolution(initLabSession(lab12ExtendedAcl));
    expect(checkAll(ls)).toEqual([true, true, true, true, true, true]);
  });
});
