import type { Lab } from '@/engine/types';

/**
 * Lab 28 — Wireless WLAN-to-VLAN mapping.
 *
 * Scope: CCNA wireless architecture fundamentals only. WLC1 uses a scoped
 * controller command surface hosted by the existing endpoint adapter; it models
 * dynamic-interface creation, WLAN creation, WLAN-to-interface mapping, enable,
 * and show verification. It does not simulate RF association, CAPWAP, roaming,
 * security policy, or a full Cisco WLC CLI.
 */
export const lab28WirelessWlanVlanMapping: Lab = {
  id: 'ccna-lab28-wireless-wlan-vlan-mapping',
  title: 'Wireless Basics: Map a WLAN to a VLAN',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    'The office wireless controller has management connectivity, but the corporate SSID has not been created or mapped to the wired user VLAN. Configure WLC1 so the CORP-WIFI WLAN places wireless clients into VLAN 20 through the CORP-USERS dynamic interface.\n\nAfter applying the wireless configuration, verify the WLAN summary and detailed WLAN mapping from WLC1.',
  topology: {
    devices: [
      {
        id: 'Admin-PC',
        kind: 'pc',
        platform: 'Windows Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '10.28.20.10', mask: '255.255.255.0', gateway: '10.28.20.1' },
        position: { x: 0, y: 30 },
      },
      {
        id: 'SW1',
        kind: 'switch',
        platform: 'Catalyst 2960',
        interfaces: ['Fa0/1', 'Fa0/2', 'Fa0/3', 'Fa0/4'],
        position: { x: 290, y: 30 },
      },
      {
        id: 'WLC1',
        kind: 'pc',
        deviceClass: 'server',
        platform: 'Wireless LAN Controller',
        interfaces: ['Mgmt0'],
        pc: { ip: '10.28.20.50', mask: '255.255.255.0', gateway: '10.28.20.1' },
        position: { x: 610, y: -120 },
      },
      {
        id: 'AP1',
        kind: 'pc',
        deviceClass: 'access-point',
        platform: 'Lightweight AP',
        interfaces: ['Eth0'],
        pc: { ip: '10.28.20.60', mask: '255.255.255.0', gateway: '10.28.20.1' },
        position: { x: 610, y: 40 },
      },
      {
        id: 'Wireless-Client',
        kind: 'pc',
        deviceClass: 'wireless-client',
        platform: 'Wireless Client',
        interfaces: ['WLAN0'],
        pc: { dhcp: true },
        position: { x: 900, y: 40 },
      },
    ],
    links: [
      { a: { deviceId: 'Admin-PC', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/1' } },
      { a: { deviceId: 'WLC1', iface: 'Mgmt0' }, b: { deviceId: 'SW1', iface: 'Fa0/2' } },
      { a: { deviceId: 'AP1', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/3' } },
    ],
  },
  setup: {
    SW1: [
      'enable',
      'configure terminal',
      'vlan 20',
      'name CORP-USERS',
      'exit',
      'interface fa0/1',
      'switchport mode access',
      'switchport access vlan 20',
      'exit',
      'interface fa0/2',
      'switchport mode access',
      'switchport access vlan 20',
      'exit',
      'interface fa0/3',
      'switchport mode access',
      'switchport access vlan 20',
      'end',
    ],
  },
  objectives: [
    {
      id: 'create-dynamic-interface',
      text: 'WLC1: create dynamic interface CORP-USERS for VLAN 20',
      check: (_state, _history, session) => {
        const wlc = session.devices.WLC1;
        return wlc?.kind === 'pc' && wlc.wirelessController?.interfaces.get('CORP-USERS')?.vlanId === 20;
      },
    },
    {
      id: 'create-corp-wlan',
      text: 'WLC1: create WLAN 1 with profile and SSID CORP-WIFI',
      check: (_state, _history, session) => {
        const wlc = session.devices.WLC1;
        const wlan = wlc?.kind === 'pc' ? wlc.wirelessController?.wlans.get(1) : undefined;
        return wlan?.profile === 'CORP-WIFI' && wlan.ssid === 'CORP-WIFI';
      },
    },
    {
      id: 'map-wlan-to-interface',
      text: 'WLC1: map WLAN 1 to the CORP-USERS interface',
      check: (_state, _history, session) => {
        const wlc = session.devices.WLC1;
        const wlan = wlc?.kind === 'pc' ? wlc.wirelessController?.wlans.get(1) : undefined;
        return wlan?.interfaceName === 'CORP-USERS';
      },
    },
    {
      id: 'enable-wlan',
      text: 'WLC1: enable WLAN 1 after it is mapped',
      check: (_state, _history, session) => {
        const wlc = session.devices.WLC1;
        const wlan = wlc?.kind === 'pc' ? wlc.wirelessController?.wlans.get(1) : undefined;
        return Boolean(wlan?.enabled && wlan.enabledAt > wlan.mappedAt);
      },
    },
    {
      id: 'verify-wlan-summary',
      text: 'WLC1: run show wlan summary after WLAN 1 is enabled',
      check: (_state, _history, session) => {
        const wlc = session.devices.WLC1;
        if (wlc?.kind !== 'pc') return false;
        const wlan = wlc.wirelessController?.wlans.get(1);
        return Boolean(wlan?.enabled && wlc.wirelessController && wlc.wirelessController.lastShowWlanSummary > wlan.enabledAt);
      },
    },
    {
      id: 'verify-wlan-detail',
      text: 'WLC1: run show wlan 1 after WLAN 1 is enabled',
      check: (_state, _history, session) => {
        const wlc = session.devices.WLC1;
        if (wlc?.kind !== 'pc') return false;
        const wlan = wlc.wirelessController?.wlans.get(1);
        const detailStamp = wlc.wirelessController?.lastShowWlanDetail.get(1) ?? 0;
        return Boolean(wlan?.enabled && detailStamp > wlan.enabledAt);
      },
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      text: 'On WLC1, create a dynamic interface for VLAN 20 first, then create the WLAN and bind the WLAN to that interface.',
    },
    {
      afterSeconds: 240,
      text: 'Use WLC1 commands: `config interface create CORP-USERS 20`, `config wlan create 1 CORP-WIFI CORP-WIFI`, `config wlan interface 1 CORP-USERS`, `config wlan enable 1`, then verify with `show wlan summary` and `show wlan 1`.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'WLC1',
        note: 'Create the VLAN-backed dynamic interface, create the WLAN, map it, enable it, and verify:',
        commands: [
          'config interface create CORP-USERS 20',
          'config wlan create 1 CORP-WIFI CORP-WIFI',
          'config wlan interface 1 CORP-USERS',
          'config wlan enable 1',
          'show wlan summary',
          'show wlan 1',
        ],
      },
    ],
  },
};
