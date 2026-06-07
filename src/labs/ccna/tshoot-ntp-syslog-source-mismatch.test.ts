import { describe, expect, it } from 'vitest';
import { initLabSession, applyToDevice, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { tshootNtpSyslogSourceMismatch as lab } from './tshoot-ntp-syslog-source-mismatch';

function run(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

describe('Ticket 14 — NTP and Syslog server mismatch', () => {
  it('starts with BRANCH pointed at the retired monitoring server and all objectives incomplete', () => {
    const ls = initLabSession(lab);
    const branch = ls.devices.BRANCH;
    if (branch?.kind !== 'router') throw new Error('BRANCH is not a router');

    expect(branch.device.ntp.servers.has('10.190.0.10')).toBe(true);
    expect(branch.device.syslog.hosts.has('10.190.0.10')).toBe(true);
    expect(branch.device.ntp.servers.has('10.190.0.50')).toBe(false);
    expect(branch.device.syslog.hosts.has('10.190.0.50')).toBe(false);
    const result = grade(lab, ls);
    expect(result.objectives).toHaveLength(5);
    expect(result.objectives.every((objective) => objective.met === false)).toBe(true);
    expect(result.allMet).toBe(false);
  });

  it('requires inspecting the existing management-service configuration before fixing it', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'BRANCH', [
      'enable',
      'configure terminal',
      'no ntp server 10.190.0.10',
      'ntp server 10.190.0.50',
      'no logging host 10.190.0.10',
      'logging host 10.190.0.50',
      'end',
      'show running-config | include ntp|logging',
      'show ntp status',
      'show logging',
    ]);

    const result = grade(lab, ls);
    expect(result.objectives.find((objective) => objective.id === 'inspect-current-services')?.met).toBe(false);
    expect(result.allMet).toBe(false);
  });

  it('grades complete after removing old targets, adding the migrated server, and verifying status', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'BRANCH', [
      'enable',
      'show running-config | include ntp|logging',
      'show ntp status',
      'show logging',
      'configure terminal',
      'no ntp server 10.190.0.10',
      'ntp server 10.190.0.50',
      'no logging host 10.190.0.10',
      'logging host 10.190.0.50',
      'end',
      'show running-config | include ntp|logging',
      'show ntp status',
      'show logging',
    ]);

    const branch = ls.devices.BRANCH;
    if (branch?.kind !== 'router') throw new Error('BRANCH is not a router');
    expect(branch.device.ntp.servers.has('10.190.0.10')).toBe(false);
    expect(branch.device.syslog.hosts.has('10.190.0.10')).toBe(false);
    expect(branch.device.ntp.servers.has('10.190.0.50')).toBe(true);
    expect(branch.device.syslog.hosts.has('10.190.0.50')).toBe(true);
    expect(grade(lab, ls).allMet).toBe(true);
  });

  it('does not allow simply adding the new monitoring server while leaving the retired server configured', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'BRANCH', [
      'enable',
      'show running-config | include ntp|logging',
      'configure terminal',
      'ntp server 10.190.0.50',
      'logging host 10.190.0.50',
      'end',
      'show running-config | include ntp|logging',
      'show ntp status',
      'show logging',
    ]);

    const result = grade(lab, ls);
    expect(result.objectives.find((objective) => objective.id === 'remove-retired-targets')?.met).toBe(false);
    expect(result.allMet).toBe(false);
  });
});
