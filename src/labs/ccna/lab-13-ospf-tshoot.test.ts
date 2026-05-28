/**
 * Lab 13 — OSPF troubleshooting (mismatched area) objective coverage.
 *
 * Drives Lab 13 from a fresh session, verifying that:
 *   - the seeded broken state (R2 area 1) yields no FULL neighbor and a
 *     failing ping, so both objectives start unsatisfied;
 *   - the canonical fix sequence (replace R2's network statements with
 *     area 0 equivalents) restores adjacency, propagates routes, and
 *     lets PC-A reach PC-B.
 */
import { describe, it, expect } from 'vitest';
import { lab13OspfTshoot } from './lab-13-ospf-tshoot';
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
  return lab13OspfTshoot.objectives.map((o) => o.check(state, history, ls));
}

/** The canonical fix: remove R2's area 1 statements, re-add in area 0. */
function applyFix(ls: LabSession): LabSession {
  return runOn(ls, 'R2', [
    'enable',
    'configure terminal',
    'router ospf 1',
    'no network 10.0.0.0 0.0.0.3 area 1',
    'network 10.0.0.0 0.0.0.3 area 0',
    'no network 192.168.2.0 0.0.0.255 area 1',
    'network 192.168.2.0 0.0.0.255 area 0',
    'end',
  ]);
}

function applyFullSolution(ls: LabSession): LabSession {
  let next = applyFix(ls);
  next = runOn(next, 'PC-A', ['ping 192.168.2.10']);
  return next;
}

// ---------- Starting-state assertions ----------

describe('Lab 13 — starting state (broken)', () => {
  it('R1 and R2 have OSPF process 1 but DIFFERENT areas on the shared link', () => {
    const ls = initLabSession(lab13OspfTshoot);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('not router');
    expect(r1.device.ospf.process).toBe(1);
    expect(r2.device.ospf.process).toBe(1);
    // R1 has area 0 throughout; R2 has area 1 throughout. The shared link
    // (10.0.0.0/30) lands under area 0 on R1 and area 1 on R2.
    expect(r1.device.ospf.networks.every((n) => n.area === 0)).toBe(true);
    expect(r2.device.ospf.networks.every((n) => n.area === 1)).toBe(true);
  });

  it('neither router has a FULL neighbor (area mismatch blocks adjacency)', () => {
    const ls = initLabSession(lab13OspfTshoot);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('not router');
    expect(r1.device.ospf.neighbors.size).toBe(0);
    expect(r2.device.ospf.neighbors.size).toBe(0);
  });

  it('PC-A cannot ping PC-B in the starting state', () => {
    let ls = initLabSession(lab13OspfTshoot);
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    const pca = ls.devices['PC-A'];
    if (pca.kind !== 'pc') throw new Error('not pc');
    expect(pca.lastPing).toEqual({ target: '192.168.2.10', ok: false });
  });

  it('both objectives are false at start', () => {
    expect(checkAll(initLabSession(lab13OspfTshoot))).toEqual([false, false]);
  });
});

// ---------- Objective-by-objective tests ----------

describe('Lab 13 — objective: adjacency', () => {
  it('false on fresh session', () => {
    expect(checkAll(initLabSession(lab13OspfTshoot))[0]).toBe(false);
  });

  it('still false if only the WAN statement on R2 is fixed (LAN still area 1)', () => {
    // A partial fix where the LAN statement on R2 stays in area 1 is enough
    // to form the WAN adjacency (the engine matches per shared link).
    // Pedagogically the WAN fix alone IS enough to flip adjacency — the
    // routes-propagating step is what the reachable objective covers.
    let ls = initLabSession(lab13OspfTshoot);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'no network 10.0.0.0 0.0.0.3 area 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'end',
    ]);
    expect(checkAll(ls)[0]).toBe(true);
  });

  it('true after the full fix (both R2 statements re-areaed to 0)', () => {
    const ls = applyFix(initLabSession(lab13OspfTshoot));
    expect(checkAll(ls)[0]).toBe(true);
  });
});

describe('Lab 13 — objective: reachable', () => {
  it('false on fresh session (no ping run, no adjacency)', () => {
    expect(checkAll(initLabSession(lab13OspfTshoot))[1]).toBe(false);
  });

  it('false after the fix but BEFORE the learner runs ping', () => {
    const ls = applyFix(initLabSession(lab13OspfTshoot));
    expect(checkAll(ls)[1]).toBe(false);
  });

  it('false if the learner pings without fixing the area (ping still fails)', () => {
    let ls = initLabSession(lab13OspfTshoot);
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    expect(checkAll(ls)[1]).toBe(false);
  });

  it('true after full fix + successful ping from PC-A', () => {
    const ls = applyFullSolution(initLabSession(lab13OspfTshoot));
    expect(checkAll(ls)[1]).toBe(true);
  });
});

describe('Lab 13 — full solution', () => {
  it('all 2 objectives pass after the canonical fix + ping', () => {
    const ls = applyFullSolution(initLabSession(lab13OspfTshoot));
    expect(checkAll(ls)).toEqual([true, true]);
  });

  it('fix propagates an OSPF route on R1 for 192.168.2.0/24', () => {
    const ls = applyFix(initLabSession(lab13OspfTshoot));
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
