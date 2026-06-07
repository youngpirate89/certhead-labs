import type { Lab } from '@/engine/types';

const MGMT_IP = '10.180.10.5';
const ADMIN_IP = '10.180.10.50';
const ADMIN_SUBNET = '10.180.10.0';
const ADMIN_WILDCARD = '0.0.0.255';
const MGMT_ACL = 23;

/**
 * Ticket 13 — SSH management denied.
 *
 * CCNA scope: SSH hardening, VTY access-class, standard ACL verification, and
 * the operational difference between data-plane reachability and management-
 * plane access. The simulator models a pre-hardened router where ping to the
 * management interface works, but SSH is refused because the inbound VTY ACL
 * still permits only the old admin subnet.
 */
export const tshootSshManagementDenied: Lab = {
  id: 'ccna-tshoot-ssh-management-denied',
  title: 'Troubleshoot: SSH Management Denied',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    'Trouble ticket: after a management hardening change window, ADMIN-PC can still ping R1\'s management IP, but SSH is denied. R1 already has SSH enabled with a local admin user and VTY lines restricted to SSH. The failure is narrower: the inbound VTY access-class still permits the old management subnet and omits the new admin workstation subnet.\n\nProve basic IP reachability, observe the SSH failure, inspect the VTY and ACL configuration, then make the least-change ACL repair so SSH works without opening management access to any source.',
  topology: {
    devices: [
      {
        id: 'ADMIN-PC',
        kind: 'pc',
        platform: 'Windows Workstation',
        interfaces: ['Eth0'],
        pc: { ip: ADMIN_IP, mask: '255.255.255.0', gateway: MGMT_IP },
        position: { x: 0, y: 0 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0'],
        position: { x: 320, y: 0 },
      },
    ],
    links: [{ a: { deviceId: 'ADMIN-PC', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } }],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'hostname R1',
      'interface gi0/0',
      `ip address ${MGMT_IP} 255.255.255.0`,
      'no shutdown',
      'exit',
      'ip domain-name certhead.local',
      'username admin secret C1sco123',
      'enable secret En4ble123',
      'crypto key generate rsa modulus 1024',
      `access-list ${MGMT_ACL} permit 10.180.20.0 0.0.0.255`,
      'line vty 0 4',
      'login local',
      'transport input ssh',
      `access-class ${MGMT_ACL} in`,
      'end',
    ],
  },
  objectives: [
    {
      id: 'prove-ping-reachability',
      text: `ADMIN-PC: prove basic IP reachability with ping ${MGMT_IP}`,
      check: (_state, _history, session) => {
        const pc = session.devices['ADMIN-PC'];
        return pc?.kind === 'pc' && pc.lastPing?.target === MGMT_IP && pc.lastPing.ok === true;
      },
    },
    {
      id: 'observe-ssh-denied',
      text: `ADMIN-PC: attempt ssh admin@${MGMT_IP} and observe that management access is denied`,
      check: (_state, _history, session) => {
        const pc = session.devices['ADMIN-PC'];
        if (pc?.kind !== 'pc') return false;
        const sshAttempts = pc.resolvedHistory.filter((cmd) => cmd === `ssh admin@${MGMT_IP}`).length;
        return (
          pc.lastSsh?.target === MGMT_IP &&
          pc.lastSsh.user === 'admin' &&
          (pc.lastSsh.ok === false || sshAttempts >= 2)
        );
      },
    },
    {
      id: 'inspect-vty-and-acl',
      text: 'R1: inspect the VTY access-class and ACL with show running-config | section line vty and show access-lists',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return (
          r1.resolvedHistory.some((cmd) => cmd === 'show running-config | section line vty') &&
          r1.lastShowAccessLists > 0 &&
          r1.device.security.vtyAccessClassIn === MGMT_ACL
        );
      },
    },
    {
      id: 'narrow-acl-fix',
      text: `R1: add a narrow permit for ${ADMIN_SUBNET}/24 to ACL ${MGMT_ACL} without permitting any source`,
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const acl = r1.device.acls.get(MGMT_ACL);
        const hasNarrowPermit = acl?.entries.some(
          (entry) => entry.action === 'permit' && entry.source === ADMIN_SUBNET && entry.wildcard === ADMIN_WILDCARD,
        );
        const opensAny = acl?.entries.some(
          (entry) => entry.action === 'permit' && entry.source === '0.0.0.0' && entry.wildcard === '255.255.255.255',
        );
        return Boolean(hasNarrowPermit && !opensAny);
      },
    },
    {
      id: 'verify-ssh-success',
      text: `ADMIN-PC: retest ssh admin@${MGMT_IP} successfully after the ACL fix`,
      check: (_state, _history, session) => {
        const pc = session.devices['ADMIN-PC'];
        const r1 = session.devices.R1;
        if (pc?.kind !== 'pc' || r1?.kind !== 'router') return false;
        const acl = r1.device.acls.get(MGMT_ACL);
        const fixed = acl?.entries.some(
          (entry) => entry.action === 'permit' && entry.source === ADMIN_SUBNET && entry.wildcard === ADMIN_WILDCARD,
        );
        return Boolean(fixed && pc.lastSsh?.target === MGMT_IP && pc.lastSsh.user === 'admin' && pc.lastSsh.ok === true);
      },
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      text: 'Ping proves the management IP is reachable, but SSH must also pass the VTY line policy. Inspect `show running-config | section line vty` for an inbound access-class.',
    },
    {
      afterSeconds: 240,
      text: `Use \`show access-lists\` to inspect ACL ${MGMT_ACL}. Add only the missing admin subnet: \`access-list ${MGMT_ACL} permit ${ADMIN_SUBNET} ${ADMIN_WILDCARD}\`, then retest SSH from ADMIN-PC.`,
    },
  ],
  solution: {
    steps: [
      {
        device: 'ADMIN-PC',
        note: 'Confirm that basic IP reachability works but SSH management access is denied:',
        commands: [`ping ${MGMT_IP}`, `ssh admin@${MGMT_IP}`],
      },
      {
        device: 'R1',
        note: 'Inspect the VTY lines and management ACL:',
        commands: ['enable', 'show running-config | section line vty', 'show access-lists'],
      },
      {
        device: 'R1',
        note: 'Permit only the new admin workstation subnet in the existing management ACL:',
        commands: [
          'configure terminal',
          `access-list ${MGMT_ACL} permit ${ADMIN_SUBNET} ${ADMIN_WILDCARD}`,
          'end',
          'show access-lists',
        ],
      },
      {
        device: 'ADMIN-PC',
        note: 'Retest SSH after the VTY ACL fix:',
        commands: [`ssh admin@${MGMT_IP}`],
      },
    ],
  },
};
