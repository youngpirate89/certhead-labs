import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab23StpRootBridge as lab } from './lab-23-stp-root-bridge';

function runOn(ls: LabSession, id: string, lines: string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function configureSw1(ls: LabSession): LabSession {
  return runOn(ls, 'SW1', [
    'enable',
    'configure terminal',
    'spanning-tree vlan 10 root primary',
    'end',
  ]);
}

function configureSw2(ls: LabSession): LabSession {
  return runOn(ls, 'SW2', [
    'enable',
    'configure terminal',
    'spanning-tree vlan 10 root secondary',
    'end',
  ]);
}

describe('lab-23-stp-root-bridge — starting state', () => {
  it('topology shape: 2 switches, 2 links, isFree:false', () => {
    expect(lab.topology.devices).toHaveLength(2);
    expect(lab.topology.links).toHaveLength(2);
    expect(lab.isFree).toBe(false);
    expect(lab.topology.devices.map((d) => d.kind)).toEqual(['switch', 'switch']);
  });

  it('setup seeds VLAN 10/trunks without satisfying STP objectives', () => {
    const ls = initLabSession(lab);
    for (const id of ['SW1', 'SW2'] as const) {
      const sw = ls.devices[id];
      if (sw.kind !== 'switch') throw new Error('shape');
      expect(sw.device.vlans.has(10)).toBe(true);
      expect(sw.device.switchports['Fa0/1'].mode).toBe('trunk');
      expect(sw.device.switchports['Fa0/2'].mode).toBe('trunk');
      expect(sw.device.spanningTree.size).toBe(0);
    }
    const g = grade(lab, ls);
    expect(g.allMet).toBe(false);
    for (const o of g.objectives) expect(o.met).toBe(false);
  });
});

describe('lab-23-stp-root-bridge — engine behavior', () => {
  it('root primary and secondary macros set expected per-VLAN priorities', () => {
    let ls = initLabSession(lab);
    ls = configureSw1(ls);
    ls = configureSw2(ls);

    const sw1 = ls.devices.SW1;
    const sw2 = ls.devices.SW2;
    if (sw1.kind !== 'switch' || sw2.kind !== 'switch') throw new Error('shape');
    expect(sw1.device.spanningTree.get(10)).toMatchObject({ priority: 24576, rootRole: 'primary' });
    expect(sw2.device.spanningTree.get(10)).toMatchObject({ priority: 28672, rootRole: 'secondary' });
  });

  it('show spanning-tree vlan 10 stamps verify state only when the learner runs it', () => {
    let ls = initLabSession(lab);
    ls = configureSw1(configureSw2(ls));
    let g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'stp-verified')?.met).toBe(false);

    ls = runOn(ls, 'SW1', ['show spanning-tree vlan 10']);
    const sw1 = ls.devices.SW1;
    if (sw1.kind !== 'switch') throw new Error('shape');
    expect(sw1.lastShowSpanningTreeVlans?.vlanIds).toEqual([10]);
    g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'stp-verified')?.met).toBe(true);
  });

  it('explicit priority form is accepted for primary-root objective', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'SW1', ['enable', 'configure terminal', 'spanning-tree vlan 10 priority 24576', 'end']);
    ls = configureSw2(ls);
    ls = runOn(ls, 'SW2', ['show spanning-tree vlan 10']);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'sw1-root-primary')?.met).toBe(true);
    expect(g.objectives.find((o) => o.id === 'stp-verified')?.met).toBe(true);
  });
});

describe('lab-23-stp-root-bridge — happy path', () => {
  it('full walkthrough completes all objectives', () => {
    let ls = initLabSession(lab);
    ls = configureSw1(ls);
    ls = configureSw2(ls);
    ls = runOn(ls, 'SW1', ['show spanning-tree vlan 10']);

    const g = grade(lab, ls);
    expect(g.allMet).toBe(true);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual([
      ['sw1-root-primary', true],
      ['sw2-root-secondary', true],
      ['stp-verified', true],
    ]);
  });
});
