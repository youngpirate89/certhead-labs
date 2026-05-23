import type { Lab } from '@/engine/types';

/**
 * Troubleshooting pilot — wrong static next-hop.
 *
 * Same topology as the return-route pilot: PC-A — R1 — R2 — PC-B. Both
 * routers are pre-configured, including R2's return static, but R2's
 * return route points at a next-hop OUTSIDE the WAN subnet
 * (192.168.12.99 against a 192.168.12.0/30 link, whose only valid host
 * pair is .1 / .2). The engine surfaces this as a `next-hop-unreachable`
 * failure on the return walk; the sentence names R2 and points at the
 * next-hop concept ("the next-hop on R2 is not in that interface's
 * subnet"). The scenario brief frames the /30 explicitly so the learner
 * arrives knowing the link's address space.
 *
 * Two objectives: replace the wrong static with the right one, then
 * confirm round-trip reachability. The failed ping is the teaching;
 * the fix is the completion.
 *
 * LOCAL ONLY: registered as `?pilot=tshoot-wrong-next-hop`; not in the
 * deployed catalog.
 */
export const pilotTshootWrongNextHop: Lab = {
  id: 'pilot-tshoot-wrong-next-hop',
  title: 'Troubleshoot: R2 points at the wrong next-hop',
  exam: 'Pilot · Troubleshoot',
  difficulty: 3,
  estimatedMinutes: 8,
  isFree: false,
  scenario:
    "Trouble ticket: PC-A on 192.168.1.0/24 can’t reach PC-B on 192.168.2.0/24. The previous lab’s missing return route was added — but a typo crept in. The WAN link between R1 and R2 is a /30 (192.168.12.0/30); the only two valid hosts on that link are R1’s Gi0/0 at 192.168.12.1 and R2’s Gi0/0 at 192.168.12.2. Anything outside that pair isn’t reachable across this link.\n\nFrom PC-A, run `ping 192.168.2.10` and read the failure carefully — the engine names R2 and tells you the next-hop on R2 isn’t in that interface’s subnet. Remove R2’s broken static and add the correct one back. The lab passes when the round-trip works.",
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
      // Wrong next-hop — 192.168.12.99 is not in 192.168.12.0/30.
      'ip route 192.168.1.0 255.255.255.0 192.168.12.99',
    ],
  },
  objectives: [
    {
      id: 'fix-r2-next-hop',
      text: 'R2 has a static route to 192.168.1.0/24 via 192.168.12.1',
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
        'Run `ping 192.168.2.10` on PC-A and read the message. Then click R2 → `enable` → `show ip route` and look at the static route line — what address does the next-hop point at, and is that address on the same /30 as R2’s WAN interface?',
    },
    {
      afterSeconds: 240,
      text:
        'On R2, remove the bad static and add the right one. The R1–R2 link is 192.168.12.0/30 — R1’s end is 192.168.12.1, R2’s end is 192.168.12.2. From R2: `enable`, `configure terminal`, `no ip route 192.168.1.0 255.255.255.0 192.168.12.99`, then `ip route 192.168.1.0 255.255.255.0 192.168.12.1`.',
    },
  ],
};
