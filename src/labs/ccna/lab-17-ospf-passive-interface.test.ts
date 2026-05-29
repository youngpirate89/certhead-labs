import { describe, it, expect } from 'vitest';
import {
  initLabSession,
  applyToDevice,
  setActive,
  type LabSession,
} from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { tabComplete } from '@/engine/adapters/ios/interpret';
import { lab17OspfPassiveInterface } from './lab-17-ospf-passive-interface';
import type { Session as RouterSession } from '@/engine/adapters/ios/state';

function runOn(lab: LabSession, deviceId: string, lines: readonly string[]): LabSession {
  let cur = setActive(lab, deviceId);
  for (const line of lines) {
    cur = applyToDevice(cur, deviceId, line).session;
  }
  return cur;
}

function fresh(): LabSession {
  return initLabSession(lab17OspfPassiveInterface);
}

function router(lab: LabSession, id: string): RouterSession {
  const s = lab.devices[id];
  if (s.kind !== 'router') throw new Error(`${id} is not a router`);
  return s;
}

/** Both passive-interface lines — the learner's job. */
const PASSIVE_R1: readonly string[] = [
  'enable',
  'configure terminal',
  'router ospf 1',
  'passive-interface GigabitEthernet0/0',
  'end',
];
const PASSIVE_R2: readonly string[] = [
  'enable',
  'configure terminal',
  'router ospf 1',
  'passive-interface GigabitEthernet0/0',
  'end',
];

describe('Lab 17 — starting state', () => {
  it('R1 and R2 interfaces are up and addressed', () => {
    const r1 = router(fresh(), 'R1');
    const r2 = router(fresh(), 'R2');
    expect(r1.device.interfaces['Gi0/0'].ip).toBe('192.168.1.1');
    expect(r1.device.interfaces['Gi0/0'].adminUp).toBe(true);
    expect(r1.device.interfaces['Gi0/2'].ip).toBe('10.0.0.1');
    expect(r1.device.interfaces['Gi0/2'].adminUp).toBe(true);
    expect(r2.device.interfaces['Gi0/2'].ip).toBe('10.0.0.2');
    expect(r2.device.interfaces['Gi0/0'].ip).toBe('192.168.2.1');
  });

  it('OSPF area 0 is pre-configured on both routers with FULL adjacency', () => {
    const r1 = router(fresh(), 'R1');
    const r2 = router(fresh(), 'R2');
    expect(r1.device.ospf.process).toBe(1);
    expect(r2.device.ospf.process).toBe(1);
    expect(r1.device.ospf.neighbors.size).toBe(1);
    expect(r2.device.ospf.neighbors.size).toBe(1);
    const r2NeighborOnR1 = [...r1.device.ospf.neighbors.values()][0];
    expect(r2NeighborOnR1.state).toBe('FULL');
    expect(r2NeighborOnR1.interface).toBe('Gi0/2');
  });

  it('passive set starts empty on both routers', () => {
    const r1 = router(fresh(), 'R1');
    const r2 = router(fresh(), 'R2');
    expect(r1.device.ospf.passive.size).toBe(0);
    expect(r2.device.ospf.passive.size).toBe(0);
  });

  it('seed commands do NOT appear in history (verify-passive gate stays unmet)', () => {
    const r1 = router(fresh(), 'R1');
    expect(r1.resolvedHistory.some((c) => /show ip ospf/.test(c))).toBe(false);
  });

  it('verify-passive gate (lastShowIpOspf) starts at 0 — not pre-stamped by setup', () => {
    const r1 = router(fresh(), 'R1');
    expect(r1.lastShowIpOspf).toBe(0);
  });
});

describe('Lab 17 — passive-interface configuration', () => {
  it('marking R1 Gi0/0 passive does NOT drop the WAN adjacency', () => {
    const lab = runOn(fresh(), 'R1', PASSIVE_R1);
    const r1 = router(lab, 'R1');
    expect(r1.device.ospf.passive.has('Gi0/0')).toBe(true);
    expect(r1.device.ospf.neighbors.size).toBe(1);
  });

  it('marking the WAN interface passive instead WOULD drop the adjacency', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'passive-interface GigabitEthernet0/2',
      'end',
    ]);
    expect(router(lab, 'R1').device.ospf.neighbors.size).toBe(0);
  });

  it('show ip ospf renders the passive interface block after marking', () => {
    let lab = runOn(fresh(), 'R1', PASSIVE_R1);
    const { output } = applyToDevice(setActive(lab, 'R1'), 'R1', 'show ip ospf');
    const text = output.map((o) => o.text).join('\n');
    expect(text).toMatch(/Passive Interface\(s\):/);
    expect(text).toMatch(/GigabitEthernet0\/0/);
  });

  it('show running-config on R1 includes the router ospf 1 + passive-interface lines', () => {
    let lab = runOn(fresh(), 'R1', PASSIVE_R1);
    const { output } = applyToDevice(setActive(lab, 'R1'), 'R1', 'show running-config');
    const text = output.map((o) => o.text).join('\n');
    expect(text).toMatch(/router ospf 1/);
    expect(text).toMatch(/ passive-interface GigabitEthernet0\/0/);
  });
});

