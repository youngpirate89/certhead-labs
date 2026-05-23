import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { grade } from '@/engine/grading';
import { pilotTshootReturnRoute as lab } from './pilot-tshoot-return-route';

function configure(ls: LabSession, id: string, lines: string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

describe('pilot tshoot-return-route — missing return route troubleshooting', () => {
  it('declares the right topology shape (2 PCs, 2 routers, 3 links) and is not free', () => {
    expect(lab.topology.devices).toHaveLength(4);
    expect(lab.topology.links).toHaveLength(3);
    expect(lab.isFree).toBe(false);
  });

  it('seeded starting state: all four interfaces up + R1 forward static + NO R2 return static', () => {
    const ls = initLabSession(lab);

    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('shape');

    // R1 LAN
    const r1Lan = r1.device.interfaces['Gi0/1'];
    expect(r1Lan.ip).toBe('192.168.1.1');
    expect(r1Lan.mask).toBe('255.255.255.0');
    expect(r1Lan.adminUp).toBe(true);
    // R1 WAN
    const r1Wan = r1.device.interfaces['Gi0/0'];
    expect(r1Wan.ip).toBe('192.168.12.1');
    expect(r1Wan.mask).toBe('255.255.255.252');
    expect(r1Wan.adminUp).toBe(true);
    // R2 WAN
    const r2Wan = r2.device.interfaces['Gi0/0'];
    expect(r2Wan.ip).toBe('192.168.12.2');
    expect(r2Wan.mask).toBe('255.255.255.252');
    expect(r2Wan.adminUp).toBe(true);
    // R2 LAN
    const r2Lan = r2.device.interfaces['Gi0/1'];
    expect(r2Lan.ip).toBe('192.168.2.1');
    expect(r2Lan.mask).toBe('255.255.255.0');
    expect(r2Lan.adminUp).toBe(true);

    // R1 has the forward static; R2 has NONE.
    expect(
      r1.staticRoutes.some(
        (r) =>
          r.prefix === '192.168.2.0' &&
          r.mask === '255.255.255.0' &&
          r.nextHop === '192.168.12.2',
      ),
    ).toBe(true);
    expect(r2.staticRoutes).toEqual([]);

    // Both routers at the user prompt — seed tail puts them there.
    expect(r1.mode).toBe('user');
    expect(r2.mode).toBe('user');

    // Seed left no history behind on either router.
    expect(r1.history).toEqual([]);
    expect(r1.resolvedHistory).toEqual([]);
    expect(r2.history).toEqual([]);
    expect(r2.resolvedHistory).toEqual([]);
  });

  it('headline failure: canReach(PC-A, PC-B) fails on the RETURN walk at R2 (reason: no-route)', () => {
    const ls = initLabSession(lab);
    const result = canReach(ls, 'PC-A', '192.168.2.10');
    expect(result.ok).toBe(false);
    if (result.ok) return; // type guard
    expect(result.failedAt.direction).toBe('return');
    expect(result.failedAt.deviceId).toBe('R2');
    expect(result.failedAt.reason).toBe('no-route');
  });

  it('objectives: both unmet at start', () => {
    const ls = initLabSession(lab);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(false);
    expect(g.objectives.find((o) => o.id === 'fix-r2-return')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(false);
  });

  it('adding the return route on R2 flips both objectives to met', () => {
    let ls = initLabSession(lab);

    ls = configure(ls, 'R2', [
      'enable',
      'configure terminal',
      'ip route 192.168.1.0 255.255.255.0 192.168.12.1',
    ]);

    const result = canReach(ls, 'PC-A', '192.168.2.10');
    expect(result.ok).toBe(true);

    const g = grade(lab, ls);
    expect(g.allMet).toBe(true);
    expect(g.objectives.find((o) => o.id === 'fix-r2-return')?.met).toBe(true);
    expect(g.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(true);
  });
});
