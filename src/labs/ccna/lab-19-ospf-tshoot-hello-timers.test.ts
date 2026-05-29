/**
 * Lab 19 — OSPF troubleshooting (hello/dead timer mismatch) objective coverage.
 *
 * Drives Lab 19 from a fresh session, verifying that:
 *   - the seeded fault (R2 Gi0/2 hello 5 / dead 20) yields no FULL neighbor and
 *     a failing ping, so the fix-related objectives start unsatisfied;
 *   - aligning R2's timers to R1's defaults re-forms the adjacency (the
 *     per-command refresh re-runs recomputeOspf across both routers);
 *   - both remediation paths — explicit values and `no ...` reset — satisfy the
 *     effective-value objectives;
 *   - the full solution (diagnose + fix + ping) satisfies every objective.
 */
import { describe, it, expect } from 'vitest';
import { lab19OspfTshootHelloTimers } from './lab-19-ospf-tshoot-hello-timers';
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
  return lab19OspfTshootHelloTimers.objectives.map((o) => o.check(state, history, ls));
}

/** Canonical fix: set R2 Gi0/2's timers back to R1's defaults. */
function applyFix(ls: LabSession): LabSession {
  return runOn(ls, 'R2', [
    'enable',
    'configure terminal',
    'interface gi0/2',
    'ip ospf hello-interval 10',
    'ip ospf dead-interval 40',
    'end',
  ]);
}

/** Full solution: diagnose + fix + ping. */
function applyFullSolution(ls: LabSession): LabSession {
  let next = runOn(ls, 'R1', ['enable', 'show ip ospf interface GigabitEthernet0/2']);
  next = applyFix(next);
  next = runOn(next, 'PC-A', ['ping 192.168.2.10']);
  return next;
}

// ---------- Starting-state assertions ----------

