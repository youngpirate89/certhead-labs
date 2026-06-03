import type { Lab } from '@/engine/types';

/**
 * Ticket lab — the server VLAN path is asymmetric.
 *
 * PC-BRANCH has a valid forward path through BRANCH to the new server VLAN on
 * CORE, and SRV-FILES uses CORE as its default gateway. The missing piece is
 * CORE's return route to the branch LAN. Learners must prove the initial
 * failure, inspect CORE's route table, add the static route back toward BRANCH,
 * verify the Cisco-style RIB entry, and confirm endpoint reachability.
 */
export const tshootReturnRouteMissingServerVlan: Lab = {
  id: 'ccna-tshoot-return-route-missing-server-vlan',
  title: 'Troubleshoot: Server VLAN Return Route Missing',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    'Trouble ticket: branch users cannot reach the newly moved file server at 10.150.50.20. BRANCH already has a static route toward the server VLAN through CORE, and the server uses CORE as its default gateway. The first half of the path is not the problem.\n\nThe return path is missing on CORE: replies for the branch client subnet 10.150.10.0/24 have no matching route back toward BRANCH. Confirm the failed ping from PC-BRANCH, inspect CORE with `show ip route`, add the missing static return route via 10.150.0.1, verify the route table, and confirm PC-BRANCH can reach SRV-FILES.',
  topology: {
    devices: [
      {
        id: 'PC-BRANCH',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '10.150.10.10', mask: '255.255.255.0', gateway: '10.150.10.1' },
        position: { x: 0, y: 120 },
      },
      {
        id: 'BRANCH',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 300, y: 120 },
      },
      {
        id: 'CORE',
        kind: 'router',
        platform: 'Catalyst 9300',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 600, y: 120 },
      },
      {
        id: 'SRV-FILES',
        kind: 'router',
        platform: 'File Server',
        interfaces: ['Gi0/0'],
        position: { x: 900, y: 120 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-BRANCH', iface: 'Eth0' }, b: { deviceId: 'BRANCH', iface: 'Gi0/0' } },
      { a: { deviceId: 'BRANCH', iface: 'Gi0/1' }, b: { deviceId: 'CORE', iface: 'Gi0/0' } },
      { a: { deviceId: 'CORE', iface: 'Gi0/1' }, b: { deviceId: 'SRV-FILES', iface: 'Gi0/0' } },
    ],
    decorations: [
      {
        id: 'SERVER-VLAN-50',
        kind: 'wan-cloud',
        label: 'Server VLAN 50',
        variant: 'provider',
        position: { x: 840, y: 30 },
      },
    ],
  },
  setup: {
    BRANCH: [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'description Branch user LAN',
      'ip address 10.150.10.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface Gi0/1',
      'description Transit to CORE',
      'ip address 10.150.0.1 255.255.255.252',
      'no shutdown',
      'exit',
      'ip route 10.150.50.0 255.255.255.0 10.150.0.2',
      'end',
    ],
    CORE: [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'description Transit to BRANCH',
      'ip address 10.150.0.2 255.255.255.252',
      'no shutdown',
      'exit',
      'interface Gi0/1',
      'description Server VLAN 50 gateway',
      'ip address 10.150.50.1 255.255.255.0',
      'no shutdown',
      'end',
    ],
    'SRV-FILES': [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'description File server NIC',
      'ip address 10.150.50.20 255.255.255.0',
      'no shutdown',
      'exit',
      'ip route 0.0.0.0 0.0.0.0 10.150.50.1',
      'end',
    ],
  },
  objectives: [
    {
      id: 'confirm-initial-failure',
      text: 'PC-BRANCH: ping 10.150.50.20 and confirm the file server is unreachable before the fix.',
      check: (_state, history) =>
        history['PC-BRANCH']?.resolved.some((cmd) => /^ping\s+10\.150\.50\.20$/i.test(cmd)) ?? false,
    },
    {
      id: 'inspect-core-route-table',
      text: 'CORE: run show ip route to inspect the missing route back to 10.150.10.0/24.',
      check: (_state, history) => history.CORE?.resolved.some((cmd) => /^(do\s+)?show ip route$/.test(cmd)) ?? false,
    },
    {
      id: 'install-return-route',
      text: 'CORE: configure ip route 10.150.10.0 255.255.255.0 10.150.0.1.',
      check: (_state, _history, session) => {
        const core = session.devices.CORE;
        if (core?.kind !== 'router') return false;
        return core.staticRoutes.some(
          (r) => r.prefix === '10.150.10.0' && r.mask === '255.255.255.0' && r.nextHop === '10.150.0.1',
        );
      },
    },
    {
      id: 'verify-return-route-table',
      text: 'CORE: after the fix, run show ip route and verify S 10.150.10.0/24 via 10.150.0.1.',
      check: (_state, history, session) => {
        const core = session.devices.CORE;
        if (core?.kind !== 'router') return false;
        const hasReturnRoute = core.staticRoutes.some(
          (r) => r.prefix === '10.150.10.0' && r.mask === '255.255.255.0' && r.nextHop === '10.150.0.1',
        );
        const showRan = history.CORE?.resolved.some((cmd) => /^(do\s+)?show ip route$/.test(cmd)) ?? false;
        return hasReturnRoute && showRan;
      },
    },
    {
      id: 'confirm-server-reachability',
      text: 'PC-BRANCH: ping 10.150.50.20 successfully.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-BRANCH'];
        if (pc?.kind !== 'pc') return false;
        return pc.lastPing?.target === '10.150.50.20' && pc.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Start from the symptom: PC-BRANCH `ping 10.150.50.20`. A failed ping can mean the reply cannot get back.',
    },
    {
      afterSeconds: 180,
      text: 'BRANCH already points 10.150.50.0/24 at CORE. Inspect the CORE route table and look for 10.150.10.0/24.',
    },
    {
      afterSeconds: 300,
      text: 'On CORE: `configure terminal`, `ip route 10.150.10.0 255.255.255.0 10.150.0.1`, `end`, then verify with `show ip route` and PC-BRANCH `ping 10.150.50.20`.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'PC-BRANCH',
        note: 'Confirm the branch client cannot reach the file server:',
        commands: ['ping 10.150.50.20'],
      },
      {
        device: 'CORE',
        note: 'Inspect CORE and confirm it has connected transit/server VLAN routes but no route to the branch LAN:',
        commands: ['enable', 'show ip route'],
      },
      {
        device: 'CORE',
        note: 'Install the missing return route toward BRANCH:',
        commands: ['configure terminal', 'ip route 10.150.10.0 255.255.255.0 10.150.0.1', 'end'],
      },
      {
        device: 'CORE',
        note: 'Verify the static return route appears in the routing table:',
        commands: ['show ip route'],
      },
      {
        device: 'PC-BRANCH',
        note: 'Confirm the branch client can now reach the file server:',
        commands: ['ping 10.150.50.20'],
      },
    ],
  },
};
