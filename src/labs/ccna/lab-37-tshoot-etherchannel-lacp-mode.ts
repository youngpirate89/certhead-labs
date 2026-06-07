import type { Lab } from '@/engine/types';

export const lab37TshootEtherchannelLacpMode: Lab = {
  id: 'ccna-lab37-tshoot-etherchannel-lacp-mode',
  title: 'Troubleshoot: EtherChannel LACP Mode Mismatch',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 14,
  isFree: false,
  scenario:
    'A server-room uplink between SW1 and SW2 was intended to use LACP Port-channel1 across Fa0/23 and Fa0/24. The links are cabled and both switches have channel-group 1 configured, but the bundle is not in use and VLAN trunks are not riding over the logical Port-channel as expected.\n\nTroubleshoot the EtherChannel state, identify the side using incompatible static EtherChannel mode, repair SW2 so both member links negotiate with LACP, keep Port-channel1 as the trunk, and verify the bundle comes up.',
  topology: {
    devices: [
      { id: 'SW1', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/23', 'Fa0/24'] },
      { id: 'SW2', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/23', 'Fa0/24'] },
    ],
    links: [
      { a: { deviceId: 'SW1', iface: 'Fa0/23' }, b: { deviceId: 'SW2', iface: 'Fa0/23' } },
      { a: { deviceId: 'SW1', iface: 'Fa0/24' }, b: { deviceId: 'SW2', iface: 'Fa0/24' } },
    ],
  },
  setup: {
    SW1: [
      'enable',
      'configure terminal',
      'interface fa0/23',
      'channel-group 1 mode active',
      'interface fa0/24',
      'channel-group 1 mode active',
      'interface port-channel 1',
      'switchport mode trunk',
      'end',
    ],
    SW2: [
      'enable',
      'configure terminal',
      'interface fa0/23',
      'channel-group 1 mode on',
      'interface fa0/24',
      'channel-group 1 mode on',
      'interface port-channel 1',
      'switchport mode trunk',
      'end',
    ],
  },
  objectives: [
    {
      id: 'diagnose-unbundled-channel',
      text: 'SW1 or SW2: use show etherchannel summary to identify that Port-channel1 is down and members are stand-alone',
      check: (_state, history, session) => {
        const sw1 = session.devices.SW1;
        const sw2 = session.devices.SW2;
        if (sw1?.kind !== 'switch' || sw2?.kind !== 'switch') return false;
        const sw1Checked = history.SW1?.resolved.some((cmd) => cmd === 'show etherchannel summary') ?? false;
        const sw2Checked = history.SW2?.resolved.some((cmd) => cmd === 'show etherchannel summary') ?? false;
        return sw1Checked || sw2Checked;
      },
    },
    {
      id: 'repair-sw2-lacp-mode',
      text: 'SW2: change Fa0/23 and Fa0/24 from static on mode to LACP active in channel-group 1',
      check: (_state, _history, session) => {
        const sw2 = session.devices.SW2;
        if (sw2?.kind !== 'switch') return false;
        return (['Fa0/23', 'Fa0/24'] as const).every((iface) => {
          const port = sw2.device.switchports[iface];
          return port.channelGroup === 1 && port.lacpMode === 'active';
        });
      },
    },
    {
      id: 'verify-portchannel-bundled',
      text: 'SW2: verify after the repair that Port-channel1 is bundled and both members show bundled in show etherchannel summary',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        const sw2 = session.devices.SW2;
        if (sw1?.kind !== 'switch' || sw2?.kind !== 'switch') return false;
        const bothBundled = sw1.device.portChannels.get(1)?.bundled === true && sw2.device.portChannels.get(1)?.bundled === true;
        const sw2Verified = sw2.lastShowEtherchannelSummary?.bundledGroups.includes(1) ?? false;
        return bothBundled && sw2Verified;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Start with show etherchannel summary. Po1(SD) and member links marked (I) mean the channel exists but is not bundled.',
    },
    {
      afterSeconds: 180,
      text: 'LACP active/passive can bundle when at least one side is active. Static mode on does not negotiate with LACP active.',
    },
    {
      afterSeconds: 300,
      text: 'On SW2, remove the existing channel-group from Fa0/23 and Fa0/24, then add them back with channel-group 1 mode active. Verify Po1(SU) and member links marked (P).',
    },
  ],
  solution: {
    steps: [
      {
        device: 'SW1',
        note: 'Confirm the EtherChannel is not bundled from either side:',
        commands: [
          'enable',
          'show etherchannel summary',
        ],
      },
      {
        device: 'SW2',
        note: 'Repair SW2 so both member links use LACP active, keep Port-channel1 as the trunk, and verify the bundle:',
        commands: [
          'enable',
          'show etherchannel summary',
          'configure terminal',
          'interface fa0/23',
          'no channel-group',
          'channel-group 1 mode active',
          'interface fa0/24',
          'no channel-group',
          'channel-group 1 mode active',
          'interface port-channel 1',
          'switchport mode trunk',
          'end',
          'show etherchannel summary',
        ],
      },
    ],
  },
};
