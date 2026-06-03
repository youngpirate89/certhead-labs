import type { Lab } from '@/engine/types';

const ADMIN_NET = '10.110.10.0';
const ADMIN_WILDCARD = '0.0.0.255';
const TRAINING_NET = '10.120.20.0';
const TRAINING_WILDCARD = '0.0.0.255';
const INTERNET_IP = '203.0.113.10';

function aclPermitsSubnet(
  entry: { action: string; source: string; wildcard?: string | null },
  source: string,
  wildcard: string,
): boolean {
  return entry.action === 'permit' && entry.source === source && entry.wildcard === wildcard;
}

/**
 * Ticket lab — PAT works for one inside VLAN but not another because the NAT
 * source ACL selects only one inside subnet.
 */
export const tshootNatVlanOmission: Lab = {
  id: 'ccna-tshoot-nat-vlan-omission',
  title: 'Troubleshoot: NAT Omits One VLAN',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    'Trouble ticket: Admin users in VLAN 110 can reach the internet through R1 PAT, but Training users in VLAN 120 cannot after a cleanup to the NAT policy. R1 already has the correct inside and outside NAT interface roles, and the PAT overload statement is present. The failure is narrower: NAT ACL 1 selects 10.110.10.0/24 but omits the Training subnet 10.120.20.0/24.\n\nCompare the working and broken clients, inspect show ip nat translations and show access-lists, then make the least-change repair by adding only the missing Training subnet to the NAT source ACL. Verify Training reachability to INTERNET-SRV at 203.0.113.10 and confirm NAT translations include both inside VLANs.',
  topology: {
    devices: [
      {
        id: 'PC-ADMIN',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '10.110.10.10', mask: '255.255.255.0', gateway: '10.110.10.1' },
        position: { x: 0, y: 80 },
      },
      {
        id: 'PC-TRAINING',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '10.120.20.10', mask: '255.255.255.0', gateway: '10.120.20.1' },
        position: { x: 0, y: 280 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1', 'Gi0/2'],
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
      { a: { deviceId: 'PC-ADMIN', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'PC-TRAINING', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/1' } },
      { a: { deviceId: 'R1', iface: 'Gi0/2' }, b: { deviceId: 'INTERNET-SRV', iface: 'Gi0/0' } },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'description VLAN 110 Admin gateway',
      'ip address 10.110.10.1 255.255.255.0',
      'ip nat inside',
      'no shutdown',
      'exit',
      'interface Gi0/1',
      'description VLAN 120 Training gateway',
      'ip address 10.120.20.1 255.255.255.0',
      'ip nat inside',
      'no shutdown',
      'exit',
      'interface Gi0/2',
      'description Internet uplink',
      'ip address 203.0.113.1 255.255.255.0',
      'ip nat outside',
      'no shutdown',
      'exit',
      'access-list 1 permit 10.110.10.0 0.0.0.255',
      'ip nat inside source list 1 interface GigabitEthernet0/2 overload',
      'end',
    ],
    'INTERNET-SRV': [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'ip address 203.0.113.10 255.255.255.0',
      'no shutdown',
      'end',
    ],
  },
  objectives: [
    {
      id: 'compare-clients',
      text: 'Compare behavior: PC-ADMIN ping 203.0.113.10 succeeds, while PC-TRAINING ping 203.0.113.10 fails.',
      check: (_state, history, session) => {
        const admin = session.devices['PC-ADMIN'];
        const training = session.devices['PC-TRAINING'];
        const adminPingRun = history['PC-ADMIN']?.raw.some((cmd) => /^ping\s+203\.0\.113\.10$/i.test(cmd)) ?? false;
        const trainingPingRun = history['PC-TRAINING']?.raw.some((cmd) => /^ping\s+203\.0\.113\.10$/i.test(cmd)) ?? false;
        return (
          admin?.kind === 'pc' &&
          training?.kind === 'pc' &&
          adminPingRun &&
          trainingPingRun &&
          admin.lastPing?.target === INTERNET_IP &&
          admin.lastPing.ok === true
        );
      },
    },
    {
      id: 'inspect-nat-acl',
      text: 'R1: inspect NAT evidence with show ip nat translations and show access-lists.',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return r1?.kind === 'router' && r1.lastShowNatTranslations > 0 && r1.lastShowAccessLists > 0;
      },
    },
    {
      id: 'permit-training-subnet',
      text: 'R1 ACL 1: add permit 10.120.20.0 0.0.0.255 for the omitted Training VLAN.',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const acl = r1.device.acls.get(1);
        return acl?.entries.some((e) => aclPermitsSubnet(e, TRAINING_NET, TRAINING_WILDCARD)) ?? false;
      },
    },
    {
      id: 'preserve-admin-nat',
      text: 'Preserve the existing Admin NAT permit, inside/outside roles, and PAT overload statement.',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const acl = r1.device.acls.get(1);
        const keepsAdmin = acl?.entries.some((e) => aclPermitsSubnet(e, ADMIN_NET, ADMIN_WILDCARD)) ?? false;
        const addsTraining = acl?.entries.some((e) => aclPermitsSubnet(e, TRAINING_NET, TRAINING_WILDCARD)) ?? false;
        const rolesOk =
          r1.device.interfaces['Gi0/0']?.natRole === 'inside' &&
          r1.device.interfaces['Gi0/1']?.natRole === 'inside' &&
          r1.device.interfaces['Gi0/2']?.natRole === 'outside';
        const overloadOk = r1.device.natStatements.some(
          (s) => s.type === 'inside-source-list-overload' && s.aclId === 1 && s.outsideInterface === 'Gi0/2',
        );
        return addsTraining && keepsAdmin && rolesOk && overloadOk;
      },
    },
    {
      id: 'verify-training-nat',
      text: 'Verify PC-TRAINING reaches 203.0.113.10 and R1 show ip nat translations includes the Training host.',
      check: (_state, _history, session) => {
        const training = session.devices['PC-TRAINING'];
        const r1 = session.devices.R1;
        if (training?.kind !== 'pc' || r1?.kind !== 'router') return false;
        return (
          training.lastPing?.target === INTERNET_IP &&
          training.lastPing.ok === true &&
          r1.lastShowNatTranslations > 0 &&
          r1.device.natTranslations.has('10.120.20.10')
        );
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Because one inside VLAN works, first compare PC-ADMIN and PC-TRAINING pings to 203.0.113.10 instead of changing NAT roles.',
    },
    {
      afterSeconds: 180,
      text: 'On R1, show ip nat translations should show only 10.110.10.10. show access-lists should show ACL 1 permitting only 10.110.10.0/24.',
    },
    {
      afterSeconds: 300,
      text: 'Make the smallest change: in global config add access-list 1 permit 10.120.20.0 0.0.0.255. Do not remove the existing Admin permit or NAT overload statement.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'PC-ADMIN',
        note: 'Confirm the known-good inside VLAN is translated successfully:',
        commands: ['ping 203.0.113.10'],
      },
      {
        device: 'PC-TRAINING',
        note: 'Confirm the reported Training VLAN failure:',
        commands: ['ping 203.0.113.10'],
      },
      {
        device: 'R1',
        note: 'Inspect NAT translations and the NAT source ACL:',
        commands: ['enable', 'show ip nat translations', 'show access-lists'],
      },
      {
        device: 'R1',
        note: 'Add only the omitted Training subnet to ACL 1; keep the existing Admin permit and PAT statement:',
        commands: ['configure terminal', 'access-list 1 permit 10.120.20.0 0.0.0.255', 'end'],
      },
      {
        device: 'R1',
        note: 'Verify NAT now translates both inside VLANs:',
        commands: ['show ip nat translations'],
      },
      {
        device: 'PC-TRAINING',
        note: 'Verify the affected VLAN can now reach the internet target:',
        commands: ['ping 203.0.113.10'],
      },
    ],
  },
};
