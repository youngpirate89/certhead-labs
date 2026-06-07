import type { Lab } from '@/engine/types';

const INSIDE_NET = '172.16.39.0';
const INSIDE_WILDCARD = '0.0.0.255';
const INTERNET_TARGET = '203.0.113.39';

function aclPermitsInsideSubnet(entry: { action: string; source: string; wildcard?: string | null }): boolean {
  return entry.action === 'permit' && entry.source === INSIDE_NET && entry.wildcard === INSIDE_WILDCARD;
}

/**
 * Lab 39 — PAT configuration is mostly present, but the WAN interface is not
 * marked as NAT outside. Learners must prove the inside subnet, ACL, and PAT
 * statement are already correct before making the smallest repair.
 */
export const lab39TshootNatOutsideRole: Lab = {
  id: 'ccna-lab39-tshoot-nat-outside-role',
  title: 'Ticket: NAT Outside Interface Missing',
  exam: 'CCNA 200-301',
  difficulty: 4,
  estimatedMinutes: 18,
  isFree: false,
  scenario:
    'Ticket: Branch users can reach their default gateway, but internet-bound traffic fails after a router replacement. The NAT ACL and overload statement were copied from the old router, and the LAN interface is already marked as NAT inside.\n\nUse evidence before changing the config: verify the client symptom, inspect NAT translations and interface NAT roles, then make the least-change repair so PC-BRANCH can reach the internet test host at 203.0.113.39.',
  topology: {
    devices: [
      {
        id: 'PC-BRANCH',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '172.16.39.10', mask: '255.255.255.0', gateway: '172.16.39.1' },
        position: { x: 0, y: 180 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 320, y: 180 },
      },
      {
        id: 'INTERNET-SRV',
        kind: 'router',
        platform: 'Internet Edge',
        interfaces: ['Gi0/0'],
        position: { x: 640, y: 180 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-BRANCH', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'INTERNET-SRV', iface: 'Gi0/0' } },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'description Branch LAN',
      'ip address 172.16.39.1 255.255.255.0',
      'ip nat inside',
      'no shutdown',
      'exit',
      'interface Gi0/1',
      'description Internet uplink',
      'ip address 203.0.113.1 255.255.255.0',
      'no shutdown',
      'exit',
      'access-list 1 permit 172.16.39.0 0.0.0.255',
      'ip nat inside source list 1 interface GigabitEthernet0/1 overload',
      'end',
    ],
    'INTERNET-SRV': [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'ip address 203.0.113.39 255.255.255.0',
      'no shutdown',
      'end',
    ],
  },
  objectives: [
    {
      id: 'confirm-client-symptom',
      text: 'PC-BRANCH: confirm ping 203.0.113.39 fails before the repair.',
      check: (_state, history) =>
        history['PC-BRANCH']?.raw.some((cmd) => /^ping\s+203\.0\.113\.39$/i.test(cmd)) ?? false,
    },
    {
      id: 'inspect-nat-evidence',
      text: 'R1: inspect show ip nat translations and show running-config for NAT evidence.',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return (
          r1?.kind === 'router' &&
          r1.lastShowNatTranslations > 0 &&
          r1.resolvedHistory.some((cmd) => cmd === 'show running-config')
        );
      },
    },
    {
      id: 'repair-outside-role',
      text: 'R1 Gi0/1: apply ip nat outside on the internet-facing interface.',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return r1?.kind === 'router' && r1.device.interfaces['Gi0/1']?.natRole === 'outside';
      },
    },
    {
      id: 'preserve-existing-nat-policy',
      text: 'Preserve ACL 1, Gi0/0 ip nat inside, and the PAT overload statement.',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const acl = r1.device.acls.get(1);
        const aclOk = acl?.entries.some(aclPermitsInsideSubnet) ?? false;
        const insideOk = r1.device.interfaces['Gi0/0']?.natRole === 'inside';
        const overloadOk = r1.device.natStatements.some(
          (s) => s.type === 'inside-source-list-overload' && s.aclId === 1 && s.outsideInterface === 'Gi0/1',
        );
        return aclOk && insideOk && overloadOk;
      },
    },
    {
      id: 'verify-translated-reachability',
      text: 'Verify PC-BRANCH reaches 203.0.113.39 and R1 shows a NAT translation for 172.16.39.10.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-BRANCH'];
        const r1 = session.devices.R1;
        if (pc?.kind !== 'pc' || r1?.kind !== 'router') return false;
        return (
          pc.lastPing?.target === INTERNET_TARGET &&
          pc.lastPing.ok === true &&
          r1.lastShowNatTranslations > 0 &&
          r1.device.natTranslations.has('172.16.39.10')
        );
      },
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      text: 'Start with the user symptom from PC-BRANCH, then inspect R1. A copied NAT ACL and overload statement can still fail if the interface roles are incomplete.',
    },
    {
      afterSeconds: 210,
      text: 'On R1, compare show running-config NAT lines with show ip nat translations. The missing role is on the internet-facing interface, not the LAN interface.',
    },
    {
      afterSeconds: 360,
      text: 'Make the smallest repair: under interface Gi0/1, apply ip nat outside. Preserve the existing ACL 1 and PAT overload statement.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'PC-BRANCH',
        note: 'Confirm the reported internet reachability failure:',
        commands: ['ping 203.0.113.39'],
      },
      {
        device: 'R1',
        note: 'Inspect NAT evidence and the current NAT-related configuration:',
        commands: ['enable', 'show ip nat translations', 'show running-config'],
      },
      {
        device: 'R1',
        note: 'Apply the missing outside role to the internet-facing interface only:',
        commands: ['configure terminal', 'interface Gi0/1', 'ip nat outside', 'end'],
      },
      {
        device: 'PC-BRANCH',
        note: 'Verify the branch client can reach the internet test host:',
        commands: ['ping 203.0.113.39'],
      },
      {
        device: 'R1',
        note: 'Verify the translated inside host appears in the NAT table:',
        commands: ['show ip nat translations'],
      },
    ],
  },
};
