import type { Lab } from '@/engine/types';

/**
 * Multi-device engine pilot lab — TWO routers cabled on one link.
 *
 * Per docs/MULTI_DEVICE_TOPOLOGY.md (3a build order): the foundation pilot
 * proves the multi-device engine + canvas end-to-end without traffic
 * simulation. Configuring an interface on R1 must not affect R2, the canvas
 * must show both nodes + the link, and clicking each node must switch the
 * console. NO ping / reachability here — that's 3b.
 *
 * LOCAL ONLY: this lab is NOT in the deployed catalog. It's accessible only
 * via the URL param `?pilot=2-router` for local development verification.
 * `isFree: false` ensures no marketing-surface tooling treats it as the
 * free lab.
 */
export const pilot2Router: Lab = {
  id: 'pilot-3a-2-router',
  title: 'Two routers, one link',
  exam: 'Pilot · 3a',
  difficulty: 2,
  estimatedMinutes: 5,
  isFree: false,
  scenario:
    "Two ISR4321 routers, R1 and R2, are cabled together — R1's GigabitEthernet0/0 to R2's GigabitEthernet0/0. They've never been configured. Click each router to open its console, assign the addresses below, and bring both interfaces up.\n\nClick R1, configure it, then click R2 and configure that one. Each console keeps its own scrollback — switch back and forth as needed.",
  topology: {
    devices: [
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] },
      { id: 'R2', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] },
    ],
    links: [
      {
        a: { deviceId: 'R1', iface: 'Gi0/0' },
        b: { deviceId: 'R2', iface: 'Gi0/0' },
      },
    ],
  },
  objectives: [
    {
      id: 'r1-ip',
      text: 'Assign 10.0.0.1/24 to R1 GigabitEthernet0/0',
      check: (state) =>
        state.R1?.interfaces['Gi0/0'].ip === '10.0.0.1' &&
        state.R1?.interfaces['Gi0/0'].mask === '255.255.255.0',
    },
    {
      id: 'r1-up',
      text: 'Bring R1 GigabitEthernet0/0 up',
      check: (state) => state.R1?.interfaces['Gi0/0'].adminUp === true,
    },
    {
      id: 'r2-ip',
      text: 'Assign 10.0.0.2/24 to R2 GigabitEthernet0/0',
      check: (state) =>
        state.R2?.interfaces['Gi0/0'].ip === '10.0.0.2' &&
        state.R2?.interfaces['Gi0/0'].mask === '255.255.255.0',
    },
    {
      id: 'r2-up',
      text: 'Bring R2 GigabitEthernet0/0 up',
      check: (state) => state.R2?.interfaces['Gi0/0'].adminUp === true,
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      text: 'Click R1 in the topology, then `enable`, `configure terminal`, `interface gi0/0`, set the IP, then `no shutdown`. Repeat for R2.',
    },
  ],
};
