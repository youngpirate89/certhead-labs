import type { Lab } from '@/engine/types';
import type { Session as RouterSession } from '@/engine/adapters/ios/state';

/**
 * Lab 03 — applied IPv4 subnetting on routed interfaces.
 *
 * The learner receives host requirements and must place the correct masks on
 * two LAN gateways plus a /30 transit. Routing is intentionally deferred to
 * later labs; this lab focuses on choosing/configuring the right interface
 * addresses and verifying local gateway reachability.
 */
export const lab03Ipv4SubnettingRoutedInterfaces: Lab = {
  id: 'ccna-lab03-ipv4-subnetting-routed-interfaces',
  title: 'IPv4 Subnetting: Address Routed Interfaces',
  exam: 'CCNA 200-301',
  difficulty: 1,
  estimatedMinutes: 9,
  isFree: false,
  scenario:
    "A small company is splitting 172.16.10.0/24 into right-sized branch subnets. The Sales LAN needs up to 50 hosts, so it uses 172.16.10.0/26. The Support LAN needs up to 25 hosts, so it uses 172.16.10.64/27. The point-to-point router link uses 10.10.10.0/30.\n\nPC-A and PC-B are already addressed by the desktop team. Your job is to configure the router interfaces with the correct subnet masks, bring the links up, verify the interface table, then prove each PC can reach its local default gateway. Do not add static routes yet - routing between the two LANs comes in the next lab.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '172.16.10.10', mask: '255.255.255.192', gateway: '172.16.10.1' },
      },
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] },
      { id: 'R2', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] },
      {
        id: 'PC-B',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '172.16.10.70', mask: '255.255.255.224', gateway: '172.16.10.65' },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'R2', iface: 'Gi0/1' } },
      { a: { deviceId: 'R2', iface: 'Gi0/0' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
    ],
  },
  objectives: [
    {
      id: 'r1-lan-wan-addressing',
      text: 'R1: configure Gi0/0 as 172.16.10.1/26 and Gi0/1 as 10.10.10.1/30, both up',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return ifaceMatches(r1, 'Gi0/0', '172.16.10.1', '255.255.255.192') &&
          ifaceMatches(r1, 'Gi0/1', '10.10.10.1', '255.255.255.252');
      },
    },
    {
      id: 'r2-lan-wan-addressing',
      text: 'R2: configure Gi0/0 as 172.16.10.65/27 and Gi0/1 as 10.10.10.2/30, both up',
      check: (_state, _history, session) => {
        const r2 = session.devices.R2;
        if (r2?.kind !== 'router') return false;
        return ifaceMatches(r2, 'Gi0/0', '172.16.10.65', '255.255.255.224') &&
          ifaceMatches(r2, 'Gi0/1', '10.10.10.2', '255.255.255.252');
      },
    },
    {
      id: 'verify-interfaces',
      text: 'R1 and R2: run show ip interface brief after configuring the interfaces',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        const r2 = session.devices.R2;
        if (r1?.kind !== 'router' || r2?.kind !== 'router') return false;
        return showIpBriefAfterConfig(r1) && showIpBriefAfterConfig(r2);
      },
    },
    {
      id: 'verify-gateways',
      text: 'PC-A: ping 172.16.10.1 succeeds, and PC-B: ping 172.16.10.65 succeeds',
      check: (_state, _history, session) => {
        const pca = session.devices['PC-A'];
        const pcb = session.devices['PC-B'];
        if (pca?.kind !== 'pc' || pcb?.kind !== 'pc') return false;
        return pca.lastPing?.target === '172.16.10.1' && pca.lastPing.ok === true &&
          pcb.lastPing?.target === '172.16.10.65' && pcb.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'A /26 mask is 255.255.255.192. The first usable address in 172.16.10.0/26 is 172.16.10.1.',
    },
    {
      afterSeconds: 150,
      text: 'A /27 mask is 255.255.255.224. The 172.16.10.64/27 subnet uses 172.16.10.65 as the first usable gateway address.',
    },
    {
      afterSeconds: 240,
      text: 'A /30 point-to-point link uses mask 255.255.255.252. Use 10.10.10.1 on R1 and 10.10.10.2 on R2.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Configure the Sales LAN gateway and the /30 transit address on R1:',
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
        note: 'Configure the Support LAN gateway and the matching /30 transit address on R2:',
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
      {
        device: 'PC-A',
        note: 'Verify PC-A can reach its local default gateway:',
        commands: ['ping 172.16.10.1'],
      },
      {
        device: 'PC-B',
        note: 'Verify PC-B can reach its local default gateway:',
        commands: ['ping 172.16.10.65'],
      },
    ],
  },
};

function ifaceMatches(router: RouterSession, iface: string, ip: string, mask: string): boolean {
  const state = router.device.interfaces[iface];
  return state?.ip === ip && state.mask === mask && state.adminUp === true;
}

function showIpBriefAfterConfig(router: RouterSession): boolean {
  const lastShow = lastIndex(router.resolvedHistory, 'show ip interface brief');
  const lastNoShutdown = lastIndex(router.resolvedHistory, 'no shutdown');
  return lastShow > -1 && lastNoShutdown > -1 && lastShow > lastNoShutdown;
}

function lastIndex(history: readonly string[], command: string): number {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i] === command || history[i] === `do ${command}`) return i;
  }
  return -1;
}
