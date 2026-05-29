import type { Lab } from '@/engine/types';

/**
 * Lab 17 — OSPF passive-interface: suppress hellos on LAN segments.
 *
 * Topology: PC-A — R1 — R2 — PC-B (same shape as Lab 05). OSPF area 0 is
 * pre-configured on both routers — interfaces are up, network statements
 * are in place, and the WAN adjacency is FULL on entry. The learner's job
 * is to add `passive-interface` on each router's LAN-facing interface so
 * hellos stop flowing onto the user segments, while the WAN adjacency stays
 * intact and the LAN prefixes remain advertised.
 *
 * Three objectives:
 *   1. `r1-passive`         — R1 Gi0/0 (LAN-facing) is in R1's OSPF passive set
 *   2. `r2-passive`         — R2 Gi0/0 (LAN-facing) is in R2's OSPF passive set
 *   3. `adjacency-intact`   — R1 still sees R2 FULL after the passive marks
 *      (the WAN iface stays hello-active because it isn't in either set)
 *   4. `verify-passive`     — learner ran `show ip ospf` on R1 to confirm
 *      the passive interface block appears
 *
 * Engine deltas this lab exercises (introduced alongside it):
 *   - `passive-interface <iface>` grammar in config-router (positive + `no`)
 *   - OspfState gains a `passive: Set<string>` of canonical iface ids
 *   - recomputeOspf skips neighbor formation when either endpoint is passive,
 *     while leaving the route advertisement path untouched (matches IOS)
 *   - `show ip ospf` appends a `Passive Interface(s):` section
 *   - `show running-config` emits the `router ospf <pid>` block with
 *     network + passive-interface lines (Lab 17 + first OSPF block in
 *     running-config; nothing else relied on its presence yet)
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once /embed lands.
 */
export const lab17OspfPassiveInterface: Lab = {
  id: 'ccna-lab17-ospf-passive-interface',
  title: 'OSPF Passive-Interface: Suppress Hellos on Stub Segments',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    "Both branch and HQ routers are running OSPF area 0 across the WAN, and routes are flowing - PC-A can reach PC-B. But OSPF is also sending hellos onto the two LAN segments where no other router lives, just user workstations. That's noise the access ports don't need, and on a real network it's a small but pointless source of broadcast traffic plus a (tiny) attack surface for anyone who can speak OSPF on the LAN.\n\nThe fix is `passive-interface`. Marking each LAN-facing port passive under `router ospf 1` tells OSPF to keep advertising the LAN prefix but stop sending or receiving hellos on it. Your job: tag R1's Gi0/0 and R2's Gi0/0 as passive. The R1↔R2 adjacency over Gi0/2 should remain FULL, and `show ip ospf` should list both LAN interfaces under the passive block.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
      },
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/2'] },
      { id: 'R2', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/2'] },
      {
        id: 'PC-B',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.2.10', mask: '255.255.255.0', gateway: '192.168.2.1' },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/2' }, b: { deviceId: 'R2', iface: 'Gi0/2' } },
      { a: { deviceId: 'R2', iface: 'Gi0/0' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface gi0/2',
      'ip address 10.0.0.1 255.255.255.252',
      'no shutdown',
      'exit',
      // OSPF pre-configured — both LAN and WAN networks advertised in area 0.
      // The LabSession's refreshOspf pass forms the FULL adjacency once R2's
      // setup completes; the learner walks in to a working area 0 and only
      // has to add passive-interface on the LAN.
      'router ospf 1',
      'network 192.168.1.0 0.0.0.255 area 0',
      'network 10.0.0.0 0.0.0.3 area 0',
      'exit',
    ],
    R2: [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'ip address 10.0.0.2 255.255.255.252',
      'no shutdown',
      'exit',
      'interface gi0/0',
      'ip address 192.168.2.1 255.255.255.0',
      'no shutdown',
      'exit',
      'router ospf 1',
      'network 192.168.2.0 0.0.0.255 area 0',
      'network 10.0.0.0 0.0.0.3 area 0',
      'exit',
    ],
  },
  objectives: [
    {
      id: 'r1-passive',
      text: 'R1: mark Gi0/0 (LAN) as passive-interface under router ospf 1',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.device.ospf.passive.has('Gi0/0');
      },
    },
    {
      id: 'r2-passive',
      text: 'R2: mark Gi0/0 (LAN) as passive-interface under router ospf 1',
      check: (_state, _history, session) => {
        const r2 = session.devices.R2;
        if (r2?.kind !== 'router') return false;
        return r2.device.ospf.passive.has('Gi0/0');
      },
    },
    {
      id: 'adjacency-intact',
      text: 'R1↔R2 OSPF adjacency on the WAN link stays FULL',
      // Setup forms the FULL adjacency at init, so a bare "is FULL?" check is
      // already satisfied at lab open. This objective is meant to confirm the
      // adjacency SURVIVES the passive-interface change, so gate it on both LAN
      // ports being passive (objectives 1 + 2) AND the WAN neighbor still being
      // FULL. Un-completable at open because the passive configs aren't applied
      // yet; flips true only once the learner has marked both LANs passive
      // without touching the WAN.
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        const r2 = session.devices.R2;
        if (r1?.kind !== 'router' || r2?.kind !== 'router') return false;
        const r1Passive = r1.device.ospf.passive.has('Gi0/0');
        const r2Passive = r2.device.ospf.passive.has('Gi0/0');
        if (!r1Passive || !r2Passive) return false;
        return Array.from(r1.device.ospf.neighbors.values()).some((n) => n.state === 'FULL');
      },
    },
    {
      id: 'verify-passive',
      text: 'R1: run show ip ospf and confirm Gi0/0 appears under Passive Interface(s)',
      // Gate on a session field stamped at command-eval time (mirrors the VLAN
      // verify objectives' lastShowInterfacesTrunk / the PC lastPing), NOT on
      // command history. The stamp only fires when R1 already has a passive
      // interface, so this requires observe-AFTER-configure: running
      // `show ip ospf` to inspect state before adding passive-interface no
      // longer satisfies it. The old history regex was order-insensitive, so a
      // pre-config inspect run ticked it green from the moment the lab opened.
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.lastShowIpOspf > 0;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'A LAN-facing port shouldn\'t process OSPF hellos - there are no other routers on it. `passive-interface` keeps the prefix advertised but turns hellos off on that interface.',
    },
    {
      afterSeconds: 180,
      text: 'Under `router ospf 1`, run `passive-interface GigabitEthernet0/0` on R1, then mirror on R2. Don\'t touch Gi0/2 - that\'s the WAN link to the peer and needs hellos to stay up.',
    },
    {
      afterSeconds: 300,
      text: 'After both are set, `show ip ospf` on R1 prints a `Passive Interface(s):` block listing Gi0/0. `show ip ospf neighbor` still shows R2 as FULL on Gi0/2 - passive only quiets the LAN, it doesn\'t break the WAN.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Mark R1\'s LAN-facing interface as passive under the OSPF process:',
        commands: [
          'enable',
          'configure terminal',
          'router ospf 1',
          'passive-interface GigabitEthernet0/0',
          'end',
        ],
      },
      {
        device: 'R2',
        note: 'Mirror the same configuration on R2\'s LAN:',
        commands: [
          'enable',
          'configure terminal',
          'router ospf 1',
          'passive-interface GigabitEthernet0/0',
          'end',
        ],
      },
      {
        device: 'R1',
        note: 'Confirm the passive block appears in show ip ospf, and the WAN adjacency stays FULL:',
        commands: ['show ip ospf', 'show ip ospf neighbor'],
      },
    ],
  },
};
