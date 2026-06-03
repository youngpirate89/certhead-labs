import type { Lab } from '@/engine/types';

function ranShowRunForSalesGateway(history: readonly string[] | undefined): boolean {
  return (history ?? []).some((line) => /^show running-config(?: interface)? gi0\/1$/i.test(line));
}

/**
 * Ticket lab — one user subnet cannot obtain DHCP because its gateway
 * interface is missing the relay target.
 *
 * PC-OPS proves the centralized DHCP server is alive: R1 Gi0/0 already relays
 * VLAN/subnet 20 to DHCP-SRV at 10.60.0.10. PC-SALES is cabled to a different
 * R1 user subnet on Gi0/1, where the L3 interface is up and correctly
 * addressed but lacks `ip helper-address`, so the DHCP broadcast never reaches
 * the remote server and Windows falls back to APIPA.
 */
export const tshootDhcpRelayMissing: Lab = {
  id: 'ccna-tshoot-dhcp-relay-missing',
  title: 'Troubleshoot: Missing DHCP Relay',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    'Trouble ticket: Sales users report they cannot get an IP address after a gateway cleanup. Their workstation shows an APIPA 169.254.x.x address with a 255.255.0.0 mask, but Operations users in another subnet still receive valid DHCP leases from the central server.\n\nThe links are up and the DHCP server is reachable for at least one user subnet. Compare PC ipconfig output, inspect the Sales gateway interface on R1, restore the missing DHCP relay toward 10.60.0.10, then verify Sales receives a 10.30.30.0/24 lease without breaking Operations.',
  topology: {
    devices: [
      {
        id: 'PC-OPS',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { dhcp: true },
        position: { x: 0, y: 120 },
      },
      {
        id: 'PC-SALES',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { dhcp: true },
        position: { x: 0, y: 360 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1', 'Gi0/2'],
        position: { x: 320, y: 240 },
      },
      {
        id: 'DHCP-SRV',
        kind: 'router',
        platform: 'server',
        interfaces: ['Gi0/0'],
        position: { x: 640, y: 240 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-OPS', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'PC-SALES', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/1' } },
      { a: { deviceId: 'R1', iface: 'Gi0/2' }, b: { deviceId: 'DHCP-SRV', iface: 'Gi0/0' } },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'description Operations user gateway - relay present',
      'ip address 10.20.20.1 255.255.255.0',
      'ip helper-address 10.60.0.10',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'description Sales user gateway - relay missing',
      'ip address 10.30.30.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface gi0/2',
      'description Link to centralized DHCP server',
      'ip address 10.60.0.1 255.255.255.0',
      'no shutdown',
      'exit',
    ],
    'DHCP-SRV': [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 10.60.0.10 255.255.255.0',
      'no shutdown',
      'exit',
      'ip dhcp excluded-address 10.20.20.1 10.20.20.20',
      'ip dhcp excluded-address 10.30.30.1 10.30.30.20',
      'ip dhcp pool OPS_USERS',
      'network 10.20.20.0 255.255.255.0',
      'default-router 10.20.20.1',
      'dns-server 10.60.0.10',
      'exit',
      'ip dhcp pool SALES_USERS',
      'network 10.30.30.0 255.255.255.0',
      'default-router 10.30.30.1',
      'dns-server 10.60.0.10',
      'exit',
    ],
  },
  objectives: [
    {
      id: 'compare-dhcp-symptoms',
      text: 'Compare PC-SALES ipconfig output with known-good PC-OPS.',
      check: (_state, _history, session) => {
        const sales = session.devices['PC-SALES'];
        const ops = session.devices['PC-OPS'];
        if (sales?.kind !== 'pc' || ops?.kind !== 'pc') return false;
        return sales.lastIpconfig > 0 && ops.lastIpconfig > 0;
      },
    },
    {
      id: 'inspect-sales-gateway',
      text: 'R1: inspect the Sales gateway interface configuration for a missing helper.',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return r1?.kind === 'router' && ranShowRunForSalesGateway(r1.resolvedHistory);
      },
    },
    {
      id: 'restore-sales-helper',
      text: 'R1 Gi0/1: configure ip helper-address 10.60.0.10.',
      check: (state) => state.R1?.interfaces['Gi0/1']?.helperAddress === '10.60.0.10',
    },
    {
      id: 'verify-sales-lease',
      text: 'PC-SALES: verify a DHCP lease in 10.30.30.0/24 with gateway 10.30.30.1.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-SALES'];
        if (pc?.kind !== 'pc') return false;
        return pc.lastIpconfig > 0 && pc.ip?.startsWith('10.30.30.') === true && pc.gateway === '10.30.30.1';
      },
    },
    {
      id: 'preserve-ops-lease',
      text: 'PC-OPS: confirm the known-good subnet still has a 10.20.20.0/24 lease.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-OPS'];
        if (pc?.kind !== 'pc') return false;
        return pc.lastIpconfig > 0 && pc.ip?.startsWith('10.20.20.') === true && pc.gateway === '10.20.20.1';
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'APIPA with the link up means the client sent DHCP but did not receive an offer. Compare against a known-good subnet before changing the server.',
    },
    {
      afterSeconds: 180,
      text: 'If one subnet receives leases from the same remote server, inspect the affected gateway interface for ip helper-address.',
    },
    {
      afterSeconds: 300,
      text: 'On R1 Gi0/1, add ip helper-address 10.60.0.10, then run ipconfig again on PC-SALES.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'PC-SALES',
        note: 'Confirm the affected Sales workstation has APIPA/no usable DHCP lease:',
        commands: ['ipconfig'],
      },
      {
        device: 'PC-OPS',
        note: 'Compare with a known-good Operations workstation using the same central DHCP server:',
        commands: ['ipconfig'],
      },
      {
        device: 'R1',
        note: 'Inspect the Sales gateway, then add the missing DHCP relay target:',
        commands: [
          'enable',
          'show running-config interface gi0/1',
          'configure terminal',
          'interface gi0/1',
          'ip helper-address 10.60.0.10',
          'end',
          'show running-config interface gi0/1',
        ],
      },
      {
        device: 'PC-SALES',
        note: 'Verify Sales now receives a valid lease from DHCP-SRV:',
        commands: ['ipconfig'],
      },
      {
        device: 'PC-OPS',
        note: 'Confirm the known-good subnet remains healthy:',
        commands: ['ipconfig'],
      },
    ],
  },
};
