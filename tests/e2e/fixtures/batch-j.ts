import type { LabSmokeCase } from './batch-d';

export const batchJTicketLabs: LabSmokeCase[] = [
  {
    id: 'ccna-tshoot-ipv6-missing-default-gateway',
    title: 'Troubleshoot: IPv6 Default Gateway Missing',
    expectedStart: '0/4',
    expectedComplete: '4/4',
    steps: [
      { device: 'PC-OPS', workbench: 'Command Prompt', commands: ['Get-NetIPConfiguration'] },
      { device: 'R1', commands: ['enable', 'show ipv6 interface brief'] },
      {
        device: 'PC-OPS',
        workbench: 'Command Prompt',
        commands: [
          'New-NetIPAddress -InterfaceAlias Eth0 -IPAddress 2001:db8:47:10::50 -PrefixLength 64 -DefaultGateway 2001:db8:47:10::1',
          'Get-NetIPConfiguration',
        ],
      },
    ],
  },
  {
    id: 'ccna-tshoot-api-management-acl-repair',
    title: 'Troubleshoot: API-Assisted Management ACL Repair',
    expectedStart: '0/6',
    expectedComplete: '6/6',
    steps: [
      {
        device: 'ADMIN-PC',
        workbench: 'Command Prompt',
        commands: [
          'curl http://api.certhead.local/devices',
          'curl http://api.certhead.local/devices/R1',
          'curl http://api.certhead.local/devices/R1/interfaces',
          'curl http://api.certhead.local/devices/R1/interfaces/Gi0%2F0',
          'ping 10.48.10.1',
          'ssh admin@10.48.10.1',
        ],
      },
      { device: 'R1', commands: ['enable', 'show running-config | section line vty', 'show access-lists'] },
      {
        device: 'R1',
        commands: [
          'configure terminal',
          'access-list 48 permit 10.48.10.0 0.0.0.255',
          'end',
          'show access-lists',
        ],
      },
      { device: 'ADMIN-PC', workbench: 'Command Prompt', commands: ['ssh admin@10.48.10.1'] },
    ],
  },
];
