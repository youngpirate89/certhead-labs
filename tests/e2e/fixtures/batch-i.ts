import type { LabSmokeCase } from './batch-d';

export const batchITicketLabs: LabSmokeCase[] = [
  {
    id: 'ccna-tshoot-ssh-management-denied',
    title: 'Troubleshoot: SSH Management Denied',
    expectedStart: '0/5',
    expectedComplete: '5/5',
    steps: [
      { device: 'ADMIN-PC', workbench: 'Command Prompt', commands: ['ping 10.180.10.5', 'ssh admin@10.180.10.5'] },
      { device: 'R1', commands: ['enable', 'show running-config | section line vty', 'show access-lists'] },
      {
        device: 'R1',
        commands: [
          'configure terminal',
          'access-list 23 permit 10.180.10.0 0.0.0.255',
          'end',
          'show access-lists',
        ],
      },
      { device: 'ADMIN-PC', workbench: 'Command Prompt', commands: ['ssh admin@10.180.10.5'] },
    ],
  },
];
