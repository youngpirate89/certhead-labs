import type { LabSmokeCase } from './batch-d';

export const batchCLabs12To17: LabSmokeCase[] = [
  {
    id: 'ccna-lab12-extended-acl',
    title: 'Named Extended ACL: Block ICMP to Server',
    expectedStart: '0/6',
    expectedComplete: '6/6',
    steps: [
      { device: 'R1', commands: ['enable', 'configure terminal'] },
      { device: 'R1', commands: ['ip access-list extended BLOCK-ICMP', ' deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10', ' permit ip any any', 'exit'] },
      { device: 'R1', commands: ['interface GigabitEthernet0/0', ' ip access-group BLOCK-ICMP in', 'end'] },
      { device: 'R1', commands: ['show access-lists'] },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 192.168.2.10'] },
    ],
  },
  {
    id: 'ccna-lab13-ospf-tshoot',
    title: 'Troubleshoot OSPF: Mismatched Area',
    expectedStart: '0/2',
    expectedComplete: '2/2',
    steps: [
      { device: 'R1', commands: ['enable', 'show ip ospf neighbor', 'show ip ospf'] },
      { device: 'R2', commands: ['enable', 'show ip ospf neighbor', 'show ip ospf'] },
      {
        device: 'R2',
        commands: ['configure terminal', 'router ospf 1', 'no network 10.0.0.0 0.0.0.3 area 1', 'network 10.0.0.0 0.0.0.3 area 0', 'no network 192.168.2.0 0.0.0.255 area 1', 'network 192.168.2.0 0.0.0.255 area 0', 'end'],
      },
      { device: 'R2', commands: ['show ip ospf neighbor', 'show ip route'] },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 192.168.2.10'] },
    ],
  },
  {
    id: 'ccna-lab14-dhcp-relay',
    title: 'DHCP Relay - ip helper-address',
    expectedStart: '0/6',
    expectedComplete: '6/6',
    steps: [
      {
        device: 'SRV1',
        commands: ['enable', 'configure terminal', 'ip dhcp excluded-address 192.168.10.1 192.168.10.10', 'ip dhcp pool CLIENT_POOL', ' network 192.168.10.0 255.255.255.0', ' default-router 192.168.10.1', ' dns-server 8.8.8.8', 'end'],
      },
      { device: 'R1', commands: ['enable', 'configure terminal', 'interface gi0/0', ' ip helper-address 172.16.0.2', 'end'] },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ipconfig'] },
    ],
  },
  {
    id: 'ccna-lab15-default-static-route',
    title: 'Default Static Route - Gateway of Last Resort',
    expectedStart: '0/3',
    expectedComplete: '3/3',
    steps: [
      { device: 'R1', commands: ['enable', 'configure terminal', 'ip route 0.0.0.0 0.0.0.0 203.0.113.2', 'end'] },
      { device: 'R1', commands: ['show ip route'] },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 8.8.8.2'] },
    ],
  },
  {
    id: 'ccna-lab16-floating-static-route',
    title: 'Floating Static Route - Backup Path',
    expectedStart: '0/3',
    expectedComplete: '3/3',
    steps: [
      { device: 'R1', commands: ['enable', 'configure terminal', 'ip route 0.0.0.0 0.0.0.0 10.1.1.2', 'ip route 0.0.0.0 0.0.0.0 10.1.2.2 200', 'end'] },
      { device: 'R1', commands: ['show ip route'] },
    ],
  },
  {
    id: 'ccna-lab17-ospf-passive-interface',
    title: 'OSPF Passive-Interface: Suppress Hellos on Stub Segments',
    expectedStart: '0/4',
    expectedComplete: '4/4',
    steps: [
      { device: 'R1', commands: ['enable', 'configure terminal', 'router ospf 1', 'passive-interface GigabitEthernet0/0', 'end'] },
      { device: 'R2', commands: ['enable', 'configure terminal', 'router ospf 1', 'passive-interface GigabitEthernet0/0', 'end'] },
      { device: 'R1', commands: ['show ip ospf', 'show ip ospf neighbor'] },
    ],
  },
];
