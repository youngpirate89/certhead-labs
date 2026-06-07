import type { Lab } from '@/engine/types';

export const lab38TshootIpv6StaticWrongNextHop: Lab = {
  id: 'ccna-lab38-tshoot-ipv6-static-wrong-next-hop',
  title: 'Troubleshoot: IPv6 Static Route Wrong Next Hop',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 13,
  isFree: false,
  scenario:
    'R1 should reach the remote IPv6 LAN behind R2, but the static route points at the wrong WAN next hop. The local and transit IPv6 addressing is already correct.\n\nInspect R1\'s IPv6 routing table, remove the incorrect static route, add the route using R2\'s actual WAN IPv6 address, and verify the corrected route appears after the repair. This lab focuses on IPv6 static-route evidence and syntax; IPv6 ping/forwarding simulation is intentionally out of scope.',
  topology: {
    devices: [
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'], position: { x: 120, y: 0 } },
      { id: 'R2', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'], position: { x: 520, y: 0 } },
      { id: 'PC-B', kind: 'pc', platform: 'Windows Workstation', interfaces: ['Eth0'], position: { x: 840, y: 0 } },
    ],
    links: [
      { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
      { a: { deviceId: 'R2', iface: 'Gi0/1' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ipv6 address 2001:db8:acad:38:10::1/64',
      'no shutdown',
      'interface gi0/1',
      'ipv6 address 2001:db8:acad:38:12::1/64',
      'no shutdown',
      'exit',
      'ipv6 route 2001:db8:acad:38:20::/64 2001:db8:acad:38:12::3',
      'end',
    ],
    R2: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ipv6 address 2001:db8:acad:38:12::2/64',
      'no shutdown',
      'interface gi0/1',
      'ipv6 address 2001:db8:acad:38:20::1/64',
      'no shutdown',
      'end',
    ],
  },
  objectives: [
    {
      id: 'diagnose-wrong-ipv6-next-hop',
      text: 'R1: inspect show ipv6 route and identify that the static route points to 2001:db8:acad:38:12::3',
      check: (_state, history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return history.R1?.resolved.some((cmd) => cmd === 'show ipv6 route') ?? false;
      },
    },
    {
      id: 'remove-bad-ipv6-route',
      text: 'R1: remove the incorrect IPv6 static route that points to 2001:db8:acad:38:12::3',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return !r1.ipv6StaticRoutes.some(
          (r) => r.prefix === '2001:db8:acad:38:20::/64' && r.nextHop === '2001:db8:acad:38:12::3',
        );
      },
    },
    {
      id: 'add-correct-ipv6-route',
      text: 'R1: add ipv6 route 2001:db8:acad:38:20::/64 2001:db8:acad:38:12::2',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.ipv6StaticRoutes.some(
          (r) => r.prefix === '2001:db8:acad:38:20::/64' && r.nextHop === '2001:db8:acad:38:12::2',
        );
      },
    },
    {
      id: 'verify-correct-ipv6-route',
      text: 'R1: run show ipv6 route after the repair and verify the static route uses R2\'s WAN address',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const route = r1.ipv6StaticRoutes.find(
          (r) => r.prefix === '2001:db8:acad:38:20::/64' && r.nextHop === '2001:db8:acad:38:12::2',
        );
        return route !== undefined && r1.lastShowIpv6Route > route.configuredAt;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Start on R1 with show ipv6 route. Look at the S route for 2001:db8:acad:38:20::/64 and compare its next hop to R2\'s WAN address.',
    },
    {
      afterSeconds: 180,
      text: 'R2 is 2001:db8:acad:38:12::2 on the transit link. The existing route points at ::3, so remove that route before adding the correct one.',
    },
    {
      afterSeconds: 300,
      text: 'Use no ipv6 route 2001:db8:acad:38:20::/64 2001:db8:acad:38:12::3, then ipv6 route 2001:db8:acad:38:20::/64 2001:db8:acad:38:12::2. Verify afterward with show ipv6 route.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Find and replace the wrong IPv6 static-route next hop, then verify the route table:',
        commands: [
          'enable',
          'show ipv6 route',
          'configure terminal',
          'no ipv6 route 2001:db8:acad:38:20::/64 2001:db8:acad:38:12::3',
          'ipv6 route 2001:db8:acad:38:20::/64 2001:db8:acad:38:12::2',
          'end',
          'show ipv6 route',
        ],
      },
    ],
  },
};
