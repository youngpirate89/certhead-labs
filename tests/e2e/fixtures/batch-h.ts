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
  {
    id: 'ccna-tshoot-default-route-lost-at-branch',
    title: 'Troubleshoot: Branch Default Route Lost',
    expectedStart: '0/4',
    expectedComplete: '4/4',
    steps: [
      { device: 'BRANCH', commands: ['enable', 'show ip route'] },
      {
        device: 'BRANCH',
        commands: ['configure terminal', 'ip route 0.0.0.0 0.0.0.0 10.140.0.2', 'end'],
      },
      { device: 'BRANCH', commands: ['show ip route'] },
      { device: 'PC-BRANCH', workbench: 'Command Prompt', commands: ['ping 198.51.100.50'] },
    ],
  },
  {
    id: 'ccna-tshoot-return-route-missing-server-vlan',
    title: 'Troubleshoot: Server VLAN Return Route Missing',
    expectedStart: '0/5',
    expectedComplete: '5/5',
    steps: [
      { device: 'PC-BRANCH', workbench: 'Command Prompt', commands: ['ping 10.150.50.20'] },
      { device: 'CORE', commands: ['enable', 'show ip route'] },
      {
        device: 'CORE',
        commands: ['configure terminal', 'ip route 10.150.10.0 255.255.255.0 10.150.0.1', 'end'],
      },
      { device: 'CORE', commands: ['show ip route'] },
      { device: 'PC-BRANCH', workbench: 'Command Prompt', commands: ['ping 10.150.50.20'] },
    ],
  },
  {
    id: 'ccna-tshoot-floating-static-failover-broken',
    title: 'Troubleshoot: Floating Static Failover Broken',
    expectedStart: '0/4',
    expectedComplete: '4/4',
    steps: [
      { device: 'BRANCH', commands: ['enable', 'show ip route'] },
      {
        device: 'BRANCH',
        commands: [
          'configure terminal',
          'no ip route 0.0.0.0 0.0.0.0 10.160.0.9 200',
          'ip route 0.0.0.0 0.0.0.0 10.160.0.6 200',
          'end',
        ],
      },
      { device: 'BRANCH', commands: ['show ip route'] },
      { device: 'PC-BRANCH', workbench: 'Command Prompt', commands: ['ping 198.51.100.160'] },
    ],
  },
];
