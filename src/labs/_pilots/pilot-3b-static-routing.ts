import type { Lab } from '@/engine/types';

/**
 * 3b reachability pilot — the Packet-Tracer moment.
 *
 * Topology per docs/ENGINE_ARCHITECTURE.md §9:
 *
 *   PC-A — R1 — R2 — PC-B
 *   192.168.1.0/24    192.168.12.0/30    192.168.2.0/24
 *
 * Objectives:
 *   - state: each router interface IP'd and admin-up
 *   - state: a static route on EACH router pointing back to the other
 *            PC's subnet (the deliberately instructive piece — forgetting
 *            R2's back-route is the headline failure mode)
 *   - reachability: PC-A → PC-B canReach succeeds
 *
 * PCs come pre-configured via the lab spec — CCNA-level pedagogy puts the
 * learner work on routers and reachability, not on PC end-user config.
 *
 * LOCAL ONLY: registered as a pilot (`?pilot=static-routing`); not in the
 * deployed catalog.
 */
export const pilot3bStaticRouting: Lab = {
  id: 'pilot-3b-static-routing',
  title: 'Static routing between two networks',
  exam: 'Pilot · 3b',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    "Two LANs, two routers, one point-to-point link between them. PC-A is on 192.168.1.0/24, PC-B is on 192.168.2.0/24, and R1 ↔ R2 are wired together on 192.168.12.0/30. Each PC already has its IP and gateway set — the LAN team handled that.\n\nYour job: configure both routers so PC-A can ping PC-B. Bring each router interface up with the right IP, then add static routes on R1 and R2 so each router knows how to reach the network it can't see directly. The lab passes when the reachability check goes green — meaning the ICMP request reaches PC-B AND the reply gets back to PC-A. If only the forward direction is configured the ping will fail at R2 on the return path; that's the exact bug this lab is teaching.",
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
  objectives: [
    {
      id: 'r1-lan-up',
      text: 'R1 Gi0/1 is 192.168.1.1/24 and admin-up',
      check: (state) => {
        const i = state.R1?.interfaces['Gi0/1'];
        return (
          i?.ip === '192.168.1.1' && i?.mask === '255.255.255.0' && i?.adminUp === true
        );
      },
    },
    {
      id: 'r1-wan-up',
      text: 'R1 Gi0/0 is 192.168.12.1/30 and admin-up',
      check: (state) => {
        const i = state.R1?.interfaces['Gi0/0'];
        return (
          i?.ip === '192.168.12.1' &&
          i?.mask === '255.255.255.252' &&
          i?.adminUp === true
        );
      },
    },
    {
      id: 'r2-wan-up',
      text: 'R2 Gi0/0 is 192.168.12.2/30 and admin-up',
      check: (state) => {
        const i = state.R2?.interfaces['Gi0/0'];
        return (
          i?.ip === '192.168.12.2' &&
          i?.mask === '255.255.255.252' &&
          i?.adminUp === true
        );
      },
    },
    {
      id: 'r2-lan-up',
      text: 'R2 Gi0/1 is 192.168.2.1/24 and admin-up',
      check: (state) => {
        const i = state.R2?.interfaces['Gi0/1'];
        return (
          i?.ip === '192.168.2.1' && i?.mask === '255.255.255.0' && i?.adminUp === true
        );
      },
    },
    {
      id: 'r1-static-forward',
      text: 'R1 has a static route to 192.168.2.0/24 via 192.168.12.2',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.staticRoutes.some(
          (r) =>
            r.prefix === '192.168.2.0' &&
            r.mask === '255.255.255.0' &&
            r.nextHop === '192.168.12.2',
        );
      },
    },
    {
      id: 'r2-static-return',
      text: 'R2 has a static route back to 192.168.1.0/24 via 192.168.12.1',
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
      text: 'Click R1 → `enable`, `configure terminal`, `interface gi0/1`, set 192.168.1.1/24, `no shutdown`. Repeat for Gi0/0 with the WAN address.',
    },
    {
      afterSeconds: 240,
      text: 'Both routers need a STATIC route to the network they can\'t see. R1 needs `ip route 192.168.2.0 255.255.255.0 192.168.12.2`; R2 needs the symmetric route back.',
    },
  ],
};
