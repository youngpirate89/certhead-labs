import type { Lab } from '@/engine/types';

/**
 * Lab 33 — interpret deterministic STP port roles on a 3-switch triangle.
 *
 * Scoped simulator note: this is not a full BPDU/convergence model. The setup
 * seeds a stable VLAN 20 STP state so learners can practice reading real IOS
 * evidence: root bridge, root ports, designated ports, and one alternate
 * blocking port.
 */
export const lab33StpPortRoles: Lab = {
  id: 'ccna-lab33-stp-port-roles',
  title: 'STP Port Roles: Read a 3-Switch Triangle',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    'VLAN 20 runs across a three-switch access-layer triangle. The design has already selected SW1 as the STP root bridge. Your job is to inspect show spanning-tree vlan 20 on all three switches and identify the root bridge, the root/designated ports, and the alternate blocking port that prevents the Layer 2 loop.\n\nDo not reconfigure the switches. This is a read-and-interpret lab focused on STP evidence.',
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
      'vlan 20',
      'name STAFF',
      'interface fa0/1',
      'switchport mode trunk',
      'interface fa0/2',
      'switchport mode trunk',
      'exit',
      'spanning-tree vlan 20 root primary',
      'end',
    ],
    SW2: [
      'enable',
      'configure terminal',
      'vlan 20',
      'name STAFF',
      'interface fa0/1',
      'switchport mode trunk',
      'interface fa0/2',
      'switchport mode trunk',
      'exit',
      'spanning-tree vlan 20 root secondary',
      'end',
    ],
    SW3: [
      'enable',
      'configure terminal',
      'vlan 20',
      'name STAFF',
      'interface fa0/1',
      'switchport mode trunk',
      'interface fa0/2',
      'switchport mode trunk',
      'exit',
      'end',
    ],
  },
  objectives: [
    {
      id: 'inspect-root-bridge',
      text: 'SW1: run show spanning-tree vlan 20 and confirm SW1 is the root bridge',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        return sw1.lastShowSpanningTreeVlans?.vlanIds.includes(20) === true;
      },
    },
    {
      id: 'inspect-non-root-roles',
      text: 'SW2: run show spanning-tree vlan 20 and identify the root port and designated port',
      check: (_state, _history, session) => {
        const sw2 = session.devices.SW2;
        if (sw2?.kind !== 'switch') return false;
        return sw2.lastShowSpanningTreeVlans?.vlanIds.includes(20) === true;
      },
    },
    {
      id: 'identify-blocked-link',
      text: 'SW3: run show spanning-tree vlan 20 and identify Fa0/2 as the alternate blocking port',
      check: (_state, _history, session) => {
        const sw3 = session.devices.SW3;
        if (sw3?.kind !== 'switch') return false;
        return sw3.lastShowSpanningTreeVlans?.vlanIds.includes(20) === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Start on SW1. The root bridge says “This bridge is the root” in show spanning-tree output.',
    },
    {
      afterSeconds: 180,
      text: 'On non-root switches, the Root role marks the best path back to the root bridge. Designated ports forward for their segment.',
    },
    {
      afterSeconds: 300,
      text: 'In this triangle, the SW2-SW3 segment has one designated forwarding side and one alternate blocking side.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'SW1',
        note: 'Confirm SW1 is the VLAN 20 root bridge and both root-side links are designated forwarding:',
        commands: ['enable', 'show spanning-tree vlan 20'],
      },
      {
        device: 'SW2',
        note: 'Inspect SW2. Fa0/1 points toward SW1 as the root port; Fa0/2 is designated forwarding toward SW3:',
        commands: ['enable', 'show spanning-tree vlan 20'],
      },
      {
        device: 'SW3',
        note: 'Inspect SW3. Fa0/1 points toward SW1 as the root port; Fa0/2 is alternate blocking toward SW2:',
        commands: ['enable', 'show spanning-tree vlan 20'],
      },
    ],
  },
};
