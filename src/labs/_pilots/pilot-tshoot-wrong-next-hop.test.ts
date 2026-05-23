import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { grade } from '@/engine/grading';
import { pilotTshootWrongNextHop as lab } from './pilot-tshoot-wrong-next-hop';

function configure(ls: LabSession, id: string, lines: string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

describe('pilot tshoot-wrong-next-hop — bad static next-hop on R2', () => {
  it('declares the right topology shape (2 PCs, 2 routers, 3 links) and is not free', () => {
    expect(lab.topology.devices).toHaveLength(4);
    expect(lab.topology.links).toHaveLength(3);
    expect(lab.isFree).toBe(false);
  });

  it('seeded starting state: interfaces up + R1 forward static + R2 bad static (.99)', () => {
    const ls = initLabSession(lab);

    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('shape');

    // Interface state — all four up.
    expect(r1.device.interfaces['Gi0/1'].ip).toBe('192.168.1.1');
    expect(r1.device.interfaces['Gi0/1'].adminUp).toBe(true);
    expect(r1.device.interfaces['Gi0/0'].ip).toBe('192.168.12.1');
    expect(r1.device.interfaces['Gi0/0'].adminUp).toBe(true);
    expect(r2.device.interfaces['Gi0/0'].ip).toBe('192.168.12.2');
    expect(r2.device.interfaces['Gi0/0'].adminUp).toBe(true);
    expect(r2.device.interfaces['Gi0/1'].ip).toBe('192.168.2.1');
    expect(r2.device.interfaces['Gi0/1'].adminUp).toBe(true);

    // R1 forward static present; R2 has the BAD static and only that.
    expect(
      r1.staticRoutes.some(
        (r) =>
          r.prefix === '192.168.2.0' &&
          r.mask === '255.255.255.0' &&
          r.nextHop === '192.168.12.2',
      ),
    ).toBe(true);
    expect(r2.staticRoutes).toHaveLength(1);
    expect(r2.staticRoutes[0]).toMatchObject({
      prefix: '192.168.1.0',
      mask: '255.255.255.0',
      nextHop: '192.168.12.99',
    });

    // Both routers at the user prompt, no history.
    expect(r1.mode).toBe('user');
    expect(r2.mode).toBe('user');
    expect(r1.history).toEqual([]);
    expect(r2.history).toEqual([]);
    expect(r1.resolvedHistory).toEqual([]);
    expect(r2.resolvedHistory).toEqual([]);
  });

  it('headline failure: canReach(PC-A, PC-B) fails on RETURN at R2 with next-hop-unreachable', () => {
    const ls = initLabSession(lab);
    const result = canReach(ls, 'PC-A', '192.168.2.10');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedAt.direction).toBe('return');
    expect(result.failedAt.deviceId).toBe('R2');
    expect(result.failedAt.reason).toBe('next-hop-unreachable');
  });

  it('objectives: both unmet at start', () => {
    const ls = initLabSession(lab);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(false);
    expect(g.objectives.find((o) => o.id === 'fix-r2-next-hop')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(false);
  });

  it('after the fix, fix-r2-next-hop is met but reach is STILL UNMET until the learner pings', () => {
    let ls = initLabSession(lab);
    ls = configure(ls, 'R2', [
      'enable',
      'configure terminal',
      'no ip route 192.168.1.0 255.255.255.0 192.168.12.99',
      'ip route 192.168.1.0 255.255.255.0 192.168.12.1',
    ]);

    const r2 = ls.devices.R2;
    if (r2.kind !== 'router') throw new Error('shape');
    expect(r2.staticRoutes).toHaveLength(1);
    expect(r2.staticRoutes[0].nextHop).toBe('192.168.12.1');
    expect(canReach(ls, 'PC-A', '192.168.2.10').ok).toBe(true);

    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'fix-r2-next-hop')?.met).toBe(true);
    expect(g.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(false);
    expect(g.allMet).toBe(false);
  });

  it('a successful ping from PC-A flips reach to met (full hand-completion contract)', () => {
    let ls = initLabSession(lab);
    ls = configure(ls, 'R2', [
      'enable',
      'configure terminal',
      'no ip route 192.168.1.0 255.255.255.0 192.168.12.99',
      'ip route 192.168.1.0 255.255.255.0 192.168.12.1',
    ]);
    ls = configure(ls, 'PC-A', ['ping 192.168.2.10']);

    const g = grade(lab, ls);
    expect(g.allMet).toBe(true);
    expect(g.objectives.find((o) => o.id === 'fix-r2-next-hop')?.met).toBe(true);
    expect(g.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(true);
  });

  it('a FAILED ping (still pointing at .99) does not satisfy the reach objective', () => {
    let ls = initLabSession(lab);
    ls = configure(ls, 'PC-A', ['ping 192.168.2.10']);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(false);
  });
});
