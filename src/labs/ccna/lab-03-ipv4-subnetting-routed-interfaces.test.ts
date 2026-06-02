import { describe, it, expect } from 'vitest';
import { initLabSession, applyToDevice, setActive, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab03Ipv4SubnettingRoutedInterfaces } from './lab-03-ipv4-subnetting-routed-interfaces';
import type { Session as RouterSession } from '@/engine/adapters/ios/state';
import type { PcSession } from '@/engine/adapters/pc';

function fresh(): LabSession {
  return initLabSession(lab03Ipv4SubnettingRoutedInterfaces);
}

function runOn(lab: LabSession, deviceId: string, lines: readonly string[]): LabSession {
  let cur = setActive(lab, deviceId);
  for (const line of lines) cur = applyToDevice(cur, deviceId, line).session;
  return cur;
}

function router(lab: LabSession, id: string): RouterSession {
  const s = lab.devices[id];
  if (s.kind !== 'router') throw new Error(`${id} is not a router`);
  return s;
}

function pc(lab: LabSession, id: string): PcSession {
  const s = lab.devices[id];
  if (s.kind !== 'pc') throw new Error(`${id} is not a PC`);
  return s;
}

const R1_ADDRESSING = [
  'enable',
  'configure terminal',
  'interface gi0/0',
  'ip address 172.16.10.1 255.255.255.192',
  'no shutdown',
  'exit',
  'interface gi0/1',
  'ip address 10.10.10.1 255.255.255.252',
  'no shutdown',
  'end',
] as const;

const R2_ADDRESSING = [
  'enable',
  'configure terminal',
  'interface gi0/0',
  'ip address 172.16.10.65 255.255.255.224',
  'no shutdown',
  'exit',
  'interface gi0/1',
  'ip address 10.10.10.2 255.255.255.252',
  'no shutdown',
  'end',
] as const;

function configureRouters(lab: LabSession = fresh()): LabSession {
  let cur = runOn(lab, 'R1', R1_ADDRESSING);
  cur = runOn(cur, 'R2', R2_ADDRESSING);
  return cur;
}

describe('Lab 03 — starting IPv4 subnetting state', () => {
  it('is a Pro guided lab that fills the numbered Lab 03 gap', () => {
    expect(lab03Ipv4SubnettingRoutedInterfaces.id).toBe('ccna-lab03-ipv4-subnetting-routed-interfaces');
    expect(lab03Ipv4SubnettingRoutedInterfaces.isFree).toBe(false);
    expect(lab03Ipv4SubnettingRoutedInterfaces.difficulty).toBe(1);
  });

  it('starts with PCs pre-addressed but router interfaces unconfigured/admin-down', () => {
    const lab = fresh();
    expect(pc(lab, 'PC-A')).toMatchObject({ ip: '172.16.10.10', mask: '255.255.255.192', gateway: '172.16.10.1' });
    expect(pc(lab, 'PC-B')).toMatchObject({ ip: '172.16.10.70', mask: '255.255.255.224', gateway: '172.16.10.65' });

    const r1 = router(lab, 'R1');
    const r2 = router(lab, 'R2');
    expect(r1.device.interfaces['Gi0/0'].ip).toBeNull();
    expect(r1.device.interfaces['Gi0/0'].adminUp).toBe(false);
    expect(r1.device.interfaces['Gi0/1'].ip).toBeNull();
    expect(r2.device.interfaces['Gi0/0'].ip).toBeNull();
    expect(r2.device.interfaces['Gi0/1'].ip).toBeNull();
  });

  it('all objectives are unmet on a fresh session', () => {
    const result = grade(lab03Ipv4SubnettingRoutedInterfaces, fresh());
    expect(result.allMet).toBe(false);
    expect(result.objectives.map((o) => [o.id, o.met])).toEqual([
      ['r1-lan-wan-addressing', false],
      ['r2-lan-wan-addressing', false],
      ['verify-interfaces', false],
      ['verify-gateways', false],
    ]);
  });
});

describe('Lab 03 — subnetting and verification', () => {
  it('R1 objective requires the correct /26 LAN gateway and /30 WAN address', () => {
    const lab = runOn(fresh(), 'R1', R1_ADDRESSING);
    const objective = grade(lab03Ipv4SubnettingRoutedInterfaces, lab).objectives.find((o) => o.id === 'r1-lan-wan-addressing');
    expect(objective?.met).toBe(true);
  });

  it('R2 objective requires the correct /27 LAN gateway and /30 WAN address', () => {
    const lab = runOn(fresh(), 'R2', R2_ADDRESSING);
    const objective = grade(lab03Ipv4SubnettingRoutedInterfaces, lab).objectives.find((o) => o.id === 'r2-lan-wan-addressing');
    expect(objective?.met).toBe(true);
  });

  it('verify-interfaces requires show ip interface brief on both routers after addressing, not before', () => {
    let lab = runOn(fresh(), 'R1', ['enable', 'show ip interface brief']);
    lab = runOn(lab, 'R2', ['enable', 'show ip interface brief']);
    expect(grade(lab03Ipv4SubnettingRoutedInterfaces, lab).objectives.find((o) => o.id === 'verify-interfaces')?.met).toBe(false);

    lab = configureRouters(lab);
    expect(grade(lab03Ipv4SubnettingRoutedInterfaces, lab).objectives.find((o) => o.id === 'verify-interfaces')?.met).toBe(false);

    lab = runOn(lab, 'R1', ['show ip interface brief']);
    lab = runOn(lab, 'R2', ['show ip interface brief']);
    expect(grade(lab03Ipv4SubnettingRoutedInterfaces, lab).objectives.find((o) => o.id === 'verify-interfaces')?.met).toBe(true);
  });

  it('gateway verification requires successful pings from both PCs after router config', () => {
    let lab = runOn(fresh(), 'PC-A', ['ping 172.16.10.1']);
    expect(pc(lab, 'PC-A').lastPing).toEqual({ target: '172.16.10.1', ok: false });
    expect(grade(lab03Ipv4SubnettingRoutedInterfaces, lab).objectives.find((o) => o.id === 'verify-gateways')?.met).toBe(false);

    lab = configureRouters(lab);
    lab = runOn(lab, 'PC-A', ['ping 172.16.10.1']);
    lab = runOn(lab, 'PC-B', ['ping 172.16.10.65']);
    expect(pc(lab, 'PC-A').lastPing).toEqual({ target: '172.16.10.1', ok: true });
    expect(pc(lab, 'PC-B').lastPing).toEqual({ target: '172.16.10.65', ok: true });
    expect(grade(lab03Ipv4SubnettingRoutedInterfaces, lab).objectives.find((o) => o.id === 'verify-gateways')?.met).toBe(true);
  });

  it('full walkthrough completes every objective', () => {
    let lab = configureRouters();
    lab = runOn(lab, 'R1', ['show ip interface brief']);
    lab = runOn(lab, 'R2', ['show ip interface brief']);
    lab = runOn(lab, 'PC-A', ['ping 172.16.10.1']);
    lab = runOn(lab, 'PC-B', ['ping 172.16.10.65']);

    const result = grade(lab03Ipv4SubnettingRoutedInterfaces, lab);
    expect(result.objectives.filter((o) => !o.met).map((o) => o.id)).toEqual([]);
    expect(result.allMet).toBe(true);
  });
});