describe('Lab 19 — starting state (broken)', () => {
  it('R2 Gi0/2 carries the non-default timers (hello 5 / dead 20) — the seeded fault', () => {
    const ls = initLabSession(lab19OspfTshootHelloTimers);
    const r2 = ls.devices.R2;
    if (r2.kind !== 'router') throw new Error('not router');
    expect(r2.device.interfaces['Gi0/2'].ospfHelloInterval).toBe(5);
    expect(r2.device.interfaces['Gi0/2'].ospfDeadInterval).toBe(20);
  });

  it('R1 Gi0/2 is at the protocol defaults (no override)', () => {
    const ls = initLabSession(lab19OspfTshootHelloTimers);
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('not router');
    expect(r1.device.interfaces['Gi0/2'].ospfHelloInterval).toBeUndefined();
    expect(r1.device.interfaces['Gi0/2'].ospfDeadInterval).toBeUndefined();
  });

  it('neither router has a FULL neighbor (timer mismatch blocks adjacency)', () => {
    const ls = initLabSession(lab19OspfTshootHelloTimers);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('not router');
    expect(r1.device.ospf.neighbors.size).toBe(0);
    expect(r2.device.ospf.neighbors.size).toBe(0);
  });

  it('PC-A cannot ping PC-B in the starting state', () => {
    let ls = initLabSession(lab19OspfTshootHelloTimers);
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    const pca = ls.devices['PC-A'];
    if (pca.kind !== 'pc') throw new Error('not pc');
    expect(pca.lastPing).toEqual({ target: '192.168.2.10', ok: false });
  });

  it('seed commands do NOT appear in history (diagnose gate stays unmet)', () => {
    const ls = initLabSession(lab19OspfTshootHelloTimers);
    const r2 = ls.devices.R2;
    if (r2.kind !== 'router') throw new Error('not router');
    expect(r2.resolvedHistory.some((c) => /show ip ospf interface/.test(c))).toBe(false);
  });

  it('only fix-hello and fix-dead pass at start (effective values already at default on R2? no — they are overridden)', () => {
    // At start R2's overrides are 5/20, so the effective values are NOT 10/40 —
    // every objective is unmet.
    expect(checkAll(initLabSession(lab19OspfTshootHelloTimers))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

// ---------- Objective-by-objective tests ----------

describe('Lab 19 — objective: diagnose', () => {
  it('false until show ip ospf interface is run', () => {
    expect(checkAll(initLabSession(lab19OspfTshootHelloTimers))[0]).toBe(false);
  });

  it('show ip ospf neighbor alone does NOT satisfy it', () => {
    let ls = initLabSession(lab19OspfTshootHelloTimers);
    ls = runOn(ls, 'R1', ['enable', 'show ip ospf neighbor']);
    expect(checkAll(ls)[0]).toBe(false);
  });

  it('satisfied by show ip ospf interface on R1 (bare or per-interface, abbreviated)', () => {
    let ls = initLabSession(lab19OspfTshootHelloTimers);
    ls = runOn(ls, 'R1', ['enable', 'sh ip ospf int gi0/2']);
    expect(checkAll(ls)[0]).toBe(true);
  });

  it('satisfied by show ip ospf interface on R2 as well', () => {
    let ls = initLabSession(lab19OspfTshootHelloTimers);
    ls = runOn(ls, 'R2', ['enable', 'show ip ospf interface']);
    expect(checkAll(ls)[0]).toBe(true);
  });
});

describe('Lab 19 — objective: fix-hello / fix-dead', () => {
  it('both false at start (R2 overrides are 5 / 20)', () => {
    const r = checkAll(initLabSession(lab19OspfTshootHelloTimers));
    expect(r[1]).toBe(false);
    expect(r[2]).toBe(false);
  });

  it('explicit `ip ospf hello-interval 10` / `dead-interval 40` satisfies both', () => {
    const ls = applyFix(initLabSession(lab19OspfTshootHelloTimers));
    const r = checkAll(ls);
    expect(r[1]).toBe(true);
    expect(r[2]).toBe(true);
  });

  it('`no ip ospf hello-interval` / `dead-interval` (reset to default) also satisfies both', () => {
    let ls = initLabSession(lab19OspfTshootHelloTimers);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'no ip ospf hello-interval',
      'no ip ospf dead-interval',
      'end',
    ]);
    const r = checkAll(ls);
    expect(r[1]).toBe(true);
    expect(r[2]).toBe(true);
  });

  it('fixing only the hello (dead still 20) leaves fix-dead unmet and no adjacency', () => {
    let ls = initLabSession(lab19OspfTshootHelloTimers);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'ip ospf hello-interval 10',
      'end',
    ]);
    const r = checkAll(ls);
    expect(r[1]).toBe(true); // fix-hello
    expect(r[2]).toBe(false); // fix-dead
    expect(r[3]).toBe(false); // adjacency still blocked by the dead mismatch
  });
});

describe('Lab 19 — objective: adjacency-full', () => {
  it('false on fresh session (timer mismatch)', () => {
    expect(checkAll(initLabSession(lab19OspfTshootHelloTimers))[3]).toBe(false);
  });

  it('true once both timers match R1', () => {
    const ls = applyFix(initLabSession(lab19OspfTshootHelloTimers));
    expect(checkAll(ls)[3]).toBe(true);
  });
});

describe('Lab 19 — objective: reachable', () => {
  it('false after the fix but BEFORE the learner runs ping', () => {
    const ls = applyFix(initLabSession(lab19OspfTshootHelloTimers));
    expect(checkAll(ls)[4]).toBe(false);
  });

  it('false if the learner pings without fixing the timers', () => {
    let ls = initLabSession(lab19OspfTshootHelloTimers);
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    expect(checkAll(ls)[4]).toBe(false);
  });

  it('true after the full fix + successful ping from PC-A', () => {
    let ls = applyFix(initLabSession(lab19OspfTshootHelloTimers));
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    expect(checkAll(ls)[4]).toBe(true);
  });
});

describe('Lab 19 — full solution', () => {
  it('all five objectives pass after diagnose + fix + ping', () => {
    const ls = applyFullSolution(initLabSession(lab19OspfTshootHelloTimers));
    expect(checkAll(ls)).toEqual([true, true, true, true, true]);
  });

  it('fix propagates an OSPF route on R1 for 192.168.2.0/24', () => {
    const ls = applyFix(initLabSession(lab19OspfTshootHelloTimers));
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
