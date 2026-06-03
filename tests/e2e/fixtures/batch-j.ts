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
  {
    id: 'ccna-tshoot-ospf-acl-overlap-ticket',
    title: 'Troubleshoot: OSPF and ACL Overlap Ticket',
    expectedStart: '0/7',
    expectedComplete: '7/7',
    steps: [
      { device: 'PC-BRANCH', workbench: 'Command Prompt', commands: ['ping 172.49.50.20'] },
      { device: 'BRANCH', commands: ['enable', 'show ip route'] },
      { device: 'EDGE', commands: ['enable', 'show ip route', 'show access-lists'] },
      {
        device: 'EDGE',
        commands: [
          'configure terminal',
          'router ospf 1',
          'default-information originate',
          'exit',
          'ip access-list extended BRANCH-APP-POLICY',
          'no 20',
          'permit tcp 10.49.10.0 0.0.0.255 host 172.49.50.20 eq 8443',
          'deny ip any any',
          'end',
          'show access-lists',
        ],
      },
      { device: 'BRANCH', commands: ['show ip route'] },
      { device: 'PC-BRANCH', workbench: 'Command Prompt', commands: ['ping 172.49.50.20'] },
    ],
  },
];
