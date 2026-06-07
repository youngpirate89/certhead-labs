import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { grade } from '@/engine/grading';
import { getLabById } from '@/labs/catalog';
import { tshootVlanTrunkAllowedList as lab } from './tshoot-vlan-trunk-allowed-list';

function runOn(ls: LabSession, id: string, lines: string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function objectiveMet(ls: LabSession, id: string): boolean {
  return grade(lab, ls).objectives.find((o) => o.id === id)?.met ?? false;
}

function outputOf(ls: LabSession, id: string, line: string): string {
  const res = applyToActive({ ...ls, activeDeviceId: id }, line);
  return res.output.map((o) => o.text).join('\n');
}

describe('tshoot-vlan-trunk-allowed-list — starting ticket state', () => {
  it('declares a non-free CCNA ticket lab and resolves from the catalog', () => {
    expect(lab.id).toBe('ccna-tshoot-vlan-trunk-allowed-list');
    expect(lab.title).toMatch(/Sales VLAN/i);
    expect(lab.scenario).toMatch(/ticket/i);
    expect(lab.isFree).toBe(false);
    expect(getLabById('ccna-tshoot-vlan-trunk-allowed-list')).toBe(lab);
  });

  it('has two switches with VLAN 10 and VLAN 30 endpoints on opposite sides of the trunk', () => {
    expect(lab.topology.devices).toHaveLength(6);
    expect(lab.topology.links).toHaveLength(5);
    const kinds = lab.topology.devices.map((d) => d.kind).sort();
    expect(kinds).toEqual(['pc', 'pc', 'pc', 'pc', 'switch', 'switch']);
  });

  it('starts with both trunk ports up as trunks, VLAN 10 allowed, and VLAN 30 missing', () => {
    const ls = initLabSession(lab);
    for (const id of ['SW1', 'SW2'] as const) {
      const sw = ls.devices[id];
      if (sw.kind !== 'switch') throw new Error('shape');
      expect(sw.device.vlans.get(10)?.name).toBe('Ops');
      expect(sw.device.vlans.get(30)?.name).toBe('Sales');
      const trunk = sw.device.switchports['Fa0/24'];
      expect(trunk.mode).toBe('trunk');
      expect(trunk.trunkAllowedVlans).toEqual([10]);
    }
  });

  it('produces a partial outage: VLAN 30 Sales fails but existing VLAN 10 still crosses the trunk', () => {
    const ls = initLabSession(lab);
    const sales = canReach(ls, 'PC-SALES', '192.168.30.50');
    expect(sales.ok).toBe(false);
    if (!sales.ok) {
      expect(sales.failedAt.reason).toBe('vlan-not-allowed');
      expect(sales.failedAt.vlanAllow).toEqual({ vlanId: 30 });
    }
    expect(canReach(ls, 'PC-OPS', '192.168.10.50').ok).toBe(true);
  });

  it('all three objectives are unmet at the start', () => {
    const g = grade(lab, initLabSession(lab));
    expect(g.allMet).toBe(false);
    expect(g.objectives).toHaveLength(3);
    for (const o of g.objectives) expect(o.met).toBe(false);
  });
});

describe('tshoot-vlan-trunk-allowed-list — repair path', () => {
  it('show interfaces trunk captures the missing VLAN before the fix but does not complete verification', () => {
    let ls = initLabSession(lab);
    const show = outputOf(ls, 'SW1', 'show interfaces trunk');
    expect(show).toContain('Fa0/24');
    expect(show).toContain('10');
    expect(objectiveMet(ls, 'verify-trunk-after-fix')).toBe(false);
    ls = runOn(ls, 'SW1', ['enable', 'show interfaces trunk']);
    expect(objectiveMet(ls, 'verify-trunk-after-fix')).toBe(false);
  });

  it('adding VLAN 30 to only one trunk side is not enough for reachability', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface Fa0/24',
      'switchport trunk allowed vlan add 30',
      'end',
    ]);
    expect(objectiveMet(ls, 'restore-sales-vlan-on-trunk')).toBe(false);
    const r = canReach(ls, 'PC-SALES', '192.168.30.50');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failedAt.reason).toBe('vlan-not-allowed');
  });

  it('after both sides allow VLAN 30, reachability is available but ping verification is still required', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', ['enable', 'configure terminal', 'interface Fa0/24', 'switchport trunk allowed vlan add 30', 'end']);
    ls = runOn(ls, 'SW2', ['enable', 'configure terminal', 'interface Fa0/24', 'switchport trunk allowed vlan add 30', 'end']);
    expect(objectiveMet(ls, 'restore-sales-vlan-on-trunk')).toBe(true);
    expect(canReach(ls, 'PC-SALES', '192.168.30.50').ok).toBe(true);
    expect(objectiveMet(ls, 'verify-sales-reachability')).toBe(false);
  });

  it('requires show interfaces trunk after the fix and a successful PC-SALES ping for all objectives', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'show interfaces trunk',
      'configure terminal',
      'interface Fa0/24',
      'switchport trunk allowed vlan add 30',
      'end',
    ]);
    ls = runOn(ls, 'SW2', ['enable', 'configure terminal', 'interface Fa0/24', 'switchport trunk allowed vlan add 30', 'end']);
    expect(objectiveMet(ls, 'verify-trunk-after-fix')).toBe(false);

    ls = runOn(ls, 'SW1', ['show interfaces trunk']);
    expect(objectiveMet(ls, 'verify-trunk-after-fix')).toBe(true);

    ls = runOn(ls, 'PC-SALES', ['ping 192.168.30.50']);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(true);
  });
});
