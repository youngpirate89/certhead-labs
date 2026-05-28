import type { Lab } from '@/engine/types';

/**
 * Lab 14 - DHCP Relay (ip helper-address).
 *
 * Topology: PC-A -- R1 -- SRV1. PC-A is a DHCP client on the LAN-side subnet
 * (192.168.10.0/24) cabled to R1's Gi0/0. SRV1, a Cisco router serving as the
 * DHCP server, sits across a /30 WAN link from R1's Gi0/1 at 172.16.0.2.
 * Because PC-A and SRV1 are on different subnets, DHCP broadcasts cannot
 * cross on their own; R1 must be configured with `ip helper-address` so it
 * forwards DHCP traffic from PC-A's subnet to SRV1.
 *
 * Engine delta this lab exercises:
 *   - `ip helper-address <ip>` in config-if (Phase 1) — sets InterfaceState
 *     `helperAddress`; rendered by show running-config / show run interface.
 *   - DHCP binding allocator relay path (Phase 2) — when the cabled router
 *     has no matching pool itself but the cabled interface has helperAddress,
 *     follow it to the remote device's pool and allocate the binding there.
 *   - PC `lastIpconfig` stamp (Phase 2) — the verify objective gate.
 *
 * Six objectives:
 *   1. `dhcp-excluded`     — SRV1 excludes 192.168.10.1-10 from the pool
 *   2. `dhcp-pool-network` — SRV1 pool covers 192.168.10.0/24
 *   3. `dhcp-pool-gateway` — SRV1 pool default-router is 192.168.10.1
 *   4. `helper-address`    — R1 Gi0/0 carries ip helper-address 172.16.0.2
 *   5. `dhcp-binding`      — PC-A receives a 192.168.10.x address
 *   6. `verify-ipconfig`   — PC-A's lastIpconfig stamp is set
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once /embed lands.
 */
export const lab14DhcpRelay: Lab = {
  id: 'ccna-lab14-dhcp-relay',
  title: 'DHCP Relay - ip helper-address',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    "PC-A on the branch LAN (192.168.10.0/24) needs an IP from the centralised DHCP server SRV1, which sits across a WAN link at 172.16.0.2. R1 is the LAN's default gateway and the only path between the two subnets. DHCP discover messages are broadcasts and don't cross routers on their own, so without help PC-A will sit forever at `(DHCP request pending)`.\n\nConfigure SRV1 with a DHCP pool for the 192.168.10.0/24 subnet (exclude the first ten addresses so the gateway and infrastructure don't collide), then add `ip helper-address 172.16.0.2` on R1's LAN-facing interface so it forwards PC-A's broadcasts to SRV1 as unicast. Verify on PC-A with `ipconfig`.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { dhcp: true },
        position: { x: 0, y: 0 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 320, y: 0 },
      },
      {
        id: 'SRV1',
        kind: 'router',
        platform: 'server',
        interfaces: ['Gi0/0'],
        position: { x: 640, y: 0 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'SRV1', iface: 'Gi0/0' } },
    ],
  },
  setup: {
    // R1 LAN + WAN interfaces pre-configured. helper-address is intentionally
    // absent — that's the learner's job to add.
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.10.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'ip address 172.16.0.1 255.255.255.252',
      'no shutdown',
      'exit',
    ],
    // SRV1's interface is up but has no DHCP pool yet — that's the learner's
    // other half of the task.
    SRV1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 172.16.0.2 255.255.255.252',
      'no shutdown',
      'exit',
    ],
  },
  objectives: [
    {
      id: 'dhcp-excluded',
      text: 'SRV1: ip dhcp excluded-address 192.168.10.1 192.168.10.10',
      check: (state) =>
        state.SRV1?.dhcpExcluded.some(
          (r) => r.start === '192.168.10.1' && r.end === '192.168.10.10',
        ) ?? false,
    },
    {
      id: 'dhcp-pool-network',
      text: 'SRV1: ip dhcp pool with network 192.168.10.0 255.255.255.0',
      check: (state) => {
        for (const pool of state.SRV1?.dhcpPools.values() ?? []) {
          if (pool.network === '192.168.10.0' && pool.mask === '255.255.255.0') {
            return true;
          }
        }
        return false;
      },
    },
    {
      id: 'dhcp-pool-gateway',
      text: 'SRV1 (DHCP pool): default-router 192.168.10.1',
      check: (state) => {
        for (const pool of state.SRV1?.dhcpPools.values() ?? []) {
          if (pool.defaultRouter === '192.168.10.1') return true;
        }
        return false;
      },
    },
    {
      id: 'helper-address',
      text: 'R1 Gi0/0: ip helper-address 172.16.0.2',
      check: (state) =>
        state.R1?.interfaces?.['Gi0/0']?.helperAddress === '172.16.0.2',
    },
    {
      id: 'dhcp-binding',
      text: 'PC-A: receives a DHCP-assigned address in 192.168.10.0/24',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-A'];
        if (pc?.kind !== 'pc') return false;
        return pc.ip !== null && pc.ip.startsWith('192.168.10.');
      },
    },
    {
      id: 'verify-ipconfig',
      text: 'PC-A: run ipconfig to verify the lease',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-A'];
        if (pc?.kind !== 'pc') return false;
        return pc.lastIpconfig > 0;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text:
        'PC-A and SRV1 are on different subnets. DHCP broadcasts cannot cross subnet boundaries on their own - the router between them needs to forward them.',
    },
    {
      afterSeconds: 180,
      text:
        'Configure SRV1 first: `ip dhcp excluded-address 192.168.10.1 192.168.10.10` then `ip dhcp pool CLIENT_POOL` with `network`, `default-router`, and `dns-server` lines inside the pool.',
    },
    {
      afterSeconds: 300,
      text:
        "On R1, enter `interface gi0/0` and add `ip helper-address 172.16.0.2`. This tells R1 to forward DHCP broadcasts from PC-A's subnet to SRV1.",
    },
  ],
  solution: {
    steps: [
      {
        device: 'SRV1',
        note: 'Configure SRV1 as the DHCP server for the 192.168.10.0/24 subnet:',
        commands: [
          'enable',
          'configure terminal',
          'ip dhcp excluded-address 192.168.10.1 192.168.10.10',
          'ip dhcp pool CLIENT_POOL',
          ' network 192.168.10.0 255.255.255.0',
          ' default-router 192.168.10.1',
          ' dns-server 8.8.8.8',
          'end',
        ],
      },
      {
        device: 'R1',
        note: 'Tell R1 to relay DHCP broadcasts from Gi0/0 to SRV1 at 172.16.0.2:',
        commands: [
          'enable',
          'configure terminal',
          'interface gi0/0',
          ' ip helper-address 172.16.0.2',
          'end',
        ],
      },
      {
        device: 'PC-A',
        note: 'Verify PC-A received an address from the relayed DHCP server:',
        commands: ['ipconfig'],
      },
    ],
  },
};
