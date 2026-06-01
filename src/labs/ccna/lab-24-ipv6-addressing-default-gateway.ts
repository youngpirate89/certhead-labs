import type { Lab } from '@/engine/types';

/**
 * Lab 24 — IPv6 addressing and host default gateway.
 *
 * Scope is intentionally narrow for first IPv6 support: configure one router
 * LAN interface with a global unicast /64, configure a workstation address in
 * the same /64, set the workstation's IPv6 default gateway to R1, then verify
 * the router and PC addressing. IPv6 routing, NDP, SLAAC, and end-to-end IPv6
 * ping are deferred to the follow-up IPv6 static-route lab.
 */
export const lab24Ipv6AddressingDefaultGateway: Lab = {
  id: 'ccna-lab24-ipv6-addressing-default-gateway',
  title: 'IPv6 Addressing: Configure a LAN Default Gateway',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    'A small branch LAN is being prepared for IPv6. PC-A will use R1 as its IPv6 default gateway on the 2001:db8:acad:10::/64 subnet. Configure R1 Gi0/0 with the gateway address, bring the interface up, then configure PC-A with its IPv6 address and default gateway.\n\nThis lab focuses on IPv6 address format, /64 prefix length, and the role of a default gateway. Full IPv6 routing and neighbor discovery are intentionally out of scope for this first IPv6 lab.',
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        position: { x: 0, y: 0 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 320, y: 0 },
      },
    ],
    links: [{ a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } }],
  },
  objectives: [
    {
      id: 'r1-ipv6-address',
      text: 'R1 Gi0/0: configure ipv6 address 2001:db8:acad:10::1/64',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.device.interfaces['Gi0/0'].ipv6Addresses.includes('2001:db8:acad:10::1/64');
      },
    },
    {
      id: 'r1-no-shutdown',
      text: 'R1 Gi0/0: bring the interface up with no shutdown',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.device.interfaces['Gi0/0'].adminUp === true;
      },
    },
    {
      id: 'r1-verify',
      text: 'R1: run show ipv6 interface brief to verify the IPv6 address',
      check: (_state, history) =>
        history.R1?.resolved.some((cmd) => /^(do\s+)?show ipv6 interface brief$/.test(cmd)) ?? false,
    },
    {
      id: 'pc-ipv6-address',
      text: 'PC-A: use New-NetIPAddress to configure 2001:db8:acad:10::10/64',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-A'];
        return pc?.kind === 'pc' && pc.ipv6 === '2001:db8:acad:10::10/64';
      },
    },
    {
      id: 'pc-default-gateway',
      text: 'PC-A: use New-NetIPAddress to set the IPv6 default gateway to 2001:db8:acad:10::1',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-A'];
        return pc?.kind === 'pc' && pc.gateway6 === '2001:db8:acad:10::1';
      },
    },
    {
      id: 'pc-verify',
      text: 'PC-A: run Get-NetIPConfiguration to verify the IPv6 address and default gateway',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-A'];
        return pc?.kind === 'pc' && pc.lastIpconfig > 0 && pc.gateway6 === '2001:db8:acad:10::1';
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'On R1, enter interface configuration for Gi0/0 and use `ipv6 address 2001:db8:acad:10::1/64`.',
    },
    {
      afterSeconds: 180,
      text: 'IPv6 LANs normally use a /64 prefix. On Windows PowerShell, use New-NetIPAddress with -IPAddress, -PrefixLength, and -DefaultGateway.',
    },
    {
      afterSeconds: 300,
      text: 'Verify R1 with `show ipv6 interface brief` and PC-A with `Get-NetIPConfiguration`.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Configure R1 as the IPv6 default gateway for the LAN and verify:',
        commands: [
          'enable',
          'configure terminal',
          'interface GigabitEthernet0/0',
          'ipv6 address 2001:db8:acad:10::1/64',
          'no shutdown',
          'end',
          'show ipv6 interface brief',
        ],
      },
      {
        device: 'PC-A',
        note: 'Configure the workstation IPv6 address and default gateway, then verify:',
        commands: [
          'New-NetIPAddress -InterfaceAlias Eth0 -IPAddress 2001:db8:acad:10::10 -PrefixLength 64 -DefaultGateway 2001:db8:acad:10::1',
          'Get-NetIPConfiguration',
        ],
      },
    ],
  },
};
