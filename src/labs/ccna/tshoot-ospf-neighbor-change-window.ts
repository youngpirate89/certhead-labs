import type { Lab } from '@/engine/types';

/**
 * Ticket Lab 08 — OSPF Neighbor Down After Change Window.
 *
 * During maintenance, the HQ router's WAN interface to the branch was
 * accidentally included in an OSPF passive-interface cleanup. The passive WAN
 * suppresses hellos, so the HQ↔BRANCH adjacency never forms and branch routes
 * disappear. Learners diagnose the missing neighbor, identify the misplaced
 * passive interface, remove passive from the transit link, and verify routes
 * and reachability return.
 */
export const tshootOspfNeighborChangeWindow: Lab = {
  id: 'ccna-tshoot-ospf-neighbor-change-window',
  title: 'Troubleshoot: OSPF Neighbor Down After Change Window',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    "Trouble ticket: after last night's change window, users at HQ can no longer reach the branch LAN. The IP addressing and OSPF network statements were already reviewed, but `show ip ospf neighbor` no longer shows the branch router and the 10.80.20.0/24 route is gone.\n\nStart from PC-HQ with `ping 10.80.20.10` to confirm the outage. On HQ, inspect the OSPF neighbor table and OSPF process details. A cleanup put the passive-interface command on the wrong port: passive is appropriate for the HQ LAN, not for the router-to-router WAN link. Apply the smallest targeted fix, then prove the neighbor is FULL and branch reachability is restored.",
  topology: {
    devices: [
      {
        id: 'PC-HQ',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '10.80.10.10', mask: '255.255.255.0', gateway: '10.80.10.1' },
      },
      { id: 'HQ', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/2'] },
      { id: 'BRANCH', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/2'] },
      {
        id: 'PC-BRANCH',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '10.80.20.10', mask: '255.255.255.0', gateway: '10.80.20.1' },
      },
    ],
    links: [
      { a: { deviceId: 'PC-HQ', iface: 'Eth0' }, b: { deviceId: 'HQ', iface: 'Gi0/0' } },
      { a: { deviceId: 'HQ', iface: 'Gi0/2' }, b: { deviceId: 'BRANCH', iface: 'Gi0/2' } },
      { a: { deviceId: 'BRANCH', iface: 'Gi0/0' }, b: { deviceId: 'PC-BRANCH', iface: 'Eth0' } },
    ],
  },
  setup: {
    HQ: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 10.80.10.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface gi0/2',
      'ip address 10.80.0.1 255.255.255.252',
      'no shutdown',
      'exit',
      'router ospf 1',
      'network 10.80.10.0 0.0.0.255 area 0',
      'network 10.80.0.0 0.0.0.3 area 0',
      'passive-interface GigabitEthernet0/2',
      'exit',
    ],
    BRANCH: [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'ip address 10.80.0.2 255.255.255.252',
      'no shutdown',
      'exit',
      'interface gi0/0',
      'ip address 10.80.20.1 255.255.255.0',
      'no shutdown',
      'exit',
      'router ospf 1',
      'network 10.80.0.0 0.0.0.3 area 0',
      'network 10.80.20.0 0.0.0.255 area 0',
      'exit',
    ],
  },
  objectives: [
    {
      id: 'diagnose-passive',
      text: 'HQ: run show ip ospf to identify the WAN interface listed as passive',
      check: (_state, history) => history.HQ?.resolved.some((cmd) => /^(do\s+)?show ip ospf$/.test(cmd)) ?? false,
    },
    {
      id: 'move-passive-to-lan',
      text: 'HQ: keep OSPF passive only on the HQ LAN interface, not the WAN',
      check: (_state, _history, session) => {
        const hq = session.devices.HQ;
        if (hq?.kind !== 'router') return false;
        return hq.device.ospf.passive.has('Gi0/0') && !hq.device.ospf.passive.has('Gi0/2');
      },
    },
    {
      id: 'ospf-neighbor-full',
      text: 'HQ↔BRANCH OSPF adjacency returns to FULL on the WAN link',
      check: (_state, _history, session) => {
        const hq = session.devices.HQ;
        if (hq?.kind !== 'router') return false;
        return Array.from(hq.device.ospf.neighbors.values()).some((n) => n.state === 'FULL');
      },
    },
    {
      id: 'branch-reachable',
      text: 'PC-HQ: ping 10.80.20.10 succeeds after the OSPF repair',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-HQ'];
        if (pc?.kind !== 'pc') return false;
        return pc.lastPing?.target === '10.80.20.10' && pc.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 45,
      text:
        'Start with the symptom: `show ip ospf neighbor` on HQ should have a branch neighbor, but the table is empty after the change window.',
    },
    {
      afterSeconds: 120,
      text:
        'Run `show ip ospf` on HQ and read the Passive Interface(s) section. Passive-interface suppresses OSPF hellos; that is safe on a LAN with no routers, but it breaks a transit link.',
    },
    {
      afterSeconds: 240,
      text:
        'Under `router ospf 1` on HQ, remove passive from GigabitEthernet0/2 and apply it to GigabitEthernet0/0. Then verify `show ip ospf neighbor` and ping the branch PC.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'PC-HQ',
        note: 'Confirm the reported outage from HQ to the branch LAN:',
        commands: ['ping 10.80.20.10'],
      },
      {
        device: 'HQ',
        note: 'Diagnose - the neighbor is missing, and OSPF lists the WAN link as passive:',
        commands: ['enable', 'show ip ospf neighbor', 'show ip ospf'],
      },
      {
        device: 'HQ',
        note: 'Fix - remove passive from the WAN transit link and leave passive on the HQ LAN:',
        commands: [
          'configure terminal',
          'router ospf 1',
          'no passive-interface GigabitEthernet0/2',
          'passive-interface GigabitEthernet0/0',
          'end',
        ],
      },
      {
        device: 'HQ',
        note: 'Verify - the branch neighbor is FULL and OSPF is learning branch routes:',
        commands: ['show ip ospf neighbor', 'show ip route'],
      },
      {
        device: 'PC-HQ',
        note: 'Confirm restored branch reachability:',
        commands: ['ping 10.80.20.10'],
      },
    ],
  },
};
