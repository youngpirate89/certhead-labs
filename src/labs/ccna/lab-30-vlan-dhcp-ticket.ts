import type { Lab } from '@/engine/types';

/**
 * Lab 30 — Real-world ticket: new VLAN users cannot get DHCP.
 *
 * This is the first ticket-style lab after the exam-targeted set. The learner
 * starts from symptoms, not a command recipe: existing VLAN 10 users still get
 * DHCP, but the newly added VLAN 30 workstation falls back to APIPA/no lease.
 * The DHCP pools and router-on-a-stick gateway already exist; the access port
 * is in the right VLAN. The primary fault is isolated to the switch trunk
 * allowed list: SW1 Gi0/1 carries only VLAN 10 at start, so VLAN 30 never
 * reaches R1's subinterface/DHCP service.
 */
export const lab30VlanDhcpTicket: Lab = {
  id: 'ccna-lab30-vlan-dhcp-ticket',
  title: 'Ticket: New VLAN Users Cannot Get DHCP',
  exam: 'CCNA 200-301',
  difficulty: 4,
  estimatedMinutes: 20,
  isFree: false,
  scenario:
    'Ticket: Users connected to the new Operations VLAN report they cannot get an IP address. Existing office users are still working normally. The change request says VLAN 30 was added for the new area and DHCP should come from the existing branch router.\n\nStart by comparing the affected workstation with a known-good workstation, then inspect the switching path toward the router. Restore DHCP service for the affected VLAN without disrupting the existing VLAN.',
  topology: {
    devices: [
      {
        id: 'PC-EXISTING',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { dhcp: true },
        position: { x: 0, y: 480 },
      },
      {
        id: 'SW1',
        kind: 'switch',
        platform: 'C2960',
        interfaces: ['Fa0/10', 'Fa0/30', 'Gi0/1'],
        position: { x: 320, y: 240 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0'],
        position: { x: 320, y: 0 },
      },
      {
        id: 'PC-NEW',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { dhcp: true },
        position: { x: 640, y: 480 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-EXISTING', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/10' } },
      { a: { deviceId: 'SW1', iface: 'Gi0/1' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'SW1', iface: 'Fa0/30' }, b: { deviceId: 'PC-NEW', iface: 'Eth0' } },
    ],
  },
  setup: {
    SW1: [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Office',
      'exit',
      'vlan 30',
      'name Operations',
      'exit',
      'interface fa0/10',
      'switchport mode access',
      'switchport access vlan 10',
      'exit',
      'interface fa0/30',
      'switchport mode access',
      'switchport access vlan 30',
      'exit',
      'interface gi0/1',
      'switchport mode trunk',
      'switchport trunk allowed vlan 10',
    ],
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'no shutdown',
      'exit',
      'interface gi0/0.10',
      'encapsulation dot1q 10',
      'ip address 10.10.10.1 255.255.255.0',
      'exit',
      'interface gi0/0.30',
      'encapsulation dot1q 30',
      'ip address 10.10.30.1 255.255.255.0',
      'exit',
      'ip dhcp excluded-address 10.10.10.1 10.10.10.20',
      'ip dhcp excluded-address 10.10.30.1 10.10.30.20',
      'ip dhcp pool OFFICE',
      'network 10.10.10.0 255.255.255.0',
      'default-router 10.10.10.1',
      'dns-server 8.8.8.8',
      'exit',
      'ip dhcp pool OPERATIONS',
      'network 10.10.30.0 255.255.255.0',
      'default-router 10.10.30.1',
      'dns-server 8.8.8.8',
    ],
  },
  objectives: [
    {
      id: 'investigate-symptom',
      text: 'Compare the affected workstation against a known-good workstation.',
      check: (_state, _history, session) => {
        const affected = session.devices['PC-NEW'];
        const existing = session.devices['PC-EXISTING'];
        if (affected?.kind !== 'pc' || existing?.kind !== 'pc') return false;
        return affected.lastIpconfig > 0 && existing.lastIpconfig > 0;
      },
    },
    {
      id: 'restore-dhcp-service',
      text: 'Restore DHCP service for the affected VLAN without changing the DHCP server.',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        const trunk = sw1.device.switchports['Gi0/1'];
        return trunk?.mode === 'trunk' &&
          (trunk.trunkAllowedVlans === 'all' || trunk.trunkAllowedVlans.includes(30));
      },
    },
    {
      id: 'verify-new-vlan-lease',
      text: 'Verify the affected workstation receives a valid 10.10.30.0/24 DHCP lease.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-NEW'];
        if (pc?.kind !== 'pc') return false;
        return pc.lastIpconfig > 0 && pc.ip?.startsWith('10.10.30.') === true && pc.gateway === '10.10.30.1';
      },
    },
    {
      id: 'verify-trunk-after-fix',
      text: 'Verify the trunk carries the affected VLAN after the repair.',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        const trunk = sw1.device.switchports['Gi0/1'];
        const verified = sw1.lastShowInterfacesTrunk?.trunkPortIds.includes('Gi0/1') ?? false;
        return verified && trunk?.mode === 'trunk' &&
          (trunk.trunkAllowedVlans === 'all' || trunk.trunkAllowedVlans.includes(30));
      },
    },
    {
      id: 'preserve-existing-vlan',
      text: 'Confirm the existing VLAN still receives a valid 10.10.10.0/24 DHCP lease.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-EXISTING'];
        if (pc?.kind !== 'pc') return false;
        return pc.lastIpconfig > 0 && pc.ip?.startsWith('10.10.10.') === true && pc.gateway === '10.10.10.1';
      },
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      text: 'Start with evidence: compare ipconfig on the affected PC and a known-good PC. If one VLAN works and the new VLAN does not, DHCP itself may not be the first suspect.',
    },
    {
      afterSeconds: 210,
      text: 'Check the switch access port VLAN and then inspect the uplink toward the router with show interfaces trunk.',
    },
    {
      afterSeconds: 360,
      text: 'If the new VLAN is missing from the trunk, add only that VLAN to the allowed list so the existing VLAN stays in service.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'PC-NEW',
        note: 'Confirm the affected workstation has no valid DHCP lease:',
        commands: ['ipconfig'],
      },
      {
        device: 'PC-EXISTING',
        note: 'Compare with a known-good workstation in the existing VLAN:',
        commands: ['ipconfig'],
      },
      {
        device: 'SW1',
        note: 'Inspect the trunk toward R1 and then restore VLAN 30 on the allowed list:',
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
      {
        device: 'PC-NEW',
        note: 'Verify the affected workstation now receives a valid Operations VLAN lease:',
        commands: ['ipconfig'],
      },
      {
        device: 'PC-EXISTING',
        note: 'Confirm the original VLAN is still healthy:',
        commands: ['ipconfig'],
      },
    ],
  },
};
