import type { Lab } from '@/engine/types';

/**
 * Lab 22 — EtherChannel LACP config/verify.
 *
 * Topology: SW1 and SW2 have two parallel links: Fa0/23 and Fa0/24. STP is not
 * modeled yet, so this first EtherChannel lab intentionally avoids promising a
 * connectivity/loop fix. The learner builds LACP Port-channel1, configures the
 * logical interface as a trunk, then verifies the bundle with show etherchannel
 * summary.
 */
export const lab22EtherchannelLacp: Lab = {
  id: 'ccna-lab22-etherchannel-lacp',
  title: 'EtherChannel LACP: Bundle Two Switch Links',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    'Two access switches, SW1 and SW2, are connected with two parallel links: Fa0/23 and Fa0/24. Your task is to bundle those physical links into LACP Port-channel1, configure the logical Port-channel as an 802.1Q trunk, and verify that the bundle is in use.\n\nThis lab focuses on EtherChannel configuration and verification. STP behavior is not part of this lab, so prove success with show etherchannel summary rather than a connectivity test.',
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
  objectives: [
    {
      id: 'members-added',
      text: 'SW1 and SW2: add Fa0/23 and Fa0/24 to channel-group 1 using LACP mode active',
      check: (_state, _history, session) => {
        for (const id of ['SW1', 'SW2'] as const) {
          const sw = session.devices[id];
          if (sw?.kind !== 'switch') return false;
          for (const iface of ['Fa0/23', 'Fa0/24'] as const) {
            const port = sw.device.switchports[iface];
            if (!port) return false;
            if (port.channelGroup !== 1 || port.lacpMode !== 'active') return false;
          }
        }
        return true;
      },
    },
    {
      id: 'portchannel-trunk',
      text: 'SW1 and SW2: configure interface Port-channel1 as a trunk',
      check: (_state, _history, session) => {
        for (const id of ['SW1', 'SW2'] as const) {
          const sw = session.devices[id];
          if (sw?.kind !== 'switch') return false;
          const po1 = sw.device.portChannels.get(1);
          if (!po1 || po1.mode !== 'trunk') return false;
          if (!po1.bundled) return false;
        }
        return true;
      },
    },
    {
      id: 'etherchannel-verified',
      text: 'SW1 or SW2: run show etherchannel summary after Port-channel1 is bundled',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        const sw2 = session.devices.SW2;
        if (sw1?.kind !== 'switch' || sw2?.kind !== 'switch') return false;
        const bothBundled = sw1.device.portChannels.get(1)?.bundled === true && sw2.device.portChannels.get(1)?.bundled === true;
        if (!bothBundled) return false;
        const sw1Verified = sw1.lastShowEtherchannelSummary?.bundledGroups.includes(1) ?? false;
        const sw2Verified = sw2.lastShowEtherchannelSummary?.bundledGroups.includes(1) ?? false;
        return sw1Verified || sw2Verified;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'EtherChannel membership is configured under each physical interface with channel-group 1 mode active.',
    },
    {
      afterSeconds: 180,
      text: 'Configure Fa0/23 and Fa0/24 on both switches. Then configure interface Port-channel1, not the physical members, as the trunk.',
    },
    {
      afterSeconds: 300,
      text: 'Use show etherchannel summary and look for Po1(SU) with Fa0/23(P) and Fa0/24(P).',
    },
  ],
  solution: {
    steps: [
      {
        device: 'SW1',
        note: 'Create the LACP bundle and configure the logical Port-channel as a trunk on SW1:',
        commands: [
          'enable',
          'configure terminal',
          'interface Fa0/23',
          'channel-group 1 mode active',
          'interface Fa0/24',
          'channel-group 1 mode active',
          'interface Port-channel 1',
          'switchport mode trunk',
          'end',
          'show etherchannel summary',
        ],
      },
      {
        device: 'SW2',
        note: 'Mirror the LACP bundle and trunk configuration on SW2:',
        commands: [
          'enable',
          'configure terminal',
          'interface Fa0/23',
          'channel-group 1 mode active',
          'interface Fa0/24',
          'channel-group 1 mode active',
          'interface Port-channel 1',
          'switchport mode trunk',
          'end',
          'show etherchannel summary',
        ],
      },
    ],
  },
};
