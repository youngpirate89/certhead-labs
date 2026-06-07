import type { Lab } from '@/engine/types';

/**
 * Ticket lab — floating static failover is configured, but the standby default
 * points at the wrong next-hop after a simulated primary WAN outage.
 *
 * The primary path is intentionally absent from the starting RIB to represent
 * the outage/change-window state. BRANCH still has a floating default at AD 200,
 * but the next-hop is not reachable on any BRANCH interface. The learner must
 * inspect the route table, remove the bad standby default, install the correct
 * backup next-hop with AD 200, verify the RIB, and confirm PC reachability.
 */
export const tshootFloatingStaticFailoverBroken: Lab = {
  id: 'ccna-tshoot-floating-static-failover-broken',
  title: 'Troubleshoot: Floating Static Failover Broken',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    'Trouble ticket: the branch has a primary WAN and a backup WAN. The primary path is currently out of service, so BRANCH should be using its floating static default route over ISP-B. Instead, PC-BRANCH cannot reach the upstream service at 198.51.100.160.\n\nInterfaces and upstream return routing are already in place. The problem is on BRANCH: the backup default route exists with administrative distance 200, but it points at the wrong next-hop. Inspect `show ip route`, remove the broken floating static route, configure the correct backup default as `ip route 0.0.0.0 0.0.0.0 10.160.0.6 200`, verify the route table again, and confirm PC-BRANCH can ping 198.51.100.160.',
  topology: {
    devices: [
      {
        id: 'PC-BRANCH',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '10.160.10.10', mask: '255.255.255.0', gateway: '10.160.10.1' },
        position: { x: 0, y: 160 },
      },
      {
        id: 'BRANCH',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1', 'Gi0/2'],
        position: { x: 300, y: 160 },
      },
      {
        id: 'ISP-A',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0'],
        position: { x: 600, y: 20 },
      },
      {
        id: 'ISP-B',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 600, y: 300 },
      },
      {
        id: 'INTERNET-SRV',
        kind: 'router',
        platform: 'Internet Service',
        interfaces: ['Gi0/0'],
        position: { x: 900, y: 300 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-BRANCH', iface: 'Eth0' }, b: { deviceId: 'BRANCH', iface: 'Gi0/0' } },
      { a: { deviceId: 'BRANCH', iface: 'Gi0/1' }, b: { deviceId: 'ISP-A', iface: 'Gi0/0' } },
      { a: { deviceId: 'BRANCH', iface: 'Gi0/2' }, b: { deviceId: 'ISP-B', iface: 'Gi0/0' } },
      { a: { deviceId: 'ISP-B', iface: 'Gi0/1' }, b: { deviceId: 'INTERNET-SRV', iface: 'Gi0/0' } },
    ],
    decorations: [
      { id: 'PRIMARY-WAN', kind: 'wan-cloud', label: 'Primary WAN outage', variant: 'isp', position: { x: 500, y: 20 } },
      { id: 'BACKUP-WAN', kind: 'wan-cloud', label: 'Backup WAN', variant: 'isp', position: { x: 500, y: 300 } },
    ],
  },
  setup: {
    BRANCH: [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'description Branch LAN gateway',
      'ip address 10.160.10.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface Gi0/1',
      'description Primary WAN to ISP-A (route withdrawn during outage)',
      'ip address 10.160.0.1 255.255.255.252',
      'no shutdown',
      'exit',
      'interface Gi0/2',
      'description Backup WAN to ISP-B',
      'ip address 10.160.0.5 255.255.255.252',
      'no shutdown',
      'exit',
      'ip route 0.0.0.0 0.0.0.0 10.160.0.9 200',
      'end',
    ],
    'ISP-A': [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'description Primary WAN to BRANCH',
      'ip address 10.160.0.2 255.255.255.252',
      'no shutdown',
      'end',
    ],
    'ISP-B': [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'description Backup WAN to BRANCH',
      'ip address 10.160.0.6 255.255.255.252',
      'no shutdown',
      'exit',
      'interface Gi0/1',
      'description Internet service segment',
      'ip address 198.51.100.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip route 10.160.10.0 255.255.255.0 10.160.0.5',
      'end',
    ],
    'INTERNET-SRV': [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'ip address 198.51.100.160 255.255.255.0',
      'no shutdown',
      'exit',
      'ip route 0.0.0.0 0.0.0.0 198.51.100.1',
      'end',
    ],
  },
  objectives: [
    {
      id: 'inspect-route-table',
      text: 'BRANCH: run show ip route to inspect the failed floating default route.',
      check: (_state, history) => history.BRANCH?.resolved.some((cmd) => /^(do\s+)?show ip route$/.test(cmd)) ?? false,
    },
    {
      id: 'correct-floating-static-route',
      text: 'BRANCH: replace the bad floating default with ip route 0.0.0.0 0.0.0.0 10.160.0.6 200.',
      check: (_state, _history, session) => {
        const branch = session.devices.BRANCH;
        if (branch?.kind !== 'router') return false;
        const hasCorrect = branch.staticRoutes.some(
          (r) => r.prefix === '0.0.0.0' && r.mask === '0.0.0.0' && r.nextHop === '10.160.0.6' && r.adminDistance === 200,
        );
        const hasBad = branch.staticRoutes.some(
          (r) => r.prefix === '0.0.0.0' && r.mask === '0.0.0.0' && r.nextHop === '10.160.0.9',
        );
        return hasCorrect && !hasBad;
      },
    },
    {
      id: 'verify-route-table',
      text: 'BRANCH: after the fix, run show ip route and verify S 0.0.0.0/0 [200/0] via 10.160.0.6.',
      check: (_state, history, session) => {
        const branch = session.devices.BRANCH;
        if (branch?.kind !== 'router') return false;
        const hasCorrectOnly =
          branch.staticRoutes.some(
            (r) => r.prefix === '0.0.0.0' && r.mask === '0.0.0.0' && r.nextHop === '10.160.0.6' && r.adminDistance === 200,
          ) &&
          !branch.staticRoutes.some((r) => r.prefix === '0.0.0.0' && r.mask === '0.0.0.0' && r.nextHop === '10.160.0.9');
        const showRan = history.BRANCH?.resolved.some((cmd) => /^(do\s+)?show ip route$/.test(cmd)) ?? false;
        return hasCorrectOnly && showRan;
      },
    },
    {
      id: 'verify-internet-reachability',
      text: 'PC-BRANCH: ping 198.51.100.160 successfully over the backup path.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-BRANCH'];
        if (pc?.kind !== 'pc') return false;
        return pc.lastPing?.target === '198.51.100.160' && pc.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Start on BRANCH with `show ip route`. A floating static default uses a higher administrative distance, so expect the bracketed value to show `[200/0]` during the primary outage.',
    },
    {
      afterSeconds: 180,
      text: 'The configured backup next-hop must be reachable on the backup WAN subnet 10.160.0.4/30. BRANCH is 10.160.0.5; ISP-B is 10.160.0.6.',
    },
    {
      afterSeconds: 300,
      text: 'Remove the bad route, then add the correct one: `no ip route 0.0.0.0 0.0.0.0 10.160.0.9 200` and `ip route 0.0.0.0 0.0.0.0 10.160.0.6 200`.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'BRANCH',
        note: 'Inspect the active route table during the primary outage. The default is floating (AD 200) but points at an unreachable next-hop:',
        commands: ['enable', 'show ip route'],
      },
      {
        device: 'BRANCH',
        note: 'Replace the broken floating default with the real ISP-B next-hop while preserving AD 200:',
        commands: [
          'configure terminal',
          'no ip route 0.0.0.0 0.0.0.0 10.160.0.9 200',
          'ip route 0.0.0.0 0.0.0.0 10.160.0.6 200',
          'end',
        ],
      },
      {
        device: 'BRANCH',
        note: 'Verify the corrected floating static default route is installed:',
        commands: ['show ip route'],
      },
      {
        device: 'PC-BRANCH',
        note: 'Confirm the branch client now reaches the upstream service through the backup WAN:',
        commands: ['ping 198.51.100.160'],
      },
    ],
  },
};
