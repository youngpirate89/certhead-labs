import type { Lab } from '@/engine/types';

/**
 * Lab 29 — Automation/API basics.
 *
 * Scope: CCNA automation and programmability fundamentals. This is a
 * read-only interpretation lab: learners query a scoped JSON API from a
 * workstation and compare structured device facts with the topology. It does
 * not require writing scripts, modifying devices through an API, RESTCONF auth,
 * tokens, YANG models, or a general-purpose HTTP client.
 */
export const lab29AutomationApiBasics: Lab = {
  id: 'ccna-lab29-automation-api-basics',
  title: 'Automation Ticket: Validate Branch Device Facts',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    'A branch change is scheduled, but the engineer needs a quick read-only validation before touching the network. From Admin-PC, use the internal device-facts API to confirm which devices are in scope and which R1 interface is the active management-facing link toward the switch.\n\nYour goal is not to configure the network. Use the JSON output to verify inventory, inspect R1 and SW1 facts, list R1 interfaces, then query the specific R1 interface that proves Gi0/0 is the active management path.',
  topology: {
    devices: [
      {
        id: 'Admin-PC',
        kind: 'pc',
        platform: 'Windows Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '10.29.10.50', mask: '255.255.255.0', gateway: '10.29.10.1' },
        position: { x: 0, y: 30 },
      },
      {
        id: 'SW1',
        kind: 'switch',
        platform: 'Catalyst 2960',
        interfaces: ['Fa0/1', 'Fa0/2'],
        position: { x: 290, y: 30 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 580, y: 30 },
      },
    ],
    links: [
      { a: { deviceId: 'Admin-PC', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/1' } },
      { a: { deviceId: 'SW1', iface: 'Fa0/2' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
    ],
  },
  setup: {
    SW1: [
      'enable',
      'configure terminal',
      'vlan 29',
      'name AUTOMATION-MGMT',
      'exit',
      'interface fa0/1',
      'switchport mode access',
      'switchport access vlan 29',
      'no shutdown',
      'exit',
      'interface fa0/2',
      'switchport mode access',
      'switchport access vlan 29',
      'no shutdown',
      'end',
    ],
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'description MGMT-LAN',
      'ip address 10.29.10.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'description RESERVED-WAN',
      'shutdown',
      'end',
    ],
  },
  objectives: [
    {
      id: 'query-device-inventory',
      text: 'Admin-PC: query the device inventory API endpoint',
      check: (_state, _history, session) => {
        const pc = session.devices['Admin-PC'];
        return pc?.kind === 'pc' && pc.lastApiInventory > 0;
      },
    },
    {
      id: 'inspect-r1-json',
      text: 'Admin-PC: inspect the JSON detail for R1',
      check: (_state, _history, session) => {
        const pc = session.devices['Admin-PC'];
        return pc?.kind === 'pc' && (pc.lastApiDeviceDetail.get('R1') ?? 0) > 0;
      },
    },
    {
      id: 'inspect-sw1-json',
      text: 'Admin-PC: inspect the JSON detail for SW1',
      check: (_state, _history, session) => {
        const pc = session.devices['Admin-PC'];
        return pc?.kind === 'pc' && (pc.lastApiDeviceDetail.get('SW1') ?? 0) > 0;
      },
    },
    {
      id: 'verify-r1-interfaces',
      text: 'Admin-PC: query the R1 interface list and compare Gi0/0 versus Gi0/1',
      check: (_state, _history, session) => {
        const pc = session.devices['Admin-PC'];
        if (pc?.kind !== 'pc') return false;
        const detailStamp = pc.lastApiDeviceDetail.get('R1') ?? 0;
        const interfaceStamp = pc.lastApiInterfaces.get('R1') ?? 0;
        return interfaceStamp > detailStamp;
      },
    },
    {
      id: 'select-r1-management-interface',
      text: 'Admin-PC: query R1 Gi0/0 directly to confirm it is the active management interface',
      check: (_state, _history, session) => {
        const pc = session.devices['Admin-PC'];
        if (pc?.kind !== 'pc') return false;
        const interfaceListStamp = pc.lastApiInterfaces.get('R1') ?? 0;
        const gi00Stamp = pc.lastApiInterfaceDetail.get('R1:Gi0/0') ?? 0;
        return gi00Stamp > interfaceListStamp;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      text: 'Start from Admin-PC and query the inventory endpoint: `curl http://api.certhead.local/devices`. Use the JSON to decide which branch devices need deeper validation.',
    },
    {
      afterSeconds: 240,
      text: 'Use read-only GET requests to inspect R1 and SW1, then list R1 interfaces. After comparing the interface JSON, query the selected interface directly with `curl http://api.certhead.local/devices/R1/interfaces/Gi0%2F0`. PowerShell syntax also works with `Invoke-RestMethod -Uri <url>`.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'Admin-PC',
        note: 'Query the read-only API facts and use the interface JSON to identify R1 Gi0/0 as the active management path:',
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
};
