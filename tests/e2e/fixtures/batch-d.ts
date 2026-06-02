export type LabCommandStep = {
  device: string;
  commands: string[];
  workbench?: 'Command Prompt' | 'Controller CLI' | 'Terminal';
};

export type LabSmokeCase = {
  id: string;
  title: string;
  expectedComplete: string;
  steps: LabCommandStep[];
};

export const batchDOspfLabs: LabSmokeCase[] = [
  {
    id: 'ccna-lab18-ospf-tshoot-passive',
    title: 'Lab 18 — Troubleshoot OSPF: Passive-Interface on the Transit Link',
    expectedComplete: '4/4',
    steps: [
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 192.168.2.10'] },
      {
        device: 'R1',
        commands: [
          'enable',
          'show ip ospf neighbor',
          'show ip ospf',
          'configure terminal',
          'router ospf 1',
          'no passive-interface GigabitEthernet0/2',
          'passive-interface GigabitEthernet0/0',
          'end',
          'show ip ospf neighbor',
        ],
      },
      { device: 'PC-A', workbench: 'Terminal', commands: ['ping 192.168.2.10'] },
    ],
  },
  {
    id: 'ccna-lab19-ospf-tshoot-hello-timers',
    title: 'Lab 19 — Troubleshoot OSPF: Hello/Dead Timer Mismatch',
    expectedComplete: '5/5',
    steps: [
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 192.168.2.10'] },
      {
        device: 'R1',
        commands: ['enable', 'show ip ospf neighbor', 'show ip ospf interface GigabitEthernet0/2'],
      },
      {
        device: 'R2',
        commands: [
          'enable',
          'show ip ospf interface GigabitEthernet0/2',
          'configure terminal',
          'interface GigabitEthernet0/2',
          'ip ospf hello-interval 10',
          'ip ospf dead-interval 40',
          'end',
          'show ip ospf neighbor',
        ],
      },
      { device: 'PC-A', workbench: 'Terminal', commands: ['ping 192.168.2.10'] },
    ],
  },
  {
    id: 'ccna-lab20-ospf-tshoot-auth',
    title: 'Lab 20 — Troubleshoot OSPF: MD5 Authentication Mismatch',
    expectedComplete: '2/2',
    steps: [
      { device: 'PC-A', workbench: 'Command Prompt', commands: ['ping 10.2.0.10'] },
      {
        device: 'R1',
        commands: ['enable', 'show ip ospf neighbor', 'show running-config interface GigabitEthernet0/2'],
      },
      {
        device: 'R2',
        commands: [
          'enable',
          'show running-config interface GigabitEthernet0/2',
          'configure terminal',
          'interface GigabitEthernet0/2',
          'no ip ospf message-digest-key 1',
          'ip ospf message-digest-key 1 md5 CISCO123',
          'end',
          'show ip ospf neighbor',
        ],
      },
      { device: 'PC-A', workbench: 'Terminal', commands: ['ping 10.2.0.10'] },
    ],
  },
  {
    id: 'ccna-lab21-ospf-default-information',
    title: 'Lab 21 — OSPF: Redistribute a Default Route',
    expectedComplete: '3/3',
    steps: [
      { device: 'PC-B', workbench: 'Command Prompt', commands: ['ping 8.8.8.2'] },
      { device: 'R2', commands: ['enable', 'show ip route'] },
      {
        device: 'R1',
        commands: [
          'enable',
          'show ip route',
          'configure terminal',
          'router ospf 1',
          'default-information originate',
          'end',
        ],
      },
      { device: 'R2', commands: ['show ip route'] },
      { device: 'PC-B', workbench: 'Terminal', commands: ['ping 8.8.8.2'] },
    ],
  },
];
