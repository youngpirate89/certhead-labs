import type { Lab } from '@/engine/types';
import { canReach } from '@/engine/reachability';

const ACL_NAME = 'BRANCH-APP-POLICY';
const BRANCH_NET = '10.49.10.0';
const BRANCH_WILDCARD = '0.0.0.255';
const APP_IP = '172.49.50.20';
const APP_PORT = 8443;

function branchToAppEntryMatches(
  entry: {
    action: string;
    protocol?: string;
    source: string;
    wildcard?: string | null;
    dstIp?: string;
    dstWildcard?: string;
    dstPort?: number;
  },
  action: 'permit' | 'deny',
  protocol: 'tcp' | 'icmp' | 'ip',
  port?: number,
): boolean {
  return (
    entry.action === action &&
    entry.protocol === protocol &&
    entry.source === BRANCH_NET &&
    entry.wildcard === BRANCH_WILDCARD &&
    entry.dstIp === APP_IP &&
    entry.dstWildcard === '0.0.0.0' &&
    (port === undefined ? entry.dstPort === undefined : entry.dstPort === port)
  );
}

function isDenyIpAnyAny(entry: { action: string; protocol?: string; source: string; wildcard?: string | null; dstIp?: string; dstWildcard?: string }): boolean {
  return (
    entry.action === 'deny' &&
    entry.protocol === 'ip' &&
    entry.source === '0.0.0.0' &&
    entry.wildcard === '255.255.255.255' &&
    entry.dstIp === '0.0.0.0' &&
    entry.dstWildcard === '255.255.255.255'
  );
}

/**
 * Lab 49 — overlapping OSPF and ACL symptoms.
 *
 * The EDGE/BRANCH OSPF adjacency is healthy, but EDGE is not originating its
 * gateway of last resort. That makes BRANCH look like it has a routing issue.
 * After the routing fix, ICMP works but the TCP business app is still blocked
 * by a named extended ACL. Learners must avoid the common shortcut of treating
 * ping success as app success, then make the narrow policy repair.
 */
