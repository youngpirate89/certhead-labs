import { describe, expect, it } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { getLabById } from '@/labs/catalog';
import { tshootReturnRouteMissingServerVlan as lab } from './tshoot-return-route-missing-server-vlan';

function runOn(ls: LabSession, id: string, lines: readonly string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function textOf(ls: LabSession, id: string, line: string): string {
  const res = applyToActive({ ...ls, activeDeviceId: id }, line);
  return res.output.map((o) => o.text).join('\n');
}

function objectiveMet(ls: LabSession, id: string): boolean {
  return grade(lab, ls).objectives.find((o) => o.id === id)?.met ?? false;
}

const RETURN_ROUTE = ['enable', 'configure terminal', 'ip route 10.150.10.0 255.255.255.0 10.150.0.1', 'end'] as const;

describe('tshoot-return-route-missing-server-vlan — starting ticket state', () => {
  it('declares a standalone non-free CCNA ticket lab and resolves from the catalog', () => {
    expect(lab.id).toBe('ccna-tshoot-return-route-missing-server-vlan');
    expect(lab.title).toMatch(/Server VLAN Return Route Missing/i);
    expect(lab.scenario).toMatch(/return route/i);
    expect(lab.scenario).toMatch(/10\.150\.50\.20/);
    expect(lab.isFree).toBe(false);
    expect(getLabById('ccna-tshoot-return-route-missing-server-vlan')).toBe(lab);
  });

  it('starts with BRANCH forward route seeded and CORE missing the branch LAN return route', () => {
    const ls = initLabSession(lab);
    const branch = ls.devices.BRANCH;
    const core = ls.devices.CORE;
    const server = ls.devices['SRV-FILES'];
    if (branch.kind !== 'router' || core.kind !== 'router' || server.kind !== 'router') throw new Error('router shape');

    expect(branch.device.interfaces['Gi0/0'].ip).toBe('10.150.10.1');
    expect(branch.device.interfaces['Gi0/1'].ip).toBe('10.150.0.1');
    expect(branch.staticRoutes).toEqual([
      expect.objectContaining({ prefix: '10.150.50.0', mask: '255.255.255.0', nextHop: '10.150.0.2' }),
    ]);

    expect(core.device.interfaces['Gi0/0'].ip).toBe('10.150.0.2');
    expect(core.device.interfaces['Gi0/1'].ip).toBe('10.150.50.1');
    expect(core.staticRoutes).toEqual([]);
    expect(server.device.interfaces['Gi0/0'].ip).toBe('10.150.50.20');
    expect(server.staticRoutes).toEqual([
      expect.objectContaining({ prefix: '0.0.0.0', mask: '0.0.0.0', nextHop: '10.150.50.1' }),
    ]);
  });

  it('headline failure: PC-BRANCH reaches CORE forward, but reply fails at CORE due to no return route', () => {
    const result = canReach(initLabSession(lab), 'PC-BRANCH', '10.150.50.20');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedAt.direction).toBe('return');
      expect(result.failedAt.deviceId).toBe('CORE');
      expect(result.failedAt.reason).toBe('no-route');
    }
  });

  it('all objectives start unmet at 0/5', () => {
    const g = grade(lab, initLabSession(lab));
    expect(g.objectives).toHaveLength(5);
    expect(g.objectives.map((o) => o.met)).toEqual([false, false, false, false, false]);
    expect(g.allMet).toBe(false);
  });
});

describe('tshoot-return-route-missing-server-vlan — repair path', () => {
  it('show ip route before the repair shows connected server/transit routes and no branch LAN static', () => {
    const text = textOf(initLabSession(lab), 'CORE', 'show ip route');
    expect(text).toMatch(/10\.150\.0\.0\/30/);
    expect(text).toMatch(/10\.150\.50\.0\/24/);
    expect(text).not.toMatch(/S\s+10\.150\.10\.0\/24 \[1\/0\] via 10\.150\.0\.1/);
  });

  it('installing the return route restores reachability, but verification objectives require show and ping commands', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'CORE', RETURN_ROUTE);

    const core = ls.devices.CORE;
    if (core.kind !== 'router') throw new Error('CORE shape');
    expect(core.staticRoutes).toEqual([
      expect.objectContaining({ prefix: '10.150.10.0', mask: '255.255.255.0', nextHop: '10.150.0.1', source: 'static' }),
    ]);
    expect(canReach(ls, 'PC-BRANCH', '10.150.50.20')).toEqual({ ok: true });
    expect(objectiveMet(ls, 'install-return-route')).toBe(true);
    expect(objectiveMet(ls, 'verify-return-route-table')).toBe(false);
    expect(objectiveMet(ls, 'confirm-server-reachability')).toBe(false);
  });

  it('show ip route after the repair renders the Cisco-style static route and satisfies the route-table objective', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'CORE', RETURN_ROUTE);
    const text = textOf(ls, 'CORE', 'show ip route');
    expect(text).toContain('S    10.150.10.0/24 [1/0] via 10.150.0.1');
    ls = runOn(ls, 'CORE', ['show ip route']);
    expect(objectiveMet(ls, 'verify-return-route-table')).toBe(true);
  });

  it('published solution exits config mode before post-fix show ip route', () => {
    const steps = lab.solution?.steps ?? [];
    const showStepIndex = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.device === 'CORE' && step.commands.includes('show ip route'))
      .at(-1)?.index;
    expect(showStepIndex).toBeGreaterThan(0);
    expect(steps[showStepIndex! - 1]?.commands.at(-1)).toBe('end');
  });

  it('published troubleshooting workflow satisfies every objective and restores file-server reachability', () => {
    let ls = initLabSession(lab);
    for (const step of lab.solution!.steps) {
      ls = runOn(ls, step.device, step.commands);
    }

    expect(canReach(ls, 'PC-BRANCH', '10.150.50.20')).toEqual({ ok: true });
    const pc = ls.devices['PC-BRANCH'];
    expect(pc.kind === 'pc' && pc.lastPing).toEqual({ target: '10.150.50.20', ok: true });

    const g = grade(lab, ls);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual(g.objectives.map((o) => [o.id, true]));
    expect(g.allMet).toBe(true);
  });
});
