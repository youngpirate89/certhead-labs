import type { LabSmokeCase } from './batch-d';

export const batchKNumberedLabs37To40: LabSmokeCase[] = [
  {
    id: 'ccna-lab37-tshoot-etherchannel-lacp-mode',
    title: 'Troubleshoot: EtherChannel LACP Mode Mismatch',
    expectedStart: '0/3',
    expectedComplete: '3/3',
    steps: [
      { device: 'SW1', commands: ['enable', 'show etherchannel summary'] },
      {
        device: 'SW2',
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
  {
    id: 'ccna-lab38-tshoot-ipv6-static-wrong-next-hop',
    title: 'Troubleshoot: IPv6 Static Route Wrong Next Hop',
    expectedStart: '0/4',
    expectedComplete: '4/4',
    steps: [
      {
        device: 'R1',
        commands: [
          'enable',
          'show ipv6 route',
          'configure terminal',
          'no ipv6 route 2001:db8:acad:38:20::/64 2001:db8:acad:38:12::3',
          'ipv6 route 2001:db8:acad:38:20::/64 2001:db8:acad:38:12::2',
          'end',
          'show ipv6 route',
        ],
      },
    ],
  },
  {
    id: 'ccna-lab39-tshoot-nat-outside-role',
    title: 'Ticket: NAT Outside Interface Missing',
    expectedStart: '0/5',
    expectedComplete: '5/5',
    steps: [
      { device: 'PC-BRANCH', workbench: 'Command Prompt', commands: ['ping 203.0.113.39'] },
      { device: 'R1', commands: ['enable', 'show ip nat translations', 'show running-config'] },
      { device: 'R1', commands: ['configure terminal', 'interface Gi0/1', 'ip nat outside', 'end'] },
      { device: 'PC-BRANCH', workbench: 'Command Prompt', commands: ['ping 203.0.113.39'] },
      { device: 'R1', commands: ['show ip nat translations'] },
    ],
  },
  {
    id: 'ccna-lab40-tshoot-dhcp-relay-wrong-helper',
    title: 'Ticket: DHCP Relay Points to Wrong Server',
    expectedStart: '0/5',
    expectedComplete: '5/5',
    steps: [
      { device: 'PC-FINANCE', workbench: 'Command Prompt', commands: ['ipconfig'] },
      { device: 'PC-HR', workbench: 'Command Prompt', commands: ['ipconfig'] },
      {
        device: 'R1',
        commands: [
          'enable',
          'show running-config interface gi0/1',
          'configure terminal',
          'interface gi0/1',
          'ip helper-address 10.80.0.10',
          'end',
          'show running-config interface gi0/1',
        ],
      },
      { device: 'PC-FINANCE', workbench: 'Command Prompt', commands: ['ipconfig'] },
      { device: 'PC-HR', workbench: 'Command Prompt', commands: ['ipconfig'] },
    ],
  },
];
