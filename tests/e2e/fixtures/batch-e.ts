import type { LabSmokeCase } from './batch-d';

export const batchELabs22To28: LabSmokeCase[] = [
  {
    id: 'ccna-lab22-etherchannel-lacp',
    title: 'Lab 22 — EtherChannel LACP: Bundle Two Switch Links',
    expectedComplete: '3/3',
    steps: [
      {
        device: 'SW1',
        commands: [
          'enable',
          'configure terminal',
          'interface Fa0/23',
          'channel-group 1 mode active',
          'interface Fa0/24',
          'channel-group 1 mode active',
          'interface port-channel 1',
          'switchport mode trunk',
          'end',
          'show etherchannel summary',
        ],
      },
      {
        device: 'SW2',
        commands: [
          'enable',
          'configure terminal',
          'interface Fa0/23',
          'channel-group 1 mode active',
          'interface Fa0/24',
          'channel-group 1 mode active',
          'interface port-channel 1',
          'switchport mode trunk',
          'end',
          'show etherchannel summary',
        ],
      },
    ],
  },
  {
    id: 'ccna-lab23-stp-root-bridge',
    title: 'Lab 23 — STP Root Bridge: Control VLAN 10 Election',
    expectedComplete: '3/3',
    steps: [
      {
        device: 'SW1',
        commands: ['enable', 'configure terminal', 'spanning-tree vlan 10 root primary', 'end', 'show spanning-tree vlan 10'],
      },
      {
        device: 'SW2',
        commands: ['enable', 'configure terminal', 'spanning-tree vlan 10 root secondary', 'end', 'show spanning-tree vlan 10'],
      },
    ],
  },
  {
    id: 'ccna-lab24-ipv6-addressing-default-gateway',
    title: 'Lab 24 — IPv6 Addressing: Configure a LAN Default Gateway',
    expectedComplete: '6/6',
    steps: [
      {
        device: 'R1',
        commands: [
          'enable',
          'configure terminal',
          'interface GigabitEthernet0/0',
          'ipv6 address 2001:db8:acad:10::1/64',
          'no shutdown',
          'end',
          'show ipv6 interface brief',
        ],
      },
      {
        device: 'PC-A',
        workbench: 'Command Prompt',
        commands: [
          'New-NetIPAddress -InterfaceAlias Eth0 -IPAddress 2001:db8:acad:10::10 -PrefixLength 64 -DefaultGateway 2001:db8:acad:10::1',
          'Get-NetIPConfiguration',
        ],
      },
    ],
  },
  {
    id: 'ccna-lab25-ipv6-static-route',
    title: 'Lab 25 — IPv6 Static Routes: Connect Two Branch LANs',
    expectedComplete: '4/4',
    steps: [
      {
        device: 'R1',
        commands: [
          'enable',
          'configure terminal',
          'ipv6 route 2001:db8:acad:20::/64 2001:db8:acad:12::2',
          'end',
          'show ipv6 route',
        ],
      },
      {
        device: 'R2',
        commands: [
          'enable',
          'configure terminal',
          'ipv6 route 2001:db8:acad:10::/64 2001:db8:acad:12::1',
          'end',
          'show ipv6 route',
        ],
      },
    ],
  },
  {
    id: 'ccna-lab26-device-hardening-ssh',
    title: 'Lab 26 — Device Hardening: Enable SSH Management',
    expectedComplete: '6/6',
    steps: [
      {
        device: 'R1',
        commands: [
          'enable',
          'configure terminal',
          'hostname R1',
          'ip domain-name certhead.local',
          'username admin secret C1sco123',
          'enable secret En4ble123',
          'banner motd ^CUnauthorized access prohibited^C',
          'crypto key generate rsa modulus 1024',
          'line vty 0 4',
          'login local',
          'transport input ssh',
          'end',
          'show ip ssh',
          'show running-config',
        ],
      },
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ssh admin@192.168.1.1'] },
    ],
  },
  {
    id: 'ccna-lab27-ntp-syslog-basics',
    title: 'Lab 27 — NTP and Syslog: Centralized Time and Logging',
    expectedComplete: '7/7',
    steps: [
      {
        device: 'R1',
        commands: [
          'enable',
          'configure terminal',
          'ntp server 172.20.27.50',
          'service timestamps log datetime msec',
          'logging host 172.20.27.50',
          'logging trap informational',
          'end',
          'show ntp status',
          'show ntp associations',
          'show logging',
        ],
      },
    ],
  },
  {
    id: 'ccna-lab28-wireless-wlan-vlan-mapping',
    title: 'Lab 28 — Wireless Basics: Map a WLAN to a VLAN',
    expectedComplete: '7/7',
    steps: [
      {
        device: 'WLC1',
        workbench: 'Controller CLI',
        commands: [
          'config interface create CORP-USERS 20',
          'config wlan create 1 CORP-WIFI CORP-WIFI',
          'config wlan interface 1 CORP-USERS',
          'config wlan enable 1',
          'show wlan summary',
          'show wlan 1',
          'show client summary',
        ],
      },
    ],
  },
];
