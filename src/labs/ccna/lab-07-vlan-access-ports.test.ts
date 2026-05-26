import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { grade } from '@/engine/grading';
import { lab07VlanAccessPorts as lab } from './lab-07-vlan-access-ports';

function runOn(ls: LabSession, id: string, lines: string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

describe('lab-07-vlan-access-ports — starting state', () => {
  it('topology shape: 3 devices (2 PCs, 1 switch), 2 links, isFree:false', () => {
    expect(lab.topology.devices).toHaveLength(3);
    expect(lab.topology.links).toHaveLength(2);
    expect(lab.isFree).toBe(false);
    const kinds = lab.topology.devices.map((d) => d.kind).sort();
    expect(kinds).toEqual(['pc', 'pc', 'switch']);
  });

  it('SW1 starts with only VLAN 1 in the database; ports default to VLAN 1', () => {
    const ls = initLabSession(lab);
    const sw1 = ls.devices.SW1;
    if (sw1.kind !== 'switch') throw new Error('shape');
    expect(sw1.device.vlans.size).toBe(1);
    expect(sw1.device.vlans.get(1)?.name).toBe('default');
    expect(sw1.device.switchports['Fa0/1'].accessVlan).toBe(1);
    expect(sw1.device.switchports['Fa0/2'].accessVlan).toBe(1);
  });

  it('PC-A CAN reach PC-B at lab start (baseline — same subnet, same VLAN 1)', () => {
    const ls = initLabSession(lab);
    expect(canReach(ls, 'PC-A', '192.168.1.20').ok).toBe(true);
  });

  it('all three objectives are unmet at start', () => {
    const ls = initLabSession(lab);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(false);
    for (const o of g.objectives) expect(o.met).toBe(false);
  });
});

describe('lab-07-vlan-access-ports — happy path', () => {
  it('creating VLAN 10 (Sales) + VLAN 20 (Engineering) ticks vlans-created', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'vlan 20',
      'name Engineering',
      'end',
    ]);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'vlans-created')?.met).toBe(true);
  });

  it('assigning Fa0/1 → 10 and Fa0/2 → 20 ticks ports-assigned', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'vlan 20',
      'name Engineering',
      'exit',
      'interface fa0/1',
      'switchport mode access',
      'switchport access vlan 10',
      'exit',
      'interface fa0/2',
      'switchport mode access',
      'switchport access vlan 20',
      'end',
    ]);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'ports-assigned')?.met).toBe(true);
  });

  it('once assigned, PC-A → PC-B fails with vlan-mismatch carrying both VLAN ids', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'vlan 20',
      'name Engineering',
      'exit',
      'interface fa0/1',
      'switchport access vlan 10',
      'exit',
      'interface fa0/2',
      'switchport access vlan 20',
      'end',
    ]);
    const result = canReach(ls, 'PC-A', '192.168.1.20');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failedAt.reason).toBe('vlan-mismatch');
    expect(result.failedAt.vlan).toEqual({
      aId: 'PC-A',
      aVlan: 10,
      bId: 'PC-B',
      bVlan: 20,
    });
  });

  it('segmentation-verified needs BOTH a failed ping AND `show vlan brief` on SW1', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'vlan 20',
      'name Engineering',
      'exit',
      'interface fa0/1',
      'switchport access vlan 10',
      'exit',
      'interface fa0/2',
      'switchport access vlan 20',
      'end',
    ]);
    // Ping fails — but show vlan brief not run yet.
    ls = runOn(ls, 'PC-A', ['ping 192.168.1.20']);
    let g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'segmentation-verified')?.met).toBe(false);

    // Now run the show — must tick.
    ls = runOn(ls, 'SW1', ['show vlan brief']);
    g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'segmentation-verified')?.met).toBe(true);
  });

  it('full walkthrough: all three objectives met, allMet true', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'vlan 20',
      'name Engineering',
      'exit',
      'interface fa0/1',
      'switchport mode access',
      'switchport access vlan 10',
      'exit',
      'interface fa0/2',
      'switchport mode access',
      'switchport access vlan 20',
      'end',
      'show vlan brief',
    ]);
    ls = runOn(ls, 'PC-A', ['ping 192.168.1.20']);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(true);
  });
});

describe('lab-07-vlan-access-ports — partial-credit guards', () => {
  it('VLAN created but name wrong → vlans-created unmet', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'vlan 10',
      'name SalesTeam', // wrong name
      'exit',
      'vlan 20',
      'name Engineering',
      'end',
    ]);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'vlans-created')?.met).toBe(false);
  });

  it('only one VLAN assigned, the other still on VLAN 1 → ports-assigned unmet but ping STILL fails', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/1',
      'switchport access vlan 10',
      'end',
    ]);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'ports-assigned')?.met).toBe(false);
    // Different VLANs (10 vs 1) still segments them — vlan-mismatch fires.
    const r = canReach(ls, 'PC-A', '192.168.1.20');
    expect(r.ok).toBe(false);
  });

  it('ports assigned to the SAME VLAN → ping STILL succeeds → segmentation-verified unmet', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'interface fa0/1',
      'switchport access vlan 10',
      'exit',
      'interface fa0/2',
      'switchport access vlan 10', // both ports in VLAN 10 → still reachable
      'end',
      'show vlan brief',
    ]);
    ls = runOn(ls, 'PC-A', ['ping 192.168.1.20']);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'segmentation-verified')?.met).toBe(false);
  });

  it('configured correctly but learner never pinged → segmentation-verified unmet', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'vlan 20',
      'name Engineering',
      'exit',
      'interface fa0/1',
      'switchport access vlan 10',
      'exit',
      'interface fa0/2',
      'switchport access vlan 20',
      'end',
      'show vlan brief',
    ]);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'segmentation-verified')?.met).toBe(false);
  });
});
