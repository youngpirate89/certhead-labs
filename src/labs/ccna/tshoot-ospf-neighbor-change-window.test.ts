import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { getLabById } from '@/labs/catalog';
import { tshootOspfNeighborChangeWindow as lab } from './tshoot-ospf-neighbor-change-window';

function runOn(ls: LabSession, id: string, lines: readonly string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function outputOf(ls: LabSession, id: string, line: string): string {
  const res = applyToActive({ ...ls, activeDeviceId: id }, line);
  return res.output.map((o) => o.text).join('\n');
}

function objectiveStates(ls: LabSession): boolean[] {
  return grade(lab, ls).objectives.map((o) => o.met);
}

function applyFix(ls: LabSession): LabSession {
  return runOn(ls, 'HQ', [
    'enable',
    'configure terminal',
    'router ospf 1',
    'no passive-interface GigabitEthernet0/2',
    'passive-interface GigabitEthernet0/0',
    'end',
  ]);
}

describe('tshoot-ospf-neighbor-change-window — ticket metadata and start state', () => {
  it('declares a cataloged non-free CCNA ticket lab', () => {
    expect(lab.id).toBe('ccna-tshoot-ospf-neighbor-change-window');
    expect(lab.title).toMatch(/OSPF Neighbor Down After Change Window/i);
    expect(lab.scenario).toMatch(/change window/i);
    expect(lab.isFree).toBe(false);
    expect(getLabById('ccna-tshoot-ospf-neighbor-change-window')).toBe(lab);
  });

  it('starts with the HQ WAN interface accidentally passive and no FULL neighbor', () => {
    const ls = initLabSession(lab);
    const hq = ls.devices.HQ;
    const branch = ls.devices.BRANCH;
    if (hq.kind !== 'router' || branch.kind !== 'router') throw new Error('router shape');

    expect(hq.device.ospf.passive.has('Gi0/2')).toBe(true);
    expect(hq.device.ospf.passive.has('Gi0/0')).toBe(false);
    expect(hq.device.ospf.neighbors.size).toBe(0);
    expect(branch.device.ospf.neighbors.size).toBe(0);
    expect(objectiveStates(ls)).toEqual([false, false, false, false]);
  });

  it('starting users cannot reach the remote branch LAN', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'PC-HQ', ['ping 10.80.20.10']);
    const pc = ls.devices['PC-HQ'];
    if (pc.kind !== 'pc') throw new Error('pc shape');
    expect(pc.lastPing).toEqual({ target: '10.80.20.10', ok: false });
    expect(objectiveStates(ls).at(-1)).toBe(false);
  });
});

describe('tshoot-ospf-neighbor-change-window — diagnosis and repair', () => {
  it('show ip ospf reveals Gi0/2 as passive on HQ', () => {
    const output = outputOf(initLabSession(lab), 'HQ', 'show ip ospf');
    expect(output).toMatch(/Passive Interface/);
    expect(output).toMatch(/Gi0\/2|GigabitEthernet0\/2/);
  });

  it('diagnosis requires show ip ospf on HQ, not only the neighbor symptom', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'HQ', ['enable', 'show ip ospf neighbor']);
    expect(objectiveStates(ls)[0]).toBe(false);

    ls = runOn(ls, 'HQ', ['show ip ospf']);
    expect(objectiveStates(ls)[0]).toBe(true);
  });

  it('removing passive from the WAN and moving it to the LAN restores the FULL neighbor and route', () => {
    const ls = applyFix(initLabSession(lab));
    const hq = ls.devices.HQ;
    if (hq.kind !== 'router') throw new Error('router shape');

    expect(hq.device.ospf.passive.has('Gi0/2')).toBe(false);
    expect(hq.device.ospf.passive.has('Gi0/0')).toBe(true);
    expect(Array.from(hq.device.ospf.neighbors.values()).some((n) => n.state === 'FULL')).toBe(true);
    expect(hq.ospfRoutes).toEqual([
      expect.objectContaining({
        prefix: '10.80.20.0',
        mask: '255.255.255.0',
        nextHop: '10.80.0.2',
        egressIface: 'Gi0/2',
        source: 'ospf',
      }),
    ]);
  });

  it('published solution exits config mode before post-fix show commands', () => {
    const fixStep = lab.solution?.steps.find((step) => step.commands.includes('no passive-interface GigabitEthernet0/2'));
    expect(fixStep?.commands.at(-1)).toBe('end');
  });

  it('published solution satisfies every objective and restores reachability', () => {
    let ls = initLabSession(lab);
    for (const step of lab.solution!.steps) ls = runOn(ls, step.device, step.commands);

    const pc = ls.devices['PC-HQ'];
    if (pc.kind !== 'pc') throw new Error('pc shape');
    expect(pc.lastPing).toEqual({ target: '10.80.20.10', ok: true });

    const g = grade(lab, ls);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual(g.objectives.map((o) => [o.id, true]));
    expect(g.allMet).toBe(true);
  });
});
