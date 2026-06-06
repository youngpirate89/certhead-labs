import { describe, it, expect } from 'vitest';
import { lab31LoopbackOspfRouterId } from './lab-31-loopback-ospf-router-id';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
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
  return lab31LoopbackOspfRouterId.objectives.map((o) => o.check(state, history, ls));
}

function applySolution(ls: LabSession): LabSession {
  let cur = ls;
  cur = runOn(cur, 'R1', [
    'enable',
    'configure terminal',
    'interface loopback0',
    'ip address 10.255.31.1 255.255.255.255',
    'exit',
    'router ospf 1',
    'router-id 10.255.31.1',
    'network 10.255.31.1 0.0.0.0 area 0',
    'end',
  ]);
  cur = runOn(cur, 'R2', [
    'enable',
    'configure terminal',
    'interface loopback0',
    'ip address 10.255.31.2 255.255.255.255',
    'exit',
    'router ospf 1',
    'router-id 10.255.31.2',
    'network 10.255.31.2 0.0.0.0 area 0',
    'end',
  ]);
  cur = runOn(cur, 'R1', ['show ip ospf neighbor', 'show ip route', 'ping 10.255.31.2']);
  cur = runOn(cur, 'R2', ['show ip ospf neighbor', 'show ip route', 'ping 10.255.31.1']);
  return cur;
}

describe('Lab 31 - Loopback OSPF Router ID', () => {
  it('starts with OSPF adjacency up but no loopbacks configured', () => {
    const ls = initLabSession(lab31LoopbackOspfRouterId);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('not routers');
    expect(Array.from(r1.device.ospf.neighbors.values()).some((n) => n.state === 'FULL')).toBe(true);
    expect(r1.device.interfaces.Lo0).toBeUndefined();
    expect(r2.device.interfaces.Lo0).toBeUndefined();
    expect(checkAll(ls)).toEqual([false, false, false, false]);
  });

  it('configures loopbacks, stable router IDs, OSPF advertisements, and reachability', () => {
    const ls = applySolution(initLabSession(lab31LoopbackOspfRouterId));
    expect(checkAll(ls)).toEqual([true, true, true, true]);

    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('not routers');
    expect(r1.device.ospf.routerId).toBe('10.255.31.1');
    expect(r2.device.ospf.routerId).toBe('10.255.31.2');
    expect(r1.ospfRoutes).toContainEqual(expect.objectContaining({ prefix: '10.255.31.2', mask: '255.255.255.255', source: 'ospf' }));
    expect(r2.ospfRoutes).toContainEqual(expect.objectContaining({ prefix: '10.255.31.1', mask: '255.255.255.255', source: 'ospf' }));
  });

  it('renders loopbacks in show output and OSPF-learned /32 routes', () => {
    const ls = applySolution(initLabSession(lab31LoopbackOspfRouterId));
    expect(showOn(ls, 'R1', 'show ip interface brief')).toMatch(/Loopback0\s+10\.255\.31\.1\s+YES\s+manual\s+up\s+up/);
    expect(showOn(ls, 'R1', 'show ip ospf')).toMatch(/Routing Process "ospf 1" with ID 10\.255\.31\.1/);
    expect(showOn(ls, 'R1', 'show ip route')).toMatch(/O\s+10\.255\.31\.2\/32 \[110\/1\] via 172\.16\.31\.2, GigabitEthernet0\/0/);
  });
});
