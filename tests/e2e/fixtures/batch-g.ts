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
  {
    id: 'ccna-tshoot-dhcp-relay-missing',
    title: 'Troubleshoot: Missing DHCP Relay',
    expectedStart: '0/5',
    expectedComplete: '5/5',
    steps: [
      { device: 'PC-SALES', workbench: 'Command Prompt', commands: ['ipconfig'] },
      { device: 'PC-OPS', workbench: 'Command Prompt', commands: ['ipconfig'] },
      {
        device: 'R1',
        commands: [
          'enable',
          'show running-config interface gi0/1',
          'configure terminal',
          'interface gi0/1',
          'ip helper-address 10.60.0.10',
          'end',
          'show running-config interface gi0/1',
        ],
      },
      { device: 'PC-SALES', workbench: 'Command Prompt', commands: ['ipconfig'] },
      { device: 'PC-OPS', workbench: 'Command Prompt', commands: ['ipconfig'] },
    ],
  },
  {
    id: 'ccna-tshoot-acl-blocks-business-app',
    title: 'Troubleshoot: ACL Blocks Business App',
    expectedStart: '0/5',
    expectedComplete: '5/5',
    steps: [
      { device: 'PC-STAFF', workbench: 'Command Prompt', commands: ['ping 172.16.50.20'] },
      { device: 'R1', commands: ['enable', 'show access-lists'] },
      {
        device: 'R1',
        commands: [
          'configure terminal',
          'ip access-list extended STAFF-DMZ-FILTER',
          'no 20',
          'permit tcp 172.16.40.0 0.0.0.255 host 172.16.50.20 eq 8443',
          'deny ip any any',
          'end',
          'show access-lists',
        ],
      },
    ],
  },
];
