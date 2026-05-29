import type { Lab } from '@/engine/types';

/**
 * Lab 15 - Default Static Route (gateway of last resort).
 *
 * Topology: PC-A -- R1 -- R2 -- INET. R1 is the LAN's gateway. R2 is the
 * upstream ISP edge across a /30 WAN. INET is a single-homed "internet host"
 * representing 8.8.8.2 — the reachability engine requires a real owner for
 * the ping destination, so this is the cheapest way to make a default-route
 * lab actually round-trip.
 *
 * Pre-seeded via setup: every interface is up and addressed; R2 has the
 * return route back to the LAN; INET has a default route back through R2.
 * The ONLY missing piece is R1's default route — that's the learner's job.
 *
 * Engine delta this lab exercises:
 *   - `ip route 0.0.0.0 0.0.0.0 <next-hop>` parses through the existing
 *     ip route grammar (Phase 1) — adminDistance:1, source:'static'.
 *   - Longest-prefix-match selects the 0.0.0.0/0 entry only when no
 *     more-specific route covers the destination (routing.test.ts:126).
 *   - PC `lastPing` stamp ({target, ok}) — the verify objective gate
 *     plus the round-trip confirmation.
 *
 * Three objectives:
 *   1. `default-route` — R1 has prefix 0.0.0.0, mask 0.0.0.0, nextHop 203.0.113.2
 *   2. `verify-route` — learner ran `show ip route` on R1
 *   3. `ping-internet` — PC-A pinged 8.8.8.2 and the reply came back
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once /embed lands.
 */
export const lab15DefaultStaticRoute: Lab = {
  id: 'ccna-lab15-default-static-route',
  title: 'Default Static Route - Gateway of Last Resort',
  exam: 'CCNA 200-301',
  difficulty: 1,
  estimatedMinutes: 8,
  isFree: false,
  scenario:
    "PC-A on the branch LAN (192.168.1.0/24) needs to reach an upstream host at 8.8.8.2. R1 is the branch gateway with a /30 WAN link to R2, which in turn connects to the internet at 8.8.8.0/30. R2 already knows how to return traffic to the LAN, and the upstream INET host already has its default route home - but R1 itself has no path to anything outside its directly-connected subnets. Pinging 8.8.8.2 from PC-A fails today because R1 drops the packet with no matching route.\n\nConfigure a default static route on R1 pointing at R2's WAN address (203.0.113.2). A default route matches every destination with no more-specific entry, so R1 will forward unknown traffic upstream and connectivity comes back end-to-end. Verify with `show ip route` on R1 and confirm with a ping from PC-A.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
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
        id: 'R2',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 640, y: 0 },
      },
      {
        id: 'INET',
        kind: 'router',
        platform: 'server',
        interfaces: ['Gi0/0'],
        position: { x: 960, y: 0 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
      { a: { deviceId: 'R2', iface: 'Gi0/1' }, b: { deviceId: 'INET', iface: 'Gi0/0' } },
    ],
  },
  setup: {
    // R1 LAN + WAN interfaces up. NO default route — that's the learner's job.
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'ip address 203.0.113.1 255.255.255.252',
      'no shutdown',
      'exit',
    ],
    // R2 fully configured: both interfaces up + return route to the LAN so
    // the round-trip works as soon as R1's default route lands.
    R2: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 203.0.113.2 255.255.255.252',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'ip address 8.8.8.1 255.255.255.252',
      'no shutdown',
      'exit',
      'ip route 192.168.1.0 255.255.255.0 203.0.113.1',
    ],
    // INET is the upstream "internet host" pinned to 8.8.8.2. Its own default
    // route points back at R2 so the reply leg returns through the path.
    INET: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 8.8.8.2 255.255.255.252',
      'no shutdown',
      'exit',
      'ip route 0.0.0.0 0.0.0.0 8.8.8.1',
    ],
  },
  objectives: [
    {
      id: 'default-route',
      text: 'R1: ip route 0.0.0.0 0.0.0.0 203.0.113.2',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.staticRoutes.some(
          (r) =>
            r.prefix === '0.0.0.0' &&
            r.mask === '0.0.0.0' &&
            r.nextHop === '203.0.113.2',
        );
      },
    },
    {
      id: 'verify-route',
      text: 'R1: run show ip route to confirm the default route is installed',
      check: (_state, history) =>
        history.R1?.resolved.some((cmd) => /^(do\s+)?show ip route$/.test(cmd)) ?? false,
    },
    {
      id: 'ping-internet',
      text: 'PC-A: ping 8.8.8.2 and confirm the reply',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-A'];
        if (pc?.kind !== 'pc') return false;
        return pc.lastPing?.target === '8.8.8.2' && pc.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'A default route matches every destination that has no more-specific entry. The network and mask are both 0.0.0.0.',
    },
    {
      afterSeconds: 180,
      text: "On R1: `ip route 0.0.0.0 0.0.0.0 203.0.113.2`. The next hop is R2's Gi0/0 address on the WAN /30.",
    },
    {
      afterSeconds: 300,
      text: 'After configuring, run `show ip route` on R1 - you should see an `S    0.0.0.0/0 [1/0] via 203.0.113.2` line. Then `ping 8.8.8.2` from PC-A.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Add the default route pointing at R2:',
        commands: [
          'enable',
          'configure terminal',
          'ip route 0.0.0.0 0.0.0.0 203.0.113.2',
          'end',
        ],
      },
      {
        device: 'R1',
        note: 'Verify the route appears in the table:',
        commands: ['show ip route'],
      },
      {
        device: 'PC-A',
        note: 'Confirm end-to-end connectivity through the default route:',
        commands: ['ping 8.8.8.2'],
      },
    ],
  },
};
