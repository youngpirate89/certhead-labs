import type { Lab } from '@/engine/types';

/**
 * Lab 16 - Floating Static Route (AD-based backup path).
 *
 * Topology: PC-A -- R1 -- {R2 primary, R3 backup}. R1 sits at the branch with
 * two WAN links to two different upstream routers. The primary path is R2;
 * R3 is a standby that only takes over when the primary is gone. PC-A is in
 * the topology for visual coherence; this lab grades routing-table state, not
 * end-to-end ping (failover demonstration is deferred to a later lab).
 *
 * Pre-seeded via setup: every interface is up and addressed on all three
 * routers. R1 has NO default route to start — the learner installs both the
 * primary (AD 1 implicit) and the floating backup (AD 200 explicit).
 *
 * Engine deltas this lab exercises (introduced alongside Lab 16):
 *   - `ip route <net> <mask> <nh> <ad>` grammar — optional 4th token parsed
 *     as an integer 1..255, stored on the route's adminDistance.
 *   - `show ip route` filters to the RIB winner per (prefix, mask) — losers
 *     stay in the routing table for LPM to promote when the winner is
 *     withdrawn, but they are hidden from the user-facing display. This is
 *     the teaching point: the backup is configured but invisible until the
 *     primary disappears.
 *   - LPM tiebreak by adminDistance (routing.ts §5) — already in place; the
 *     lab depends on it being unchanged.
 *
 * Three objectives:
 *   1. `primary-route` — R1 has 0.0.0.0/0 via 10.1.1.2 at AD 1
 *   2. `backup-route`  — R1 has 0.0.0.0/0 via 10.1.2.2 at AD 200
 *   3. `verify-route`  — learner ran `show ip route` on R1
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once /embed lands.
 */
export const lab16FloatingStaticRoute: Lab = {
  id: 'ccna-lab16-floating-static-route',
  title: 'Floating Static Route - Backup Path',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    "PC-A on the branch LAN (192.168.1.0/24) reaches the internet through R1. R1 is dual-homed: a primary WAN link to R2 (10.1.1.0/30) and a backup WAN link to R3 (10.1.2.0/30). The business rule is simple — use R2 by default, and only fall back to R3 when R2 is unreachable. Both circuits are billed, but the R3 path is a more expensive standby that should sit idle whenever R2 is healthy.\n\nA floating static route is the standard tool for this. Both defaults point at 0.0.0.0/0, but the backup gets a higher administrative distance (200) so the routing process only installs it when the primary is gone. Configure both defaults on R1, then verify with `show ip route` — only the primary should appear in the table. The backup lives in the running-config as insurance against the day R2 goes dark.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
        position: { x: 0, y: 160 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1', 'Gi0/2'],
        position: { x: 320, y: 160 },
      },
      {
        id: 'R2',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0'],
        position: { x: 640, y: 0 },
      },
      {
        id: 'R3',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0'],
        position: { x: 640, y: 320 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/2' }, b: { deviceId: 'R3', iface: 'Gi0/0' } },
    ],
  },
  setup: {
    // R1 LAN + both WAN interfaces up. NO default routes — those are the
    // learner's job (both the primary and the floating backup).
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'ip address 10.1.1.1 255.255.255.252',
      'no shutdown',
      'exit',
      'interface gi0/2',
      'ip address 10.1.2.1 255.255.255.252',
      'no shutdown',
      'exit',
    ],
    // R2: primary WAN edge. Addressed; nothing else needed for the lab.
    R2: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 10.1.1.2 255.255.255.252',
      'no shutdown',
      'exit',
    ],
    // R3: backup WAN edge. Addressed; nothing else needed for the lab.
    R3: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 10.1.2.2 255.255.255.252',
      'no shutdown',
      'exit',
    ],
  },
  objectives: [
    {
      id: 'primary-route',
      text: 'R1: ip route 0.0.0.0 0.0.0.0 10.1.1.2 (primary, default AD 1)',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.staticRoutes.some(
          (r) =>
            r.prefix === '0.0.0.0' &&
            r.mask === '0.0.0.0' &&
            r.nextHop === '10.1.1.2' &&
            r.adminDistance === 1,
        );
      },
    },
    {
      id: 'backup-route',
      text: 'R1: ip route 0.0.0.0 0.0.0.0 10.1.2.2 200 (floating backup, AD 200)',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.staticRoutes.some(
          (r) =>
            r.prefix === '0.0.0.0' &&
            r.mask === '0.0.0.0' &&
            r.nextHop === '10.1.2.2' &&
            r.adminDistance === 200,
        );
      },
    },
    {
      id: 'verify-route',
      text: 'R1: run show ip route to confirm only the primary is in the RIB',
      check: (_state, history) =>
        history.R1?.resolved.some((cmd) => /^(do\s+)?show ip route$/.test(cmd)) ?? false,
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'A floating static route uses the same destination as the primary but a higher administrative distance. IOS installs only the lowest-AD route per prefix, so the backup sits idle in the config until the primary is withdrawn.',
    },
    {
      afterSeconds: 180,
      text: 'Syntax is `ip route <net> <mask> <next-hop> <AD>`. The AD slot is optional — when omitted, statics default to 1. For the backup, use a high AD like 200.',
    },
    {
      afterSeconds: 300,
      text: 'Run `show ip route` on R1. Only `S* 0.0.0.0/0 [1/0] via 10.1.1.2` appears — the backup via 10.1.2.2 is in the running-config but not in the routing table while the primary is healthy.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Add the primary default via R2 (AD 1 by default) and the floating backup via R3 at AD 200:',
        commands: [
          'enable',
          'configure terminal',
          'ip route 0.0.0.0 0.0.0.0 10.1.1.2',
          'ip route 0.0.0.0 0.0.0.0 10.1.2.2 200',
          'end',
        ],
      },
      {
        device: 'R1',
        note: 'Confirm only the primary route is installed — the backup is hidden until the primary disappears:',
        commands: ['show ip route'],
      },
    ],
  },
};
