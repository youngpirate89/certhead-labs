import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab34TshootStpWrongRoot } from './lab-34-tshoot-stp-wrong-root';

function runOn(ls: LabSession, id: string, lines: readonly string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function showOn(ls: LabSession, id: string, command: string): string {
  const { output } = applyToActive({ ...ls, activeDeviceId: id }, command);
  return output.map((o) => o.text).join('\n');
}

function applySolution(ls: LabSession): LabSession {
  let cur = runOn(ls, 'SW3', ['enable', 'show spanning-tree vlan 40']);
  cur = runOn(cur, 'SW1', [
    'enable',
    'configure terminal',
    'spanning-tree vlan 40 root primary',
    'end',
  ]);
  cur = runOn(cur, 'SW2', [
    'enable',
    'configure terminal',
    'spanning-tree vlan 40 root secondary',
    'end',
  ]);
  cur = runOn(cur, 'SW3', [
    'configure terminal',
    'spanning-tree vlan 40 priority 32768',
    'end',
  ]);
  cur = runOn(cur, 'SW1', ['show spanning-tree vlan 40']);
  return cur;
}

describe('Lab 34 - Troubleshoot STP wrong root', () => {
  it('starts with SW3 incorrectly configured as the VLAN 40 root bridge', () => {
    const ls = initLabSession(lab34TshootStpWrongRoot);
    const sw1 = ls.devices.SW1;
    const sw2 = ls.devices.SW2;
    const sw3 = ls.devices.SW3;
    if (sw1.kind !== 'switch' || sw2.kind !== 'switch' || sw3.kind !== 'switch') throw new Error('shape');

    expect(lab34TshootStpWrongRoot.topology.devices).toHaveLength(3);
    expect(lab34TshootStpWrongRoot.topology.links).toHaveLength(3);
    expect(sw1.device.spanningTree.get(40)).toBeUndefined();
    expect(sw2.device.spanningTree.get(40)).toBeUndefined();
    expect(sw3.device.spanningTree.get(40)).toMatchObject({ rootRole: 'primary', priority: 24576 });
    expect(showOn(ls, 'SW3', 'show spanning-tree vlan 40')).toMatch(/This bridge is the root/);
    expect(grade(lab34TshootStpWrongRoot, ls).allMet).toBe(false);
  });

  it('does not complete if the learner only sets SW1 primary without clearing the wrong-root switch', () => {
    let ls = initLabSession(lab34TshootStpWrongRoot);
    ls = runOn(ls, 'SW3', ['enable', 'show spanning-tree vlan 40']);
    ls = runOn(ls, 'SW1', ['enable', 'configure terminal', 'spanning-tree vlan 40 root primary', 'end']);
    ls = runOn(ls, 'SW1', ['show spanning-tree vlan 40']);

    const g = grade(lab34TshootStpWrongRoot, ls);
    expect(g.allMet).toBe(false);
    expect(g.objectives.find((o) => o.id === 'clear-wrong-root')?.met).toBe(false);
  });

  it('full troubleshooting path diagnoses, repairs, and verifies the intended root design', () => {
    const ls = applySolution(initLabSession(lab34TshootStpWrongRoot));
    const sw1 = ls.devices.SW1;
    const sw2 = ls.devices.SW2;
    const sw3 = ls.devices.SW3;
    if (sw1.kind !== 'switch' || sw2.kind !== 'switch' || sw3.kind !== 'switch') throw new Error('shape');

    expect(sw1.device.spanningTree.get(40)).toMatchObject({ rootRole: 'primary', priority: 24576 });
    expect(sw2.device.spanningTree.get(40)).toMatchObject({ rootRole: 'secondary', priority: 28672 });
    expect(sw3.device.spanningTree.get(40)).toMatchObject({ rootRole: null, priority: 32768 });
    expect(showOn(ls, 'SW1', 'show spanning-tree vlan 40')).toMatch(/This bridge is the root/);

    const g = grade(lab34TshootStpWrongRoot, ls);
    expect(g.allMet).toBe(true);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual([
      ['diagnose-wrong-root', true],
      ['set-intended-root', true],
      ['set-secondary-root', true],
      ['clear-wrong-root', true],
      ['verify-after-repair', true],
    ]);
  });
});
