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
  {
    id: 'ccna-tshoot-ntp-syslog-source-mismatch',
    title: 'Troubleshoot: NTP and Syslog Server Mismatch',
    expectedStart: '0/5',
    expectedComplete: '5/5',
    steps: [
      { device: 'BRANCH', commands: ['enable', 'show running-config | include ntp|logging', 'show ntp status', 'show logging'] },
      {
        device: 'BRANCH',
        commands: [
          'configure terminal',
          'no ntp server 10.190.0.10',
          'ntp server 10.190.0.50',
          'no logging host 10.190.0.10',
          'logging host 10.190.0.50',
          'end',
          'show running-config | include ntp|logging',
          'show ntp status',
          'show logging',
        ],
      },
    ],
  },
  {
    id: 'ccna-tshoot-wireless-client-wrong-vlan',
    title: 'Troubleshoot: Wireless Client in Wrong VLAN',
    expectedStart: '0/5',
    expectedComplete: '5/5',
    steps: [
      { device: 'LAPTOP-SALES', workbench: 'Command Prompt', commands: ['ipconfig'] },
      { device: 'WLC', workbench: 'Controller CLI', commands: ['show wlan summary', 'show wlan 1'] },
      {
        device: 'WLC',
        workbench: 'Controller CLI',
        commands: ['config wlan interface 1 SALES-USERS', 'show wlan summary', 'show wlan 1', 'show client summary'],
      },
      { device: 'LAPTOP-SALES', workbench: 'Command Prompt', commands: ['ipconfig'] },
    ],
  },
];
