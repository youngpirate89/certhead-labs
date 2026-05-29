import type { Lab } from '@/engine/types';

/**
 * Lab 19 — Troubleshoot OSPF: Hello/Dead Timer Mismatch.
 *
 * Topology: PC-A — R1 — R2 — PC-B (mirrors Labs 05 / 13 / 17 / 18). Both
 * routers run OSPF process 1 in area 0 with correct `network` statements and
 * all interfaces up — but R2's WAN interface (Gi0/2) was configured with a
 * non-default `ip ospf hello-interval 5` / `dead-interval 20`, while R1's side
 * is at the protocol defaults (hello 10 / dead 40). OSPF requires the hello and
 * dead intervals to match on both ends of a link; the engine compares the
 * effective values in recomputeOspf and suppresses neighbor formation on a
 * mismatch (RFC 2328 §10.5 — hellos with disagreeing timers are dropped). So
 * the R1↔R2 adjacency never forms, routes don't propagate, and PC-A can't
 * reach PC-B.
 *
 * This is the third OSPF troubleshooting lab. Where Lab 13 is an area mismatch
 * and Lab 18 a misplaced passive-interface, this one trains the learner to
 * reach for `show ip ospf interface` — the only show command that surfaces the
 * per-interface Hello/Dead timers — and to recognize that they must agree on
 * both ends. Diagnosis flow:
 *   1. `show ip ospf neighbor` on R1 — empty table (no FULL entries).
 *   2. `show ip ospf interface Gi0/2` on R1 (Hello 10, Dead 40) and R2
 *      (Hello 5, Dead 20) — the mismatch is in the `Timer intervals
 *      configured` line.
 *   3. Fix R2's Gi0/2 to match R1 — either set the values explicitly
 *      (`ip ospf hello-interval 10` / `dead-interval 40`) or reset to default
 *      (`no ip ospf hello-interval` / `no ip ospf dead-interval`). The
 *      adjacency re-forms (the per-command refresh re-runs recomputeOspf),
 *      routes propagate, and the ping succeeds.
 *
 * Five objectives:
 *   1. `diagnose`       — learner ran `show ip ospf interface` on R1 or R2
 *      (the command that reveals the timers; matches `resolved`, so any
 *      abbreviation or the per-interface form counts).
 *   2. `fix-hello`      — R2 Gi0/2's EFFECTIVE hello interval is back to 10.
 *      Reading the effective value (override ?? default) accepts both
 *      remediation paths: explicit `hello-interval 10` and `no hello-interval`.
 *   3. `fix-dead`       — R2 Gi0/2's effective dead interval is back to 40.
 *   4. `adjacency-full` — R1 sees R2 FULL. The engine only writes FULL when the
 *      timers (and area, and passive state) agree, so this confirms the fix at
 *      the protocol level.
 *   5. `reachable`      — PC-A's lastPing to 192.168.2.10 succeeded end-to-end.
 *
 * Engine deltas (introduced alongside this lab):
 *   - InterfaceState gains `ospfHelloInterval` / `ospfDeadInterval` overrides
 *     (unset = OSPF_DEFAULT_HELLO_INTERVAL / _DEAD_INTERVAL = 10 / 40).
 *   - `[no] ip ospf hello-interval <1-65535>` / `dead-interval <1-65535>` in
 *     config-if.
 *   - recomputeOspf compares the effective hello/dead on both ends and skips
 *     neighbor formation on a mismatch.
 *   - `show ip ospf interface [<iface>]` renders the per-interface block with
 *     the `Timer intervals configured` line; `show running-config` emits the
 *     `ip ospf hello-interval` / `dead-interval` lines when non-default.
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once /embed lands.
 */
