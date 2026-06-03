import type { Lab } from '@/engine/types';

const SALES_SUBNET = '10.170.30.0/24';
const GUEST_SUBNET = '10.170.99.0/24';

/**
 * Ticket 15 — Wireless client in wrong VLAN.
 *
 * CCNA scope: WLAN-to-VLAN mapping and symptom validation. This uses the
 * repository's scoped WLC command surface from Lab 28: dynamic interfaces,
 * WLAN/interface mapping, and WLC show verification. It intentionally avoids
 * modeling CAPWAP/RF/802.1X details; the lesson is that an associated client
 * can still be placed in the wrong wired VLAN.
 */
export const tshootWirelessClientWrongVlan: Lab = {
  id: 'ccna-tshoot-wireless-client-wrong-vlan',
  title: 'Troubleshoot: Wireless Client in Wrong VLAN',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    `Trouble ticket: LAPTOP-SALES associates to the correct SALES-WIFI SSID, but it receives an address from the Guest subnet (${GUEST_SUBNET}) and cannot reach Sales-only resources. The Sales WLAN should place clients in VLAN 30 (${SALES_SUBNET}), while Guest users belong in VLAN 99 (${GUEST_SUBNET}).\n\nStart from client evidence, inspect the WLC WLAN-to-interface mapping, correct WLAN 1 so SALES-WIFI maps to the Sales dynamic interface, then verify the WLC mapping and recheck the client outcome. The real-world lesson: connected to Wi-Fi does not automatically mean connected to the right VLAN.`,
  topology: {
    devices: [
      {
        id: 'LAPTOP-SALES',
        kind: 'pc',
        deviceClass: 'wireless-client',
        platform: 'Wireless Client',
        interfaces: ['WLAN0'],
        pc: { ip: '10.170.99.23', mask: '255.255.255.0', gateway: '10.170.99.1' },
        position: { x: 900, y: 60 },
      },
      {
        id: 'WLC',
        kind: 'pc',
        deviceClass: 'server',
        platform: 'Wireless LAN Controller',
        interfaces: ['Mgmt0'],
        pc: { ip: '10.170.30.50', mask: '255.255.255.0', gateway: '10.170.30.1' },
        position: { x: 560, y: -110 },
      },
      {
        id: 'AP-1',
        kind: 'pc',
        deviceClass: 'access-point',
        platform: 'Lightweight AP',
        interfaces: ['Eth0'],
        pc: { ip: '10.170.30.60', mask: '255.255.255.0', gateway: '10.170.30.1' },
        position: { x: 560, y: 80 },
      },
      {
        id: 'SW1',
        kind: 'switch',
        platform: 'Catalyst 2960',
        interfaces: ['Fa0/1', 'Fa0/2'],
        position: { x: 260, y: 30 },
      },
    ],
    links: [
      { a: { deviceId: 'WLC', iface: 'Mgmt0' }, b: { deviceId: 'SW1', iface: 'Fa0/1' } },
      { a: { deviceId: 'AP-1', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/2' } },
    ],
  },
  setup: {
    SW1: [
      'enable',
      'configure terminal',
      'vlan 30',
      'name SALES-USERS',
      'vlan 99',
      'name GUEST-USERS',
      'interface fa0/1',
      'switchport mode access',
      'switchport access vlan 30',
      'exit',
      'interface fa0/2',
      'switchport mode access',
      'switchport access vlan 30',
      'end',
    ],
    WLC: [
      'config interface create SALES-USERS 30',
      'config interface create GUEST-USERS 99',
      'config wlan create 1 SALES-WIFI SALES-WIFI',
      'config wlan interface 1 GUEST-USERS',
      'config wlan enable 1',
    ],
  },
  objectives: [
    {
      id: 'confirm-client-wrong-subnet',
      text: `LAPTOP-SALES: run ipconfig before changing the WLC and identify that the client is in ${GUEST_SUBNET}`,
      check: (_state, _history, session) => {
        const laptop = session.devices['LAPTOP-SALES'];
        const wlc = session.devices.WLC;
        if (laptop?.kind !== 'pc' || wlc?.kind !== 'pc') return false;
        const firstIpconfig = laptop.resolvedHistory.indexOf('ipconfig');
        const firstFix = wlc.resolvedHistory.indexOf('config wlan interface 1 SALES-USERS');
        return Boolean(
          laptop.ip?.startsWith('10.170.99.') &&
            firstIpconfig !== -1 &&
            (firstFix === -1 || firstIpconfig < firstFix),
        );
      },
    },
    {
      id: 'inspect-wlan-mapping',
      text: 'WLC: inspect WLAN 1 and confirm SALES-WIFI is mapped to the Guest interface/VLAN 99',
      check: (_state, _history, session) => {
        const wlc = session.devices.WLC;
        if (wlc?.kind !== 'pc') return false;
        const firstSummary = wlc.resolvedHistory.indexOf('show wlan summary');
        const firstDetail = wlc.resolvedHistory.indexOf('show wlan 1');
        const firstFix = wlc.resolvedHistory.indexOf('config wlan interface 1 SALES-USERS');
        const inspectedBeforeFix =
          firstSummary !== -1 &&
          firstDetail !== -1 &&
          (firstFix === -1 || (firstSummary < firstFix && firstDetail < firstFix));
        return Boolean(inspectedBeforeFix && wlc.wirelessController?.interfaces.get('GUEST-USERS')?.vlanId === 99);
      },
    },
    {
      id: 'correct-sales-wlan-vlan',
      text: 'WLC: map WLAN 1 (SALES-WIFI) to the SALES-USERS dynamic interface for VLAN 30',
      check: (_state, _history, session) => {
        const wlc = session.devices.WLC;
        const wlan = wlc?.kind === 'pc' ? wlc.wirelessController?.wlans.get(1) : undefined;
        const salesInterface = wlc?.kind === 'pc' ? wlc.wirelessController?.interfaces.get('SALES-USERS') : undefined;
        return wlan?.interfaceName === 'SALES-USERS' && salesInterface?.vlanId === 30;
      },
    },
    {
      id: 'verify-wlc-sales-mapping',
      text: 'WLC: verify WLAN 1 shows SALES-USERS / VLAN 30 after the correction',
      check: (_state, _history, session) => {
        const wlc = session.devices.WLC;
        if (wlc?.kind !== 'pc') return false;
        const wlan = wlc.wirelessController?.wlans.get(1);
        return Boolean(
          wlan?.interfaceName === 'SALES-USERS' &&
            wlan.mappedAt > 0 &&
            wlc.wirelessController &&
            wlc.wirelessController.lastShowWlanSummary > wlan.mappedAt &&
            (wlc.wirelessController.lastShowWlanDetail.get(1) ?? 0) > wlan.mappedAt &&
            wlc.wirelessController.lastShowClientSummary > wlan.mappedAt,
        );
      },
    },
    {
      id: 'verify-client-sales-subnet',
      text: `LAPTOP-SALES: re-run ipconfig after the WLC fix to validate the Sales VLAN outcome (${SALES_SUBNET})`,
      check: (_state, _history, session) => {
        const laptop = session.devices['LAPTOP-SALES'];
        const wlc = session.devices.WLC;
        if (laptop?.kind !== 'pc' || wlc?.kind !== 'pc') return false;
        const wlan = wlc.wirelessController?.wlans.get(1);
        return Boolean(wlan?.interfaceName === 'SALES-USERS' && wlan.mappedAt > 0 && laptop.lastIpconfig > wlan.mappedAt);
      },
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      text: 'Prove the symptom first: run `ipconfig` on LAPTOP-SALES, then use `show wlan summary` and `show wlan 1` on WLC to compare the SSID with its mapped interface/VLAN.',
    },
    {
      afterSeconds: 240,
      text: 'Use the existing WLC syntax from the wireless basics lab: `config wlan interface 1 SALES-USERS`, then verify with `show wlan summary`, `show wlan 1`, `show client summary`, and a final `ipconfig` on LAPTOP-SALES.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'LAPTOP-SALES',
        note: 'Confirm the wireless client is associated but receiving the Guest subnet instead of Sales:',
        commands: ['ipconfig'],
      },
      {
        device: 'WLC',
        note: 'Inspect the WLAN-to-interface mapping that controls client VLAN placement:',
        commands: ['show wlan summary', 'show wlan 1'],
      },
      {
        device: 'WLC',
        note: 'Map SALES-WIFI (WLAN 1) to the Sales dynamic interface and verify the WLC view:',
        commands: ['config wlan interface 1 SALES-USERS', 'show wlan summary', 'show wlan 1', 'show client summary'],
      },
      {
        device: 'LAPTOP-SALES',
        note: 'Recheck the client after the WLAN/VLAN mapping correction:',
        commands: ['ipconfig'],
      },
    ],
  },
};
