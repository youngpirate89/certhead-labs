import type { Lab } from '@/engine/types';

/**
 * Ticket lab — the branch edge lost its gateway of last resort.
 *
 * The topology is intentionally small: PC-BRANCH -- BRANCH -- EDGE --
 * INTERNET-SRV. All interfaces and upstream return routing are already seeded.
 * BRANCH can reach directly connected LAN/WAN networks, but has no route for
 * offsite destinations such as 198.51.100.50. The learner must inspect the
 * route table, configure the missing default static route toward EDGE, verify
 * the default route appears, then confirm endpoint reachability.
 */
export const tshootDefaultRouteLostAtBranch: Lab = {
  id: 'ccna-tshoot-default-route-lost-at-branch',
  title: 'Troubleshoot: Branch Default Route Lost',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 9,
  isFree: false,
  scenario:
    "Trouble ticket: users on the branch LAN can still reach their local gateway and the directly connected WAN link, but they cannot reach the upstream service at 198.51.100.50. The branch interfaces are up, and the upstream EDGE/INTERNET-SRV side already has the return path back to 10.140.10.0/24.\n\nThe failure is on BRANCH: its default static route was removed, so traffic for destinations outside connected networks has no gateway of last resort. Inspect BRANCH with `show ip route`, add the missing default route toward EDGE at 10.140.0.2, verify the route table again, and confirm PC-BRANCH can ping 198.51.100.50.",
  topology: {
    devices: [
      {
        id: 'PC-BRANCH',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '10.140.10.10', mask: '255.255.255.0', gateway: '10.140.10.1' },
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
        id: 'EDGE',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 600, y: 120 },
      },
      {
        id: 'INTERNET-SRV',
        kind: 'router',
        platform: 'Internet Service',
        interfaces: ['Gi0/0'],
        position: { x: 900, y: 120 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-BRANCH', iface: 'Eth0' }, b: { deviceId: 'BRANCH', iface: 'Gi0/0' } },
      { a: { deviceId: 'BRANCH', iface: 'Gi0/1' }, b: { deviceId: 'EDGE', iface: 'Gi0/0' } },
      { a: { deviceId: 'EDGE', iface: 'Gi0/1' }, b: { deviceId: 'INTERNET-SRV', iface: 'Gi0/0' } },
    ],
    decorations: [
      {
        id: 'WAN-CLOUD',
        kind: 'wan-cloud',
        label: 'Upstream WAN',
        variant: 'isp',
        position: { x: 510, y: 20 },
      },
    ],
  },
  setup: {
    BRANCH: [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'description Branch LAN gateway',
      'ip address 10.140.10.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface Gi0/1',
      'description WAN to EDGE',
      'ip address 10.140.0.1 255.255.255.252',
      'no shutdown',
      'end',
    ],
    EDGE: [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'description WAN to BRANCH',
      'ip address 10.140.0.2 255.255.255.252',
      'no shutdown',
      'exit',
      'interface Gi0/1',
      'description Upstream service segment',
      'ip address 198.51.100.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip route 10.140.10.0 255.255.255.0 10.140.0.1',
      'end',
    ],
    'INTERNET-SRV': [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'ip address 198.51.100.50 255.255.255.0',
      'no shutdown',
      'exit',
      'ip route 0.0.0.0 0.0.0.0 198.51.100.1',
      'end',
    ],
  },
  objectives: [
    {
      id: 'inspect-route-table',
      text: 'BRANCH: run show ip route to inspect the missing gateway of last resort.',
      check: (_state, history) => history.BRANCH?.resolved.some((cmd) => /^(do\s+)?show ip route$/.test(cmd)) ?? false,
    },
    {
      id: 'install-default-route',
      text: 'BRANCH: configure ip route 0.0.0.0 0.0.0.0 10.140.0.2.',
      check: (_state, _history, session) => {
        const branch = session.devices.BRANCH;
        if (branch?.kind !== 'router') return false;
        return branch.staticRoutes.some(
          (r) => r.prefix === '0.0.0.0' && r.mask === '0.0.0.0' && r.nextHop === '10.140.0.2',
        );
      },
    },
    {
      id: 'verify-route-table',
      text: 'BRANCH: after the fix, run show ip route and verify S 0.0.0.0/0 via 10.140.0.2.',
      check: (_state, history, session) => {
        const branch = session.devices.BRANCH;
        if (branch?.kind !== 'router') return false;
        const hasDefault = branch.staticRoutes.some(
          (r) => r.prefix === '0.0.0.0' && r.mask === '0.0.0.0' && r.nextHop === '10.140.0.2',
        );
        const showRan = history.BRANCH?.resolved.some((cmd) => /^(do\s+)?show ip route$/.test(cmd)) ?? false;
        return hasDefault && showRan;
      },
    },
    {
      id: 'verify-internet-reachability',
      text: 'PC-BRANCH: ping 198.51.100.50 successfully.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-BRANCH'];
        if (pc?.kind !== 'pc') return false;
        return pc.lastPing?.target === '198.51.100.50' && pc.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Start on BRANCH with `show ip route`. Connected routes alone do not cover 198.51.100.50.',
    },
    {
      afterSeconds: 180,
      text: 'The next-hop for the default route is EDGE on the WAN /30: 10.140.0.2.',
    },
    {
      afterSeconds: 300,
      text: 'On BRANCH: `configure terminal`, `ip route 0.0.0.0 0.0.0.0 10.140.0.2`, `end`, then verify with `show ip route` and PC-BRANCH `ping 198.51.100.50`.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'BRANCH',
        note: 'Inspect the branch routing table and confirm there is no default route:',
        commands: ['enable', 'show ip route'],
      },
      {
        device: 'BRANCH',
        note: 'Install the missing gateway of last resort toward EDGE:',
        commands: ['configure terminal', 'ip route 0.0.0.0 0.0.0.0 10.140.0.2', 'end'],
      },
      {
        device: 'BRANCH',
        note: 'Verify the static default route is now present:',
        commands: ['show ip route'],
      },
      {
        device: 'PC-BRANCH',
        note: 'Confirm the branch client can reach the upstream service:',
        commands: ['ping 198.51.100.50'],
      },
    ],
  },
};
