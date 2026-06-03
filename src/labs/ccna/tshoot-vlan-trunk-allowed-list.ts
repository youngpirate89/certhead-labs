import type { Lab } from '@/engine/types';

function allowsVlan30(port: { mode: string; trunkAllowedVlans: 'all' | readonly number[] } | undefined): boolean {
  return port?.mode === 'trunk' && (port.trunkAllowedVlans === 'all' || port.trunkAllowedVlans.includes(30));
}

function hasPostFixTrunkShow(history: readonly string[]): boolean {
  const fixIndex = history.findIndex((line) => /switchport trunk allowed vlan add 30/i.test(line));
  if (fixIndex < 0) return false;
  return history.slice(fixIndex + 1).some((line) => /^show interfaces trunk$/i.test(line) || /^sh(?:ow)? int(?:erfaces)? tr(?:unk)?$/i.test(line));
}

/**
 * Ticket lab — VLAN 30 is missing from an inter-switch trunk allowed list.
 *
 * Existing Operations users in VLAN 10 still work across the trunk, so the
 * learner sees a partial outage rather than a dead uplink. The broken service
 * path is PC-SALES (SW1, VLAN 30) to SRV-FILES (SW2, VLAN 30). Both switches
 * already have VLANs and access ports configured, and Fa0/24 is already a
 * trunk; the cleanup mistake is that the allowed list contains VLAN 10 only.
 */
export const tshootVlanTrunkAllowedList: Lab = {
  id: 'ccna-tshoot-vlan-trunk-allowed-list',
  title: 'Troubleshoot: Sales VLAN Missing from Trunk',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    'Trouble ticket: Sales users on SW1 cannot reach the shared file service after a switch cleanup, but existing Operations users are still working. The switches and access ports were already built for VLAN 10 (Ops) and VLAN 30 (Sales), and the inter-switch link is intended to carry both VLANs.\n\nStart with `show interfaces trunk` on the switches, compare the working VLAN to the affected Sales VLAN, repair the allowed list without disrupting VLAN 10, then confirm PC-SALES can reach the file server.',
  topology: {
    devices: [
      {
        id: 'PC-SALES',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.30.10', mask: '255.255.255.0', gateway: '192.168.30.1' },
        position: { x: 0, y: 120 },
      },
      {
        id: 'PC-OPS',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.10.10', mask: '255.255.255.0', gateway: '192.168.10.1' },
        position: { x: 0, y: 360 },
      },
      { id: 'SW1', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/10', 'Fa0/30', 'Fa0/24'], position: { x: 280, y: 240 } },
      { id: 'SW2', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/10', 'Fa0/30', 'Fa0/24'], position: { x: 620, y: 240 } },
      {
        id: 'SRV-OPS',
        kind: 'pc',
        platform: 'Server',
        deviceClass: 'server',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.10.50', mask: '255.255.255.0', gateway: '192.168.10.1' },
        position: { x: 900, y: 360 },
      },
      {
        id: 'SRV-FILES',
        kind: 'pc',
        platform: 'Server',
        deviceClass: 'server',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.30.50', mask: '255.255.255.0', gateway: '192.168.30.1' },
        position: { x: 900, y: 120 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-SALES', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/30' } },
      { a: { deviceId: 'PC-OPS', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/10' } },
      { a: { deviceId: 'SW1', iface: 'Fa0/24' }, b: { deviceId: 'SW2', iface: 'Fa0/24' } },
      { a: { deviceId: 'SW2', iface: 'Fa0/10' }, b: { deviceId: 'SRV-OPS', iface: 'Eth0' } },
      { a: { deviceId: 'SW2', iface: 'Fa0/30' }, b: { deviceId: 'SRV-FILES', iface: 'Eth0' } },
    ],
  },
  setup: {
    SW1: [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Ops',
      'exit',
      'vlan 30',
      'name Sales',
      'exit',
      'interface Fa0/10',
      'switchport mode access',
      'switchport access vlan 10',
      'exit',
      'interface Fa0/30',
      'switchport mode access',
      'switchport access vlan 30',
      'exit',
      'interface Fa0/24',
      'switchport mode trunk',
      'switchport trunk allowed vlan 10',
    ],
    SW2: [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Ops',
      'exit',
      'vlan 30',
      'name Sales',
      'exit',
      'interface Fa0/10',
      'switchport mode access',
      'switchport access vlan 10',
      'exit',
      'interface Fa0/30',
      'switchport mode access',
      'switchport access vlan 30',
      'exit',
      'interface Fa0/24',
      'switchport mode trunk',
      'switchport trunk allowed vlan 10',
    ],
  },
  objectives: [
    {
      id: 'restore-sales-vlan-on-trunk',
      text: 'Restore VLAN 30 to the allowed list on the SW1-SW2 trunk.',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        const sw2 = session.devices.SW2;
        if (sw1?.kind !== 'switch' || sw2?.kind !== 'switch') return false;
        return allowsVlan30(sw1.device.switchports['Fa0/24']) && allowsVlan30(sw2.device.switchports['Fa0/24']);
      },
    },
    {
      id: 'verify-trunk-after-fix',
      text: 'Run show interfaces trunk after the fix and confirm VLAN 30 is allowed on Fa0/24.',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        const sw2 = session.devices.SW2;
        if (sw1?.kind !== 'switch' || sw2?.kind !== 'switch') return false;
        const fixed = allowsVlan30(sw1.device.switchports['Fa0/24']) && allowsVlan30(sw2.device.switchports['Fa0/24']);
        if (!fixed) return false;
        const sw1Verified = (sw1.lastShowInterfacesTrunk?.trunkPortIds.includes('Fa0/24') ?? false) && hasPostFixTrunkShow(sw1.resolvedHistory);
        const sw2Verified = (sw2.lastShowInterfacesTrunk?.trunkPortIds.includes('Fa0/24') ?? false) && hasPostFixTrunkShow(sw2.resolvedHistory);
        return sw1Verified || sw2Verified;
      },
    },
    {
      id: 'verify-sales-reachability',
      text: 'PC-SALES: ping 192.168.30.50 succeeds.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-SALES'];
        if (pc?.kind !== 'pc') return false;
        return pc.lastPing?.target === '192.168.30.50' && pc.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Because VLAN 10 still works, the trunk is not completely down. Check exactly which VLANs are allowed with show interfaces trunk.',
    },
    {
      afterSeconds: 180,
      text: 'On the inter-switch trunk, add the affected VLAN without replacing the existing list: switchport trunk allowed vlan add 30.',
    },
    {
      afterSeconds: 300,
      text: 'After the change, run show interfaces trunk again and then ping 192.168.30.50 from PC-SALES.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'SW1',
        note: 'Confirm VLAN 30 is absent, then add Sales to the trunk allowed list on SW1:',
        commands: [
          'enable',
          'show interfaces trunk',
          'configure terminal',
          'interface Fa0/24',
          'switchport trunk allowed vlan add 30',
          'end',
          'show interfaces trunk',
        ],
      },
      {
        device: 'SW2',
        note: 'Mirror the allowed-list repair on the far end of the trunk:',
        commands: [
          'enable',
          'configure terminal',
          'interface Fa0/24',
          'switchport trunk allowed vlan add 30',
          'end',
          'show interfaces trunk',
        ],
      },
      {
        device: 'PC-SALES',
        note: 'Verify Sales can reach the shared file server:',
        commands: ['ping 192.168.30.50'],
      },
    ],
  },
};
