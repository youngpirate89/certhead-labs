import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab30VlanDhcpTicket as lab } from './lab-30-vlan-dhcp-ticket';

function runOn(ls: LabSession, id: string, lines: string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function objectiveMet(ls: LabSession, id: string): boolean {
  return grade(lab, ls).objectives.find((o) => o.id === id)?.met ?? false;
}

function fixAllowedVlan(ls: LabSession): LabSession {
  return runOn(ls, 'SW1', [
    'enable',
    'configure terminal',
    'interface Gi0/1',
    'switchport trunk allowed vlan add 30',
    'end',
  ]);
}

describe('lab-30-vlan-dhcp-ticket — starting ticket state', () => {
  it('is a level 4 real-world ticket about restoring DHCP for VLAN 30', () => {
    expect(lab.id).toBe('ccna-lab30-vlan-dhcp-ticket');
    expect(lab.title).toMatch(/VLAN.*DHCP/i);
    expect(lab.difficulty).toBe(4);
    expect(lab.isFree).toBe(false);
    expect(lab.scenario).toMatch(/ticket/i);
    expect(lab.scenario).toMatch(/cannot get an IP address/i);
    expect(lab.scenario).not.toMatch(/allowed VLAN list/i);
  });

  it('starts with VLAN 30 missing from SW1 Gi0/1 allowed VLANs while existing VLAN 10 remains allowed', () => {
    const ls = initLabSession(lab);
    const sw1 = ls.devices.SW1;
    if (sw1.kind !== 'switch') throw new Error('shape');
    const trunk = sw1.device.switchports['Gi0/1'];
    expect(trunk.mode).toBe('trunk');
    expect(trunk.trunkAllowedVlans).toEqual([10]);
    expect(sw1.device.switchports['Fa0/10'].accessVlan).toBe(10);
    expect(sw1.device.switchports['Fa0/30'].accessVlan).toBe(30);
  });

  it('affected VLAN 30 PC shows APIPA/no lease at the start but existing VLAN 10 PC has a lease', () => {
    const ls = initLabSession(lab);
    const affected = ls.devices['PC-NEW'];
    const existing = ls.devices['PC-EXISTING'];
    if (affected.kind !== 'pc' || existing.kind !== 'pc') throw new Error('shape');
    expect(affected.ip).toBeNull();
    expect(existing.ip).toMatch(/^10\.10\.10\./);

    const out = runOn(ls, 'PC-NEW', ['ipconfig']).devices['PC-NEW'];
    if (out.kind !== 'pc') throw new Error('shape');
    expect(out.lastIpconfig).toBeGreaterThan(0);
  });

  it('all objectives are unmet at the start', () => {
    const g = grade(lab, initLabSession(lab));
    expect(g.allMet).toBe(false);
    for (const o of g.objectives) expect(o.met).toBe(false);
  });
});

describe('lab-30-vlan-dhcp-ticket — repair path', () => {
  it('does not complete the fix objective until the learner restores VLAN 30 on the trunk', () => {
    let ls = initLabSession(lab);
    expect(objectiveMet(ls, 'restore-dhcp-service')).toBe(false);
    ls = fixAllowedVlan(ls);
    expect(objectiveMet(ls, 'restore-dhcp-service')).toBe(true);
  });

  it('requires post-fix ipconfig verification on PC-NEW before DHCP verification completes', () => {
    let ls = fixAllowedVlan(initLabSession(lab));
    expect(objectiveMet(ls, 'verify-new-vlan-lease')).toBe(false);
    const affected = ls.devices['PC-NEW'];
    if (affected.kind !== 'pc') throw new Error('shape');
    expect(affected.ip).toMatch(/^10\.10\.30\./);

    ls = runOn(ls, 'PC-NEW', ['ipconfig']);
    expect(objectiveMet(ls, 'verify-new-vlan-lease')).toBe(true);
  });

  it('requires preserving the existing VLAN service', () => {
    let ls = fixAllowedVlan(initLabSession(lab));
    expect(objectiveMet(ls, 'preserve-existing-vlan')).toBe(false);
    ls = runOn(ls, 'PC-EXISTING', ['ipconfig']);
    expect(objectiveMet(ls, 'preserve-existing-vlan')).toBe(true);
  });

  it('full walkthrough restores DHCP for VLAN 30 and preserves VLAN 10', () => {
    let ls = fixAllowedVlan(initLabSession(lab));
    ls = runOn(ls, 'SW1', ['enable', 'show interfaces trunk']);
    ls = runOn(ls, 'PC-NEW', ['ipconfig']);
    ls = runOn(ls, 'PC-EXISTING', ['ipconfig']);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(true);
  });
});
