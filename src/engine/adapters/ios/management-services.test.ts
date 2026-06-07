import { describe, expect, it } from 'vitest';
import { initLabSession, applyToDevice, type LabSession } from '@/engine/lab-session';
import type { Lab } from '@/engine/types';

const lab: Lab = {
  id: 'management-services-engine-fixture',
  title: 'Management Services Engine Fixture',
  exam: 'TEST',
  difficulty: 1,
  estimatedMinutes: 1,
  isFree: false,
  scenario: 'fixture',
  topology: {
    devices: [
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0'] },
      {
        id: 'MGMT-SRV',
        kind: 'pc',
        deviceClass: 'server',
        platform: 'Management Server',
        interfaces: ['Eth0'],
        pc: { ip: '172.20.27.50', mask: '255.255.255.0', gateway: '172.20.27.1' },
      },
    ],
    links: [{ a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'MGMT-SRV', iface: 'Eth0' } }],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 172.20.27.1 255.255.255.0',
      'no shutdown',
      'end',
    ],
  },
  objectives: [],
  hints: [],
};

function run(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

describe('IOS management services command surface', () => {
  it('stores NTP and Syslog settings from realistic IOS commands', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'R1', [
      'enable',
      'configure terminal',
      'ntp server 172.20.27.50',
      'service timestamps log datetime msec',
      'logging host 172.20.27.50',
      'logging trap informational',
      'end',
    ]);

    const r1 = ls.devices.R1;
    if (r1?.kind !== 'router') throw new Error('R1 is not a router');
    expect(r1.device.ntp.servers.get('172.20.27.50')?.server).toBe('172.20.27.50');
    expect(r1.device.syslog.hosts.get('172.20.27.50')?.host).toBe('172.20.27.50');
    expect(r1.device.syslog.trapLevel).toBe('informational');
    expect(r1.device.syslog.serviceTimestampsLogDatetimeMsec).toBe(true);
  });

  it('renders NTP and Syslog verification output after configuration', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'R1', [
      'enable',
      'configure terminal',
      'ntp server 172.20.27.50',
      'service timestamps log datetime msec',
      'logging host 172.20.27.50',
      'logging trap informational',
      'end',
    ]);

    const ntpStatus = applyToDevice(ls, 'R1', 'show ntp status');
    expect(ntpStatus.output.map((o) => o.text).join('\n')).toMatch(/Clock is synchronized, stratum 2, reference is 172\.20\.27\.50/);
    expect(ntpStatus.session.devices.R1?.kind === 'router' && ntpStatus.session.devices.R1.lastShowNtpStatus).not.toBe(0);

    const ntpAssoc = applyToDevice(ntpStatus.session, 'R1', 'show ntp associations');
    expect(ntpAssoc.output.map((o) => o.text).join('\n')).toMatch(/\*~172\.20\.27\.50/);
    expect(ntpAssoc.session.devices.R1?.kind === 'router' && ntpAssoc.session.devices.R1.lastShowNtpAssociations).not.toBe(0);

    const logging = applyToDevice(ntpAssoc.session, 'R1', 'show logging');
    const text = logging.output.map((o) => o.text).join('\n');
    expect(text).toMatch(/Syslog logging: enabled/);
    expect(text).toMatch(/Trap logging: level informational/);
    expect(text).toMatch(/Logging to 172\.20\.27\.50/);
    expect(logging.session.devices.R1?.kind === 'router' && logging.session.devices.R1.lastShowLogging).not.toBe(0);
  });

  it('renders management service lines in show running-config', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'R1', [
      'enable',
      'configure terminal',
      'ntp server 172.20.27.50',
      'service timestamps log datetime msec',
      'logging host 172.20.27.50',
      'logging trap informational',
      'end',
    ]);

    const result = applyToDevice(ls, 'R1', 'show running-config');
    const text = result.output.map((o) => o.text).join('\n');
    expect(text).toMatch(/service timestamps log datetime msec/);
    expect(text).toMatch(/logging host 172\.20\.27\.50/);
    expect(text).toMatch(/logging trap informational/);
    expect(text).toMatch(/ntp server 172\.20\.27\.50/);
  });
});
