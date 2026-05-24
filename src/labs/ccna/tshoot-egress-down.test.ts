import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { grade } from '@/engine/grading';
import { tshootEgressDown as lab } from './tshoot-egress-down';

function configure(ls: LabSession, id: string, lines: string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

describe('tshoot-egress-down — R1 Gi0/2 administratively down', () => {
  it('topology shape (2 PCs, 2 routers, 3 links) and isFree: false', () => {
    expect(lab.topology.devices).toHaveLength(4);
    expect(lab.topology.links).toHaveLength(3);
    expect(lab.isFree).toBe(false);
  });

  it('seeded starting state: every config present, R1 Gi0/2 is the ONLY admin-down interface', () => {
    const ls = initLabSession(lab);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('shape');

    // R1 LAN — up and addressed.
    expect(r1.device.interfaces['Gi0/0'].ip).toBe('192.168.1.1');
    expect(r1.device.interfaces['Gi0/0'].adminUp).toBe(true);
    // R1 WAN — IP is still set (shutdown doesn't clear it), only adminUp flipped.
    expect(r1.device.interfaces['Gi0/2'].ip).toBe('10.0.0.1');
    expect(r1.device.interfaces['Gi0/2'].mask).toBe('255.255.255.252');
    expect(r1.device.interfaces['Gi0/2'].adminUp).toBe(false);

    // R2 — both interfaces up and addressed.
    expect(r2.device.interfaces['Gi0/2'].ip).toBe('10.0.0.2');
    expect(r2.device.interfaces['Gi0/2'].adminUp).toBe(true);
    expect(r2.device.interfaces['Gi0/0'].ip).toBe('192.168.2.1');
    expect(r2.device.interfaces['Gi0/0'].adminUp).toBe(true);

    // Both static routes seeded — the break is the interface, not the routing table.
    expect(
      r1.staticRoutes.some(
        (r) =>
          r.prefix === '192.168.2.0' &&
          r.mask === '255.255.255.0' &&
          r.nextHop === '10.0.0.2',
      ),
    ).toBe(true);
    expect(
      r2.staticRoutes.some(
        (r) =>
          r.prefix === '192.168.1.0' &&
          r.mask === '255.255.255.0' &&
          r.nextHop === '10.0.0.1',
      ),
    ).toBe(true);

    // Seed left no history; both routers back at the user prompt.
    expect(r1.mode).toBe('user');
    expect(r2.mode).toBe('user');
    expect(r1.history).toEqual([]);
    expect(r1.resolvedHistory).toEqual([]);
    expect(r2.history).toEqual([]);
    expect(r2.resolvedHistory).toEqual([]);
  });

  // GOLDEN TEST per the work-order: the seed must produce `egress-down`
  // naming R1 Gi0/2 — not `no-route`, not anything generic. Honors the
  // LAB_AUTHORING §4 rule that the failure sentence is the lab's lesson;
  // if the reason drifts, the seed is broken, fix the seed.
  it('headline failure: canReach(PC-A, PC-B) is egress-down at R1 Gi0/2 (forward)', () => {
    const ls = initLabSession(lab);
    const r = canReach(ls, 'PC-A', '192.168.2.10');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failedAt.direction).toBe('forward');
    expect(r.failedAt.deviceId).toBe('R1');
    expect(r.failedAt.iface).toBe('Gi0/2');
    expect(r.failedAt.reason).toBe('egress-down');
  });

  it('objectives: both unmet at start', () => {
    const ls = initLabSession(lab);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(false);
    expect(g.objectives.find((o) => o.id === 'noshut-r1-wan')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(false);
  });

  it('after no shutdown, noshut is met and canReach succeeds; reach STILL UNMET until ping', () => {
    let ls = initLabSession(lab);
    ls = configure(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'no shutdown',
    ]);

    // Flipping Gi0/2 adminUp restores reachability per the engine (this is
    // half of the golden test).
    expect(canReach(ls, 'PC-A', '192.168.2.10').ok).toBe(true);

    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'noshut-r1-wan')?.met).toBe(true);
    // ...but `reach` must not auto-complete on the fix alone — it requires
    // an actual learner-initiated ping (the lastPing pattern).
    expect(g.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(false);
    expect(g.allMet).toBe(false);
  });

  it('a successful ping from PC-A flips reach to met (full hand-completion contract)', () => {
    let ls = initLabSession(lab);
    ls = configure(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'no shutdown',
    ]);
    ls = configure(ls, 'PC-A', ['ping 192.168.2.10']);

    const g = grade(lab, ls);
    expect(g.allMet).toBe(true);
    expect(g.objectives.find((o) => o.id === 'noshut-r1-wan')?.met).toBe(true);
    expect(g.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(true);
  });

  it('a FAILED ping (interface still shut) does not satisfy the reach objective', () => {
    let ls = initLabSession(lab);
    ls = configure(ls, 'PC-A', ['ping 192.168.2.10']);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'reach-pc-a-to-pc-b')?.met).toBe(false);
  });
});
