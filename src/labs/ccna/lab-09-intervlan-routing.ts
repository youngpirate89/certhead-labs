import type { Lab } from '@/engine/types';

/**
 * Lab 9 — Inter-VLAN Routing (Router-on-a-Stick).
 *
 * RULE: One VLAN = one subnet. PC-A on VLAN 10 sits on 192.168.10.0/24;
 * PC-B on VLAN 20 sits on 192.168.20.0/24. Inter-VLAN routing happens on R1
 * via dot1Q subinterfaces of a single trunk-attached physical: Gi0/0.10
 * carries VLAN 10 with IP 192.168.10.1; Gi0/0.20 carries VLAN 20 with IP
 * 192.168.20.1. The physical Gi0/0 itself has no IP — it is the trunk
 * carrying both VLANs.
 *
 * Topology:
 *
 *   R1 Gi0/0 ─── SW1 Gi0/0 (trunk, allowed 1,10,20)
 *                  ├── Gi0/1 (access VLAN 10) ─── PC-A 192.168.10.10
 *                  └── Gi0/2 (access VLAN 20) ─── PC-B 192.168.20.10
 *
 *   R1 Gi0/0.10 → 192.168.10.1 / encapsulation dot1Q 10
 *   R1 Gi0/0.20 → 192.168.20.1 / encapsulation dot1Q 20
 *
 * The switch is pre-configured (Lab 07/08 territory — VLANs, trunk, access
 * ports). The router is bare: the learner brings up the physical Gi0/0, creates
 * the two subinterfaces, sets encapsulation + IPs (the subifs come up off the
 * parent — no per-subif no shutdown), verifies with show ip interface brief,
 * then proves end-to-end reachability with a ping from PC-A to PC-B.
 *
 * Six objectives (in completion order):
 *   1. `subif10-encap`     — Gi0/0.10 has encapsulation dot1q 10.
 *   2. `subif10-ip`        — Gi0/0.10 has IP 192.168.10.1/24.
 *   3. `subif20-encap`     — Gi0/0.20 has encapsulation dot1q 20.
 *   4. `subif20-ip`        — Gi0/0.20 has IP 192.168.20.1/24.
 *   5. `verify-brief`      — `show ip interface brief` ran AFTER both subifs
 *      came up (mirrors Lab 08's lastShowInterfacesTrunk pattern — forces an
 *      observe-after-configure step).
 *   6. `ping-cross-vlan`   — PC-A's lastPing to 192.168.20.10 succeeded.
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once /embed lands.
 */
