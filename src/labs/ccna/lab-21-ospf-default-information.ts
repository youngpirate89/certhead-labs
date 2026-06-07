import type { Lab } from '@/engine/types';

/**
 * Lab 21 — OSPF: Redistribute a Default Route with default-information originate.
 *
 * Topology: PC-B — R2 — R1 (edge) — INET. R1 is the branch edge router with a
 * pre-seeded static default route toward the ISP (203.0.113.2). R2 is the
 * internal router; PC-B lives behind it. Both routers run OSPF process 1 in
 * area 0 across the 10.0.0.0/30 transit link, and the R1↔R2 adjacency is FULL
 * on entry. The ISP segment (203.0.113.0/30) and the internet host (8.8.8.2,
 * on INET) are deliberately OUTSIDE OSPF — so R2 has no route to anything on
 * the far side of R1 until R1 shares its default.
 *
 * The teaching point: a default route is NOT advertised into OSPF
 * automatically. Even though R1 has `S* 0.0.0.0/0` and R2 is its FULL neighbor,
 * R2's table has no default — PC-B can't reach 8.8.8.2. The fix is one command
 * under `router ospf 1` on R1: `default-information originate`. R1 becomes an
 * ASBR and floods the default as an external Type-2 LSA; R2 installs it as
 * `O*E2 0.0.0.0/0` and end-to-end reachability comes up.
 *
 * Flow:
 *   1. From PC-B, ping 8.8.8.2 — it fails (R2 has no default, confirms the gap).
 *   2. On R1, show ip route — confirm R1 itself has S* 0.0.0.0/0 via the ISP.
 *   3. On R2, show ip route — no default present (the missing piece).
 *   4. On R1, `router ospf 1` then `default-information originate`.
 *   5. On R2, show ip route — now shows O*E2 0.0.0.0/0 via 10.0.0.1. Ping again
 *      from PC-B — it succeeds.
 *
 * Three objectives (config outcome → propagation outcome → end-to-end; each
 * reads the resulting STATE, none can be faked by typing a command):
 *   1. default-info     — R1's OSPF process has default-information originate set.
 *   2. r2-learns-default — R2 installed an OSPF-sourced 0.0.0.0/0 default. This
 *      is the real payload: it only appears once R1 originates AND the
 *      adjacency carries it, so it proves the redistribution worked.
 *   3. ping-internet    — PC-B's lastPing to 8.8.8.2 succeeded end-to-end
 *      (requires the whole chain: O*E2 on R2 → R1 → ISP default → INET).
 *
 * Engine deltas (shipped in the accompanying feat(engine) commit):
 *   - OspfState gains defaultInfoOriginate / defaultInfoAlways.
 *   - config-router grammar: [no] default-information originate [always].
 *   - recomputeOspf injects 0.0.0.0/0 (AD 110, metric 1, ospfExternal) into a
 *     FULL neighbor when the originator has default-information set AND a
 *     default in its RIB (or `always`).
 *   - show ip route renders the O*E2 default + "Gateway of last resort"; show
 *     ip ospf flags the ASBR; show running-config emits the originate line.
 *
 * Pro-tier (isFree: false); reachable through getLabById once /embed lands.
 */
