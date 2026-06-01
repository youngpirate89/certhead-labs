import type { Lab } from '@/engine/types';

/**
 * Lab 25 — IPv6 static routes.
 *
 * Scope stays deliberately narrow: routers and hosts are pre-addressed from
 * Lab 24's IPv6 command surface, and the learner adds one reciprocal IPv6
 * static route per router. The engine records IPv6 route intent and verifies
 * `show ipv6 route`; it does not yet simulate IPv6 forwarding, NDP, or ping.
 */
export const lab25Ipv6StaticRoute: Lab = {
  id: 'ccna-lab25-ipv6-static-route',
  title: 'IPv6 Static Routes: Connect Two Branch LANs',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    'Two branch LANs have already been addressed for IPv6. R1 serves 2001:db8:acad:10::/64, R2 serves 2001:db8:acad:20::/64, and the router-to-router link uses 2001:db8:acad:12::/64.\n\nYour job is to add reciprocal IPv6 static routes so each router knows how to reach the remote LAN, then verify the IPv6 routing table on both routers. This lab focuses on route syntax and next-hop selection; full IPv6 ping/reachability simulation is intentionally out of scope for this step.',
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Windows Workstation',
        interfaces: ['Eth0'],
        position: { x: 0, y: 0 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 260, y: 0 },
      },
      {
        id: 'R2',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 520, y: 0 },
      },
      {
        id: 'PC-B',
        kind: 'pc',
        platform: 'Windows Workstation',
        interfaces: ['Eth0'],
        position: { x: 780, y: 0 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
      { a: { deviceId: 'R2', iface: 'Gi0/1' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ipv6 address 2001:db8:acad:10::1/64',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'ipv6 address 2001:db8:acad:12::1/64',
      'no shutdown',
      'end',
    ],
    R2: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ipv6 address 2001:db8:acad:12::2/64',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'ipv6 address 2001:db8:acad:20::1/64',
      'no shutdown',
      'end',
    ],
  },
  objectives: [
    {
      id: 'r1-static-ipv6-route',
      text: 'R1: configure ipv6 route 2001:db8:acad:20::/64 2001:db8:acad:12::2',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.ipv6StaticRoutes.some(
          (r) => r.prefix === '2001:db8:acad:20::/64' && r.nextHop === '2001:db8:acad:12::2',
        );
      },
    },
    {
      id: 'r1-verify-ipv6-route',
      text: 'R1: run show ipv6 route after adding the static route',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const route = r1.ipv6StaticRoutes.find(
          (r) => r.prefix === '2001:db8:acad:20::/64' && r.nextHop === '2001:db8:acad:12::2',
        );
        return route !== undefined && r1.lastShowIpv6Route > route.configuredAt;
      },
    },
    {
      id: 'r2-static-ipv6-route',
      text: 'R2: configure ipv6 route 2001:db8:acad:10::/64 2001:db8:acad:12::1',
      check: (_state, _history, session) => {
        const r2 = session.devices.R2;
        if (r2?.kind !== 'router') return false;
        return r2.ipv6StaticRoutes.some(
          (r) => r.prefix === '2001:db8:acad:10::/64' && r.nextHop === '2001:db8:acad:12::1',
        );
      },
    },
    {
      id: 'r2-verify-ipv6-route',
      text: 'R2: run show ipv6 route after adding the static route',
      check: (_state, _history, session) => {
        const r2 = session.devices.R2;
        if (r2?.kind !== 'router') return false;
        const route = r2.ipv6StaticRoutes.find(
          (r) => r.prefix === '2001:db8:acad:10::/64' && r.nextHop === '2001:db8:acad:12::1',
        );
        return route !== undefined && r2.lastShowIpv6Route > route.configuredAt;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      text: 'IPv6 static route syntax is `ipv6 route <remote-prefix>/<prefix-length> <next-hop-ipv6-address>`. R1 points to R2\'s WAN IPv6 address; R2 points to R1\'s WAN IPv6 address.',
    },
    {
      afterSeconds: 240,
      text: 'On R1 use `ipv6 route 2001:db8:acad:20::/64 2001:db8:acad:12::2`. On R2 use `ipv6 route 2001:db8:acad:10::/64 2001:db8:acad:12::1`. Verify each router with `show ipv6 route`.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Point R1 toward the remote R2 LAN, then verify the IPv6 routing table:',
        commands: [
          'enable',
          'configure terminal',
          'ipv6 route 2001:db8:acad:20::/64 2001:db8:acad:12::2',
          'end',
          'show ipv6 route',
        ],
      },
      {
        device: 'R2',
        note: 'Point R2 back toward the remote R1 LAN, then verify the IPv6 routing table:',
        commands: [
          'enable',
          'configure terminal',
          'ipv6 route 2001:db8:acad:10::/64 2001:db8:acad:12::1',
          'end',
          'show ipv6 route',
        ],
      },
    ],
  },
};
