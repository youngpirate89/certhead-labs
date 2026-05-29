import type { Lab } from '@/engine/types';

/**
 * Lab 13 — Troubleshoot OSPF: Mismatched Area.
 *
 * Topology: PC-A — R1 — R2 — PC-B (mirrors Lab 05). All interfaces are
 * seeded admin-up with their addresses, and both routers run OSPF process 1
 * — but R2's `network` statements use area 1, while R1 uses area 0. The
 * engine enforces area match in adjacency formation (ospf.ts: aMatch.area
 * !== bMatch.area → skip), so the routers never form a FULL neighbor and
 * PC-A's ping to PC-B fails (R2 has no OSPF-learned route back to
 * 192.168.1.0/24).
 *
 * The lab is the first OSPF troubleshooting scenario in the catalog and
 * pairs directly with Lab 05 (configure OSPF). Diagnosis flow:
 *   1. `show ip ospf neighbor` on R1 — empty header row (no FULL entries).
 *   2. `show ip ospf` on both routers — R2's network area is 1; R1's is 0.
 *   3. Fix R2: `no network ... area 1` then `network ... area 0` for each
 *      statement. Adjacency forms, routes propagate, ping succeeds.
 *
 * Two objectives:
 *   1. `adjacency`  — both routers' OSPF tables show at least one FULL
 *      neighbor entry. The engine only writes FULL when areas match on the
 *      shared link, so this check IS the area-match verification — no
 *      hand-rolled re-implementation of the engine rule in the objective.
 *   2. `reachable`  — PC-A's lastPing to 192.168.2.10 succeeded. Same
 *      lastPing pattern as the other tshoot labs / Lab 05's reachability.
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once /embed
 * lands, and via `?pilot=ccna-lab13-ospf-tshoot` for dev runs.
 */
export const lab13OspfTshoot: Lab = {
  id: 'ccna-lab13-ospf-tshoot',
  title: 'Troubleshoot OSPF: Mismatched Area',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    "Trouble ticket: PC-A on 192.168.1.0/24 can't reach PC-B on 192.168.2.0/24. The NOC tells you both routers were brought up with OSPF process 1, but no routes are propagating between them.\n\nFrom PC-A, run `ping 192.168.2.10` to confirm the break. Then click into each router and inspect the OSPF state - `show ip ospf neighbor` will tell you whether adjacency formed, and `show ip ospf` will show what area each router thinks it's in. The network was meant to be single-area (area 0) throughout. Fix the misconfiguration and confirm end-to-end reachability.",
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
    // R1: interfaces + OSPF area 0 — correctly configured.
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
      'router ospf 1',
      'network 192.168.1.0 0.0.0.255 area 0',
      'network 10.0.0.0 0.0.0.3 area 0',
      'exit',
    ],
    // R2: interfaces + OSPF area 1 — the bug. Areas must match for adjacency
    // to form; the engine never advances state past INIT here, so the
    // neighbor table on R1 stays empty and routes don't propagate.
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
      'network 10.0.0.0 0.0.0.3 area 1',
      'network 192.168.2.0 0.0.0.255 area 1',
      'exit',
    ],
  },
  objectives: [
    {
      id: 'adjacency',
      text: 'Restore OSPF adjacency - R1 and R2 must reach FULL neighbor state',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        const r2 = session.devices.R2;
        if (r1?.kind !== 'router' || r2?.kind !== 'router') return false;
        // Engine enforces area-match for FULL: this is the canonical
        // adjacency check — no need to re-implement the wildcard/area
        // comparison in the objective.
        const r1Full = Array.from(r1.device.ospf.neighbors.values()).some(
          (n) => n.state === 'FULL',
        );
        const r2Full = Array.from(r2.device.ospf.neighbors.values()).some(
          (n) => n.state === 'FULL',
        );
        return r1Full && r2Full;
      },
    },
    {
      id: 'reachable',
      text: 'PC-A: ping 192.168.2.10 succeeds',
      check: (_state, _history, session) => {
        const pca = session.devices['PC-A'];
        if (pca?.kind !== 'pc') return false;
        return pca.lastPing?.target === '192.168.2.10' && pca.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 45,
      text:
        'Start with `show ip ospf neighbor` on R1 - an empty table (header row only, no FULL entries) means adjacency never formed. Try the same command on R2; it will also be empty.',
    },
    {
      afterSeconds: 120,
      text:
        "Run `show ip ospf` on both routers. Look at the area each router has on the shared WAN link (`10.0.0.0/30`) - OSPF requires the area to match on both sides for adjacency to form. One of the routers is wrong.",
    },
    {
      afterSeconds: 240,
      text:
        "Fix R2's area by removing the wrong-area statements and re-adding in area 0: `router ospf 1`, then `no network 10.0.0.0 0.0.0.3 area 1` followed by `network 10.0.0.0 0.0.0.3 area 0`. Do the same for the 192.168.2.0/24 statement. Then re-run `show ip ospf neighbor` and ping from PC-A.",
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: "Diagnose - confirm R1's neighbor table is empty and that R1 is in area 0:",
        commands: ['enable', 'show ip ospf neighbor', 'show ip ospf'],
      },
      {
        device: 'R2',
        note: 'Diagnose - R2 is in area 1 on the WAN side; should be area 0:',
        commands: ['enable', 'show ip ospf neighbor', 'show ip ospf'],
      },
      {
        device: 'R2',
        note: "Fix - replace R2's network statements with area 0 equivalents:",
        commands: [
          'configure terminal',
          'router ospf 1',
          'no network 10.0.0.0 0.0.0.3 area 1',
          'network 10.0.0.0 0.0.0.3 area 0',
          'no network 192.168.2.0 0.0.0.255 area 1',
          'network 192.168.2.0 0.0.0.255 area 0',
          'end',
        ],
      },
      {
        device: 'R2',
        note: 'Verify adjacency formed and routes appeared:',
        commands: ['show ip ospf neighbor', 'show ip route'],
      },
      {
        device: 'PC-A',
        note: 'Confirm end-to-end reachability:',
        commands: ['ping 192.168.2.10'],
      },
    ],
  },
};
