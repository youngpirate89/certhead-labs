import type { Lab } from '@/engine/types';

/**
 * Lab 27 — NTP and Syslog basics.
 *
 * Scope: CCNA infrastructure-services configuration and verification only.
 * This models NTP client/server association intent and remote syslog settings;
 * it does not simulate actual clock drift, log transport, or an interactive
 * syslog server console.
 */
export const lab27NtpSyslogBasics: Lab = {
  id: 'ccna-lab27-ntp-syslog-basics',
  title: 'NTP and Syslog: Centralized Time and Logging',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    'The branch router has basic management connectivity to a centralized services host, but time synchronization and remote logging have not been configured. Configure R1 to use the management server for NTP and Syslog so future troubleshooting records have useful timestamps and are collected centrally.\n\nAfter applying the configuration, verify NTP status, NTP associations, and logging configuration from R1.',
  topology: {
    devices: [
      {
        id: 'Admin-PC',
        kind: 'pc',
        platform: 'Windows Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '172.20.27.10', mask: '255.255.255.0', gateway: '172.20.27.1' },
        position: { x: 0, y: 20 },
      },
      {
        id: 'SW1',
        kind: 'switch',
        platform: 'Catalyst 2960',
        interfaces: ['Fa0/1', 'Fa0/2', 'Fa0/3'],
        position: { x: 300, y: 20 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0'],
        position: { x: 650, y: -130 },
      },
      {
        id: 'MGMT-SRV',
        kind: 'pc',
        deviceClass: 'server',
        platform: 'Management Server',
        interfaces: ['Eth0'],
        pc: { ip: '172.20.27.50', mask: '255.255.255.0', gateway: '172.20.27.1' },
        position: { x: 650, y: 170 },
      },
    ],
    links: [
      { a: { deviceId: 'Admin-PC', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/1' } },
      { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'SW1', iface: 'Fa0/2' } },
      { a: { deviceId: 'MGMT-SRV', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/3' } },
    ],
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
  objectives: [
    {
      id: 'configure-ntp-server',
      text: 'R1: configure 172.20.27.50 as the NTP server',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return r1?.kind === 'router' && r1.device.ntp.servers.has('172.20.27.50');
      },
    },
    {
      id: 'enable-log-timestamps',
      text: 'R1: enable log timestamps with service timestamps log datetime msec',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return r1?.kind === 'router' && r1.device.syslog.serviceTimestampsLogDatetimeMsec;
      },
    },
    {
      id: 'configure-syslog-host',
      text: 'R1: configure 172.20.27.50 as the remote syslog host',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return r1?.kind === 'router' && r1.device.syslog.hosts.has('172.20.27.50');
      },
    },
    {
      id: 'configure-syslog-trap',
      text: 'R1: set logging trap informational',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return r1?.kind === 'router' && r1.device.syslog.trapLevel === 'informational';
      },
    },
    {
      id: 'verify-ntp-status',
      text: 'R1: run show ntp status after configuring the NTP server',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const server = r1.device.ntp.servers.get('172.20.27.50');
        return Boolean(server && r1.lastShowNtpStatus > server.configuredAt);
      },
    },
    {
      id: 'verify-ntp-associations',
      text: 'R1: run show ntp associations after configuring the NTP server',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const server = r1.device.ntp.servers.get('172.20.27.50');
        return Boolean(server && r1.lastShowNtpAssociations > server.configuredAt);
      },
    },
    {
      id: 'verify-syslog',
      text: 'R1: run show logging after configuring remote syslog',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const host = r1.device.syslog.hosts.get('172.20.27.50');
        return Boolean(host && r1.lastShowLogging > host.configuredAt);
      },
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      text: 'Use the management server address 172.20.27.50 for both NTP and Syslog. NTP and logging are global configuration commands on R1.',
    },
    {
      afterSeconds: 240,
      text: 'Useful commands: `ntp server 172.20.27.50`, `service timestamps log datetime msec`, `logging host 172.20.27.50`, `logging trap informational`, then verify with `show ntp status`, `show ntp associations`, and `show logging`.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Configure NTP, timestamped logs, and remote Syslog forwarding:',
        commands: [
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
        ],
      },
    ],
  },
};
