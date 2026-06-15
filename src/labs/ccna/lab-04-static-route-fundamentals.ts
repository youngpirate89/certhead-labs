import type { Lab } from '@/engine/types';
import type { Session as RouterSession } from '@/engine/adapters/ios/state';

/**
 * Lab 04 — static route fundamentals.
 *
 * Builds directly on Lab 03's addressed topology. Interfaces are already up;
 * the missing piece is bidirectional routing between two differently-sized LAN
 * subnets across the /30 transit link.
 */
export const lab04StaticRouteFundamentals: Lab = {
  id: 'ccna-lab04-static-route-fundamentals',
  title: 'Static Routes: Connect Two Subnetted LANs',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: true,
  scenario:
    "The branch addressing plan from the previous lab is now installed: Sales uses 172.16.10.0/26 behind R1, Support uses 172.16.10.64/27 behind R2, and the routers share the 10.10.10.0/30 transit link. Local gateway pings work, but PC-A still cannot reach PC-B because neither router has a route to the remote LAN.\n\nConfigure one static route on each router, verify the routing tables, then prove PC-A can reach PC-B. This lab focuses on the core static-route pattern: destination network, subnet mask, and next-hop IP address.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '172.16.10.10', mask: '255.255.255.192', gateway: '172.16.10.1' },
      },
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] },
      { id: 'R2', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] },
      {
        id: 'PC-B',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '172.16.10.70', mask: '255.255.255.224', gateway: '172.16.10.65' },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'R2', iface: 'Gi0/1' } },
      { a: { deviceId: 'R2', iface: 'Gi0/0' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 172.16.10.1 255.255.255.192',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'ip address 10.10.10.1 255.255.255.252',
      'no shutdown',
      'exit',
    ],
    R2: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 172.16.10.65 255.255.255.224',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'ip address 10.10.10.2 255.255.255.252',
      'no shutdown',
      'exit',
    ],
  },
  objectives: [
    {
      id: 'r1-static-route',
      text: 'R1: add ip route 172.16.10.64 255.255.255.224 10.10.10.2',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return r1?.kind === 'router' && r1.staticRoutes.some((route) =>
          route.prefix === '172.16.10.64' && route.mask === '255.255.255.224' && route.nextHop === '10.10.10.2',
        );
      },
    },
    {
      id: 'r2-static-route',
      text: 'R2: add ip route 172.16.10.0 255.255.255.192 10.10.10.1',
      check: (_state, _history, session) => {
        const r2 = session.devices.R2;
        return r2?.kind === 'router' && r2.staticRoutes.some((route) =>
          route.prefix === '172.16.10.0' && route.mask === '255.255.255.192' && route.nextHop === '10.10.10.1',
        );
      },
    },
    {
      id: 'verify-routes',
      text: 'R1 and R2: run show ip route after adding the static routes',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        const r2 = session.devices.R2;
        return r1?.kind === 'router' && r2?.kind === 'router' && showRouteAfterStatic(r1) && showRouteAfterStatic(r2);
      },
    },
    {
      id: 'end-to-end-ping',
      text: 'PC-A: ping 172.16.10.70 and confirm end-to-end reachability',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-A'];
        return pc?.kind === 'pc' && pc.lastPing?.target === '172.16.10.70' && pc.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'On R1, the destination is the remote Support LAN: 172.16.10.64 with mask 255.255.255.224. The next hop is R2 at 10.10.10.2.',
    },
    {
      afterSeconds: 150,
      text: 'On R2, add the return route to Sales: 172.16.10.0 mask 255.255.255.192 via R1 at 10.10.10.1.',
    },
    {
      afterSeconds: 240,
      text: 'After both routes are configured, use `show ip route` on both routers, then ping PC-B from PC-A.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Add the forward static route from Sales toward Support:',
        commands: [
          'enable',
          'configure terminal',
          'ip route 172.16.10.64 255.255.255.224 10.10.10.2',
          'end',
          'show ip route',
        ],
      },
      {
        device: 'R2',
        note: 'Add the return static route from Support back to Sales:',
        commands: [
          'enable',
          'configure terminal',
          'ip route 172.16.10.0 255.255.255.192 10.10.10.1',
          'end',
          'show ip route',
        ],
      },
      {
        device: 'PC-A',
        note: 'Verify end-to-end reachability:',
        commands: ['ping 172.16.10.70'],
      },
    ],
  },
};

function showRouteAfterStatic(router: RouterSession): boolean {
  const lastShow = lastMatchingIndex(router.resolvedHistory, /^(do\s+)?show ip route$/);
  // Raw history preserves the static-route arguments; resolvedHistory only stores
  // the grammar head. Use raw history here so a pre-route show cannot satisfy
  // the verification gate.
  const lastStatic = lastMatchingIndex(router.history, /^ip route\s+/i);
  return lastShow > -1 && lastStatic > -1 && lastShow > lastStatic;
}

function lastMatchingIndex(history: readonly string[], pattern: RegExp): number {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (pattern.test(history[i])) return i;
  }
  return -1;
}
