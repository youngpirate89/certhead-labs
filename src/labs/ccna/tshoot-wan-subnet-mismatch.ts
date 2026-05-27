import type { Lab } from '@/engine/types';

/**
 * Troubleshooting lab — mismatched WAN subnets on a point-to-point link.
 *
 * Topology: PC-A — R1 — R2 — PC-B. R1's WAN interface sits at 192.168.12.1/30
 * (network 192.168.12.0/30). R2's WAN interface was misconfigured at
 * 192.168.12.6/30 (network 192.168.12.4/30). The two ends of the link compute
 * different networks — the engine catches this on the forward walk as
 * `link-subnet-mismatch` and surfaces the verbatim sentence:
 *   Request timed out — the subnets on the two ends of the link at R1 Gi0/0 do not match.
 *
 * This is a subnetting lesson, not a routing one — both routers have sensible
 * static routes, but the link itself is broken. The fix is to re-IP R2's WAN
 * interface so it lives in the same /30 as R1 (i.e. 192.168.12.2/30).
 *
 * Two objectives: re-IP R2's WAN end and confirm round-trip reachability. The
 * failed ping is the teaching; the fix is the completion.
 *
 * Catalog id is stable: `ccna-tshoot-wan-subnet-mismatch`. Pro-tier
 * (`isFree: false`); the embed catalog serves this through `getLabById`. Not
 * in the `/try` bundle.
 */
export const tshootWanSubnetMismatch: Lab = {
  id: 'ccna-tshoot-wan-subnet-mismatch',
  title: 'Troubleshoot: Mismatched WAN subnet',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 8,
  isFree: false,
  scenario:
    "Trouble ticket: PC-A still can’t reach PC-B. Both routers have static routes pointing at the right next-hops on the WAN, but the link between R1 and R2 isn’t carrying traffic. The two ends of a point-to-point link have to live in the same subnet — if R1 thinks the link is one /30 and R2 thinks it’s a different /30, IP can’t cross.\n\nFrom PC-A, run `ping 192.168.2.10`. The engine names the link directly: it tells you the subnets on the two ends of the link at R1 Gi0/0 don’t match. Click R1 and R2 in turn and `show ip interface brief` — look at the WAN addresses and figure out which side is wrong. Fix R2’s WAN interface so both ends sit in the same /30.",
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
      // Wrong WAN address — .6/30 puts R2 in 192.168.12.4/30, not R1's 192.168.12.0/30.
      'interface gi0/0',
      'ip address 192.168.12.6 255.255.255.252',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'ip address 192.168.2.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip route 192.168.1.0 255.255.255.0 192.168.12.1',
    ],
  },
  objectives: [
    {
      id: 'fix-r2-wan',
      text: 'R2 Gi0/0 is 192.168.12.2/30 (same /30 as R1 Gi0/0)',
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
        'Run `ping 192.168.2.10` on PC-A — the failure names R1 Gi0/0 and says the subnets on the two ends of the link don’t match. Click R1 → `enable` → `show ip interface brief` to see R1’s end of the link, then do the same on R2. Compute the network each side belongs to and find the mismatch.',
    },
    {
      afterSeconds: 240,
      text:
        'R1’s Gi0/0 is 192.168.12.1/30 → network 192.168.12.0/30. R2’s Gi0/0 was set to 192.168.12.6/30 → network 192.168.12.4/30. Fix R2 to match R1’s link: `enable`, `configure terminal`, `interface gi0/0`, `no ip address`, `ip address 192.168.12.2 255.255.255.252`.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R2',
        note: "Re-IP Gi0/0 so it sits in the same /30 as R1's end of the link:",
        commands: [
          'enable',
          'configure terminal',
          'interface Gi0/0',
          'no ip address',
          'ip address 192.168.12.2 255.255.255.252',
          'end',
        ],
      },
      {
        device: 'PC-A',
        note: 'Confirm the round-trip works now:',
        commands: ['ping 192.168.2.10'],
      },
    ],
  },
};
