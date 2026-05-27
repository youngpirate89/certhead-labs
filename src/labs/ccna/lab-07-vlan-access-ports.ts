import type { Lab } from '@/engine/types';

/**
 * Lab 7 — VLAN access ports, one switch between two PCs.
 *
 * RULE: One VLAN = one subnet. Always. Each VLAN must have its own unique IP
 * subnet. This is Cisco IOS standard practice per the official CCNA cert guide
 * (Wendell Odom, ICND1) and Cisco's VLAN configuration guides. Never place
 * devices from different VLANs on the same subnet in any lab — it is incorrect
 * network design and teaches the wrong mental model.
 *
 * Topology: PC-A — SW1 — PC-B. PC-A sits on 192.168.10.0/24 (the VLAN 10
 * subnet); PC-B sits on 192.168.20.0/24 (the VLAN 20 subnet). At lab start
 * both ports are on the default VLAN 1 — but the PCs are on DIFFERENT IP
 * subnets, so they already cannot reach each other (no inter-VLAN router
 * exists; an L2 switch alone cannot bridge subnets). The learner's task is to
 * model the segmentation correctly: create VLAN 10 (Sales) + VLAN 20
 * (Engineering), assign each PC's port to the right VLAN, and verify the
 * configuration with a failed ping plus `show vlan brief`.
 *
 * Three objectives, in completion order:
 *   1. `vlans-created` — VLAN 10 named Sales AND VLAN 20 named Engineering,
 *      both active in SW1's VLAN database.
 *   2. `ports-assigned` — Fa0/1 in access mode in VLAN 10 AND Fa0/2 in
 *      access mode in VLAN 20.
 *   3. `segmentation-verified` — PC-A's lastPing to 192.168.20.10 FAILED AND
 *      the learner ran `show vlan brief` on SW1. Same lastPing + inspect
 *      pattern as Lab 6 (ACL) — forces the learner to demonstrate the block
 *      AND inspect the VLAN database. The failure reason itself is
 *      surfaced-by-engine (no-gateway, since PC-A's gateway has no router
 *      behind it) and not asserted here — the lesson is "different VLANs
 *      need a router between subnets," not the specific FailReason.
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once /embed
 * lands, and via `?pilot=ccna-lab07-vlan-access-ports` for dev runs.
 */
export const lab07VlanAccessPorts: Lab = {
  id: 'ccna-lab07-vlan-access-ports',
  title: 'VLANs: Segment Two Teams onto Access Ports',
  exam: 'CCNA 200-301',
  difficulty: 1,
  estimatedMinutes: 8,
  isFree: false,
  scenario:
    "The network team is segmenting the office into departments. PC-A belongs to the Sales team (VLAN 10, subnet 192.168.10.0/24) and PC-B belongs to the Engineering team (VLAN 20, subnet 192.168.20.0/24). Your task: create both VLANs on SW1, name them, assign each PC's port to the correct VLAN, then verify the segmentation — PC-A and PC-B should not be able to reach each other without inter-VLAN routing.\n\nBoth PCs have been pre-configured with static IP addresses by the network admin — PC-A is 192.168.10.10 and PC-B is 192.168.20.10. You do not need to change anything on the PCs. VLAN assignment happens on the switch; the PCs are unaware of which VLAN they are in.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        // VLAN 10 subnet (192.168.10.0/24). Gateway is the would-be VLAN 10 SVI
        // — no router exists in Session 1, so the gateway is unreachable; that
        // is the correct teaching state for "L2 switch alone cannot route
        // between VLANs."
        pc: { ip: '192.168.10.10', mask: '255.255.255.0', gateway: '192.168.10.1' },
      },
      { id: 'SW1', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/1', 'Fa0/2'] },
      {
        id: 'PC-B',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        // VLAN 20 subnet (192.168.20.0/24). Same gateway story as PC-A.
        pc: { ip: '192.168.20.10', mask: '255.255.255.0', gateway: '192.168.20.1' },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/1' } },
      { a: { deviceId: 'SW1', iface: 'Fa0/2' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
    ],
  },
  // No setup needed — switchports come up admin-up in VLAN 1 by default. The
  // PCs are unreachable from one another at lab start (different subnets, no
  // inter-VLAN router), which is exactly what proper one-subnet-per-VLAN
  // design produces.
  objectives: [
    {
      id: 'vlans-created',
      text: 'SW1: create VLAN 10 named Sales and VLAN 20 named Engineering',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        const v10 = sw1.device.vlans.get(10);
        const v20 = sw1.device.vlans.get(20);
        if (!v10 || !v20) return false;
        return (
          v10.active &&
          v10.name === 'Sales' &&
          v20.active &&
          v20.name === 'Engineering'
        );
      },
    },
    {
      id: 'ports-assigned',
      text: 'SW1: set Fa0/1 to switchport access vlan 10 and Fa0/2 to switchport access vlan 20',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        const p1 = sw1.device.switchports['Fa0/1'];
        const p2 = sw1.device.switchports['Fa0/2'];
        if (!p1 || !p2) return false;
        return (
          p1.mode === 'access' &&
          p1.accessVlan === 10 &&
          p2.mode === 'access' &&
          p2.accessVlan === 20
        );
      },
    },
    {
      id: 'segmentation-verified',
      text: 'PC-A: ping 192.168.20.10 fails, and SW1: run show vlan brief',
      check: (_state, history, session) => {
        // lastPing pattern: the segmentation must be demonstrated by an actual
        // learner-initiated ping. State-permits-the-block alone is not enough.
        const pca = session.devices['PC-A'];
        if (pca?.kind !== 'pc') return false;
        const pingFailed =
          pca.lastPing?.target === '192.168.20.10' && pca.lastPing.ok === false;
        // AND the learner must have inspected the VLAN database on SW1 —
        // forces a discovery step instead of a configure-and-move-on.
        const inspected = history.SW1?.resolved.some((cmd) =>
          /^(do\s+)?show vlan brief$/.test(cmd),
        );
        return pingFailed && !!inspected;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Create a VLAN with: vlan 10, then name it with: name Sales',
    },
    {
      afterSeconds: 180,
      text: 'Assign a port to a VLAN from config-if mode: switchport access vlan 10',
    },
    {
      afterSeconds: 300,
      text: 'Run show vlan brief on SW1 to see which ports are in which VLAN. Then ping from PC-A to confirm segmentation.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'SW1',
        note: 'Create both VLANs in the switch database:',
        commands: [
          'enable',
          'configure terminal',
          'vlan 10',
          'name Sales',
          'exit',
          'vlan 20',
          'name Engineering',
          'exit',
        ],
      },
      {
        device: 'SW1',
        note: 'Assign each access port to its VLAN:',
        commands: [
          'interface Fa0/1',
          'switchport mode access',
          'switchport access vlan 10',
          'exit',
          'interface Fa0/2',
          'switchport mode access',
          'switchport access vlan 20',
          'end',
          'show vlan brief',
        ],
      },
      {
        device: 'PC-A',
        note: 'Confirm segmentation — the ping should fail:',
        commands: ['ping 192.168.20.10'],
      },
    ],
  },
};