describe('Lab 17 — objective coverage', () => {
  it('on a fresh session, NO objectives are met (adjacency-intact is gated on the passive configs)', () => {
    // The adjacency is FULL at init (setup forms it), but adjacency-intact must
    // NOT auto-complete at open — it confirms the adjacency SURVIVES the passive
    // change, so it is gated on r1-passive && r2-passive being set first.
    const result = grade(lab17OspfPassiveInterface, fresh());
    const byId = Object.fromEntries(result.objectives.map((o) => [o.id, o.met]));
    expect(byId['r1-passive']).toBe(false);
    expect(byId['r2-passive']).toBe(false);
    expect(byId['adjacency-intact']).toBe(false);
    expect(byId['verify-passive']).toBe(false);
    expect(result.allMet).toBe(false);
  });

  it('adjacency-intact stays UNMET until BOTH passive configs are applied', () => {
    // Only R1 passive: not enough — obj2 (R2) is still unmet.
    let lab = runOn(fresh(), 'R1', PASSIVE_R1);
    expect(
      grade(lab17OspfPassiveInterface, lab).objectives.find((x) => x.id === 'adjacency-intact')?.met,
    ).toBe(false);
    // Both LANs passive and the WAN neighbor still FULL: now it flips true.
    lab = runOn(lab, 'R2', PASSIVE_R2);
    expect(
      grade(lab17OspfPassiveInterface, lab).objectives.find((x) => x.id === 'adjacency-intact')?.met,
    ).toBe(true);
  });

  it('adjacency-intact stays UNMET if the learner marks the WAN passive (breaks the adjacency)', () => {
    // R1 LAN passive (obj1 ok) but R2 WAN (Gi0/2) passive instead of its LAN:
    // obj2 (R2 Gi0/0 passive) is unmet AND the adjacency would drop — either way
    // adjacency-intact must not be satisfied.
    let lab = runOn(fresh(), 'R1', PASSIVE_R1);
    lab = runOn(lab, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'passive-interface GigabitEthernet0/2',
      'end',
    ]);
    expect(
      grade(lab17OspfPassiveInterface, lab).objectives.find((x) => x.id === 'adjacency-intact')?.met,
    ).toBe(false);
  });

  it('r1-passive flips after passive-interface gi0/0 on R1', () => {
    const lab = runOn(fresh(), 'R1', PASSIVE_R1);
    const o = grade(lab17OspfPassiveInterface, lab).objectives.find((x) => x.id === 'r1-passive');
    expect(o?.met).toBe(true);
  });

  it('r2-passive flips after passive-interface gi0/0 on R2', () => {
    const lab = runOn(fresh(), 'R2', PASSIVE_R2);
    const o = grade(lab17OspfPassiveInterface, lab).objectives.find((x) => x.id === 'r2-passive');
    expect(o?.met).toBe(true);
  });

  it('verify-passive requires the learner to actually run show ip ospf on R1', () => {
    let lab = runOn(fresh(), 'R1', PASSIVE_R1);
    expect(
      grade(lab17OspfPassiveInterface, lab).objectives.find((x) => x.id === 'verify-passive')?.met,
    ).toBe(false);
    lab = runOn(lab, 'R1', ['show ip ospf']);
    expect(
      grade(lab17OspfPassiveInterface, lab).objectives.find((x) => x.id === 'verify-passive')?.met,
    ).toBe(true);
  });

  it('show ip ospf BEFORE any passive config does NOT satisfy verify-passive (observe-after-configure)', () => {
    // The natural first move in a fresh lab is to inspect state. Running
    // `show ip ospf` before marking any interface passive must NOT tick the
    // verify objective green — the old history regex was order-insensitive and
    // did exactly that, surfacing as "complete at lab open" in the cold-run.
    let lab = runOn(fresh(), 'R1', ['enable', 'show ip ospf', 'disable']);
    expect(router(lab, 'R1').lastShowIpOspf).toBe(0);
    expect(
      grade(lab17OspfPassiveInterface, lab).objectives.find((x) => x.id === 'verify-passive')?.met,
    ).toBe(false);
    // Now configure passive and re-run the show — only then does it count.
    lab = runOn(lab, 'R1', PASSIVE_R1);
    lab = runOn(lab, 'R1', ['show ip ospf']);
    expect(
      grade(lab17OspfPassiveInterface, lab).objectives.find((x) => x.id === 'verify-passive')?.met,
    ).toBe(true);
  });

  it('verify-passive accepts an abbreviated form (canonical history)', () => {
    let lab = runOn(fresh(), 'R1', PASSIVE_R1);
    lab = runOn(lab, 'R1', ['sh ip ospf']);
    expect(
      grade(lab17OspfPassiveInterface, lab).objectives.find((x) => x.id === 'verify-passive')?.met,
    ).toBe(true);
  });

  it('full happy-path satisfies every objective', () => {
    let lab = runOn(fresh(), 'R1', PASSIVE_R1);
    lab = runOn(lab, 'R2', PASSIVE_R2);
    lab = runOn(lab, 'R1', ['show ip ospf']);
    const result = grade(lab17OspfPassiveInterface, lab);
    const unmet = result.objectives.filter((o) => !o.met).map((o) => o.id);
    expect(unmet).toEqual([]);
    expect(result.allMet).toBe(true);
  });
});

describe('Lab 17 — tab completion', () => {
  it('`passive` tab-completes to `passive-interface` inside config-router mode', () => {
    const lab = runOn(fresh(), 'R1', ['enable', 'configure terminal', 'router ospf 1']);
    const r1 = router(lab, 'R1');
    expect(r1.mode).toBe('config-router');
    expect(tabComplete(r1, 'passive')).toBe('passive-interface ');
  });
});
