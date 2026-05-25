import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { grade } from '@/engine/grading';
import { lab05OspfSingleArea as lab } from './lab-05-ospf-single-area';

/**
 * Tests for the OSPF single-area lab. The shape mirrors the troubleshooting
 * labs: golden start-state assertions, then a happy-path walkthrough that
 * runs each objective transition through the full applyToActive pipeline.
 */

function runOn(ls: LabSession, id: string, lines: string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

describe('lab-05-ospf-single-area — starting state', () => {
  it('topology shape: 4 devices (2 PCs, 2 routers), 3 links, isFree:false', () => {
    expect(lab.topology.devices).toHaveLength(4);
    expect(lab.topology.links).toHaveLength(3);
    expect(lab.isFree).toBe(false);
  });

  it('seeded interfaces are up and addressed; no routing or OSPF at start', () => {
    const ls = initLabSession(lab);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('shape');

    expect(r1.device.interfaces['Gi0/0'].ip).toBe('192.168.1.1');
    expect(r1.device.interfaces['Gi0/0'].adminUp).toBe(true);
    expect(r1.device.interfaces['Gi0/2'].ip).toBe('10.0.0.1');
    expect(r1.device.interfaces['Gi0/2'].adminUp).toBe(true);

    expect(r2.device.interfaces['Gi0/0'].ip).toBe('192.168.2.1');
    expect(r2.device.interfaces['Gi0/0'].adminUp).toBe(true);
    expect(r2.device.interfaces['Gi0/2'].ip).toBe('10.0.0.2');
    expect(r2.device.interfaces['Gi0/2'].adminUp).toBe(true);

    expect(r1.staticRoutes).toEqual([]);
    expect(r2.staticRoutes).toEqual([]);
    expect(r1.device.ospf.process).toBeNull();
    expect(r2.device.ospf.process).toBeNull();

    expect(r1.mode).toBe('user');
    expect(r2.mode).toBe('user');
    expect(r1.history).toEqual([]);
    expect(r2.history).toEqual([]);
  });

  it('PC-A cannot reach PC-B at lab start (no routes between LANs)', () => {
    const ls = initLabSession(lab);
    const r = canReach(ls, 'PC-A', '192.168.2.10');
    expect(r.ok).toBe(false);
  });

  it('all three objectives are unmet at start', () => {
    const ls = initLabSession(lab);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(false);
    expect(g.objectives.find((o) => o.id === 'ospf-config')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'ospf-neighbor')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'reachability')?.met).toBe(false);
  });
});

describe('lab-05-ospf-single-area — happy path', () => {
  it('configuring OSPF on both routers ticks ospf-config', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 192.168.1.0 0.0.0.255 area 0',
      'network 10.0.0.0 0.0.0.3 area 0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 192.168.2.0 0.0.0.255 area 0',
      'network 10.0.0.0 0.0.0.3 area 0',
    ]);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'ospf-config')?.met).toBe(true);
  });

  it('ospf-neighbor requires BOTH adjacency AND a learner-run show command', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 192.168.1.0 0.0.0.255 area 0',
      'network 10.0.0.0 0.0.0.3 area 0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 192.168.2.0 0.0.0.255 area 0',
      'network 10.0.0.0 0.0.0.3 area 0',
    ]);

    // Adjacency formed, but no verify command run yet → ospf-neighbor unmet.
    let g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'ospf-neighbor')?.met).toBe(false);

    // Run the verify command — must tick now.
    ls = runOn(ls, 'R1', ['end', 'show ip ospf neighbor']);
    g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'ospf-neighbor')?.met).toBe(true);
  });

  it('reachability requires a learner-initiated ping from PC-A (not just routing-correct state)', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 192.168.1.0 0.0.0.255 area 0',
      'network 10.0.0.0 0.0.0.3 area 0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 192.168.2.0 0.0.0.255 area 0',
      'network 10.0.0.0 0.0.0.3 area 0',
    ]);

    // Routes now exist end-to-end (forward via OSPF, return via OSPF) — but
    // the objective must NOT auto-complete; the lastPing pattern requires
    // the learner to actually ping.
    expect(canReach(ls, 'PC-A', '192.168.2.10').ok).toBe(true);
    let g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'reachability')?.met).toBe(false);

    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'reachability')?.met).toBe(true);
  });

  it('full walkthrough: all three objectives met, allMet true', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 192.168.1.0 0.0.0.255 area 0',
      'network 10.0.0.0 0.0.0.3 area 0',
      'end',
      'show ip ospf neighbor',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 192.168.2.0 0.0.0.255 area 0',
      'network 10.0.0.0 0.0.0.3 area 0',
    ]);
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(true);
  });
});

describe('lab-05-ospf-single-area — wrong-area pitfall', () => {
  it('OSPF on both sides but mismatched areas → no adjacency, no learned routes, ping still fails', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 192.168.1.0 0.0.0.255 area 0',
      'network 10.0.0.0 0.0.0.3 area 0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 192.168.2.0 0.0.0.255 area 1',
      'network 10.0.0.0 0.0.0.3 area 1',
    ]);
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('shape');
    expect(r1.device.ospf.neighbors.size).toBe(0);
    expect(r1.ospfRoutes).toEqual([]);
    expect(canReach(ls, 'PC-A', '192.168.2.10').ok).toBe(false);
  });
});
