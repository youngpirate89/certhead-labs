import type { LabSmokeCase } from './batch-d';

export const batchALabs01To06: LabSmokeCase[] = [
  {
    id: 'ccna-l01-interface-ip',
    title: 'Configure Interface IP & Bring Link Up',
    expectedStart: '0/3',
    expectedComplete: '3/3',
    steps: [
      {
        device: 'R1',
        commands: [
          'enable',
          'configure terminal',
          'interface GigabitEthernet0/0',
          'ip address 192.168.1.1 255.255.255.0',
          'no shutdown',
          'exit',
          'end',
          'show ip interface brief',
        ],
      },
    ],
  },
  {
    id: 'ccna-lab02-network-discovery',
    title: 'Network Discovery: Interfaces, VLANs, Routes, and Ping',
    expectedStart: '0/3',
    expectedComplete: '3/3',
    steps: [
      { device: 'R1', commands: ['enable', 'show ip interface brief', 'show interfaces', 'show ip route'] },
      { device: 'SW1', commands: ['enable', 'show vlan brief', 'show interfaces'] },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ipconfig', 'ping 192.168.2.1'] },
    ],
  },
  {
    id: 'ccna-lab03-ipv4-subnetting-routed-interfaces',
    title: 'IPv4 Subnetting: Address Routed Interfaces',
    expectedStart: '0/4',
    expectedComplete: '4/4',
    steps: [
      {
        device: 'R1',
        commands: [
          'enable',
          'configure terminal',
          'interface GigabitEthernet0/0',
          'ip address 172.16.10.1 255.255.255.192',
          'no shutdown',
          'exit',
          'interface GigabitEthernet0/1',
          'ip address 10.10.10.1 255.255.255.252',
          'no shutdown',
          'end',
          'show ip interface brief',
        ],
      },
      {
        device: 'R2',
        commands: [
          'enable',
          'configure terminal',
          'interface GigabitEthernet0/0',
          'ip address 172.16.10.65 255.255.255.224',
          'no shutdown',
          'exit',
          'interface GigabitEthernet0/1',
          'ip address 10.10.10.2 255.255.255.252',
          'no shutdown',
          'end',
          'show ip interface brief',
        ],
      },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 172.16.10.1'] },
      { device: 'PC-B', workbench: 'Command Prompt', commands: ['ping 172.16.10.65'] },
    ],
  },
  {
    id: 'ccna-lab04-static-route-fundamentals',
    title: 'Static Routes: Connect Two Subnetted LANs',
    expectedStart: '0/4',
    expectedComplete: '4/4',
    steps: [
      {
        device: 'R1',
        commands: ['enable', 'configure terminal', 'ip route 172.16.10.64 255.255.255.224 10.10.10.2', 'end', 'show ip route'],
      },
      {
        device: 'R2',
        commands: ['enable', 'configure terminal', 'ip route 172.16.10.0 255.255.255.192 10.10.10.1', 'end', 'show ip route'],
      },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 172.16.10.70'] },
    ],
  },
  {
    id: 'ccna-lab05-ospf-single-area',
    title: 'OSPF Single-Area: Branch to HQ',
    expectedStart: '0/3',
    expectedComplete: '3/3',
    steps: [
      {
        device: 'R1',
        commands: ['enable', 'configure terminal', 'router ospf 1', 'network 192.168.1.0 0.0.0.255 area 0', 'network 10.0.0.0 0.0.0.3 area 0', 'end'],
      },
      {
        device: 'R2',
        commands: ['enable', 'configure terminal', 'router ospf 1', 'network 192.168.2.0 0.0.0.255 area 0', 'network 10.0.0.0 0.0.0.3 area 0', 'end', 'show ip ospf neighbor'],
      },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 192.168.2.10'] },
    ],
  },
  {
    id: 'ccna-lab06-standard-acl',
    title: 'Standard ACL: Block One Host',
    expectedStart: '0/3',
    expectedComplete: '3/3',
    steps: [
      { device: 'R1', commands: ['enable', 'configure terminal', 'access-list 1 deny host 192.168.1.10', 'access-list 1 permit 192.168.1.0 0.0.0.255'] },
      { device: 'R1', commands: ['interface Gi0/1', 'ip access-group 1 out', 'end', 'show access-lists'] },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 192.168.2.10'] },
    ],
  },
];
