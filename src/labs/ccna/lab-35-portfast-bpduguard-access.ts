import type { Lab } from '@/engine/types';

export const lab35PortfastBpduguardAccess: Lab = {
  id: 'ccna-lab35-portfast-bpduguard-access',
  title: 'PortFast and BPDU Guard on Access Ports',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    'A small operations VLAN has two endpoint-facing access ports on SW1. Configure the user and printer access ports for fast edge-port activation and protect them from accidental switch connections with BPDU Guard.\n\nOnly apply PortFast and BPDU Guard to endpoint access ports. Do not configure these features on trunk links.',
  topology: {
    devices: [
      { id: 'SW1', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/1', 'Fa0/2', 'Fa0/3', 'Fa0/4'] },
      { id: 'PC1', kind: 'pc', platform: 'Windows', interfaces: ['Eth0'] },
      { id: 'PRN1', kind: 'pc', platform: 'Printer', interfaces: ['Eth0'] },
    ],
    links: [
      { a: { deviceId: 'SW1', iface: 'Fa0/3' }, b: { deviceId: 'PC1', iface: 'Eth0' } },
      { a: { deviceId: 'SW1', iface: 'Fa0/4' }, b: { deviceId: 'PRN1', iface: 'Eth0' } },
    ],
  },
  setup: {
    SW1: [
      'enable',
      'configure terminal',
      'vlan 50',
      'name OPS-ENDPOINTS',
      'interface fa0/3',
      'description User workstation',
      'switchport mode access',
      'switchport access vlan 50',
      'interface fa0/4',
      'description Network printer',
      'switchport mode access',
      'switchport access vlan 50',
      'end',
    ],
  },
  objectives: [
    {
      id: 'configure-user-port',
      text: 'SW1 Fa0/3: keep it as a VLAN 50 access port and enable PortFast plus BPDU Guard',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        const port = sw1.device.switchports['Fa0/3'];
        return port.mode === 'access' && port.accessVlan === 50 && port.stpPortfast && port.bpduGuard;
      },
    },
    {
      id: 'configure-printer-port',
      text: 'SW1 Fa0/4: keep it as a VLAN 50 access port and enable PortFast plus BPDU Guard',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        const port = sw1.device.switchports['Fa0/4'];
        return port.mode === 'access' && port.accessVlan === 50 && port.stpPortfast && port.bpduGuard;
      },
    },
    {
      id: 'verify-portfast-bpduguard',
      text: 'SW1: verify both endpoint interfaces with show running-config interface',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        return (
          sw1.resolvedHistory.some((cmd) => /^show running-config interface fa0\/3$/i.test(cmd)) &&
          sw1.resolvedHistory.some((cmd) => /^show running-config interface fa0\/4$/i.test(cmd))
        );
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'PortFast belongs on endpoint-facing access ports. Confirm Fa0/3 and Fa0/4 stay in access mode for VLAN 50.',
    },
    {
      afterSeconds: 180,
      text: 'Use interface configuration commands: spanning-tree portfast and spanning-tree bpduguard enable.',
    },
    {
      afterSeconds: 300,
      text: 'Verify each interface with show running-config interface fa0/3 and show running-config interface fa0/4.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'SW1',
        note: 'Configure both endpoint-facing access ports for PortFast and BPDU Guard:',
        commands: [
          'enable',
          'configure terminal',
          'interface fa0/3',
          'switchport mode access',
          'switchport access vlan 50',
          'spanning-tree portfast',
          'spanning-tree bpduguard enable',
          'interface fa0/4',
          'switchport mode access',
          'switchport access vlan 50',
          'spanning-tree portfast',
          'spanning-tree bpduguard enable',
          'end',
          'show running-config interface fa0/3',
          'show running-config interface fa0/4',
        ],
      },
    ],
  },
};
