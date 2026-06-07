import type { Lab } from '@/engine/types';

export const lab34TshootStpWrongRoot: Lab = {
  id: 'ccna-lab34-tshoot-stp-wrong-root',
  title: 'Troubleshoot: Wrong STP Root Bridge',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 15,
  isFree: false,
  scenario:
    'After a switch replacement, VLAN 40 now uses the closet switch SW3 as the STP root bridge. The design standard requires SW1 to be the primary root and SW2 to be the secondary root. Troubleshoot the current STP state, move the root role back to SW1, restore SW2 as the backup root, clear the accidental root priority on SW3, and verify the result.\n\nKeep the VLAN and trunks intact. This ticket is about STP root-bridge control, not changing the physical topology.',
  topology: {
    devices: [
      { id: 'SW1', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/1', 'Fa0/2'] },
      { id: 'SW2', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/1', 'Fa0/2'] },
      { id: 'SW3', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/1', 'Fa0/2'] },
    ],
    links: [
      { a: { deviceId: 'SW1', iface: 'Fa0/1' }, b: { deviceId: 'SW2', iface: 'Fa0/1' } },
      { a: { deviceId: 'SW1', iface: 'Fa0/2' }, b: { deviceId: 'SW3', iface: 'Fa0/1' } },
      { a: { deviceId: 'SW2', iface: 'Fa0/2' }, b: { deviceId: 'SW3', iface: 'Fa0/2' } },
    ],
  },
  setup: {
    SW1: [
      'enable',
      'configure terminal',
      'vlan 40',
      'name OPERATIONS',
      'interface fa0/1',
      'switchport mode trunk',
      'interface fa0/2',
      'switchport mode trunk',
      'end',
    ],
    SW2: [
      'enable',
      'configure terminal',
      'vlan 40',
      'name OPERATIONS',
      'interface fa0/1',
      'switchport mode trunk',
      'interface fa0/2',
      'switchport mode trunk',
      'end',
    ],
    SW3: [
      'enable',
      'configure terminal',
      'vlan 40',
      'name OPERATIONS',
      'interface fa0/1',
      'switchport mode trunk',
      'interface fa0/2',
      'switchport mode trunk',
      'exit',
      'spanning-tree vlan 40 root primary',
      'end',
    ],
  },
  objectives: [
    {
      id: 'diagnose-wrong-root',
      text: 'SW3: run show spanning-tree vlan 40 and confirm the wrong switch is currently root',
      check: (_state, _history, session) => {
        const sw3 = session.devices.SW3;
        if (sw3?.kind !== 'switch') return false;
        return sw3.lastShowSpanningTreeVlans?.vlanIds.includes(40) === true;
      },
    },
    {
      id: 'set-intended-root',
      text: 'SW1: configure VLAN 40 so SW1 becomes the primary STP root bridge',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        const stp = sw1.device.spanningTree.get(40);
        return stp?.rootRole === 'primary' && stp.priority === 24576;
      },
    },
    {
      id: 'set-secondary-root',
      text: 'SW2: configure VLAN 40 as the secondary STP root bridge',
      check: (_state, _history, session) => {
        const sw2 = session.devices.SW2;
        if (sw2?.kind !== 'switch') return false;
        const stp = sw2.device.spanningTree.get(40);
        return stp?.rootRole === 'secondary' && stp.priority === 28672;
      },
    },
    {
      id: 'clear-wrong-root',
      text: 'SW3: restore VLAN 40 bridge priority to the default so SW3 is no longer the root candidate',
      check: (_state, _history, session) => {
        const sw3 = session.devices.SW3;
        if (sw3?.kind !== 'switch') return false;
        const stp = sw3.device.spanningTree.get(40);
        return stp?.rootRole === null && stp.priority === 32768;
      },
    },
    {
      id: 'verify-after-repair',
      text: 'SW1: run show spanning-tree vlan 40 after the repair and verify SW1 is root',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        const stp = sw1.device.spanningTree.get(40);
        return stp?.rootRole === 'primary' && sw1.lastShowSpanningTreeVlans?.vlanIds.includes(40) === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Use show spanning-tree vlan 40 on SW3 first. If it says “This bridge is the root,” the access closet switch is incorrectly winning the election.',
    },
    {
      afterSeconds: 180,
      text: 'The design calls for SW1 primary and SW2 secondary. Use the root primary/root secondary macros for VLAN 40.',
    },
    {
      afterSeconds: 300,
      text: 'Do not leave SW3 configured as root primary. Restore its VLAN 40 priority to the default value, then verify from SW1.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'SW3',
        note: 'Diagnose the current root bridge. SW3 should not be the root:',
        commands: ['enable', 'show spanning-tree vlan 40'],
      },
      {
        device: 'SW1',
        note: 'Move the primary root role to the intended distribution switch:',
        commands: ['enable', 'configure terminal', 'spanning-tree vlan 40 root primary', 'end'],
      },
      {
        device: 'SW2',
        note: 'Restore the backup root role:',
        commands: ['enable', 'configure terminal', 'spanning-tree vlan 40 root secondary', 'end'],
      },
      {
        device: 'SW3',
        note: 'Clear the accidental low root priority from the closet switch:',
        commands: ['configure terminal', 'spanning-tree vlan 40 priority 32768', 'end'],
      },
      {
        device: 'SW1',
        note: 'Verify SW1 is now the VLAN 40 root bridge:',
        commands: ['show spanning-tree vlan 40'],
      },
    ],
  },
};
