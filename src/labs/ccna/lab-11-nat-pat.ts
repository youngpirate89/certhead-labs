import type { Lab } from '@/engine/types';

/**
 * Lab 11 — Configure PAT (NAT Overload).
 *
 * R1 sits between a private LAN (PC-A on 192.168.1.0/24) and an ISP router on
 * 203.0.113.0/30. Both routers are seeded with addresses and the cables are
 * up, so PC-A can already reach R1's LAN interface. The problem: the ISP has
 * no route back to 192.168.1.0/24, so any packet PC-A sends to the ISP gets
 * out fine but the reply has nowhere to go — `canReach` surfaces this as
 * `direction:'return'` `no-route` on the ISP, and ping fails with the
 * matching `[sim]` sentence.
 *
 * The learner fixes it by configuring NAT overload (PAT) on R1:
 *   1. `access-list 1 permit 192.168.1.0 0.0.0.255` — select inside traffic
 *   2. `interface Gi0/0` → `ip nat inside`
 *   3. `interface Gi0/1` → `ip nat outside`
 *   4. `ip nat inside source list 1 interface GigabitEthernet0/1 overload`
 *   5. Verify with `show ip nat translations`
 *
 * After step 4, R1 rewrites PC-A's source from 192.168.1.10 → 203.0.113.1
 * (R1's WAN IP). The reply comes back to 203.0.113.1 — which IS reachable
 * from the ISP (directly connected on the WAN subnet) — so the round-trip
 * completes. The reachability objective uses the standard tshoot-lab pattern
 * (PC-A's `lastPing` flag) so the learner has to actually run ping for it
 * to tick, not just type the config.
 *
 * Topology — PC-A on R1's LAN, ISP on R1's WAN. PC-A starts with a static
 * IP (192.168.1.10, gw 192.168.1.1); ISP is a normal router with one
 * configured interface (203.0.113.2/30) and NO routes back to the LAN.
 *
 *      PC-A ─── R1 ─── ISP
 *      (.10)   (Gi0/0)(Gi0/1)   (.2)
 *               .1     .1
 *           192.168.1.0/24   203.0.113.0/30
 *
 * Per RFC 5737, 203.0.113.0/24 is the documentation-public range — the
 * canonical "pretend this is the internet" prefix used in CCNA materials.
 * No real public IPs ever appear in the lab.
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once /embed
 * lands. Catalog entry follows Lab 10 in the registry.
 */
export const lab11NatPat: Lab = {
  id: 'ccna-lab11-nat-pat',
  title: 'Configure PAT (NAT Overload)',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    "R1 is your branch router. PC-A (192.168.1.10/24, gateway 192.168.1.1) sits on the LAN attached to R1's Gi0/0. R1's WAN interface Gi0/1 (203.0.113.1/30) cables to the ISP router (203.0.113.2). The ISP has no route to your 192.168.1.0/24 LAN — that's the internet, after all.\n\nFrom PC-A run `ping 203.0.113.2` first. You'll see the round-trip fail: R1 forwards the packet, the ISP receives it, but the reply has nowhere to go. Configure NAT overload (PAT) on R1 so that PC-A's private source address gets translated to R1's public WAN IP on the way out. After the config lands, PC-A can reach the ISP and `show ip nat translations` on R1 shows the active translation.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
        position: { x: 0, y: 0 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 320, y: 0 },
      },
      {
        id: 'ISP',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0'],
        position: { x: 640, y: 0 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'ISP', iface: 'Gi0/0' } },
    ],
  },
  setup: {
    // R1's LAN and WAN interfaces are pre-configured — the lesson is NAT,
    // not interface bring-up. Lab 01 covers interface configuration.
    R1: [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface Gi0/1',
      'ip address 203.0.113.1 255.255.255.252',
      'no shutdown',
    ],
    // ISP's WAN interface is pre-configured. Deliberately NO route back to
    // 192.168.1.0/24 — that absence is the whole point of the lab.
    ISP: [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'ip address 203.0.113.2 255.255.255.252',
      'no shutdown',
    ],
  },
  objectives: [
    {
      id: 'acl',
      text: 'Define ACL 1 to permit the 192.168.1.0/24 LAN subnet',
      check: (state) => {
        const acl = state.R1?.acls.get(1);
        if (!acl) return false;
        return acl.entries.some(
          (e) =>
            e.action === 'permit' &&
            e.source === '192.168.1.0' &&
            e.wildcard === '0.0.0.255',
        );
      },
    },
    {
      id: 'nat-inside',
      text: 'Mark Gi0/0 as ip nat inside',
      check: (state) => state.R1?.interfaces['Gi0/0']?.natRole === 'inside',
    },
    {
      id: 'nat-outside',
      text: 'Mark Gi0/1 as ip nat outside',
      check: (state) => state.R1?.interfaces['Gi0/1']?.natRole === 'outside',
    },
    {
      id: 'overload',
      text: 'Apply ip nat inside source list 1 interface Gi0/1 overload',
      check: (state) =>
        state.R1?.natStatements.some(
          (s) =>
            s.type === 'inside-source-list-overload' &&
            s.aclId === 1 &&
            s.outsideInterface === 'Gi0/1',
        ) ?? false,
    },
    {
      id: 'reachable',
      text: 'PC-A can ping the ISP at 203.0.113.2',
      check: (_state, _history, session) => {
        const pca = session.devices['PC-A'];
        if (pca?.kind !== 'pc') return false;
        return pca.lastPing?.target === '203.0.113.2' && pca.lastPing.ok === true;
      },
    },
    {
      id: 'verify',
      text: 'Verify with show ip nat translations',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.lastShowNatTranslations > 0;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text:
        'Start by defining which traffic should get translated: in global config, `access-list 1 permit 192.168.1.0 0.0.0.255`.',
    },
    {
      afterSeconds: 180,
      text:
        "Mark R1's interfaces: `interface Gi0/0` then `ip nat inside`, `exit`, `interface Gi0/1` then `ip nat outside`. The inside is the LAN-facing port, the outside is the WAN-facing port.",
    },
    {
      afterSeconds: 300,
      text:
        'Apply PAT in global config: `ip nat inside source list 1 interface GigabitEthernet0/1 overload`. Then `end`, `show ip nat translations` to see the active entry, and re-run `ping 203.0.113.2` from PC-A.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Enter privileged and global config mode:',
        commands: ['enable', 'configure terminal'],
      },
      {
        device: 'R1',
        note: 'Define which inside traffic to translate (the LAN subnet):',
        commands: ['access-list 1 permit 192.168.1.0 0.0.0.255'],
      },
      {
        device: 'R1',
        note: 'Mark the LAN interface as NAT inside:',
        commands: ['interface Gi0/0', 'ip nat inside', 'exit'],
      },
      {
        device: 'R1',
        note: 'Mark the WAN interface as NAT outside:',
        commands: ['interface Gi0/1', 'ip nat outside', 'exit'],
      },
      {
        device: 'R1',
        note: "Apply PAT overload — borrow Gi0/1's IP as the translated source:",
        commands: [
          'ip nat inside source list 1 interface GigabitEthernet0/1 overload',
        ],
      },
      {
        device: 'R1',
        note: 'Verify the translation table:',
        commands: ['end', 'show ip nat translations'],
      },
      {
        device: 'PC-A',
        note: 'Confirm end-to-end reachability:',
        commands: ['ping 203.0.113.2'],
      },
    ],
  },
};
