import type { Lab } from '@/engine/types';
import { canReach } from '@/engine/reachability';

const ACL_NAME = 'STAFF-DMZ-FILTER';
const STAFF_NET = '172.16.40.0';
const STAFF_WILDCARD = '0.0.0.255';
const APP_IP = '172.16.50.20';
const APP_PORT = 8443;

function staffToAppEntryMatches(
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
    entry.source === STAFF_NET &&
    entry.wildcard === STAFF_WILDCARD &&
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
 * Ticket lab — ICMP reaches the server, but the business application fails
 * because an inbound extended ACL permits ping and then denies all other IP.
 */
export const tshootAclBlocksBusinessApp: Lab = {
  id: 'ccna-tshoot-acl-blocks-business-app',
  title: 'Troubleshoot: ACL Blocks Business App',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    'Trouble ticket: Staff users can ping APP-SRV at 172.16.50.20, but the required business application on TCP port 8443 fails after a firewall ACL cleanup. R1 routes between the Staff LAN and the App DMZ, and the security intent is narrow: allow Staff ICMP for reachability testing, allow Staff to APP-SRV on TCP 8443, then deny all other traffic.\n\nProve that ping alone is not an application test, inspect the extended ACL, repair the ACL without opening broader access, run show access-lists, and verify the simulated TCP application path is permitted again.',
  topology: {
    devices: [
      {
        id: 'PC-STAFF',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '172.16.40.10', mask: '255.255.255.0', gateway: '172.16.40.1' },
        position: { x: 0, y: 200 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 320, y: 200 },
      },
      {
        id: 'APP-SRV',
        kind: 'pc',
        platform: 'Server',
        deviceClass: 'server',
        interfaces: ['Eth0'],
        pc: { ip: APP_IP, mask: '255.255.255.0', gateway: '172.16.50.1' },
        position: { x: 640, y: 200 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-STAFF', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'APP-SRV', iface: 'Eth0' } },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'description Staff LAN gateway - ACL applied inbound',
      'ip address 172.16.40.1 255.255.255.0',
      'ip access-group STAFF-DMZ-FILTER in',
      'no shutdown',
      'exit',
      'interface gi0/1',
      'description App DMZ gateway',
      'ip address 172.16.50.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip access-list extended STAFF-DMZ-FILTER',
      'permit icmp 172.16.40.0 0.0.0.255 host 172.16.50.20',
      'deny ip any any',
      'end',
    ],
  },
  objectives: [
    {
      id: 'confirm-ping-only',
      text: 'PC-STAFF: confirm ping to 172.16.50.20 succeeds, proving only basic reachability.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-STAFF'];
        return pc?.kind === 'pc' && pc.lastPing?.target === APP_IP && pc.lastPing.ok === true;
      },
    },
    {
      id: 'inspect-acl',
      text: 'R1: inspect the packet filter with show access-lists.',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return r1?.kind === 'router' && r1.lastShowAccessLists > 0;
      },
    },
    {
      id: 'permit-app-port',
      text: 'R1 ACL STAFF-DMZ-FILTER: permit tcp 172.16.40.0 0.0.0.255 host 172.16.50.20 eq 8443.',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const acl = r1.device.acls.get(ACL_NAME);
        return acl?.type === 'extended' && acl.entries.some((e) => staffToAppEntryMatches(e, 'permit', 'tcp', APP_PORT));
      },
    },
    {
      id: 'acl-order-secure',
      text: 'R1 ACL STAFF-DMZ-FILTER: keep ICMP and TCP/8443 permits before the final deny ip any any.',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const acl = r1.device.acls.get(ACL_NAME);
        if (!acl || acl.type !== 'extended') return false;
        const icmp = acl.entries.findIndex((e) => staffToAppEntryMatches(e, 'permit', 'icmp'));
        const tcp = acl.entries.findIndex((e) => staffToAppEntryMatches(e, 'permit', 'tcp', APP_PORT));
        const deny = acl.entries.findIndex(isDenyIpAnyAny);
        return icmp !== -1 && tcp !== -1 && deny !== -1 && icmp < deny && tcp < deny;
      },
    },
    {
      id: 'verify-app-path',
      text: 'Verify the corrected ACL permits the Staff-to-APP-SRV TCP application path while preserving the final deny.',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router' || r1.lastShowAccessLists <= 0) return false;
        const acl = r1.device.acls.get(ACL_NAME);
        if (!acl || acl.entries.findIndex(isDenyIpAnyAny) === -1) return false;
        return canReach(session, 'PC-STAFF', APP_IP, undefined, 'tcp').ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'A successful ping only proves ICMP. The failed app uses TCP/8443, so inspect any ACL between the Staff LAN and APP-SRV.',
    },
    {
      afterSeconds: 180,
      text: 'On R1, show access-lists should reveal STAFF-DMZ-FILTER permits ICMP and then denies IP. A TCP permit added after the deny will still be unreachable.',
    },
    {
      afterSeconds: 300,
      text: 'Edit the named ACL: remove the deny sequence, add permit tcp 172.16.40.0 0.0.0.255 host 172.16.50.20 eq 8443, then re-add deny ip any any.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'PC-STAFF',
        note: 'Confirm basic reachability works; this does not test the app port:',
        commands: ['ping 172.16.50.20'],
      },
      {
        device: 'R1',
        note: 'Inspect the existing ACL and identify that only ICMP is permitted before the final deny:',
        commands: ['enable', 'show access-lists'],
      },
      {
        device: 'R1',
        note: 'Preserve the restrictive policy but insert the required TCP/8443 permit before the final deny:',
        commands: [
          'configure terminal',
          'ip access-list extended STAFF-DMZ-FILTER',
          'no 20',
          'permit tcp 172.16.40.0 0.0.0.255 host 172.16.50.20 eq 8443',
          'deny ip any any',
          'end',
        ],
      },
      {
        device: 'R1',
        note: 'Verify the ACL now shows ICMP and TCP/8443 permits before the final deny:',
        commands: ['show access-lists'],
      },
    ],
  },
};
