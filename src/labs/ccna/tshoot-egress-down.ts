import type { Lab } from '@/engine/types';

/**
 * Troubleshooting lab — interface administratively down.
 *
 * Topology: PC-A — R1 — R2 — PC-B, with R1's LAN on Gi0/0 and R1's WAN on
 * Gi0/2 (cabled to R2 Gi0/2). Everything is seeded FULLY working — both
 * routers have their forward and return static routes — and then, as the
 * LAST setup step, R1's WAN interface is administratively shut. The shut
 * interface is the ONE break.
 *
 * This is the failure mode where the port LEDs finally show a physical
 * break: both ends of the R1–R2 link render red (interface admin-down on
 * R1, peer of R2's interface is down). The other four LEDs stay green.
 *
 * Failure sentence: because R1 still has a route to PC-B's subnet but its
 * egress interface is admin-down, the engine returns `egress-down` —
 * "Request timed out — R1 Gi0/2 is administratively down." NOT `no-route`.
 * If reachability comes back any other reason, the seed is wrong (a
 * missing route, an unintentionally cleared IP) — fix the seed, never
 * reword the sentence (LAB_AUTHORING.md §4 rule 2: don't dress one
 * failure mode up as another).
 *
 * Two objectives only: fix (no shutdown) and reachability via lastPing.
 *
 * Catalog id is stable: `ccna-tshoot-egress-down`. Pro-tier (`isFree:
 * false`); served via getLabById once /embed lands. Not in the /try bundle.
 */
export const tshootEgressDown: Lab = {
  id: 'ccna-tshoot-egress-down',
  // Title is deliberately about the SYMPTOM, not the cause. The cold-student
  // audit (work-order Fix 6) found that "interface administratively down"
  // names the diagnosis up front and removes the diagnostic step from the
  // lab. The fix the learner ultimately applies is `no shutdown`, but
  // arriving at that conclusion is the whole point.
  title: 'Troubleshoot: WAN connectivity loss',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 5,
  isFree: false,
  scenario:
    "Trouble ticket: PC-A on 192.168.1.0/24 can't reach PC-B on 192.168.2.0/24. The NOC has confirmed both routers' configurations and routing tables look correct on paper — R1 has a static route to PC-B's subnet, R2 has the return route. Despite that, the round-trip is dead. Something on the wire isn't carrying traffic.\n\nFrom PC-A, run `ping 192.168.2.10` and read the message — the engine names the device and interface that's failing. The R1–R2 link uses 10.0.0.0/30 (R1 Gi0/2 ↔ R2 Gi0/2). Fix the one thing that's wrong. The lab passes when PC-A can ping PC-B end-to-end.",
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
      'ip route 192.168.2.0 255.255.255.0 10.0.0.2',
      // THE BREAK — must be LAST so every other piece of state is correct.
      // Shutting Gi0/2 after the route is already installed means the route
      // is still in R1's table; its egress interface just isn't up. That is
      // the engine's exact definition of egress-down (reachability.ts §4) —
      // it's the only way to produce that FailReason cleanly.
      'interface gi0/2',
      'shutdown',
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
      'ip route 192.168.1.0 255.255.255.0 10.0.0.1',
    ],
  },
  objectives: [
    {
      id: 'noshut-r1-wan',
      // Display text describes the OUTCOME, not the command. The check
      // function still looks for R1 Gi0/2 adminUp (the seed has no other
      // way to satisfy the symptom), so the grading is identical — only
      // the learner-facing wording moves away from spoiling the fix.
      text: 'Restore WAN connectivity between PC-A and PC-B',
      check: (state) => state.R1?.interfaces['Gi0/2'].adminUp === true,
    },
    {
      id: 'reach-pc-a-to-pc-b',
      // Objective label is a clean outcome line — the "how to" (run ping from
      // PC-A) lives in the scenario + hints, not in the objective text. Keeps
      // the panel scannable instead of restating the procedure.
      text: 'Confirm end-to-end reachability from PC-A',
      check: (_state, _history, session) => {
        const pca = session.devices['PC-A'];
        if (pca?.kind !== 'pc') return false;
        return pca.lastPing?.target === '192.168.2.10' && pca.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      // Reveals the diagnostic path WITHOUT naming the device or command —
      // the learner still has to read the show output and decide what to do.
      text: 'Check interface states on each router with `show ip interface brief`',
    },
    {
      afterSeconds: 180,
      text:
        'From PC-A run `ping 192.168.2.10` and read the failure line — it names the router and interface that\'s the problem. Click that router → `enable` → `show ip interface brief` and look at the Status column.',
    },
    {
      afterSeconds: 300,
      text:
        'R1\'s WAN interface is administratively down. Click R1 → `enable`, `configure terminal`, `interface gi0/2`, `no shutdown`. Re-run the ping from PC-A to confirm the round-trip works.',
    },
  ],
};
