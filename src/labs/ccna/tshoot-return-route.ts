import type { Lab } from '@/engine/types';

/**
 * Troubleshooting lab — missing return route.
 *
 * Topology: PC-A — R1 — R2 — PC-B. Both routers and all four interfaces are
 * pre-configured via `Lab.setup`; R1 has its forward static. R2 is deliberately
 * MISSING its return route to 192.168.1.0/24 — the one thing the learner must
 * add. The headline failure surfaces as
 *   Reply timed out — R2 has no return route to the source.
 * on the very first ping, naming R2 directly so the diagnosis is immediate.
 *
 * Two objectives only: fix the route, then verify the round-trip works. The
 * failed ping is the teaching; the fix is the completion. No re-grading of
 * the seeded config.
 *
 * Catalog id is stable: `ccna-tshoot-return-route`. Pro-tier (`isFree: false`);
 * the embed catalog serves this through `getLabById`. Not in the `/try` bundle.
 */
export const tshootReturnRoute: Lab = {
  id: 'ccna-tshoot-return-route',
  title: 'Troubleshoot: PC-A can\'t reach PC-B',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 8,
  isFree: false,
  scenario:
    "Trouble ticket: PC-A on 192.168.1.0/24 can’t reach PC-B on 192.168.2.0/24. Both routers were already configured by the NOC — interfaces are up, the WAN link between R1 and R2 is in place, and R1 has a static route forward to PC-B’s subnet. Despite all that, ping fails.\n\nFrom PC-A, run `ping 192.168.2.10` and read the message carefully — the engine names the device where the packet dies. Fix that one missing piece. The lab passes when PC-A can ping PC-B end-to-end.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
      },
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] },
      { id: 'R2', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] },
      {
        id: 'PC-B',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.2.10', mask: '255.255.255.0', gateway: '192.168.2.1' },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/1' } },
      { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
      { a: { deviceId: 'R2', iface: 'Gi0/1' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/1',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface gi0/0',
      'ip address 192.168.12.1 255.255.255.252',
      'no shutdown',
      'exit',
      'ip route 192.168.2.0 255.255.255.0 192.168.12.2',
    ],
    R2: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.12.2 255.255.255.252',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'ip address 192.168.2.1 255.255.255.0',
      'no shutdown',
      'exit',
      // No return route to 192.168.1.0/24 — this is the bug the learner fixes.
    ],
  },
  objectives: [
    {
      id: 'fix-r2-return',
      text: 'Add the missing return route on R2 to 192.168.1.0/24 via 192.168.12.1',
      check: (_state, _history, session) => {
        const r2 = session.devices.R2;
        if (r2?.kind !== 'router') return false;
        return r2.staticRoutes.some(
          (r) =>
            r.prefix === '192.168.1.0' &&
            r.mask === '255.255.255.0' &&
            r.nextHop === '192.168.12.1',
        );
      },
    },
    {
      id: 'reach-pc-a-to-pc-b',
      text: 'PC-A can ping PC-B — run `ping 192.168.2.10` from PC-A and confirm a reply',
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
      text:
        'From PC-A run `ping 192.168.2.10` and read the failure line. If you want to confirm the diagnosis, click R1 and R2 in turn, `enable`, then `show ip route` — compare what each router knows about the OTHER PC’s subnet.',
    },
    {
      afterSeconds: 240,
      text:
        'R2 has no route back to 192.168.1.0/24. Click R2 → `enable`, `configure terminal`, then `ip route 192.168.1.0 255.255.255.0 192.168.12.1`. Re-run the ping from PC-A.',
    },
  ],
};
