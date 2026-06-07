import { describe, expect, it } from 'vitest';
import { initLabSession, applyToDevice, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab27NtpSyslogBasics as lab } from './lab-27-ntp-syslog-basics';

function run(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

describe('Lab 27 — NTP and Syslog basics', () => {
  it('keeps all topology devices inside the default rendered canvas comfort zone', () => {
    for (const device of lab.topology.devices) {
      expect(device.position?.y, `${device.id} should not render clipped above the topology canvas`).toBeGreaterThanOrEqual(0);
    }
  });

  it('starts incomplete with management connectivity seeded but no NTP or Syslog services', () => {
    const ls = initLabSession(lab);
    const r1 = ls.devices.R1;
    if (r1?.kind !== 'router') throw new Error('R1 is not a router');

    expect(r1.device.interfaces['Gi0/0'].ip).toBe('172.20.27.1');
    expect(r1.device.ntp.servers.size).toBe(0);
    expect(r1.device.syslog.hosts.size).toBe(0);
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('grades complete after configuring NTP, Syslog, timestamps, and running verification commands', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'R1', [
      'enable',
      'configure terminal',
      'ntp server 172.20.27.50',
      'service timestamps log datetime msec',
      'logging host 172.20.27.50',
      'logging trap informational',
      'end',
      'show ntp status',
      'show ntp associations',
      'show logging',
    ]);

    expect(grade(lab, ls).allMet).toBe(true);
  });

  it('does not satisfy verification objectives from show commands run before services are configured', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'R1', ['enable', 'show ntp status', 'show ntp associations', 'show logging']);
    ls = run(ls, 'R1', [
      'configure terminal',
      'ntp server 172.20.27.50',
      'service timestamps log datetime msec',
      'logging host 172.20.27.50',
      'logging trap informational',
      'end',
    ]);

    const result = grade(lab, ls);
    expect(result.objectives.find((o) => o.id === 'verify-ntp-status')?.met).toBe(false);
    expect(result.objectives.find((o) => o.id === 'verify-ntp-associations')?.met).toBe(false);
    expect(result.objectives.find((o) => o.id === 'verify-syslog')?.met).toBe(false);
    expect(result.allMet).toBe(false);
  });
});