export const lab21OspfDefaultInformation: Lab = {
  id: 'ccna-lab21-ospf-default-information',
  title: 'OSPF: Redistribute a Default Route (default-information originate)',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    "PC-B sits on the internal LAN behind R2 and needs to reach the internet at 8.8.8.2. R1 is the branch edge router: it has a /30 to the ISP and already carries a default static route (`S* 0.0.0.0/0`) pointing upstream. R1 and R2 are OSPF neighbors in area 0 across the transit link, and routes between their LANs flow fine - but R2 still has no way out to the internet. OSPF does NOT redistribute a router's default route to its neighbors on its own.\n\nFrom PC-B, run `ping 8.8.8.2` to confirm the gap. On R2, `show ip route` shows every internal prefix but no default. The fix lives on R1: under `router ospf 1`, add `default-information originate`. That turns R1 into an ASBR and advertises its default into OSPF as an external Type-2 route. Re-check R2 - you'll see `O*E2 0.0.0.0/0` with a gateway of last resort - then ping 8.8.8.2 from PC-B to confirm the path is up end to end.",
  topology: {
    devices: [
      {
        id: 'PC-B',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.2.10', mask: '255.255.255.0', gateway: '192.168.2.1' },
        position: { x: 0, y: 0 },
      },
      {
        id: 'R2',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/2'],
        position: { x: 320, y: 0 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/2'],
        position: { x: 640, y: 0 },
      },
      {
        id: 'INET',
        kind: 'router',
        platform: 'server',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 960, y: 0 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-B', iface: 'Eth0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
      { a: { deviceId: 'R2', iface: 'Gi0/2' }, b: { deviceId: 'R1', iface: 'Gi0/2' } },
      { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'INET', iface: 'Gi0/0' } },
    ],
  },
  setup: {
    // R2 — internal router. LAN toward PC-B + transit toward R1, OSPF area 0 on
    // both. NO default route and NO default-information; R2 walks in with every
    // internal prefix but no way out. (Its default is the thing R1 must share.)
    R2: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.2.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface gi0/2',
      'ip address 10.0.0.2 255.255.255.252',
      'no shutdown',
      'exit',
      'router ospf 1',
      'network 192.168.2.0 0.0.0.255 area 0',
      'network 10.0.0.0 0.0.0.3 area 0',
      'exit',
    ],
    // R1 — edge router. Transit toward R2 (OSPF area 0) + ISP link (NOT in
    // OSPF). It already has the default static route toward the ISP, so the
    // ONLY missing piece is sharing it: `default-information originate` is the
    // learner's job.
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'ip address 10.0.0.1 255.255.255.252',
      'no shutdown',
      'exit',
      'interface gi0/0',
      'ip address 203.0.113.1 255.255.255.252',
      'no shutdown',
      'exit',
      // Pre-seeded default toward the ISP. default-information originate only
      // advertises when this exists in the RIB (no `always` needed).
      'ip route 0.0.0.0 0.0.0.0 203.0.113.2',
      // OSPF runs on the transit link only — the ISP side stays out of OSPF.
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'exit',
    ],
    // INET — the ISP / internet host. Gi0/0 is the ISP /30 toward R1; Gi0/1
    // carries the iconic internet address 8.8.8.2 (the ping target). Its own
    // default points back at R1 so the reply leg returns through the path.
    INET: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 203.0.113.2 255.255.255.252',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'ip address 8.8.8.2 255.255.255.252',
      'no shutdown',
      'exit',
      'ip route 0.0.0.0 0.0.0.0 203.0.113.1',
    ],
  },
  objectives: [
    {
      id: 'default-info',
      text: 'R1: configure default-information originate under router ospf 1',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.device.ospf.defaultInfoOriginate === true;
      },
    },
    {
      id: 'r2-learns-default',
      text: 'R2: learns an OSPF default route (O*E2 0.0.0.0/0) from R1',
      // The real payload — an OSPF-sourced default in R2's table. It only
      // exists once R1 originates AND the FULL adjacency carries it, so this
      // proves the redistribution end-to-end at the protocol level rather than
      // checking that a command was typed. Un-completable at lab open.
      check: (_state, _history, session) => {
        const r2 = session.devices.R2;
        if (r2?.kind !== 'router') return false;
        return r2.ospfRoutes.some(
          (r) => r.prefix === '0.0.0.0' && r.mask === '0.0.0.0' && r.source === 'ospf',
        );
      },
    },
    {
      id: 'ping-internet',
      text: 'PC-B: ping 8.8.8.2 and confirm the reply',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-B'];
        if (pc?.kind !== 'pc') return false;
        return pc.lastPing?.target === '8.8.8.2' && pc.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'R1 already has the default route (`show ip route` on R1 shows `S* 0.0.0.0/0`). The problem is R2 has no default at all - OSPF does not redistribute a default route to neighbors automatically.',
    },
    {
      afterSeconds: 180,
      text: 'On R1, enter `router ospf 1` and run `default-information originate`. This makes R1 advertise its default route to OSPF neighbors as an external Type-2 route.',
    },
    {
      afterSeconds: 300,
      text: 'After configuring, run `show ip route` on R2 - look for `O*E2 0.0.0.0/0 [110/1] via 10.0.0.1`. That is the default learned via OSPF. Then `ping 8.8.8.2` from PC-B.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'PC-B',
        note: 'Confirm the gap - the ping fails because R2 has no route to the internet:',
        commands: ['ping 8.8.8.2'],
      },
      {
        device: 'R2',
        note: 'R2 has every internal prefix but no default route (nothing toward 8.8.8.2):',
        commands: ['enable', 'show ip route'],
      },
      {
        device: 'R1',
        note: 'R1 has S* 0.0.0.0/0 toward the ISP. Tell OSPF to advertise it:',
        commands: [
          'enable',
          'configure terminal',
          'router ospf 1',
          'default-information originate',
          'end',
        ],
      },
      {
        device: 'R2',
        note: 'R2 now installs O*E2 0.0.0.0/0 via 10.0.0.1 - the default learned from R1:',
        commands: ['show ip route'],
      },
      {
        device: 'PC-B',
        note: 'Confirm end-to-end reachability to the internet host:',
        commands: ['ping 8.8.8.2'],
      },
    ],
  },
};
