import type { Lab } from '@/engine/types';

const OLD_MONITOR = '10.190.0.10';
const NEW_MONITOR = '10.190.0.50';

/**
 * Ticket 14 — NTP and Syslog server mismatch.
 *
 * CCNA scope: IP services operational validation for NTP and Syslog. This lab
 * intentionally models configuration intent and IOS-style verification output;
 * it does not simulate real clock discipline, NTP packets, or log transport.
 */
export const tshootNtpSyslogSourceMismatch: Lab = {
  id: 'ccna-tshoot-ntp-syslog-source-mismatch',
  title: 'Troubleshoot: NTP and Syslog Server Mismatch',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    'Trouble ticket: after a branch monitoring migration, operations reports that BRANCH is missing centralized logs and has unreliable time correlation. IP reachability to the new monitoring server exists, but the router was left pointing its NTP and Syslog clients at the retired monitoring server address.\n\nInspect the current service configuration, remove the retired server references, point both NTP and remote Syslog at the new monitoring server, then verify the final configuration and service status from BRANCH.',
  topology: {
    devices: [
      {
        id: 'BRANCH',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0'],
        position: { x: 300, y: 20 },
      },
      {
        id: 'MON-OLD',
        kind: 'pc',
        deviceClass: 'server',
        platform: 'Retired Monitoring Server',
        interfaces: ['Eth0'],
        pc: { ip: OLD_MONITOR, mask: '255.255.255.0', gateway: '10.190.0.1' },
        position: { x: 0, y: 160 },
      },
      {
        id: 'MONITOR-SRV',
        kind: 'pc',
        deviceClass: 'server',
        platform: 'Monitoring Server',
        interfaces: ['Eth0'],
        pc: { ip: NEW_MONITOR, mask: '255.255.255.0', gateway: '10.190.0.1' },
        position: { x: 600, y: 160 },
      },
    ],
    links: [
      { a: { deviceId: 'BRANCH', iface: 'Gi0/0' }, b: { deviceId: 'MON-OLD', iface: 'Eth0' } },
      { a: { deviceId: 'BRANCH', iface: 'Gi0/0' }, b: { deviceId: 'MONITOR-SRV', iface: 'Eth0' } },
    ],
  },
  setup: {
    BRANCH: [
      'enable',
      'configure terminal',
      'hostname BRANCH',
      'interface gi0/0',
      'ip address 10.190.0.1 255.255.255.0',
      'no shutdown',
      'exit',
      `ntp server ${OLD_MONITOR}`,
      `logging host ${OLD_MONITOR}`,
      'logging trap informational',
      'service timestamps log datetime msec',
      'end',
    ],
  },
  objectives: [
    {
      id: 'inspect-current-services',
      text: 'BRANCH: inspect current NTP and Syslog targets with show running-config | include ntp|logging',
      check: (_state, _history, session) => {
        const branch = session.devices.BRANCH;
        if (branch?.kind !== 'router' || branch.lastShowRunningConfig === 0) return false;
        const firstInspect = branch.resolvedHistory.indexOf('show running-config | include ntp|logging');
        const firstFix = branch.resolvedHistory.findIndex(
          (cmd) => cmd === `no ntp server ${OLD_MONITOR}` || cmd === `no logging host ${OLD_MONITOR}`,
        );
        return firstInspect !== -1 && (firstFix === -1 || firstInspect < firstFix);
      },
    },
    {
      id: 'remove-retired-targets',
      text: `BRANCH: remove retired NTP and Syslog targets for ${OLD_MONITOR}`,
      check: (_state, _history, session) => {
        const branch = session.devices.BRANCH;
        return branch?.kind === 'router' && !branch.device.ntp.servers.has(OLD_MONITOR) && !branch.device.syslog.hosts.has(OLD_MONITOR);
      },
    },
    {
      id: 'configure-new-monitoring-targets',
      text: `BRANCH: configure ${NEW_MONITOR} as both the NTP server and remote Syslog host`,
      check: (_state, _history, session) => {
        const branch = session.devices.BRANCH;
        return branch?.kind === 'router' && branch.device.ntp.servers.has(NEW_MONITOR) && branch.device.syslog.hosts.has(NEW_MONITOR);
      },
    },
    {
      id: 'verify-final-running-config',
      text: 'BRANCH: verify only the new monitoring targets remain in show running-config | include ntp|logging',
      check: (_state, _history, session) => {
        const branch = session.devices.BRANCH;
        if (branch?.kind !== 'router') return false;
        const ntp = branch.device.ntp.servers.get(NEW_MONITOR);
        const syslog = branch.device.syslog.hosts.get(NEW_MONITOR);
        const fixedAt = Math.max(ntp?.configuredAt ?? 0, syslog?.configuredAt ?? 0);
        return Boolean(fixedAt > 0 && branch.lastShowRunningConfig > fixedAt);
      },
    },
    {
      id: 'verify-service-status',
      text: 'BRANCH: verify NTP and Syslog status after the server migration fix',
      check: (_state, _history, session) => {
        const branch = session.devices.BRANCH;
        if (branch?.kind !== 'router') return false;
        const ntp = branch.device.ntp.servers.get(NEW_MONITOR);
        const syslog = branch.device.syslog.hosts.get(NEW_MONITOR);
        return Boolean(
          ntp &&
            syslog &&
            branch.lastShowNtpStatus > ntp.configuredAt &&
            branch.lastShowLogging > syslog.configuredAt,
        );
      },
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      text: `The new monitoring server is ${NEW_MONITOR}. Compare the configured \`ntp server\` and \`logging host\` lines against that address.`,
    },
    {
      afterSeconds: 240,
      text: `Use \`no ntp server ${OLD_MONITOR}\`, \`ntp server ${NEW_MONITOR}\`, \`no logging host ${OLD_MONITOR}\`, and \`logging host ${NEW_MONITOR}\`. Then verify with \`show running-config | include ntp|logging\`, \`show ntp status\`, and \`show logging\`.`,
    },
  ],
  solution: {
    steps: [
      {
        device: 'BRANCH',
        note: 'Inspect the current NTP and Syslog server references:',
        commands: ['enable', 'show running-config | include ntp|logging', 'show ntp status', 'show logging'],
      },
      {
        device: 'BRANCH',
        note: 'Remove the retired monitoring server and configure the migrated monitoring server:',
        commands: [
          'configure terminal',
          `no ntp server ${OLD_MONITOR}`,
          `ntp server ${NEW_MONITOR}`,
          `no logging host ${OLD_MONITOR}`,
          `logging host ${NEW_MONITOR}`,
          'end',
        ],
      },
      {
        device: 'BRANCH',
        note: 'Verify the final running configuration and management-service status:',
        commands: ['show running-config | include ntp|logging', 'show ntp status', 'show logging'],
      },
    ],
  },
};
