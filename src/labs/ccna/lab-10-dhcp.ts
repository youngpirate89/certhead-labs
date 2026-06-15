import type { Lab } from '@/engine/types';

/**
 * Lab 10 — Configure DHCP Server.
 *
 * R1 acts as a DHCP server for the LAN attached to Gi0/1 (192.168.1.0/24).
 * PC-A starts in DHCP-client mode (no static IP). The learner:
 *   1. Excludes 192.168.1.1–192.168.1.10 globally so the first ten host
 *      addresses are reserved (router IP + future infrastructure).
 *   2. Creates pool LAN with `ip dhcp pool LAN`, entering config-dhcp mode.
 *   3. Sets the network/mask, default-router (R1's LAN IP), and dns-server.
 *   4. Verifies with `show ip dhcp binding` — PC-A appears at 192.168.1.11
 *      (first allocatable address after the excluded range).
 *
 * Determinism: the engine's binding allocator walks the pool range from the
 * network address upward, skipping excluded ranges, network, and broadcast
 * — so PC-A always lands on 192.168.1.11 once the excluded range is in
 * place. Multiple recomputes (which fire after every state mutation) are
 * idempotent.
 *
 * Topology — single router + single PC, directly cabled. WAN side (Gi0/0)
 * is pre-configured to keep the focus on DHCP; the lab doesn't ask the
 * learner to touch it.
 *
 *      R1 ───── PC-A
 *   (Gi0/1)    (Eth0, DHCP)
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once /embed
 * lands. Catalog entry follows Lab 09 in the registry.
 */
export const lab10Dhcp: Lab = {
  id: 'ccna-lab10-dhcp-server',
  title: 'Configure DHCP Server',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: true,
  scenario:
    "Your branch router R1 needs to hand out IP addresses to the LAN devices on the 192.168.1.0/24 subnet. R1's LAN interface (Gi0/1) is already configured with 192.168.1.1/24 and is up; PC-A is connected to that LAN, currently waiting for a DHCP lease.\n\nConfigure R1 as the DHCP server: exclude the first ten host addresses (so future printers and infrastructure won't collide with the dynamic range), create a pool named LAN, set its network, default gateway, and DNS server, then verify that PC-A receives an address with `show ip dhcp binding`.",
  topology: {
    devices: [
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/1'],
        position: { x: 0, y: 0 },
      },
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { dhcp: true },
        position: { x: 320, y: 0 },
      },
    ],
    links: [
      { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'PC-A', iface: 'Eth0' } },
    ],
  },
  setup: {
    // R1's LAN interface is pre-configured — the lesson is DHCP server config,
    // not interface bring-up. Lab 01 covers interface configuration.
    R1: [
      'enable',
      'configure terminal',
      'interface Gi0/1',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
    ],
  },
  objectives: [
    {
      id: 'excluded',
      text: 'R1: ip dhcp excluded-address 192.168.1.1 192.168.1.10',
      check: (state) =>
        state.R1?.dhcpExcluded.some(
          (r) => r.start === '192.168.1.1' && r.end === '192.168.1.10',
        ) ?? false,
    },
    {
      id: 'pool-network',
      text: 'R1: ip dhcp pool LAN - network 192.168.1.0 255.255.255.0',
      check: (state) => {
        const pool = state.R1?.dhcpPools.get('LAN');
        return pool?.network === '192.168.1.0' && pool?.mask === '255.255.255.0';
      },
    },
    {
      id: 'default-router',
      text: 'R1 (pool LAN): default-router 192.168.1.1',
      check: (state) =>
        state.R1?.dhcpPools.get('LAN')?.defaultRouter === '192.168.1.1',
    },
    {
      id: 'dns-server',
      text: 'R1 (pool LAN): dns-server 8.8.8.8',
      check: (state) =>
        state.R1?.dhcpPools.get('LAN')?.dnsServer === '8.8.8.8',
    },
    {
      id: 'binding',
      text: 'PC-A: receives a DHCP-assigned address in 192.168.1.0/24',
      check: (state) => {
        const binding = state.R1?.dhcpBindings.get('PC-A');
        if (!binding) return false;
        const [a, b, c] = binding.ip.split('.').map(Number);
        return a === 192 && b === 168 && c === 1;
      },
    },
    {
      id: 'verify',
      text: "R1: run show ip dhcp binding and confirm PC-A's lease",
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.lastShowDhcpBinding > 0;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text:
        'Use `ip dhcp excluded-address 192.168.1.1 192.168.1.10` from global config to reserve the first ten addresses.',
    },
    {
      afterSeconds: 150,
      text:
        "Create the pool with `ip dhcp pool LAN`. You'll enter `R1(config-dhcp)#` - set `network`, `default-router`, and `dns-server` there.",
    },
    {
      afterSeconds: 270,
      text:
        'Verify with `show ip dhcp binding`. PC-A should appear with an address starting at 192.168.1.11 - the first slot after the excluded range.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Enter privileged and global config mode:',
        commands: ['enable', 'configure terminal'],
      },
      {
        device: 'R1',
        note: 'Exclude the first 10 addresses (router IP + reserved):',
        commands: ['ip dhcp excluded-address 192.168.1.1 192.168.1.10'],
      },
      {
        device: 'R1',
        note: 'Create the DHCP pool and configure it:',
        commands: [
          'ip dhcp pool LAN',
          ' network 192.168.1.0 255.255.255.0',
          ' default-router 192.168.1.1',
          ' dns-server 8.8.8.8',
          'exit',
        ],
      },
      {
        device: 'R1',
        note: 'Verify the binding:',
        commands: ['end', 'show ip dhcp binding'],
      },
    ],
  },
};
