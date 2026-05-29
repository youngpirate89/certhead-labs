/**
 * Lab 20 - OSPF troubleshooting (MD5 authentication mismatch) objective coverage.
 *
 * Drives Lab 20 from a fresh session, verifying that:
 *   - the seeded fault (R2 Gi0/2 key WrongKey99 vs R1 CISCO123) yields no FULL
 *     neighbor on either router and a failing ping, so both objectives start
 *     unsatisfied;
 *   - all four reachability surfaces agree in the mismatched state: empty
 *     neighbor table on the pair, canReach failing with no-route, ping false;
 *   - aligning R2's key to R1's re-forms the adjacency (the per-command refresh
 *     re-runs recomputeOspf across both routers), canReach flips ok, and the
 *     lastPing predicate satisfies the reach objective;
 *   - the full solution (fix + ping) satisfies both objectives;
 *   - ADVERSARIAL: re-adding the WRONG key leaves the auth-match objective red
 *     and the ping still failing.
 */
import { describe, it, expect } from 'vitest';
import { lab20OspfTshootAuth } from './lab-20-ospf-tshoot-auth';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import type { LabState, HistoryView } from '@/engine/types';

function runOn(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  let cur = ls;
  if (cur.activeDeviceId !== deviceId) cur = { ...cur, activeDeviceId: deviceId };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

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
  return lab20OspfTshootAuth.objectives.map((o) => o.check(state, history, ls));
}

/** Canonical fix: replace R2 Gi0/2's key with R1's (no-then-readd). */
function applyFix(ls: LabSession): LabSession {
  return runOn(ls, 'R2', [
    'enable',
    'configure terminal',
    'interface gi0/2',
    'no ip ospf message-digest-key 1',
    'ip ospf message-digest-key 1 md5 CISCO123',
    'end',
  ]);
}

/** Full solution: fix + ping. */
function applyFullSolution(ls: LabSession): LabSession {
  let next = applyFix(ls);
  next = runOn(next, 'PC-A', ['ping 10.2.0.10']);
  return next;
}

// ---------- Starting-state assertions ----------

describe('Lab 20 - starting state (broken)', () => {
  it('both transit ends run message-digest auth with key-id 1', () => {
    const ls = initLabSession(lab20OspfTshootAuth);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('not router');
    expect(r1.device.interfaces['Gi0/2'].ospfAuthMessageDigest).toBe(true);
    expect(r2.device.interfaces['Gi0/2'].ospfAuthMessageDigest).toBe(true);
    expect(r1.device.interfaces['Gi0/2'].ospfMd5KeyId).toBe(1);
    expect(r2.device.interfaces['Gi0/2'].ospfMd5KeyId).toBe(1);
  });

  it('R2 Gi0/2 carries the wrong key string (WrongKey99 vs R1 CISCO123) - the seeded fault', () => {
    const ls = initLabSession(lab20OspfTshootAuth);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('not router');
    expect(r1.device.interfaces['Gi0/2'].ospfMd5Key).toBe('CISCO123');
    expect(r2.device.interfaces['Gi0/2'].ospfMd5Key).toBe('WrongKey99');
  });

  it('neither router has a FULL neighbor (key mismatch blocks adjacency)', () => {
    const ls = initLabSession(lab20OspfTshootAuth);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('not router');
    expect(r1.device.ospf.neighbors.size).toBe(0);
    expect(r2.device.ospf.neighbors.size).toBe(0);
  });

  it('canReach PC-A -> PC-B fails with no-route (no O route installed)', () => {
    const ls = initLabSession(lab20OspfTshootAuth);
    const result = canReach(ls, 'PC-A', '10.2.0.10', undefined, 'icmp');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failedAt.reason).toBe('no-route');
  });

  it('PC-A cannot ping PC-B in the starting state', () => {
    let ls = initLabSession(lab20OspfTshootAuth);
    ls = runOn(ls, 'PC-A', ['ping 10.2.0.10']);
    const pca = ls.devices['PC-A'];
    if (pca.kind !== 'pc') throw new Error('not pc');
    expect(pca.lastPing).toEqual({ target: '10.2.0.10', ok: false });
  });

  it('both objectives start unmet', () => {
    expect(checkAll(initLabSession(lab20OspfTshootAuth))).toEqual([false, false]);
  });
});

// ---------- Objective: auth-match ----------

describe('Lab 20 - objective: auth-match', () => {
  it('false on fresh session (keys differ)', () => {
    expect(checkAll(initLabSession(lab20OspfTshootAuth))[0]).toBe(false);
  });

  it('true once R2 Gi0/2 key is aligned to R1 (CISCO123)', () => {
    const ls = applyFix(initLabSession(lab20OspfTshootAuth));
    expect(checkAll(ls)[0]).toBe(true);
  });

  it('direct re-entry of the correct key (no remove first) also satisfies it', () => {
    // The engine models a single key per interface, so re-entering key-id 1
    // with the right string replaces the wrong one. The objective reads the
    // effective state, so this forgiving path also passes.
    let ls = initLabSession(lab20OspfTshootAuth);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'ip ospf message-digest-key 1 md5 CISCO123',
      'end',
    ]);
    expect(checkAll(ls)[0]).toBe(true);
  });
});

