import type { Lab } from '@/engine/types';

export const lab36TshootBpduguardErrdisabled: Lab = {
  id: 'ccna-lab36-tshoot-bpduguard-errdisabled',
  title: 'Troubleshoot BPDU Guard Err-Disabled Access Port',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 14,
  isFree: false,
  scenario:
    'A conference-room drop on SW1 stopped working after someone connected a small unmanaged switch behind the wall jack. The help desk reports the room is now back to a single workstation, but the access port is still down.\n\nDiagnose why Fa0/5 is err-disabled, remove the unsafe BPDU Guard condition for this shared drop, recover the interface with a shut/no shut cycle, and verify the port is connected again.',
  topology: {
    devices: [
      { id: 'SW1', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/1', 'Fa0/5'] },
      { id: 'PC-CONF', kind: 'pc', platform: 'Windows', interfaces: ['Eth0'] },
    ],
    links: [
      { a: { deviceId: 'SW1', iface: 'Fa0/5' }, b: { deviceId: 'PC-CONF', iface: 'Eth0' } },
    ],
  },
  setup: {
    SW1: [
      'enable',
      'configure terminal',
      'vlan 60',
      'name CONF-ROOMS',
      'interface fa0/5',
      'description Conference room drop',
      'switchport mode access',
      'switchport access vlan 60',
      'spanning-tree portfast',
      'spanning-tree bpduguard enable',
      'shutdown',
      'end',
    ],
  },
  objectives: [
    {
      id: 'diagnose-errdisabled-port',
      text: 'SW1: identify Fa0/5 as err-disabled with show interfaces status',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        return sw1.resolvedHistory.some((cmd) => /^show interfaces status$/i.test(cmd));
      },
    },
    {
      id: 'inspect-bpduguard-config',
      text: 'SW1: inspect Fa0/5 running configuration for PortFast and BPDU Guard',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        return sw1.resolvedHistory.some((cmd) => /^show running-config interface fa0\/5$/i.test(cmd));
      },
    },
    {
      id: 'clear-bpduguard-trigger',
      text: 'SW1 Fa0/5: disable the BPDU Guard setting that keeps this shared drop unusable',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        const port = sw1.device.switchports['Fa0/5'];
        return port.mode === 'access' && port.accessVlan === 60 && port.stpPortfast && !port.bpduGuard;
      },
    },
    {
      id: 'recover-interface',
      text: 'SW1 Fa0/5: recover the err-disabled port with shutdown followed by no shutdown',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        const port = sw1.device.switchports['Fa0/5'];
        const shutdownIndex = sw1.resolvedHistory.findIndex((cmd) => /^shutdown$/i.test(cmd));
        const noShutdownIndex = sw1.resolvedHistory.findIndex((cmd, index) => index > shutdownIndex && /^no shutdown$/i.test(cmd));
        return !port.errDisabled && port.adminUp && shutdownIndex !== -1 && noShutdownIndex !== -1;
      },
    },
    {
      id: 'verify-port-restored',
      text: 'SW1: verify after the repair that Fa0/5 is connected in VLAN 60',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        const port = sw1.device.switchports['Fa0/5'];
        const lastStatus = sw1.lastShowInterfacesStatus;
        return !!lastStatus?.connectedPortIds.includes('Fa0/5') && !port.errDisabled && port.accessVlan === 60;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Start with show interfaces status. Err-disabled is different from a normal administratively down or notconnect state.',
    },
    {
      afterSeconds: 180,
      text: 'Use show running-config interface fa0/5 to see why this edge-port protection triggered.',
    },
    {
      afterSeconds: 300,
      text: 'After removing BPDU Guard from Fa0/5, bounce the port with shutdown and no shutdown, then verify with show interfaces status.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'SW1',
        note: 'Diagnose the err-disabled access port, remove BPDU Guard for this shared conference-room drop, recover the interface, and verify status:',
        commands: [
          'enable',
          'show interfaces status',
          'show running-config interface fa0/5',
          'configure terminal',
          'interface fa0/5',
          'shutdown',
          'no spanning-tree bpduguard enable',
          'no shutdown',
          'end',
          'show interfaces status',
        ],
      },
    ],
  },
};
