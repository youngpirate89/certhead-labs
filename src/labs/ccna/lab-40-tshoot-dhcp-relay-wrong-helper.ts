import type { Lab } from '@/engine/types';

function ranShowRunForFinanceGateway(history: readonly string[] | undefined): boolean {
  return (history ?? []).some((line) => /^show running-config(?: interface)? gi0\/1$/i.test(line));
}

/**
 * Lab 40 — remote DHCP server is alive, but one user subnet relays DHCP to a
 * stale helper address. The fix is to correct the helper on the affected
 * gateway interface while preserving the known-good subnet.
 */
export const lab40TshootDhcpRelayWrongHelper: Lab = {
  id: 'ccna-lab40-tshoot-dhcp-relay-wrong-helper',
  title: 'Ticket: DHCP Relay Points to Wrong Server',
  exam: 'CCNA 200-301',
  difficulty: 4,
  estimatedMinutes: 20,
  isFree: false,
  scenario:
    'Ticket: Finance users cannot get an IPv4 address after a DHCP server migration. HR users still receive leases from the central DHCP service. The DHCP server has pools for both user subnets, and the Finance gateway interface is up, but Finance clients fall back to APIPA.\n\nCompare a failed Finance workstation with a known-good HR workstation, inspect the Finance gateway interface helper address, correct the stale relay target, and verify both subnets receive valid leases from the central server.',
  topology: {
    devices: [
      {
        id: 'PC-HR',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { dhcp: true },
        position: { x: 0, y: 60 },
      },
      {
        id: 'PC-FINANCE',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { dhcp: true },
        position: { x: 0, y: 300 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1', 'Gi0/2'],
        position: { x: 320, y: 180 },
      },
      {
        id: 'DHCP-SRV',
        kind: 'router',
        platform: 'server',
        interfaces: ['Gi0/0'],
        position: { x: 640, y: 180 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-HR', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'PC-FINANCE', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/1' } },
      { a: { deviceId: 'R1', iface: 'Gi0/2' }, b: { deviceId: 'DHCP-SRV', iface: 'Gi0/0' } },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'description HR user gateway - relay works',
      'ip address 10.40.40.1 255.255.255.0',
      'ip helper-address 10.80.0.10',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'description Finance user gateway - stale relay target',
      'ip address 10.50.50.1 255.255.255.0',
      'ip helper-address 10.80.0.99',
      'no shutdown',
      'exit',
      'interface gi0/2',
      'description Link to central DHCP server',
      'ip address 10.80.0.1 255.255.255.0',
      'no shutdown',
      'end',
    ],
    'DHCP-SRV': [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 10.80.0.10 255.255.255.0',
      'no shutdown',
      'exit',
      'ip dhcp excluded-address 10.40.40.1 10.40.40.20',
      'ip dhcp excluded-address 10.50.50.1 10.50.50.20',
      'ip dhcp pool HR_USERS',
      'network 10.40.40.0 255.255.255.0',
      'default-router 10.40.40.1',
      'dns-server 10.80.0.10',
      'exit',
      'ip dhcp pool FINANCE_USERS',
      'network 10.50.50.0 255.255.255.0',
      'default-router 10.50.50.1',
      'dns-server 10.80.0.10',
      'end',
    ],
  },
  objectives: [
    {
      id: 'compare-dhcp-symptoms',
      text: 'Compare PC-FINANCE ipconfig output with known-good PC-HR.',
      check: (_state, _history, session) => {
        const finance = session.devices['PC-FINANCE'];
        const hr = session.devices['PC-HR'];
        if (finance?.kind !== 'pc' || hr?.kind !== 'pc') return false;
        return finance.lastIpconfig > 0 && hr.lastIpconfig > 0;
      },
    },
    {
      id: 'inspect-finance-helper',
      text: 'R1: inspect the Finance gateway interface helper address.',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return r1?.kind === 'router' && ranShowRunForFinanceGateway(r1.resolvedHistory);
      },
    },
    {
      id: 'correct-finance-helper',
      text: 'R1 Gi0/1: correct the helper address to 10.80.0.10.',
      check: (state) => state.R1?.interfaces['Gi0/1']?.helperAddress === '10.80.0.10',
    },
    {
      id: 'verify-finance-lease',
      text: 'PC-FINANCE: verify a DHCP lease in 10.50.50.0/24 with gateway 10.50.50.1.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-FINANCE'];
        if (pc?.kind !== 'pc') return false;
        return pc.lastIpconfig > 0 && pc.ip?.startsWith('10.50.50.') === true && pc.gateway === '10.50.50.1';
      },
    },
    {
      id: 'preserve-hr-lease',
      text: 'PC-HR: confirm the known-good subnet still has a 10.40.40.0/24 lease.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-HR'];
        if (pc?.kind !== 'pc') return false;
        return pc.lastIpconfig > 0 && pc.ip?.startsWith('10.40.40.') === true && pc.gateway === '10.40.40.1';
      },
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      text: 'APIPA on Finance with HR working points away from the DHCP server itself. Compare client leases before changing the server pools.',
    },
    {
      afterSeconds: 210,
      text: 'Inspect the affected gateway interface. A helper address can be present but still wrong after a server migration.',
    },
    {
      afterSeconds: 360,
      text: 'On R1 Gi0/1, replace the stale helper with ip helper-address 10.80.0.10, then verify Finance and HR leases.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'PC-FINANCE',
        note: 'Confirm the affected Finance workstation has APIPA/no usable DHCP lease:',
        commands: ['ipconfig'],
      },
      {
        device: 'PC-HR',
        note: 'Compare against a known-good HR workstation using the same central DHCP server:',
        commands: ['ipconfig'],
      },
      {
        device: 'R1',
        note: 'Inspect the Finance gateway, then replace the stale DHCP relay target:',
        commands: [
          'enable',
          'show running-config interface gi0/1',
          'configure terminal',
          'interface gi0/1',
          'ip helper-address 10.80.0.10',
          'end',
          'show running-config interface gi0/1',
        ],
      },
      {
        device: 'PC-FINANCE',
        note: 'Verify Finance now receives a valid lease from DHCP-SRV:',
        commands: ['ipconfig'],
      },
      {
        device: 'PC-HR',
        note: 'Confirm the known-good subnet remains healthy:',
        commands: ['ipconfig'],
      },
    ],
  },
};
