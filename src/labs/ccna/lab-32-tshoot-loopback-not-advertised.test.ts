import { describe, it, expect } from 'vitest';
import { lab32TshootLoopbackNotAdvertised } from './lab-32-tshoot-loopback-not-advertised';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import type { HistoryView, LabState } from '@/engine/types';

function runOn(ls: LabSession, deviceId: string, lines: readonly string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: deviceId };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function showOn(ls: LabSession, deviceId: string, line: string): string {
  const { output } = applyToActive({ ...ls, activeDeviceId: deviceId }, line);
  return output.map((o) => o.text).join('\n');
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
  return lab32TshootLoopbackNotAdvertised.objectives.map((o) => o.check(state, history, ls));
}

function applyFix(ls: LabSession): LabSession {
  return runOn(ls, 'R2', [
    'enable',
    'configure terminal',
    'router ospf 1',
    'network 10.255.32.2 0.0.0.0 area 0',
    'end',
  ]);
}

function applyFullSolution(ls: LabSession): LabSession {
  let cur = runOn(ls, 'R1', ['enable', 'show ip ospf neighbor', 'show ip route', 'ping 10.255.32.2']);
  cur = applyFix(cur);
  cur = runOn(cur, 'R1', ['show ip route', 'ping 10.255.32.2']);
  return cur;
}

describe('Lab 32 - Troubleshoot loopback missing from OSPF', () => {
  it('starts with a FULL OSPF adjacency, both loopbacks configured, but R1 lacks R2 loopback route', () => {
    const ls = initLabSession(lab32TshootLoopbackNotAdvertised);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('not routers');

    expect(Array.from(r1.device.ospf.neighbors.values()).some((n) => n.state === 'FULL')).toBe(true);
    expect(r1.device.interfaces.Lo0?.ip).toBe('10.255.32.1');
    expect(r2.device.interfaces.Lo0?.ip).toBe('10.255.32.2');
    expect(r1.ospfRoutes.some((r) => r.prefix === '10.255.32.2' && r.mask === '255.255.255.255')).toBe(false);
    expect(canReach(ls, 'R1', '10.255.32.2').ok).toBe(false);
    expect(checkAll(ls)).toEqual([false, false, false, false]);
  });

  it('initial diagnostics show adjacency is healthy but the remote /32 route is missing', () => {
    const ls = initLabSession(lab32TshootLoopbackNotAdvertised);
    expect(showOn(ls, 'R1', 'show ip ospf neighbor')).toMatch(/10\.255\.32\.2\s+1\s+FULL/);
    expect(showOn(ls, 'R1', 'show ip route')).not.toMatch(/10\.255\.32\.2\/32/);
  });

  it('adding R2 loopback to OSPF installs the /32 route and restores reachability', () => {
    const ls = applyFix(initLabSession(lab32TshootLoopbackNotAdvertised));
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('not router');
    expect(r1.ospfRoutes).toContainEqual(expect.objectContaining({
      prefix: '10.255.32.2',
      mask: '255.255.255.255',
      nextHop: '172.16.32.2',
      egressIface: 'Gi0/0',
      source: 'ospf',
    }));
    expect(canReach(ls, 'R1', '10.255.32.2').ok).toBe(true);
  });

  it('requires diagnose, repair, and post-fix verification to complete all objectives', () => {
    expect(checkAll(applyFix(initLabSession(lab32TshootLoopbackNotAdvertised)))).toEqual([false, false, true, false]);
    const ls = applyFullSolution(initLabSession(lab32TshootLoopbackNotAdvertised));
    expect(checkAll(ls)).toEqual([true, true, true, true]);
    expect(showOn(ls, 'R1', 'show ip route')).toMatch(/O\s+10\.255\.32\.2\/32 \[110\/1\] via 172\.16\.32\.2, GigabitEthernet0\/0/);
  });
});
