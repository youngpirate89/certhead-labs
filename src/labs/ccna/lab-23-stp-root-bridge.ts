import type { Lab } from '@/engine/types';

/**
 * Lab 23 — STP root bridge election and verification.
 *
 * This is a scoped CCNA STP lab. The engine models per-VLAN bridge priority,
 * the common root primary/root secondary macros, and show spanning-tree output.
 * It does not model full BPDU exchange, convergence timers, topology changes,
 * or loop-prevention behavior.
 */
export const lab23StpRootBridge: Lab = {
  id: 'ccna-lab23-stp-root-bridge',
  title: 'STP Root Bridge: Control VLAN 10 Election',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    'The access layer has two switches carrying VLAN 10. To make the Layer 2 design predictable, set SW1 as the STP root bridge for VLAN 10 and SW2 as the secondary root. Then verify the result with show spanning-tree vlan 10.\n\nThis lab focuses on STP root bridge configuration and verification. Full STP convergence, BPDU exchange, and loop-prevention simulation are intentionally out of scope.',
  topology: {
    devices: [
      { id: 'SW1', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/1', 'Fa0/2'] },
      { id: 'SW2', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/1', 'Fa0/2'] },
    ],
    links: [
      { a: { deviceId: 'SW1', iface: 'Fa0/1' }, b: { deviceId: 'SW2', iface: 'Fa0/1' } },
      { a: { deviceId: 'SW1', iface: 'Fa0/2' }, b: { deviceId: 'SW2', iface: 'Fa0/2' } },
    ],
  },
  setup: {
    SW1: ['enable', 'configure terminal', 'vlan 10', 'name USERS', 'interface fa0/1', 'switchport mode trunk', 'interface fa0/2', 'switchport mode trunk', 'end'],
    SW2: ['enable', 'configure terminal', 'vlan 10', 'name USERS', 'interface fa0/1', 'switchport mode trunk', 'interface fa0/2', 'switchport mode trunk', 'end'],
  },
  objectives: [
    {
      id: 'sw1-root-primary',
      text: 'SW1: configure VLAN 10 so this switch becomes the STP root bridge',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        const stp = sw1.device.spanningTree.get(10);
        return stp?.rootRole === 'primary' || (stp?.priority ?? 32768) < 28672;
      },
    },
    {
      id: 'sw2-root-secondary',
      text: 'SW2: configure VLAN 10 as the secondary root bridge',
      check: (_state, _history, session) => {
        const sw2 = session.devices.SW2;
        if (sw2?.kind !== 'switch') return false;
        const stp = sw2.device.spanningTree.get(10);
        return stp?.rootRole === 'secondary' || stp?.priority === 28672;
      },
    },
    {
      id: 'stp-verified',
      text: 'SW1 or SW2: run show spanning-tree vlan 10 after configuring STP priority',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        const sw2 = session.devices.SW2;
        if (sw1?.kind !== 'switch' || sw2?.kind !== 'switch') return false;
        const configured =
          (sw1.device.spanningTree.get(10)?.rootRole === 'primary' || (sw1.device.spanningTree.get(10)?.priority ?? 32768) < 28672) &&
          (sw2.device.spanningTree.get(10)?.rootRole === 'secondary' || sw2.device.spanningTree.get(10)?.priority === 28672);
        if (!configured) return false;
        return Boolean(
          sw1.lastShowSpanningTreeVlans?.vlanIds.includes(10) ||
            sw2.lastShowSpanningTreeVlans?.vlanIds.includes(10),
        );
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'STP root bridge selection is controlled by bridge priority. Lower priority wins.',
    },
    {
      afterSeconds: 180,
      text: 'Use spanning-tree vlan 10 root primary on SW1 and spanning-tree vlan 10 root secondary on SW2.',
    },
    {
      afterSeconds: 300,
      text: 'Verify with show spanning-tree vlan 10. Look for the root bridge and bridge priority lines.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'SW1',
        note: 'Configure SW1 as the primary root bridge for VLAN 10 and verify:',
        commands: [
          'enable',
          'configure terminal',
          'spanning-tree vlan 10 root primary',
          'end',
          'show spanning-tree vlan 10',
        ],
      },
      {
        device: 'SW2',
        note: 'Configure SW2 as the secondary root bridge for VLAN 10 and verify:',
        commands: [
          'enable',
          'configure terminal',
          'spanning-tree vlan 10 root secondary',
          'end',
          'show spanning-tree vlan 10',
        ],
      },
    ],
  },
};
