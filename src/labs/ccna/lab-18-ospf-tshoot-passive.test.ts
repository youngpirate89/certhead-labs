/**
 * Lab 18 — OSPF troubleshooting (passive-interface on the transit link)
 * objective coverage.
 *
 * Drives Lab 18 from a fresh session, verifying that:
 *   - the seeded fault (R1 Gi0/2 marked passive) yields no FULL neighbor and a
 *     failing ping, so the fix-related objectives start unsatisfied;
 *   - removing the passive mark from the WAN re-forms the adjacency (the
 *     per-command refresh re-runs recomputeOspf across both routers);
 *   - the canonical remediation (move passive to the LAN) plus a ping from
 *     PC-A satisfies every objective.
 */
import { describe, it, expect } from 'vitest';
import { lab18OspfTshootPassive } from './lab-18-ospf-tshoot-passive';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
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
  return lab18OspfTshootPassive.objectives.map((o) => o.check(state, history, ls));
}

/** The canonical fix: drop passive on the WAN, apply it to the LAN. */
function applyFix(ls: LabSession): LabSession {
  return runOn(ls, 'R1', [
    'enable',
    'configure terminal',
    'router ospf 1',
    'no passive-interface GigabitEthernet0/2',
    'passive-interface GigabitEthernet0/0',
    'end',
  ]);
}

/** Full solution: diagnose + fix + verify + ping. */
function applyFullSolution(ls: LabSession): LabSession {
  let next = runOn(ls, 'R1', ['enable', 'show ip ospf']);
  next = applyFix(next);
  next = runOn(next, 'PC-A', ['ping 192.168.2.10']);
  return next;
}

// ---------- Starting-state assertions ----------

describe('Lab 18 — starting state (broken)', () => {
  it('R1 and R2 both run OSPF process 1 in area 0', () => {
    const ls = initLabSession(lab18OspfTshootPassive);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('not router');
    expect(r1.device.ospf.process).toBe(1);
    expect(r2.device.ospf.process).toBe(1);
    expect(r1.device.ospf.networks.every((n) => n.area === 0)).toBe(true);
    expect(r2.device.ospf.networks.every((n) => n.area === 0)).toBe(true);
  });

  it('R1 has Gi0/2 (the WAN link) marked passive — the seeded fault', () => {
    const ls = initLabSession(lab18OspfTshootPassive);
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('not router');
    expect(r1.device.ospf.passive.has('Gi0/2')).toBe(true);
    expect(r1.device.ospf.passive.has('Gi0/0')).toBe(false);
  });

  it('neither router has a FULL neighbor (passive WAN blocks adjacency)', () => {
    const ls = initLabSession(lab18OspfTshootPassive);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('not router');
    expect(r1.device.ospf.neighbors.size).toBe(0);
    expect(r2.device.ospf.neighbors.size).toBe(0);
  });

  it('PC-A cannot ping PC-B in the starting state', () => {
    let ls = initLabSession(lab18OspfTshootPassive);
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    const pca = ls.devices['PC-A'];
    if (pca.kind !== 'pc') throw new Error('not pc');
    expect(pca.lastPing).toEqual({ target: '192.168.2.10', ok: false });
  });

  it('seed commands do NOT appear in history (diagnose gate stays unmet)', () => {
    const ls = initLabSession(lab18OspfTshootPassive);
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('not router');
    expect(r1.resolvedHistory.some((c) => /show ip ospf/.test(c))).toBe(false);
  });

  it('all four objectives are false at start', () => {
    expect(checkAll(initLabSession(lab18OspfTshootPassive))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

// ---------- Objective-by-objective tests ----------

describe('Lab 18 — objective: diagnose', () => {
  it('false until show ip ospf is run on R1', () => {
    expect(checkAll(initLabSession(lab18OspfTshootPassive))[0]).toBe(false);
  });

  it('show ip ospf neighbor alone does NOT satisfy it (symptom, not cause)', () => {
    let ls = initLabSession(lab18OspfTshootPassive);
    ls = runOn(ls, 'R1', ['enable', 'show ip ospf neighbor']);
    expect(checkAll(ls)[0]).toBe(false);
  });

  it('true after show ip ospf on R1, and accepts an abbreviation', () => {
    let ls = initLabSession(lab18OspfTshootPassive);
    ls = runOn(ls, 'R1', ['enable', 'sh ip ospf']);
    expect(checkAll(ls)[0]).toBe(true);
  });
});

describe('Lab 18 — objective: correct-passive', () => {
  it('false on fresh session (only Gi0/2 is passive)', () => {
    expect(checkAll(initLabSession(lab18OspfTshootPassive))[1]).toBe(false);
  });

  it('true once Gi0/0 is marked passive on R1', () => {
    const ls = applyFix(initLabSession(lab18OspfTshootPassive));
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('not router');
    expect(r1.device.ospf.passive.has('Gi0/0')).toBe(true);
    expect(checkAll(ls)[1]).toBe(true);
  });
});

describe('Lab 18 — objective: adjacency-full', () => {
  it('false on fresh session (WAN is passive)', () => {
    expect(checkAll(initLabSession(lab18OspfTshootPassive))[2]).toBe(false);
  });

  it('removing passive from Gi0/2 alone re-forms the adjacency', () => {
    // The minimal fault removal: no passive on the WAN. Adjacency comes back
    // even before the learner moves passive to the LAN.
    let ls = initLabSession(lab18OspfTshootPassive);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'no passive-interface GigabitEthernet0/2',
      'end',
    ]);
    expect(checkAll(ls)[2]).toBe(true);
  });

  it('true after the full fix', () => {
    const ls = applyFix(initLabSession(lab18OspfTshootPassive));
    expect(checkAll(ls)[2]).toBe(true);
  });
});

describe('Lab 18 — objective: reachable', () => {
  it('false on fresh session (no ping, no adjacency)', () => {
    expect(checkAll(initLabSession(lab18OspfTshootPassive))[3]).toBe(false);
  });

  it('false after the fix but BEFORE the learner runs ping', () => {
    const ls = applyFix(initLabSession(lab18OspfTshootPassive));
    expect(checkAll(ls)[3]).toBe(false);
  });

  it('false if the learner pings without fixing the passive mark', () => {
    let ls = initLabSession(lab18OspfTshootPassive);
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    expect(checkAll(ls)[3]).toBe(false);
  });

  it('true after the full fix + successful ping from PC-A', () => {
    let ls = applyFix(initLabSession(lab18OspfTshootPassive));
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    expect(checkAll(ls)[3]).toBe(true);
  });
});

describe('Lab 18 — full solution', () => {
  it('all four objectives pass after diagnose + fix + ping', () => {
    const ls = applyFullSolution(initLabSession(lab18OspfTshootPassive));
    expect(checkAll(ls)).toEqual([true, true, true, true]);
  });

  it('fix propagates an OSPF route on R1 for 192.168.2.0/24', () => {
    const ls = applyFix(initLabSession(lab18OspfTshootPassive));
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('not router');
    expect(r1.ospfRoutes).toEqual([
      expect.objectContaining({
        prefix: '192.168.2.0',
        mask: '255.255.255.0',
        nextHop: '10.0.0.2',
        egressIface: 'Gi0/2',
        source: 'ospf',
      }),
    ]);
  });
});
