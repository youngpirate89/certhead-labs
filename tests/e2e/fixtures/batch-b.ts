import type { LabSmokeCase } from './batch-d';

export const batchBLabs07To11: LabSmokeCase[] = [
  {
    id: 'ccna-lab07-vlan-access-ports',
    title: 'VLANs: Segment Two Teams onto Access Ports',
    expectedStart: '0/3',
    expectedComplete: '3/3',
    steps: [
      { device: 'SW1', commands: ['enable', 'configure terminal', 'vlan 10', 'name Sales', 'exit', 'vlan 20', 'name Engineering', 'exit'] },
      {
        device: 'SW1',
        commands: ['interface Fa0/1', 'switchport mode access', 'switchport access vlan 10', 'exit', 'interface Fa0/2', 'switchport mode access', 'switchport access vlan 20', 'end', 'show vlan brief'],
      },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 192.168.20.10'] },
    ],
  },
  {
    id: 'ccna-lab08-vlan-trunking',
    title: 'VLAN Trunking: Span One VLAN Across Two Switches',
    expectedStart: '0/3',
    expectedComplete: '3/3',
    steps: [
      { device: 'SW1', commands: ['enable', 'configure terminal', 'interface Fa0/24', 'switchport mode trunk', 'end', 'show interfaces trunk'] },
      { device: 'SW2', commands: ['enable', 'configure terminal', 'interface Fa0/24', 'switchport mode trunk', 'end', 'show interfaces trunk'] },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 192.168.10.20'] },
    ],
  },
  {
    id: 'ccna-lab09-intervlan-routing',
    title: 'Inter-VLAN Routing - Router-on-a-Stick',
    expectedStart: '0/6',
    expectedComplete: '6/6',
    steps: [
      { device: 'R1', commands: ['enable', 'configure terminal', 'interface Gi0/0', 'no shutdown', 'exit'] },
      { device: 'R1', commands: ['interface Gi0/0.10', 'encapsulation dot1q 10', 'ip address 192.168.10.1 255.255.255.0', 'exit'] },
      { device: 'R1', commands: ['interface Gi0/0.20', 'encapsulation dot1q 20', 'ip address 192.168.20.1 255.255.255.0', 'end', 'show ip interface brief'] },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 192.168.20.10'] },
    ],
  },
  {
    id: 'ccna-lab10-dhcp-server',
    title: 'Configure DHCP Server',
    expectedStart: '0/6',
    expectedComplete: '6/6',
    steps: [
      { device: 'R1', commands: ['enable', 'configure terminal'] },
      { device: 'R1', commands: ['ip dhcp excluded-address 192.168.1.1 192.168.1.10'] },
      { device: 'R1', commands: ['ip dhcp pool LAN', ' network 192.168.1.0 255.255.255.0', ' default-router 192.168.1.1', ' dns-server 8.8.8.8', 'exit'] },
      { device: 'R1', commands: ['end', 'show ip dhcp binding'] },
    ],
  },
  {
    id: 'ccna-lab11-nat-pat',
    title: 'Configure PAT (NAT Overload)',
    expectedStart: '0/6',
    expectedComplete: '6/6',
    steps: [
      { device: 'R1', commands: ['enable', 'configure terminal'] },
      { device: 'R1', commands: ['access-list 1 permit 192.168.1.0 0.0.0.255'] },
      { device: 'R1', commands: ['interface Gi0/0', 'ip nat inside', 'exit'] },
      { device: 'R1', commands: ['interface Gi0/1', 'ip nat outside', 'exit'] },
      { device: 'R1', commands: ['ip nat inside source list 1 interface GigabitEthernet0/1 overload'] },
      { device: 'R1', commands: ['end'] },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 203.0.113.2'] },
      { device: 'R1', commands: ['show ip nat translations'] },
    ],
  },
];
