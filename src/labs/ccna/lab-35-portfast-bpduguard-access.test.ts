import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab35PortfastBpduguardAccess } from './lab-35-portfast-bpduguard-access';

function runOn(ls: LabSession, id: string, lines: readonly string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function outputOn(ls: LabSession, id: string, command: string): string {
  const { output } = applyToActive({ ...ls, activeDeviceId: id }, command);
  return output.map((o) => o.text).join('\n');
}

function applySolution(ls: LabSession): LabSession {
  let cur = runOn(ls, 'SW1', [
    'enable',
    'configure terminal',
    'interface fa0/3',
    'switchport mode access',
    'switchport access vlan 50',
    'spanning-tree portfast',
    'spanning-tree bpduguard enable',
    'interface fa0/4',
    'switchport mode access',
    'switchport access vlan 50',
    'spanning-tree portfast',
    'spanning-tree bpduguard enable',
    'end',
  ]);
  cur = runOn(cur, 'SW1', [
    'show running-config interface fa0/3',
    'show running-config interface fa0/4',
  ]);
  return cur;
}

describe('Lab 35 - PortFast and BPDU Guard on access ports', () => {
  it('starts with VLAN 50 access ports but no PortFast or BPDU Guard', () => {
    const ls = initLabSession(lab35PortfastBpduguardAccess);
    const sw1 = ls.devices.SW1;
    if (sw1.kind !== 'switch') throw new Error('shape');

    expect(sw1.device.switchports['Fa0/3']).toMatchObject({
      mode: 'access',
      accessVlan: 50,
      stpPortfast: false,
      bpduGuard: false,
    });
    expect(sw1.device.switchports['Fa0/4']).toMatchObject({
      mode: 'access',
      accessVlan: 50,
      stpPortfast: false,
      bpduGuard: false,
    });
    expect(grade(lab35PortfastBpduguardAccess, ls).allMet).toBe(false);
  });

  it('accepts interface-level spanning-tree portfast and bpduguard enable commands', () => {
    const ls = applySolution(initLabSession(lab35PortfastBpduguardAccess));
    const sw1 = ls.devices.SW1;
    if (sw1.kind !== 'switch') throw new Error('shape');

    expect(sw1.device.switchports['Fa0/3']).toMatchObject({ stpPortfast: true, bpduGuard: true });
    expect(sw1.device.switchports['Fa0/4']).toMatchObject({ stpPortfast: true, bpduGuard: true });
  });

  it('renders PortFast and BPDU Guard in per-interface running config and completes objectives', () => {
    const ls = applySolution(initLabSession(lab35PortfastBpduguardAccess));
    const fa03 = outputOn(ls, 'SW1', 'show running-config interface fa0/3');
    const fa04 = outputOn(ls, 'SW1', 'show running-config interface fa0/4');

    expect(fa03).toMatch(/spanning-tree portfast/);
    expect(fa03).toMatch(/spanning-tree bpduguard enable/);
    expect(fa04).toMatch(/spanning-tree portfast/);
    expect(fa04).toMatch(/spanning-tree bpduguard enable/);

    const g = grade(lab35PortfastBpduguardAccess, ls);
    expect(g.allMet).toBe(true);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual([
      ['configure-user-port', true],
      ['configure-printer-port', true],
      ['verify-portfast-bpduguard', true],
    ]);
  });
});
