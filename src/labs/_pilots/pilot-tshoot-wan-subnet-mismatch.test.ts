import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { grade } from '@/engine/grading';
import { pilotTshootWanSubnetMismatch as lab } from './pilot-tshoot-wan-subnet-mismatch';

function configure(ls: LabSession, id: string, lines: string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

describe('pilot tshoot-wan-subnet-mismatch — R2 Gi0/0 lives in the wrong /30', () => {
  it('declares the right topology shape (2 PCs, 2 routers, 3 links) and is not free', () => {
    expect(lab.topology.devices).toHaveLength(4);
    expect(lab.topology.links).toHaveLength(3);
    expect(lab.isFree).toBe(false);
  });

  it('seeded starting state: R1.Gi0/0 in 192.168.12.0/30, R2.Gi0/0 in 192.168.12.4/30', () => {
    const ls = initLabSession(lab);

    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('shape');

    // R1 fully correct.
    expect(r1.device.interfaces['Gi0/1'].ip).toBe('192.168.1.1');
    expect(r1.device.interfaces['Gi0/1'].adminUp).toBe(true);
    expect(r1.device.interfaces['Gi0/0'].ip).toBe('192.168.12.1');
    expect(r1.device.interfaces['Gi0/0'].mask).toBe('255.255.255.252');
    expect(r1.device.interfaces['Gi0/0'].adminUp).toBe(true);

    // R2's WAN is the misconfigured end.
    expect(r2.device.interfaces['Gi0/0'].ip).toBe('192.168.12.6');
    expect(r2.device.interfaces['Gi0/0'].mask).toBe('255.255.255.252');
    expect(r2.device.interfaces['Gi0/0'].adminUp).toBe(true);
    expect(r2.device.interfaces['Gi0/1'].ip).toBe('192.168.2.1');
    expect(r2.device.interfaces['Gi0/1'].adminUp).toBe(true);

    // Both routers have sensible static routes — the link itself is broken.
    expect(
      r1.staticRoutes.some(
        (r) =>
          r.prefix === '192.168.2.0' &&
          r.mask === '255.255.255.0' &&
          r.nextHop === '192.168.12.2',
      ),
    ).toBe(true);
    expect(
      r2.staticRoutes.some(
        (r) =>
          r.prefix === '192.168.1.0' &&
          r.mask === '255.255.255.0' &&
          r.nextHop === '192.168.12.1',
      ),
    ).toBe(true);

    // Seed left no history, both at user prompt.
    expect(r1.mode).toBe('user');
    expect(r2.mode).toBe('user');
    expect(r1.history).toEqual([]);
    expect(r2.history).toEqual([]);
  });

  it('headline failure: canReach(PC-A, PC-B) fails on FORWARD at R1 Gi0/0 with link-subnet-mismatch', () => {
    const ls = initLabSession(lab);
    const result = canReach(ls, 'PC-A', '192.168.2.10');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedAt.direction).toBe('forward');
    expect(result.failedAt.deviceId).toBe('R1');
    expect(result.failedAt.iface).toBe('Gi0/0');
    expect(result.failedAt.reason).toBe('link-subnet-mismatch');
  });

  it('objectives: both unmet at start', () => {
    const ls = initLabSession(lab);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(false);
    expect(g.objectives.find((o) => o.id === 'fix-r2-wan')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(false);
  });

  it('after the fix, fix-r2-wan is met but reach is STILL UNMET until the learner pings', () => {
    let ls = initLabSession(lab);
    ls = configure(ls, 'R2', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'no ip address',
      'ip address 192.168.12.2 255.255.255.252',
    ]);

    const r2 = ls.devices.R2;
    if (r2.kind !== 'router') throw new Error('shape');
    expect(r2.device.interfaces['Gi0/0'].ip).toBe('192.168.12.2');
    expect(canReach(ls, 'PC-A', '192.168.2.10').ok).toBe(true);

    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'fix-r2-wan')?.met).toBe(true);
    expect(g.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(false);
    expect(g.allMet).toBe(false);
  });

  it('a successful ping from PC-A flips reach to met (full hand-completion contract)', () => {
    let ls = initLabSession(lab);
    ls = configure(ls, 'R2', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'no ip address',
      'ip address 192.168.12.2 255.255.255.252',
    ]);
    ls = configure(ls, 'PC-A', ['ping 192.168.2.10']);

    const g = grade(lab, ls);
    expect(g.allMet).toBe(true);
    expect(g.objectives.find((o) => o.id === 'fix-r2-wan')?.met).toBe(true);
    expect(g.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(true);
  });

  it('a FAILED ping (subnets still mismatched) does not satisfy the reach objective', () => {
    let ls = initLabSession(lab);
    ls = configure(ls, 'PC-A', ['ping 192.168.2.10']);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(false);
  });
});
