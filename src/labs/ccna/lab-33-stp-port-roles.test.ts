import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab33StpPortRoles } from './lab-33-stp-port-roles';

function runOn(ls: LabSession, id: string, lines: readonly string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function showOn(ls: LabSession, id: string, command: string): string {
  const { output } = applyToActive({ ...ls, activeDeviceId: id }, command);
  return output.map((o) => o.text).join('\n');
}

describe('Lab 33 - STP port roles', () => {
  it('uses a 3-switch triangle carrying VLAN 20', () => {
    expect(lab33StpPortRoles.topology.devices).toHaveLength(3);
    expect(lab33StpPortRoles.topology.links).toHaveLength(3);
    expect(lab33StpPortRoles.topology.devices.map((d) => d.id)).toEqual(['SW1', 'SW2', 'SW3']);
  });

  it('starting state renders deterministic root/designated/alternate roles', () => {
    const ls = initLabSession(lab33StpPortRoles);
    const sw1 = showOn(ls, 'SW1', 'show spanning-tree vlan 20');
    const sw2 = showOn(ls, 'SW2', 'show spanning-tree vlan 20');
    const sw3 = showOn(ls, 'SW3', 'show spanning-tree vlan 20');

    expect(sw1).toMatch(/This bridge is the root/);
    expect(sw1).toMatch(/Fa0\/1\s+Desg FWD/);
    expect(sw1).toMatch(/Fa0\/2\s+Desg FWD/);
    expect(sw2).toMatch(/Fa0\/1\s+Root FWD/);
    expect(sw2).toMatch(/Fa0\/2\s+Desg FWD/);
    expect(sw3).toMatch(/Fa0\/1\s+Root FWD/);
    expect(sw3).toMatch(/Fa0\/2\s+Altn BLK/);
  });

  it('requires learners to inspect all three switches before completion', () => {
    let ls = initLabSession(lab33StpPortRoles);
    expect(grade(lab33StpPortRoles, ls).allMet).toBe(false);

    ls = runOn(ls, 'SW1', ['enable', 'show spanning-tree vlan 20']);
    ls = runOn(ls, 'SW2', ['enable', 'show spanning-tree vlan 20']);
    expect(grade(lab33StpPortRoles, ls).allMet).toBe(false);

    ls = runOn(ls, 'SW3', ['enable', 'show spanning-tree vlan 20']);
    const g = grade(lab33StpPortRoles, ls);
    expect(g.allMet).toBe(true);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual([
      ['inspect-root-bridge', true],
      ['inspect-non-root-roles', true],
      ['identify-blocked-link', true],
    ]);
  });
});
