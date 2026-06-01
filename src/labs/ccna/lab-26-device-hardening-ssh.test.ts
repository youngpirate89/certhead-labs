import { describe, expect, it } from 'vitest';
import { initLabSession, applyToDevice, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab26DeviceHardeningSsh as lab } from './lab-26-device-hardening-ssh';

function run(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

describe('Lab 26 — Device hardening with SSH', () => {
  it('starts incomplete with the management interface seeded but no SSH hardening', () => {
    const ls = initLabSession(lab);
    const r1 = ls.devices.R1;
    if (r1?.kind !== 'router') throw new Error('R1 is not a router');

    expect(r1.device.interfaces['Gi0/0'].ip).toBe('192.168.1.1');
    expect(r1.device.security.users.size).toBe(0);
    expect(r1.device.security.vtyTransportInput).toBe('all');
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('grades complete after configuring SSH hardening, verifying running config, and testing SSH from PC-A', () => {
    let ls = initLabSession(lab);

    ls = run(ls, 'R1', [
      'enable',
      'configure terminal',
      'hostname R1',
      'ip domain-name certhead.local',
      'username admin secret C1sco123',
      'enable secret En4ble123',
      'crypto key generate rsa modulus 1024',
      'line vty 0 4',
      'login local',
      'transport input ssh',
      'end',
      'show running-config',
    ]);
    ls = run(ls, 'PC-A', ['ssh admin@192.168.1.1']);

    expect(grade(lab, ls).allMet).toBe(true);
  });

  it('does not mark SSH verification complete until PC-A tests SSH after router hardening is complete', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'PC-A', ['ssh admin@192.168.1.1']);
    ls = run(ls, 'R1', [
      'enable',
      'configure terminal',
      'ip domain-name certhead.local',
      'username admin secret C1sco123',
      'enable secret En4ble123',
      'crypto key generate rsa modulus 1024',
      'line vty 0 4',
      'login local',
      'transport input ssh',
      'end',
      'show running-config',
    ]);

    const result = grade(lab, ls);
    expect(result.objectives.find((o) => o.id === 'verify-ssh-from-pc')?.met).toBe(false);
    expect(result.allMet).toBe(false);
  });
});
