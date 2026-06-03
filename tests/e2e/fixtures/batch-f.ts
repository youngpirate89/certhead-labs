import type { LabSmokeCase } from './batch-d';

export const batchFLabs29To30AndTickets: LabSmokeCase[] = [
  {
    id: 'ccna-lab29-automation-api-basics',
    title: 'Lab 29 — Automation Ticket: Validate Branch Device Facts',
    expectedComplete: '5/5',
    steps: [
      {
        device: 'Admin-PC',
        workbench: 'Command Prompt',
        commands: [
          'curl http://api.certhead.local/devices',
          'curl http://api.certhead.local/devices/R1',
          'curl http://api.certhead.local/devices/SW1',
          'curl http://api.certhead.local/devices/R1/interfaces',
          'curl http://api.certhead.local/devices/R1/interfaces/Gi0%2F0',
        ],
      },
    ],
  },
  {
    id: 'ccna-lab30-vlan-dhcp-ticket',
    title: 'Lab 30 — Ticket: New VLAN Users Cannot Get DHCP',
    expectedComplete: '5/5',
    steps: [
      { device: 'PC-NEW', workbench: 'Command Prompt', commands: ['ipconfig'] },
      { device: 'PC-EXISTING', workbench: 'Command Prompt', commands: ['ipconfig'] },
      {
        device: 'SW1',
        commands: [
          'enable',
          'show interfaces trunk',
          'configure terminal',
          'interface Gi0/1',
          'switchport trunk allowed vlan add 30',
          'end',
          'show interfaces trunk',
        ],
      },
      { device: 'PC-NEW', workbench: 'Command Prompt', commands: ['ipconfig'] },
      { device: 'PC-EXISTING', workbench: 'Command Prompt', commands: ['ipconfig'] },
    ],
  },
  {
    id: 'ccna-tshoot-return-route',
    title: "Troubleshoot: PC-A can't reach PC-B",
    expectedComplete: '2/2',
    steps: [
      {
        device: 'R2',
        commands: [
          'enable',
          'configure terminal',
          'ip route 192.168.1.0 255.255.255.0 192.168.12.1',
          'end',
        ],
      },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 192.168.2.10'] },
    ],
  },
  {
    id: 'ccna-tshoot-wrong-next-hop',
    title: 'Troubleshoot: R2 points at the wrong next-hop',
    expectedComplete: '2/2',
    steps: [
      {
        device: 'R2',
        commands: [
          'enable',
          'configure terminal',
          'no ip route 192.168.1.0 255.255.255.0 192.168.12.99',
          'ip route 192.168.1.0 255.255.255.0 192.168.12.1',
          'end',
        ],
      },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 192.168.2.10'] },
    ],
  },
  {
    id: 'ccna-tshoot-wan-subnet-mismatch',
    title: 'Troubleshoot: Mismatched WAN subnet',
    expectedComplete: '2/2',
    steps: [
      {
        device: 'R2',
        commands: [
          'enable',
          'configure terminal',
          'interface Gi0/0',
          'no ip address',
          'ip address 192.168.12.2 255.255.255.252',
          'end',
        ],
      },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 192.168.2.10'] },
    ],
  },
  {
    id: 'ccna-tshoot-egress-down',
    title: 'Troubleshoot: WAN connectivity loss',
    expectedComplete: '2/2',
    steps: [
      {
        device: 'R1',
        commands: ['enable', 'configure terminal', 'interface Gi0/2', 'no shutdown', 'end'],
      },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 192.168.2.10'] },
    ],
  },
];