// ---------- Objective: reachable ----------

describe('Lab 20 - objective: reachable', () => {
  it('false after the fix but BEFORE the learner re-pings', () => {
    const ls = applyFix(initLabSession(lab20OspfTshootAuth));
    expect(checkAll(ls)[1]).toBe(false);
  });

  it('false if the learner pings without fixing the key', () => {
    let ls = initLabSession(lab20OspfTshootAuth);
    ls = runOn(ls, 'PC-A', ['ping 10.2.0.10']);
    expect(checkAll(ls)[1]).toBe(false);
  });

  it('true after the full fix + successful ping from PC-A', () => {
    let ls = applyFix(initLabSession(lab20OspfTshootAuth));
    ls = runOn(ls, 'PC-A', ['ping 10.2.0.10']);
    expect(checkAll(ls)[1]).toBe(true);
  });
});

// ---------- Fix re-forms adjacency across all four surfaces ----------

describe('Lab 20 - fix re-forms the adjacency', () => {
  it('R1 sees R2 FULL after the key is aligned', () => {
    const ls = applyFix(initLabSession(lab20OspfTshootAuth));
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('not router');
    expect(Array.from(r1.device.ospf.neighbors.values()).some((n) => n.state === 'FULL')).toBe(
      true,
    );
  });

  it('canReach PC-A -> PC-B flips ok after the fix', () => {
    const ls = applyFix(initLabSession(lab20OspfTshootAuth));
    const result = canReach(ls, 'PC-A', '10.2.0.10', undefined, 'icmp');
    expect(result.ok).toBe(true);
  });

  it('fix propagates an OSPF route on R1 for 10.2.0.0/24', () => {
    const ls = applyFix(initLabSession(lab20OspfTshootAuth));
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('not router');
    expect(r1.ospfRoutes).toEqual([
      expect.objectContaining({
        prefix: '10.2.0.0',
        mask: '255.255.255.0',
        nextHop: '10.255.255.2',
        egressIface: 'Gi0/2',
        source: 'ospf',
      }),
    ]);
  });
});

// ---------- Adversarial: wrong key keeps the lab red ----------

describe('Lab 20 - adversarial (wrong key still present)', () => {
  it('re-adding a DIFFERENT wrong key on R2 leaves auth-match red and adjacency down', () => {
    let ls = initLabSession(lab20OspfTshootAuth);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'no ip ospf message-digest-key 1',
      'ip ospf message-digest-key 1 md5 StillWrong',
      'end',
    ]);
    expect(checkAll(ls)[0]).toBe(false);
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('not router');
    expect(r1.device.ospf.neighbors.size).toBe(0);
  });

  it('matching the key string but a different key-id leaves auth-match red', () => {
    // key-id must also agree: same string, key-id 2 on R2 vs key-id 1 on R1.
    let ls = initLabSession(lab20OspfTshootAuth);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'no ip ospf message-digest-key 1',
      'ip ospf message-digest-key 2 md5 CISCO123',
      'end',
    ]);
    expect(checkAll(ls)[0]).toBe(false);
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('not router');
    expect(r1.device.ospf.neighbors.size).toBe(0);
  });

  it('the wrong key still fails the ping (no false completion)', () => {
    let ls = initLabSession(lab20OspfTshootAuth);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'no ip ospf message-digest-key 1',
      'ip ospf message-digest-key 1 md5 StillWrong',
      'end',
    ]);
    ls = runOn(ls, 'PC-A', ['ping 10.2.0.10']);
    expect(checkAll(ls)[1]).toBe(false);
  });
});

// ---------- Full solution ----------

describe('Lab 20 - full solution', () => {
  it('both objectives pass after fix + ping', () => {
    const ls = applyFullSolution(initLabSession(lab20OspfTshootAuth));
    expect(checkAll(ls)).toEqual([true, true]);
  });

  it('running-config on R2 shows the corrected key after the fix', () => {
    const ls = applyFix(initLabSession(lab20OspfTshootAuth));
    const { output } = applyToActive(
      { ...ls, activeDeviceId: 'R2' },
      'show running-config interface GigabitEthernet0/2',
    );
    const text = output.map((o) => o.text).join('\n');
    expect(text).toMatch(/ip ospf message-digest-key 1 md5 CISCO123/);
    expect(text).toMatch(/ip ospf authentication message-digest/);
  });
});
