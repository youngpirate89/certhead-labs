import type { Lab } from '@/engine/types';

/**
 * Lab 7 — VLAN access ports, one switch between two PCs.
 *
 * Topology: PC-A — SW1 — PC-B. Both PCs share the 192.168.1.0/24 subnet and
 * sit on the default VLAN 1 at lab start, so PC-A can reach PC-B before the
 * learner touches anything. The learner's task is to segment the two PCs:
 * create VLAN 10 (Sales) + VLAN 20 (Engineering), assign each PC's port to
 * the right VLAN, and verify the segmentation took hold.
 *
 * Three objectives, in completion order:
 *   1. `vlans-created` — VLAN 10 named Sales AND VLAN 20 named Engineering,
 *      both active in SW1's VLAN database.
 *   2. `ports-assigned` — Fa0/1 in access mode in VLAN 10 AND Fa0/2 in
 *      access mode in VLAN 20.
 *   3. `segmentation-verified` — PC-A's lastPing to 192.168.1.20 FAILED with
 *      the vlan-mismatch reason AND the learner ran `show vlan brief` on
 *      SW1. Same lastPing + inspect pattern as Lab 6 (ACL) — forces the
 *      learner to demonstrate the block AND inspect the VLAN database.
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
    "The network team is segmenting the office. PC-A belongs to the Sales team (VLAN 10) and PC-B belongs to the Engineering team (VLAN 20). Your task: create both VLANs on SW1, assign each PC's port to the correct VLAN, then verify the segmentation is working — PC-A and PC-B should no longer be able to reach each other.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
      },
      { id: 'SW1', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/1', 'Fa0/2'] },
      {
        id: 'PC-B',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.1.20', mask: '255.255.255.0', gateway: '192.168.1.1' },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/1' } },
      { a: { deviceId: 'SW1', iface: 'Fa0/2' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
    ],
  },
  // No setup needed — switchports come up admin-up in VLAN 1 by default, so
  // PC-A reaches PC-B at lab start without any seeded configuration.
  objectives: [
    {
      id: 'vlans-created',
      text: 'Create VLAN 10 (Sales) and VLAN 20 (Engineering) on SW1',
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
      text: 'Assign Fa0/1 to VLAN 10 and Fa0/2 to VLAN 20',
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
      text: 'Verify PCs on different VLANs cannot communicate (ping AND inspect VLAN table)',
      check: (_state, history, session) => {
        // lastPing pattern: the segmentation must be demonstrated by an actual
        // learner-initiated ping. State-permits-the-block alone is not enough.
        const pca = session.devices['PC-A'];
        if (pca?.kind !== 'pc') return false;
        const pingFailed =
          pca.lastPing?.target === '192.168.1.20' && pca.lastPing.ok === false;
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
};
