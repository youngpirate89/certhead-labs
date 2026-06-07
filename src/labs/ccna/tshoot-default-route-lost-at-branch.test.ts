import { describe, expect, it } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { getLabById } from '@/labs/catalog';
import { tshootDefaultRouteLostAtBranch as lab } from './tshoot-default-route-lost-at-branch';

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

const DEFAULT_ROUTE = ['enable', 'configure terminal', 'ip route 0.0.0.0 0.0.0.0 10.140.0.2', 'end'] as const;

describe('tshoot-default-route-lost-at-branch — starting ticket state', () => {
  it('declares a standalone non-free CCNA ticket lab and resolves from the catalog', () => {
    expect(lab.id).toBe('ccna-tshoot-default-route-lost-at-branch');
    expect(lab.title).toMatch(/Default Route Lost/i);
    expect(lab.scenario).toMatch(/branch/i);
    expect(lab.scenario).toMatch(/default route/i);
    expect(lab.isFree).toBe(false);
    expect(getLabById('ccna-tshoot-default-route-lost-at-branch')).toBe(lab);
  });

  it('starts with branch LAN and WAN interfaces up, upstream return path seeded, and no BRANCH static routes', () => {
    const ls = initLabSession(lab);
    const branch = ls.devices.BRANCH;
    const edge = ls.devices.EDGE;
    const internet = ls.devices['INTERNET-SRV'];
    if (branch.kind !== 'router' || edge.kind !== 'router' || internet.kind !== 'router') throw new Error('router shape');

    expect(branch.device.interfaces['Gi0/0'].ip).toBe('10.140.10.1');
    expect(branch.device.interfaces['Gi0/0'].adminUp).toBe(true);
    expect(branch.device.interfaces['Gi0/1'].ip).toBe('10.140.0.1');
    expect(branch.device.interfaces['Gi0/1'].adminUp).toBe(true);
    expect(branch.staticRoutes).toEqual([]);

    expect(edge.device.interfaces['Gi0/0'].ip).toBe('10.140.0.2');
    expect(edge.staticRoutes).toEqual([
      expect.objectContaining({ prefix: '10.140.10.0', mask: '255.255.255.0', nextHop: '10.140.0.1' }),
    ]);
    expect(internet.device.interfaces['Gi0/0'].ip).toBe('198.51.100.50');
    expect(internet.staticRoutes).toEqual([
      expect.objectContaining({ prefix: '0.0.0.0', mask: '0.0.0.0', nextHop: '198.51.100.1' }),
    ]);
  });

  it('headline failure: PC-BRANCH cannot reach INTERNET-SRV because BRANCH has no route beyond connected networks', () => {
    const ls = initLabSession(lab);
    const result = canReach(ls, 'PC-BRANCH', '198.51.100.50');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedAt.direction).toBe('forward');
      expect(result.failedAt.deviceId).toBe('BRANCH');
      expect(result.failedAt.reason).toBe('no-route');
    }
  });

  it('all objectives start unmet at 0/N', () => {
    const g = grade(lab, initLabSession(lab));
    expect(g.objectives).toHaveLength(4);
    expect(g.objectives.map((o) => o.met)).toEqual([false, false, false, false]);
    expect(g.allMet).toBe(false);
  });
});

describe('tshoot-default-route-lost-at-branch — repair path', () => {
  it('show ip route before the repair reveals connected routes but no gateway of last resort', () => {
    const text = textOf(initLabSession(lab), 'BRANCH', 'show ip route');
    expect(text).toMatch(/10\.140\.10\.0\/24/);
    expect(text).toMatch(/10\.140\.0\.0\/30/);
    expect(text).not.toMatch(/0\.0\.0\.0\/0/);
  });

  it('installing the default route restores reachability, but verification objectives require learner show and ping commands', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'BRANCH', DEFAULT_ROUTE);

    const branch = ls.devices.BRANCH;
    if (branch.kind !== 'router') throw new Error('BRANCH shape');
    expect(branch.staticRoutes).toEqual([
      expect.objectContaining({ prefix: '0.0.0.0', mask: '0.0.0.0', nextHop: '10.140.0.2', source: 'static' }),
    ]);
    expect(canReach(ls, 'PC-BRANCH', '198.51.100.50')).toEqual({ ok: true });
    expect(objectiveMet(ls, 'install-default-route')).toBe(true);
    expect(objectiveMet(ls, 'verify-route-table')).toBe(false);
    expect(objectiveMet(ls, 'verify-internet-reachability')).toBe(false);
  });

  it('show ip route after the repair renders the static default and satisfies the route-table objective', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'BRANCH', DEFAULT_ROUTE);
    const text = textOf(ls, 'BRANCH', 'show ip route');
    expect(text).toContain('S    0.0.0.0/0 [1/0] via 10.140.0.2');
    ls = runOn(ls, 'BRANCH', ['show ip route']);
    expect(objectiveMet(ls, 'verify-route-table')).toBe(true);
  });

  it('published solution exits config mode before post-fix show ip route', () => {
    const steps = lab.solution?.steps ?? [];
    const showStepIndex = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.device === 'BRANCH' && step.commands.includes('show ip route'))
      .at(-1)?.index;
    expect(showStepIndex).toBeGreaterThan(0);
    expect(steps[showStepIndex! - 1]?.commands.at(-1)).toBe('end');
  });

  it('published troubleshooting workflow satisfies every objective and restores internet reachability', () => {
    let ls = initLabSession(lab);
    for (const step of lab.solution!.steps) {
      ls = runOn(ls, step.device, step.commands);
    }

    expect(canReach(ls, 'PC-BRANCH', '198.51.100.50')).toEqual({ ok: true });
    const pc = ls.devices['PC-BRANCH'];
    expect(pc.kind === 'pc' && pc.lastPing).toEqual({ target: '198.51.100.50', ok: true });

    const g = grade(lab, ls);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual(g.objectives.map((o) => [o.id, true]));
    expect(g.allMet).toBe(true);
  });
});