export const lab19OspfTshootHelloTimers: Lab = {
  id: 'ccna-lab19-ospf-tshoot-hello-timers',
  title: 'Troubleshoot OSPF: Hello/Dead Timer Mismatch',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    "Trouble ticket: PC-A on 192.168.1.0/24 can't reach PC-B on 192.168.2.0/24. Both routers run OSPF process 1 in area 0, the addressing is correct, and every interface is up - but the routers won't become neighbors.\n\nFrom PC-A, run `ping 192.168.2.10` to confirm the break. Then click into R1 and run `show ip ospf neighbor` - the table is empty. The areas match and nothing is passive, so look closer: `show ip ospf interface GigabitEthernet0/2` prints the Hello and Dead timers for that link. Compare R1's values to R2's. OSPF won't form an adjacency unless the timers agree on both ends. Align them, confirm the neighbor reaches FULL, and verify end-to-end reachability.",
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
    // R1: interfaces + OSPF area 0 — fully correct. Gi0/2 keeps the default
    // OSPF timers (hello 10 / dead 40).
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
    // R2: correctly addressed and advertised in area 0, but the WAN link (Gi0/2)
    // carries non-default OSPF timers — hello 5 / dead 20. R1's side is at the
    // defaults (10 / 40), so the timers disagree and adjacency never forms.
    // This is the seeded fault.
    R2: [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'ip address 10.0.0.2 255.255.255.252',
      'ip ospf hello-interval 5',
      'ip ospf dead-interval 20',
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
      text: 'Run show ip ospf interface on R1 or R2 to compare the Hello/Dead timers',
      check: (_state, history) => {
        const ran = (cmds?: readonly string[]) =>
          cmds?.some((cmd) => /^(do\s+)?show ip ospf interface\b/.test(cmd)) ?? false;
        return ran(history.R1?.resolved) || ran(history.R2?.resolved);
      },
    },
    {
      id: 'fix-hello',
      text: 'R2 Gi0/2: restore the hello interval to 10 (matching R1)',
      check: (_state, _history, session) => {
        const r2 = session.devices.R2;
        if (r2?.kind !== 'router') return false;
        // Effective value = override ?? default(10). Accepts both the explicit
        // `ip ospf hello-interval 10` fix and `no ip ospf hello-interval`.
        return (r2.device.interfaces['Gi0/2']?.ospfHelloInterval ?? 10) === 10;
      },
    },
    {
      id: 'fix-dead',
      text: 'R2 Gi0/2: restore the dead interval to 40 (matching R1)',
      check: (_state, _history, session) => {
        const r2 = session.devices.R2;
        if (r2?.kind !== 'router') return false;
        return (r2.device.interfaces['Gi0/2']?.ospfDeadInterval ?? 40) === 40;
      },
    },
    {
      id: 'adjacency-full',
      text: 'R1↔R2 OSPF adjacency on the WAN link reaches FULL',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
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
        'Start on R1 with `show ip ospf neighbor` - the table is empty, so adjacency never formed. The areas match and nothing is passive here, so the cause is something else on the link.',
    },
    {
      afterSeconds: 120,
      text:
        'Run `show ip ospf interface GigabitEthernet0/2` on R1, then the same on R2. Read the `Timer intervals configured` line - R1 shows Hello 10 / Dead 40, R2 shows Hello 5 / Dead 20. OSPF requires both timers to match on each end of the link.',
    },
    {
      afterSeconds: 240,
      text:
        'On R2: `interface GigabitEthernet0/2`, then `ip ospf hello-interval 10` and `ip ospf dead-interval 40` (or `no ip ospf hello-interval` / `no ip ospf dead-interval` to reset to default). Re-check `show ip ospf neighbor`, then ping from PC-A.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: "Diagnose - neighbor table is empty; note R1's Gi0/2 timers (Hello 10, Dead 40):",
        commands: ['enable', 'show ip ospf neighbor', 'show ip ospf interface GigabitEthernet0/2'],
      },
      {
        device: 'R2',
        note: 'R2 Gi0/2 shows Hello 5 / Dead 20 - the mismatch that blocks adjacency:',
        commands: ['enable', 'show ip ospf interface GigabitEthernet0/2'],
      },
      {
        device: 'R2',
        note: 'Fix - align R2 Gi0/2 to the defaults R1 is using:',
        commands: [
          'configure terminal',
          'interface GigabitEthernet0/2',
          'ip ospf hello-interval 10',
          'ip ospf dead-interval 40',
          'end',
        ],
      },
      {
        device: 'R1',
        note: 'Verify the adjacency comes up FULL:',
        commands: ['show ip ospf neighbor'],
      },
      {
        device: 'PC-A',
        note: 'Confirm end-to-end reachability:',
        commands: ['ping 192.168.2.10'],
      },
    ],
  },
};
