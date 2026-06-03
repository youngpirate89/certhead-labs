import type { LabSmokeCase } from './batch-d';

export const batchGTicketLabs: LabSmokeCase[] = [
  {
    id: 'ccna-tshoot-vlan-trunk-allowed-list',
    title: 'Troubleshoot: Sales VLAN Missing from Trunk',
    expectedStart: '0/3',
    expectedComplete: '3/3',
    steps: [
      {
        device: 'SW1',
        commands: [
          'enable',
          'show interfaces trunk',
          'configure terminal',
          'interface Fa0/24',
          'switchport trunk allowed vlan add 30',
          'end',
          'show interfaces trunk',
        ],
      },
      {
        device: 'SW2',
        commands: [
          'enable',
          'configure terminal',
          'interface Fa0/24',
          'switchport trunk allowed vlan add 30',
          'end',
          'show interfaces trunk',
        ],
      },
      { device: 'PC-SALES', workbench: 'Command Prompt', commands: ['ping 192.168.30.50'] },
    ],
  },
];
