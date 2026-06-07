import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab36TshootBpduguardErrdisabled } from './lab-36-tshoot-bpduguard-errdisabled';

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
    'show interfaces status',
    'show running-config interface fa0/5',
    'configure terminal',
    'interface fa0/5',
    'shutdown',
    'no spanning-tree bpduguard enable',
    'no shutdown',
    'end',
  ]);
  cur = runOn(cur, 'SW1', ['show interfaces status']);
  return cur;
}

describe('Lab 36 - Troubleshoot BPDU Guard err-disabled access port', () => {
  it('starts with Fa0/5 err-disabled by BPDU Guard while configured as a protected access port', () => {
    const ls = initLabSession(lab36TshootBpduguardErrdisabled);
    const sw1 = ls.devices.SW1;
    if (sw1.kind !== 'switch') throw new Error('shape');

    expect(sw1.device.switchports['Fa0/5']).toMatchObject({
      mode: 'access',
      accessVlan: 60,
      stpPortfast: true,
      bpduGuard: true,
      bpduGuardViolation: true,
      errDisabled: true,
    });
    expect(outputOn(ls, 'SW1', 'show interfaces status')).toMatch(/Fa0\/5\s+err-disabled\s+60/);
    expect(grade(lab36TshootBpduguardErrdisabled, ls).allMet).toBe(false);
  });

  it('shows the PortFast and BPDU Guard configuration that explains the shutdown reason', () => {
    const ls = initLabSession(lab36TshootBpduguardErrdisabled);
    const output = outputOn(ls, 'SW1', 'show running-config interface fa0/5');

    expect(output).toMatch(/switchport mode access/);
    expect(output).toMatch(/switchport access vlan 60/);
    expect(output).toMatch(/spanning-tree portfast/);
    expect(output).toMatch(/spanning-tree bpduguard enable/);
  });

  it('does not auto-recover err-disable just because the BPDU Guard trigger is removed', () => {
    const ls = runOn(initLabSession(lab36TshootBpduguardErrdisabled), 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/5',
      'no spanning-tree bpduguard enable',
      'end',
    ]);
    const sw1 = ls.devices.SW1;
    if (sw1.kind !== 'switch') throw new Error('shape');

    expect(sw1.device.switchports['Fa0/5']).toMatchObject({
      bpduGuard: false,
      bpduGuardViolation: false,
      errDisabled: true,
      adminUp: false,
    });
    expect(outputOn(ls, 'SW1', 'show interfaces status')).toMatch(/Fa0\/5\s+err-disabled\s+60/);
    expect(grade(lab36TshootBpduguardErrdisabled, ls).allMet).toBe(false);
  });

  it('requires diagnosis, disabling the unsafe BPDU Guard condition, shut/no shut recovery, and post-fix verification', () => {
    const ls = applySolution(initLabSession(lab36TshootBpduguardErrdisabled));
    const sw1 = ls.devices.SW1;
    if (sw1.kind !== 'switch') throw new Error('shape');

    expect(sw1.device.switchports['Fa0/5']).toMatchObject({
      mode: 'access',
      accessVlan: 60,
      stpPortfast: true,
      bpduGuard: false,
      bpduGuardViolation: false,
      errDisabled: false,
      adminUp: true,
    });
    expect(outputOn(ls, 'SW1', 'show interfaces status')).toMatch(/Fa0\/5\s+connected\s+60/);

    const g = grade(lab36TshootBpduguardErrdisabled, ls);
    expect(g.allMet).toBe(true);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual([
      ['diagnose-errdisabled-port', true],
      ['inspect-bpduguard-config', true],
      ['clear-bpduguard-trigger', true],
      ['recover-interface', true],
      ['verify-port-restored', true],
    ]);
  });
});
