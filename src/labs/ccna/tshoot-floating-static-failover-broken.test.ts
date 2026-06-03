import { describe, expect, it } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { getLabById } from '@/labs/catalog';
import { tshootFloatingStaticFailoverBroken as lab } from './tshoot-floating-static-failover-broken';

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

const FIX_BACKUP_DEFAULT = [
  'enable',
  'configure terminal',
  'no ip route 0.0.0.0 0.0.0.0 10.160.0.9 200',
  'ip route 0.0.0.0 0.0.0.0 10.160.0.6 200',
  'end',
] as const;

describe('tshoot-floating-static-failover-broken — starting ticket state', () => {
  it('declares a standalone non-free CCNA ticket lab and resolves from the catalog', () => {
    expect(lab.id).toBe('ccna-tshoot-floating-static-failover-broken');
    expect(lab.title).toMatch(/Floating Static Failover/i);
    expect(lab.scenario).toMatch(/floating static/i);
    expect(lab.scenario).toMatch(/administrative distance/i);
    expect(lab.isFree).toBe(false);
    expect(getLabById('ccna-tshoot-floating-static-failover-broken')).toBe(lab);
  });

  it('starts with the primary route absent, a bad floating backup default, and backup WAN/return path seeded', () => {
    const ls = initLabSession(lab);
    const branch = ls.devices.BRANCH;
    const ispB = ls.devices['ISP-B'];
    const srv = ls.devices['INTERNET-SRV'];
    if (branch.kind !== 'router' || ispB.kind !== 'router' || srv.kind !== 'router') throw new Error('router shape');

    expect(branch.device.interfaces['Gi0/0'].ip).toBe('10.160.10.1');
    expect(branch.device.interfaces['Gi0/1'].ip).toBe('10.160.0.1');
    expect(branch.device.interfaces['Gi0/2'].ip).toBe('10.160.0.5');
    expect(branch.staticRoutes).toEqual([
      expect.objectContaining({ prefix: '0.0.0.0', mask: '0.0.0.0', nextHop: '10.160.0.9', adminDistance: 200 }),
    ]);
    expect(ispB.device.interfaces['Gi0/0'].ip).toBe('10.160.0.6');
    expect(ispB.staticRoutes).toEqual([
      expect.objectContaining({ prefix: '10.160.10.0', mask: '255.255.255.0', nextHop: '10.160.0.5' }),
    ]);
    expect(srv.device.interfaces['Gi0/0'].ip).toBe('198.51.100.160');
  });

  it('headline failure: PC-BRANCH cannot reach the internet service because the backup next-hop is unreachable', () => {
    const result = canReach(initLabSession(lab), 'PC-BRANCH', '198.51.100.160');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedAt.direction).toBe('forward');
      expect(result.failedAt.deviceId).toBe('BRANCH');
      expect(result.failedAt.reason).toBe('next-hop-unreachable');
    }
  });

  it('all objectives start unmet at 0/4', () => {
    const g = grade(lab, initLabSession(lab));
    expect(g.objectives).toHaveLength(4);
    expect(g.objectives.map((o) => o.met)).toEqual([false, false, false, false]);
    expect(g.allMet).toBe(false);
  });
});

describe('tshoot-floating-static-failover-broken — repair path', () => {
  it('show ip route before repair displays the broken floating static default with AD 200', () => {
    const text = textOf(initLabSession(lab), 'BRANCH', 'show ip route');
    expect(text).toContain('S    0.0.0.0/0 [200/0] via 10.160.0.9');
    expect(text).toMatch(/10\.160\.10\.0\/24/);
    expect(text).toMatch(/10\.160\.0\.4\/30/);
  });

  it('adding the correct route without removing the bad equal-AD route does not restore reachability', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'BRANCH', ['enable', 'configure terminal', 'ip route 0.0.0.0 0.0.0.0 10.160.0.6 200', 'end']);
    expect(canReach(ls, 'PC-BRANCH', '198.51.100.160').ok).toBe(false);
    expect(objectiveMet(ls, 'correct-floating-static-route')).toBe(false);
  });

  it('removing the bad route and installing the correct AD 200 backup restores reachability', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'BRANCH', FIX_BACKUP_DEFAULT);

    const branch = ls.devices.BRANCH;
    if (branch.kind !== 'router') throw new Error('BRANCH shape');
    expect(branch.staticRoutes).toEqual([
      expect.objectContaining({ prefix: '0.0.0.0', mask: '0.0.0.0', nextHop: '10.160.0.6', adminDistance: 200 }),
    ]);
    expect(canReach(ls, 'PC-BRANCH', '198.51.100.160')).toEqual({ ok: true });
    expect(objectiveMet(ls, 'correct-floating-static-route')).toBe(true);
    expect(objectiveMet(ls, 'verify-route-table')).toBe(false);
    expect(objectiveMet(ls, 'verify-internet-reachability')).toBe(false);
  });

  it('show ip route after repair renders the backup default with AD 200 and satisfies route-table verification', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'BRANCH', FIX_BACKUP_DEFAULT);
    const text = textOf(ls, 'BRANCH', 'show ip route');
    expect(text).toContain('S    0.0.0.0/0 [200/0] via 10.160.0.6');
    expect(text).not.toContain('via 10.160.0.9');
    ls = runOn(ls, 'BRANCH', ['show ip route']);
    expect(objectiveMet(ls, 'verify-route-table')).toBe(true);
  });

  it('published troubleshooting workflow satisfies every objective and restores reachability', () => {
    let ls = initLabSession(lab);
    for (const step of lab.solution!.steps) {
      ls = runOn(ls, step.device, step.commands);
    }

    expect(canReach(ls, 'PC-BRANCH', '198.51.100.160')).toEqual({ ok: true });
    const pc = ls.devices['PC-BRANCH'];
    expect(pc.kind === 'pc' && pc.lastPing).toEqual({ target: '198.51.100.160', ok: true });

    const g = grade(lab, ls);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual(g.objectives.map((o) => [o.id, true]));
    expect(g.allMet).toBe(true);
  });
});
