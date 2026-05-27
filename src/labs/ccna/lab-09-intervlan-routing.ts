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
 * ports). The router is bare: the learner brings up Gi0/0, creates the two
 * subinterfaces, sets encapsulation + IPs + no shutdown, verifies with
 * show ip interface brief, then proves end-to-end reachability with a ping
 * from PC-A to PC-B.
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
  title: 'Inter-VLAN Routing — Router-on-a-Stick',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 15,
  isFree: false,
  scenario:
    "The Sales team (VLAN 10, 192.168.10.0/24) and the Engineering team (VLAN 20, 192.168.20.0/24) sit on the same switch SW1 but on different VLANs. The two teams need to talk to each other. SW1 is already trunking to R1 on Gi0/0 (allowed VLANs 1,10,20) and the access ports are assigned correctly — but R1 has no IP configuration yet.\n\nYour task: configure router-on-a-stick on R1. Bring up Gi0/0 (no IP — the physical is the trunk carrier), create two subinterfaces Gi0/0.10 and Gi0/0.20, set dot1Q encapsulation matching each VLAN, assign the gateway IPs (192.168.10.1 and 192.168.20.1), `no shutdown` both subifs, verify with `show ip interface brief`, then prove the cross-VLAN path with a ping from PC-A to PC-B.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.10.10', mask: '255.255.255.0', gateway: '192.168.10.1' },
      },
      // SW1: Gi0/0 = trunk to R1, Gi0/1 = access VLAN 10 (PC-A), Gi0/2 = access
      // VLAN 20 (PC-B). Pre-configured by setup; the lesson is on the router.
      {
        id: 'SW1',
        kind: 'switch',
        platform: 'C2960',
        interfaces: ['Gi0/0', 'Gi0/1', 'Gi0/2'],
      },
      // R1: bare. Gi0/0 is the trunk port the learner will configure subifs on;
      // Gi0/1 is unused (kept so the device matches a real ISR with multiple
      // ports — out-of-scope commands targeting Gi0/1 still resolve cleanly).
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
      },
      {
        id: 'PC-B',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.20.10', mask: '255.255.255.0', gateway: '192.168.20.1' },
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
      text: 'Configure Gi0/0.10 with encapsulation dot1q 10',
      check: (state) => state.R1?.subInterfaces['Gi0/0.10']?.dot1qVlan === 10,
    },
    {
      id: 'subif10-ip',
      text: 'Assign 192.168.10.1/24 to Gi0/0.10',
      check: (state) => {
        const sub = state.R1?.subInterfaces['Gi0/0.10'];
        return sub?.ip === '192.168.10.1' && sub?.mask === '255.255.255.0';
      },
    },
    {
      id: 'subif20-encap',
      text: 'Configure Gi0/0.20 with encapsulation dot1q 20',
      check: (state) => state.R1?.subInterfaces['Gi0/0.20']?.dot1qVlan === 20,
    },
    {
      id: 'subif20-ip',
      text: 'Assign 192.168.20.1/24 to Gi0/0.20',
      check: (state) => {
        const sub = state.R1?.subInterfaces['Gi0/0.20'];
        return sub?.ip === '192.168.20.1' && sub?.mask === '255.255.255.0';
      },
    },
    {
      id: 'verify-brief',
      text: 'Verify the subinterfaces are up by running `show ip interface brief` on R1',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        // Engine monotonic-seq comparison: the show must run AFTER both subifs
        // came up (no shutdown). lastShowIpIntBrief defaults to 0; an unset
        // subIfConfiguredAt entry defaults to 0 too — both must be > 0.
        const cfg10 = r1.subIfConfiguredAt['Gi0/0.10'] ?? 0;
        const cfg20 = r1.subIfConfiguredAt['Gi0/0.20'] ?? 0;
        if (cfg10 === 0 || cfg20 === 0) return false;
        return r1.lastShowIpIntBrief > Math.max(cfg10, cfg20);
      },
    },
    {
      id: 'ping-cross-vlan',
      text: 'Confirm cross-VLAN reachability — `ping 192.168.20.10` from PC-A',
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
        '`encapsulation dot1q 10` must come before `ip address` — IOS will reject the IP without it on a real router. Use the dot1Q tag matching the VLAN id.',
    },
    {
      afterSeconds: 300,
      text:
        'After configuring both subinterfaces, run `show ip interface brief` on R1 to confirm both show up/up before testing pings.',
    },
    {
      afterSeconds: 420,
      text:
        "If PC-A can't ping PC-B, check that both Gi0/0.10 and Gi0/0.20 are `no shutdown` — subinterfaces default to shutdown when created.",
    },
  ],
};
