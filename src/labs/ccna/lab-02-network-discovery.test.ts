import { describe, it, expect } from 'vitest';
import { initLabSession, applyToDevice, setActive, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab02NetworkDiscovery } from './lab-02-network-discovery';
import type { Session as RouterSession } from '@/engine/adapters/ios/state';
import type { PcSession } from '@/engine/adapters/pc';

function fresh(): LabSession {
  return initLabSession(lab02NetworkDiscovery);
}

function runOn(lab: LabSession, deviceId: string, lines: readonly string[]): LabSession {
  let cur = setActive(lab, deviceId);
  for (const line of lines) {
    cur = applyToDevice(cur, deviceId, line).session;
  }
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

const DISCOVERY_WALKTHROUGH = [
  ['R1', ['enable', 'show ip interface brief', 'show interfaces', 'show ip route']],
  ['SW1', ['enable', 'show vlan brief', 'show interfaces']],
  ['PC-A', ['ipconfig', 'ping 192.168.2.1']],
] as const;

function runDiscoveryWalkthrough(lab: LabSession = fresh()): LabSession {
  let cur = lab;
  for (const [device, commands] of DISCOVERY_WALKTHROUGH) {
    cur = runOn(cur, device, commands);
  }
  return cur;
}

describe('Lab 02 — starting network discovery state', () => {
  it('is a Pro lab between Lab 01 and Lab 05 in difficulty/sequence', () => {
    expect(lab02NetworkDiscovery.id).toBe('ccna-lab02-network-discovery');
    expect(lab02NetworkDiscovery.isFree).toBe(false);
    expect(lab02NetworkDiscovery.difficulty).toBe(1);
  });

  it('starts with R1 already addressed so the learner can inspect before configuring', () => {
    const r1 = router(fresh(), 'R1');
    expect(r1.device.interfaces['Gi0/0'].ip).toBe('192.168.2.1');
    expect(r1.device.interfaces['Gi0/0'].adminUp).toBe(true);
    expect(Object.keys(r1.device.interfaces)).toEqual(['Gi0/0']);
  });

  it('seeded setup does not count as learner discovery history', () => {
    const r1 = router(fresh(), 'R1');
    expect(r1.resolvedHistory).toEqual([]);
    const result = grade(lab02NetworkDiscovery, fresh());
    expect(result.allMet).toBe(false);
    expect(result.objectives.map((o) => [o.id, o.met])).toEqual([
      ['router-discovery', false],
      ['switch-discovery', false],
      ['endpoint-discovery', false],
    ]);
  });
});

describe('Lab 02 — discovery commands', () => {
  it('router discovery requires show ip interface brief, show interfaces, and show ip route on R1', () => {
    let lab = runOn(fresh(), 'R1', ['enable', 'show ip interface brief', 'show interfaces']);
    expect(grade(lab02NetworkDiscovery, lab).objectives.find((o) => o.id === 'router-discovery')?.met).toBe(false);

    lab = runOn(lab, 'R1', ['show ip route']);
    expect(grade(lab02NetworkDiscovery, lab).objectives.find((o) => o.id === 'router-discovery')?.met).toBe(true);
  });

  it('router discovery accepts valid IOS abbreviations through canonical resolved history', () => {
    const lab = runOn(fresh(), 'R1', ['en', 'sh ip int br', 'sh int', 'sh ip ro']);
    expect(grade(lab02NetworkDiscovery, lab).objectives.find((o) => o.id === 'router-discovery')?.met).toBe(true);
  });

  it('switch discovery requires show vlan brief and show interfaces on SW1', () => {
    let lab = runOn(fresh(), 'SW1', ['enable', 'show vlan brief']);
    expect(grade(lab02NetworkDiscovery, lab).objectives.find((o) => o.id === 'switch-discovery')?.met).toBe(false);

    lab = runOn(lab, 'SW1', ['show interfaces']);
    expect(grade(lab02NetworkDiscovery, lab).objectives.find((o) => o.id === 'switch-discovery')?.met).toBe(true);
  });

  it('endpoint discovery requires ipconfig plus a successful ping to the default gateway', () => {
    let lab = runOn(fresh(), 'PC-A', ['ipconfig']);
    expect(pc(lab, 'PC-A').lastIpconfig).toBeGreaterThan(0);
    expect(grade(lab02NetworkDiscovery, lab).objectives.find((o) => o.id === 'endpoint-discovery')?.met).toBe(false);

    lab = runOn(lab, 'PC-A', ['ping 192.168.2.1']);
    expect(pc(lab, 'PC-A').lastPing).toEqual({ target: '192.168.2.1', ok: true });
    expect(grade(lab02NetworkDiscovery, lab).objectives.find((o) => o.id === 'endpoint-discovery')?.met).toBe(true);
  });

  it('full guided discovery walkthrough completes the lab without configuration commands', () => {
    const lab = runDiscoveryWalkthrough();
    const result = grade(lab02NetworkDiscovery, lab);
    expect(result.objectives.filter((o) => !o.met).map((o) => o.id)).toEqual([]);
    expect(result.allMet).toBe(true);
  });
});