export const lab09IntervlanRouting: Lab = {
  id: 'ccna-lab09-intervlan-routing',
  title: 'Inter-VLAN Routing - Router-on-a-Stick',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 15,
  isFree: false,
  scenario:
    "The Sales team (VLAN 10, 192.168.10.0/24) and the Engineering team (VLAN 20, 192.168.20.0/24) sit on the same switch SW1 but on different VLANs. The two teams need to talk to each other. SW1 is already trunking to R1 on Gi0/0 (allowed VLANs 1,10,20) and the access ports are assigned correctly - but R1 has no IP configuration yet.\n\nYour task: configure router-on-a-stick on R1. Bring up Gi0/0 (no IP - the physical is the trunk carrier), create two subinterfaces Gi0/0.10 and Gi0/0.20, set dot1Q encapsulation matching each VLAN, assign the gateway IPs (192.168.10.1 and 192.168.20.1) - the subinterfaces come up off the physical, so you don't `no shutdown` them individually - verify with `show ip interface brief`, then prove the cross-VLAN path with a ping from PC-A to PC-B.",
  topology: {
    // T-shape layout (per-device `position` overrides the renderer's default
    // linear left-to-right row). SW1 is the L2 hub at center; R1 stacks above
    // it (the trunk), with PC-A and PC-B fanning out below. This is the only
    // arrangement that keeps SW1's three spokes from crossing through another
    // node — see TopologyPanel's `computePositions` for the convention.
    //
    //          R1   ← (320, 0)
    //          |
    //         SW1   ← (320, 240) — bottom-center port to R1 (top)
    //        /   \
    //    PC-A    PC-B   ← y = 480
    //   (0,480)  (640,480)
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.10.10', mask: '255.255.255.0', gateway: '192.168.10.1' },
        position: { x: 0, y: 480 },
      },
      // SW1: Gi0/0 = trunk to R1, Gi0/1 = access VLAN 10 (PC-A), Gi0/2 = access
      // VLAN 20 (PC-B). Pre-configured by setup; the lesson is on the router.
      {
        id: 'SW1',
        kind: 'switch',
        platform: 'C2960',
        interfaces: ['Gi0/0', 'Gi0/1', 'Gi0/2'],
        position: { x: 320, y: 240 },
      },
      // R1: bare. Only Gi0/0 (the trunk port the learner configures subifs on)
      // is declared — other labs follow the same convention of declaring only
      // cabled interfaces so the topology renderer doesn't draw floating port
      // dots for unconnected ports.
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0'],
        position: { x: 320, y: 0 },
      },
      {
        id: 'PC-B',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.20.10', mask: '255.255.255.0', gateway: '192.168.20.1' },
        position: { x: 640, y: 480 },
      },
    ],
    links: [
      // R1 Gi0/0 — SW1 Gi0/0 (the trunk carrying both VLANs)
      { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'SW1', iface: 'Gi0/0' } },
      // SW1 Gi0/1 — PC-A (access VLAN 10)
      { a: { deviceId: 'SW1', iface: 'Gi0/1' }, b: { deviceId: 'PC-A', iface: 'Eth0' } },
      // SW1 Gi0/2 — PC-B (access VLAN 20)
      { a: { deviceId: 'SW1', iface: 'Gi0/2' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
    ],
  },
  setup: {
    // SW1: VLANs 10/20 + trunk on Gi0/0 with allowed list + access ports for
    // each PC. This is Lab 07/08 territory already; the learner's focus here
    // is on the router subifs.
    SW1: [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'vlan 20',
      'name Engineering',
      'exit',
      'interface gi0/0',
      'switchport mode trunk',
      'switchport trunk allowed vlan 1,10,20',
      'exit',
      'interface gi0/1',
      'switchport mode access',
      'switchport access vlan 10',
      'exit',
      'interface gi0/2',
      'switchport mode access',
      'switchport access vlan 20',
    ],
  },
  objectives: [
    {
      id: 'subif10-encap',
      text: 'R1 Gi0/0.10: set encapsulation dot1q 10',
      check: (state) => state.R1?.subInterfaces['Gi0/0.10']?.dot1qVlan === 10,
    },
    {
      id: 'subif10-ip',
      text: 'R1 Gi0/0.10: assign ip address 192.168.10.1 255.255.255.0',
      check: (state) => {
        const sub = state.R1?.subInterfaces['Gi0/0.10'];
        return sub?.ip === '192.168.10.1' && sub?.mask === '255.255.255.0';
      },
    },
    {
      id: 'subif20-encap',
      text: 'R1 Gi0/0.20: set encapsulation dot1q 20',
      check: (state) => state.R1?.subInterfaces['Gi0/0.20']?.dot1qVlan === 20,
    },
    {
      id: 'subif20-ip',
      text: 'R1 Gi0/0.20: assign ip address 192.168.20.1 255.255.255.0',
      check: (state) => {
        const sub = state.R1?.subInterfaces['Gi0/0.20'];
        return sub?.ip === '192.168.20.1' && sub?.mask === '255.255.255.0';
      },
    },
    {
      id: 'verify-brief',
      text: 'R1: run show ip interface brief and confirm both subinterfaces are up/up',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        // Engine monotonic-seq comparison: the show must run AFTER both subifs
        // were configured (subIfConfiguredAt is stamped on the encap/ip config
        // actions). lastShowIpIntBrief defaults to 0; an unset subIfConfiguredAt
        // entry defaults to 0 too — both must be > 0.
        const cfg10 = r1.subIfConfiguredAt['Gi0/0.10'] ?? 0;
        const cfg20 = r1.subIfConfiguredAt['Gi0/0.20'] ?? 0;
        if (cfg10 === 0 || cfg20 === 0) return false;
        return r1.lastShowIpIntBrief > Math.max(cfg10, cfg20);
      },
    },
    {
      id: 'ping-cross-vlan',
      text: 'PC-A: ping 192.168.20.10 succeeds (routed across VLANs at R1)',
      check: (_state, _history, session) => {
        const pca = session.devices['PC-A'];
        if (pca?.kind !== 'pc') return false;
        return pca.lastPing?.target === '192.168.20.10' && pca.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      text:
        'On R1, enter `interface gi0/0.10` to create a subinterface. The `.10` maps this subif to VLAN 10.',
    },
    {
      afterSeconds: 180,
      text:
        '`encapsulation dot1q 10` is what makes the subinterface forward and emit its connected route - set it with the dot1Q tag matching the VLAN id. (The order relative to `ip address` is not enforced.)',
    },
    {
      afterSeconds: 300,
      text:
        'After configuring both subinterfaces, run `show ip interface brief` on R1 to confirm both show up/up before testing pings.',
    },
    {
      afterSeconds: 420,
      text:
        "If PC-A cannot ping PC-B, confirm the physical Gi0/0 has 'no shutdown' - subinterfaces follow the parent's line state, so you don't 'no shutdown' Gi0/0.10 / Gi0/0.20 individually. Also check each subif's encapsulation and IP.",
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Bring up the physical trunk-facing interface (no IP - the L3 lives on the subifs):',
        commands: [
          'enable',
          'configure terminal',
          'interface Gi0/0',
          'no shutdown',
          'exit',
        ],
      },
      {
        device: 'R1',
        note: 'Configure the VLAN 10 subinterface (it comes up off the physical - no per-subif no shutdown needed):',
        commands: [
          'interface Gi0/0.10',
          'encapsulation dot1q 10',
          'ip address 192.168.10.1 255.255.255.0',
          'exit',
        ],
      },
      {
        device: 'R1',
        note: 'Configure the VLAN 20 subinterface and verify:',
        commands: [
          'interface Gi0/0.20',
          'encapsulation dot1q 20',
          'ip address 192.168.20.1 255.255.255.0',
          'end',
          'show ip interface brief',
        ],
      },
      {
        device: 'PC-A',
        note: 'Confirm cross-VLAN reachability:',
        commands: ['ping 192.168.20.10'],
      },
    ],
  },
};
