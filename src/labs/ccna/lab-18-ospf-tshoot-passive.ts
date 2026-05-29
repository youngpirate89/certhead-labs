import type { Lab } from '@/engine/types';

/**
 * Lab 18 — Troubleshoot OSPF: Passive-Interface on the Transit Link.
 *
 * Topology: PC-A — R1 — R2 — PC-B (mirrors Labs 05 / 13 / 17). Both routers
 * run OSPF process 1 in area 0 with correct `network` statements and all
 * interfaces up — but R1 was misconfigured with `passive-interface` on Gi0/2,
 * the WAN link to R2. Passive suppresses hellos on that segment (engine:
 * recomputeOspf skips neighbor formation when either endpoint is passive), so
 * the R1↔R2 adjacency never forms, the LAN prefixes never propagate, and
 * PC-A can't reach PC-B.
 *
 * This is the troubleshooting counterpart to Lab 17 (where passive-interface
 * is the correct tool, applied to the LAN). The misconfiguration here embodies
 * the exact misconception Lab 17 guards against: passive belongs on stub/LAN
 * segments, NOT on transit links between routers. Diagnosis flow:
 *   1. `show ip ospf neighbor` on R1 — empty table (no FULL entries).
 *   2. `show ip ospf` on R1 — the `Passive Interface(s):` block lists Gi0/2,
 *      the very link that needs hellos to peer with R2.
 *   3. Fix R1: `no passive-interface Gi0/2` restores hellos and the adjacency
 *      re-forms (the per-command refresh re-runs recomputeOspf). Then move the
 *      mark to where it belongs — `passive-interface Gi0/0` on the LAN.
 *
 * Four objectives:
 *   1. `diagnose`        — learner ran `show ip ospf` on R1 (the command that
 *      surfaces the passive interface list; matches `resolved` so any
 *      abbreviation counts). `show ip ospf neighbor` shows the symptom; only
 *      `show ip ospf` shows the cause, so the gate requires the latter.
 *   2. `correct-passive` — R1 Gi0/0 (LAN) is now in R1's OSPF passive set.
 *      The remediation: passive moved to the segment where it's appropriate.
 *   3. `adjacency-full`  — R1 sees R2 FULL. The engine only writes FULL when
 *      neither endpoint of the link is passive, so this IS the verification
 *      that the WAN mark was removed — no need to re-assert it separately.
 *   4. `reachable`       — PC-A's lastPing to 192.168.2.10 succeeded (routes
 *      propagated end-to-end). Same lastPing pattern as Lab 13.
 *
 * Engine deltas: NONE. Reuses the passive-interface grammar, passive set, and
 * neighbor-suppression introduced for Lab 17 — only the `no` (removal) path
 * and the cross-device re-form on refresh are newly exercised at the lab level.
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once /embed lands.
 */
export const lab18OspfTshootPassive: Lab = {
  id: 'ccna-lab18-ospf-tshoot-passive',
  title: 'Troubleshoot OSPF: Passive-Interface on the Transit Link',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    "Trouble ticket: PC-A on 192.168.1.0/24 can't reach PC-B on 192.168.2.0/24. Both routers run OSPF process 1 in area 0, the addressing checks out, and every interface is up - but no routes are crossing between the routers.\n\nFrom PC-A, run `ping 192.168.2.10` to confirm the break. Then click into R1 and inspect OSPF: `show ip ospf neighbor` shows an empty table (no adjacency), and `show ip ospf` lists which interfaces are passive. Passive-interface is the right tool for a LAN segment with no other routers - but someone applied it to the wrong port. Move it to where it belongs, confirm the R1↔R2 adjacency comes up FULL, and verify end-to-end reachability.",
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
    // R1: interfaces + OSPF area 0 — correctly addressed and advertised, but
    // the WAN link to R2 (Gi0/2) is mistakenly marked passive. Passive
    // suppresses hellos on that segment, so the adjacency never forms and the
    // LAN prefixes never reach R2. This is the seeded fault.
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
      'passive-interface GigabitEthernet0/2',
      'exit',
    ],
    // R2: interfaces + OSPF area 0 — fully correct. R2's WAN side is hello-
    // active; it's R1's passive mark that breaks the pairing.
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
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.2.0 0.0.0.255 area 0',
      'exit',
    ],
  },
  objectives: [
    {
      id: 'diagnose',
      text: 'R1: run show ip ospf to find which interface is passive',
      check: (_state, history) =>
        history.R1?.resolved.some((cmd) => /^(do\s+)?show ip ospf$/.test(cmd)) ?? false,
    },
    {
      id: 'correct-passive',
      text: 'R1: move passive-interface to Gi0/0 (the LAN), where it belongs',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.device.ospf.passive.has('Gi0/0');
      },
    },
    {
      id: 'adjacency-full',
      text: 'R1↔R2 OSPF adjacency on the WAN link reaches FULL',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        // The engine only forms FULL when neither endpoint of the link is
        // passive — a FULL neighbor here IS proof the Gi0/2 mark was removed.
        return Array.from(r1.device.ospf.neighbors.values()).some((n) => n.state === 'FULL');
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
        'Start on R1 with `show ip ospf neighbor` - an empty table (header only, no FULL entries) means the R1↔R2 adjacency never formed even though both routers are configured for OSPF.',
    },
    {
      afterSeconds: 120,
      text:
        "Run `show ip ospf` on R1 and read the `Passive Interface(s):` block. Passive turns off hellos on an interface - fine for a LAN with no other routers, fatal on the link to R2. One of the listed interfaces is the WAN link (Gi0/2). That's the bug.",
    },
    {
      afterSeconds: 240,
      text:
        'Under `router ospf 1` on R1: `no passive-interface GigabitEthernet0/2` to bring hellos back on the WAN, then `passive-interface GigabitEthernet0/0` to quiet the LAN where passive actually belongs. Re-run `show ip ospf neighbor`, then ping from PC-A.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: "Diagnose - the neighbor table is empty, and show ip ospf lists Gi0/2 (the WAN link to R2) as passive:",
        commands: ['enable', 'show ip ospf neighbor', 'show ip ospf'],
      },
      {
        device: 'R1',
        note: 'Fix - remove passive from the transit link and apply it to the LAN instead:',
        commands: [
          'configure terminal',
          'router ospf 1',
          'no passive-interface GigabitEthernet0/2',
          'passive-interface GigabitEthernet0/0',
          'end',
        ],
      },
      {
        device: 'R1',
        note: 'Verify - R2 now shows FULL, and Gi0/0 is the passive interface:',
        commands: ['show ip ospf neighbor', 'show ip ospf'],
      },
      {
        device: 'PC-A',
        note: 'Confirm end-to-end reachability:',
        commands: ['ping 192.168.2.10'],
      },
    ],
  },
};
