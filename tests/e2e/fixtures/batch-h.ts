import type { LabSmokeCase } from './batch-d';

export const batchHTicketLabs: LabSmokeCase[] = [
  {
    id: 'ccna-tshoot-nat-vlan-omission',
    title: 'Troubleshoot: NAT Omits One VLAN',
    expectedStart: '0/5',
    expectedComplete: '5/5',
    steps: [
      { device: 'PC-ADMIN', workbench: 'Command Prompt', commands: ['ping 203.0.113.10'] },
      { device: 'PC-TRAINING', workbench: 'Command Prompt', commands: ['ping 203.0.113.10'] },
      { device: 'R1', commands: ['enable', 'show ip nat translations', 'show access-lists'] },
      {
        device: 'R1',
        commands: [
          'configure terminal',
          'access-list 1 permit 10.120.20.0 0.0.0.255',
          'end',
          'show ip nat translations',
        ],
      },
      { device: 'PC-TRAINING', workbench: 'Command Prompt', commands: ['ping 203.0.113.10'] },
    ],
  },
];