export const tshootOspfAclOverlapTicket: Lab = {
  id: 'ccna-tshoot-ospf-acl-overlap-ticket',
  title: 'Troubleshoot: OSPF and ACL Overlap Ticket',
  exam: 'CCNA 200-301',
  difficulty: 4,
  estimatedMinutes: 14,
  isFree: false,
  scenario:
    'Trouble ticket: the Branch team reports that the hosted CRM at 172.49.50.20 is unreachable. The EDGE-to-BRANCH OSPF neighbor is still FULL, and an application ACL also sits on the EDGE transit interface, so the symptoms overlap: routing and policy both need to be checked instead of assuming one layer is the whole problem.\n\nStart from PC-BRANCH and confirm the outage. On BRANCH, inspect the route table; it has branch routes but no gateway of last resort because EDGE is not advertising its static default into OSPF. On EDGE, inspect both the route table and BRANCH-APP-POLICY. Fix OSPF with default-information originate, then repair the ACL narrowly so Branch can reach APP-SRV on TCP/8443 while keeping the final deny. Verify the learned OSPF default, show the corrected ACL, and confirm basic reachability from PC-BRANCH.',
  topology: {
    devices: [
      {
        id: 'PC-BRANCH',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '10.49.10.10', mask: '255.255.255.0', gateway: '10.49.10.1' },
        position: { x: 0, y: 160 },
      },
      {
        id: 'BRANCH',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 300, y: 160 },
      },
      {
        id: 'EDGE',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 600, y: 160 },
      },
      {
        id: 'APP-SRV',
        kind: 'pc',
        platform: 'Server',
        deviceClass: 'server',
        interfaces: ['Eth0'],
        pc: { ip: APP_IP, mask: '255.255.255.0', gateway: '172.49.50.1' },
        position: { x: 900, y: 160 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-BRANCH', iface: 'Eth0' }, b: { deviceId: 'BRANCH', iface: 'Gi0/0' } },
      { a: { deviceId: 'BRANCH', iface: 'Gi0/1' }, b: { deviceId: 'EDGE', iface: 'Gi0/0' } },
      { a: { deviceId: 'EDGE', iface: 'Gi0/1' }, b: { deviceId: 'APP-SRV', iface: 'Eth0' } },
    ],
    decorations: [
      { id: 'SAAS-CLOUD', kind: 'wan-cloud', label: 'Hosted CRM / SaaS Edge', variant: 'isp', position: { x: 760, y: 45 } },
    ],
  },
  setup: {
    BRANCH: [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'description Branch user LAN',
      'ip address 10.49.10.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface Gi0/1',
      'description WAN to EDGE',
      'ip address 10.49.0.2 255.255.255.252',
      'no shutdown',
      'exit',
      'router ospf 1',
      'network 10.49.10.0 0.0.0.255 area 0',
      'network 10.49.0.0 0.0.0.3 area 0',
      'exit',
    ],
    EDGE: [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'description WAN to BRANCH - policy applied inbound',
      'ip address 10.49.0.1 255.255.255.252',
      'ip access-group BRANCH-APP-POLICY in',
      'no shutdown',
      'exit',
      'interface Gi0/1',
      'description Hosted CRM service segment',
      'ip address 172.49.50.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip route 0.0.0.0 0.0.0.0 172.49.50.20',
      'router ospf 1',
      'network 10.49.0.0 0.0.0.3 area 0',
      'exit',
      'ip access-list extended BRANCH-APP-POLICY',
      'permit icmp 10.49.10.0 0.0.0.255 host 172.49.50.20',
      'deny ip any any',
      'end',
    ],
  },
  objectives: [
    {
      id: 'diagnose-branch-route-table',
      text: 'BRANCH: run show ip route and identify that no gateway of last resort was learned from OSPF.',
      check: (_state, history) => history.BRANCH?.resolved.some((cmd) => /^(do\s+)?show ip route$/.test(cmd)) ?? false,
    },
    {
      id: 'inspect-edge-policy',
      text: 'EDGE: run show access-lists to inspect BRANCH-APP-POLICY before changing it.',
      check: (_state, _history, session) => {
        const edge = session.devices.EDGE;
        return edge?.kind === 'router' && edge.lastShowAccessLists > 0;
      },
    },
    {
      id: 'originate-ospf-default',
      text: 'EDGE: configure default-information originate under router ospf 1.',
      check: (_state, _history, session) => {
        const edge = session.devices.EDGE;
        return edge?.kind === 'router' && edge.device.ospf.defaultInfoOriginate === true;
      },
    },
    {
      id: 'learn-ospf-default',
      text: 'BRANCH: verify an OSPF-learned default route appears after the EDGE repair.',
      check: (_state, history, session) => {
        const branch = session.devices.BRANCH;
        if (branch?.kind !== 'router') return false;
        const postFixShow = history.BRANCH?.resolved.some((cmd) => /^(do\s+)?show ip route$/.test(cmd)) ?? false;
        return postFixShow && branch.ospfRoutes.some((route) => route.prefix === '0.0.0.0' && route.mask === '0.0.0.0' && route.source === 'ospf');
      },
    },
    {
      id: 'permit-business-app',
      text: 'EDGE ACL BRANCH-APP-POLICY: permit tcp 10.49.10.0 0.0.0.255 host 172.49.50.20 eq 8443 before the final deny.',
      check: (_state, _history, session) => {
        const edge = session.devices.EDGE;
        if (edge?.kind !== 'router') return false;
        const acl = edge.device.acls.get(ACL_NAME);
        if (!acl || acl.type !== 'extended') return false;
        const tcp = acl.entries.findIndex((entry) => branchToAppEntryMatches(entry, 'permit', 'tcp', APP_PORT));
        const deny = acl.entries.findIndex(isDenyIpAnyAny);
        return tcp !== -1 && deny !== -1 && tcp < deny;
      },
    },
    {
      id: 'verify-basic-reachability',
      text: 'PC-BRANCH: after OSPF is fixed, ping 172.49.50.20 successfully.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-BRANCH'];
        return pc?.kind === 'pc' && pc.lastPing?.target === APP_IP && pc.lastPing.ok === true;
      },
    },
    {
      id: 'verify-business-app-path',
      text: 'Verify the corrected policy permits Branch TCP application traffic while preserving the final deny.',
      check: (_state, _history, session) => {
        const edge = session.devices.EDGE;
        if (edge?.kind !== 'router' || edge.lastShowAccessLists <= 0) return false;
        const acl = edge.device.acls.get(ACL_NAME);
        if (!acl || acl.type !== 'extended' || acl.entries.findIndex(isDenyIpAnyAny) === -1) return false;
        return canReach(session, 'PC-BRANCH', APP_IP, undefined, 'tcp').ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Do not stop at the OSPF neighbor table. A FULL neighbor proves the adjacency, not that EDGE is advertising a default route or that policy permits the app.',
    },
    {
      afterSeconds: 180,
      text: 'BRANCH needs an OSPF default from EDGE. EDGE already has a static default, but OSPF requires `default-information originate` before BRANCH learns it.',
    },
    {
      afterSeconds: 300,
      text: 'After ping starts working, inspect BRANCH-APP-POLICY. ICMP is permitted, but the business app uses TCP/8443 and needs a narrow permit before the final deny.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'PC-BRANCH',
        note: 'Confirm the reported outage from the branch workstation:',
        commands: ['ping 172.49.50.20'],
      },
      {
        device: 'BRANCH',
        note: 'Diagnose routing first: the OSPF neighbor can be up while the route table still lacks a default.',
        commands: ['enable', 'show ip route'],
      },
      {
        device: 'EDGE',
        note: 'Inspect both the EDGE default route and the policy applied toward the branch.',
        commands: ['enable', 'show ip route', 'show access-lists'],
      },
      {
        device: 'EDGE',
        note: 'Advertise EDGE\'s default route into OSPF, then insert only the required TCP/8443 permit before the final deny.',
        commands: [
          'configure terminal',
          'router ospf 1',
          'default-information originate',
          'exit',
          'ip access-list extended BRANCH-APP-POLICY',
          'no 20',
          'permit tcp 10.49.10.0 0.0.0.255 host 172.49.50.20 eq 8443',
          'deny ip any any',
          'end',
          'show access-lists',
        ],
      },
      {
        device: 'BRANCH',
        note: 'Verify BRANCH learned the OSPF external default route from EDGE.',
        commands: ['show ip route'],
      },
      {
        device: 'PC-BRANCH',
        note: 'Confirm basic reachability after the routing repair; the ACL objective separately verifies the TCP app policy.',
        commands: ['ping 172.49.50.20'],
      },
    ],
  },
};
