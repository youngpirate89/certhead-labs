import type { Lab } from '@/engine/types';

const MGMT_IP = '10.48.10.1';
const ADMIN_IP = '10.48.10.50';
const ADMIN_SUBNET = '10.48.10.0';
const ADMIN_WILDCARD = '0.0.0.255';
const LEGACY_ADMIN_SUBNET = '10.48.20.0';
const MGMT_ACL = 48;

function adminPc(session: Parameters<NonNullable<Lab['objectives'][number]['check']>>[2]) {
  const device = session.devices['ADMIN-PC'];
  return device?.kind === 'pc' ? device : null;
}

function r1(session: Parameters<NonNullable<Lab['objectives'][number]['check']>>[2]) {
  const device = session.devices.R1;
  return device?.kind === 'router' ? device : null;
}

function hasNarrowAdminPermit(session: Parameters<NonNullable<Lab['objectives'][number]['check']>>[2]) {
  const router = r1(session);
  const acl = router?.device.acls.get(MGMT_ACL);
  return Boolean(
    acl?.entries.some(
      (entry) => entry.action === 'permit' && entry.source === ADMIN_SUBNET && entry.wildcard === ADMIN_WILDCARD,
    ),
  );
}

function hasAnyPermit(session: Parameters<NonNullable<Lab['objectives'][number]['check']>>[2]) {
  const router = r1(session);
  const acl = router?.device.acls.get(MGMT_ACL);
  return Boolean(
    acl?.entries.some(
      (entry) => entry.action === 'permit' && entry.source === '0.0.0.0' && entry.wildcard === '255.255.255.255',
    ),
  );
}

/**
 * Lab 48 — API-assisted management ACL repair.
 *
 * Scope: CCNA automation/read-only API interpretation plus management-plane ACL
 * troubleshooting. The API is a local read-only facts source; it is not
 * RESTCONF/YANG, not a write API, and not a general HTTP simulator.
 */
export const tshootApiManagementAclRepair: Lab = {
  id: 'ccna-tshoot-api-management-acl-repair',
  title: 'Troubleshoot: API-Assisted Management ACL Repair',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    'Trouble ticket: after an admin VLAN migration, ADMIN-PC can reach R1\'s management IP, but SSH is denied. The NOC provides a read-only device-facts API so you can confirm which branch device and interface are in scope before changing the management-plane policy.\n\nUse the API from ADMIN-PC to identify R1 and its active management interface, prove IP reachability, observe the SSH denial, inspect the VTY access-class and ACL, then make the least-change ACL repair. Do not open SSH management to any source.',
  topology: {
    devices: [
      {
        id: 'ADMIN-PC',
        kind: 'pc',
        platform: 'Windows Workstation',
        interfaces: ['Eth0'],
        pc: { ip: ADMIN_IP, mask: '255.255.255.0', gateway: MGMT_IP },
        position: { x: 70, y: 150 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 390, y: 150 },
      },
    ],
    links: [{ a: { deviceId: 'ADMIN-PC', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } }],
    decorations: [
      {
        id: 'READONLY-API',
        kind: 'wan-cloud',
        label: 'Read-only device facts API',
        variant: 'provider',
        position: { x: 710, y: 150 },
      },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'hostname R1',
      'interface gi0/0',
      'description ADMIN-MGMT-LAN',
      `ip address ${MGMT_IP} 255.255.255.0`,
      'no shutdown',
      'exit',
      'interface gi0/1',
      'description RESERVED-WAN',
      'shutdown',
      'exit',
      'ip domain-name certhead.local',
      'username admin secret C1sco123',
      'enable secret En4ble123',
      'crypto key generate rsa modulus 1024',
      `access-list ${MGMT_ACL} permit ${LEGACY_ADMIN_SUBNET} 0.0.0.255`,
      'line vty 0 4',
      'login local',
      'transport input ssh',
      `access-class ${MGMT_ACL} in`,
      'end',
    ],
  },
  objectives: [
    {
      id: 'discover-management-device-via-api',
      text: 'ADMIN-PC: query the read-only device API inventory and inspect R1 details',
      check: (_state, _history, session) => {
        const pc = adminPc(session);
        return pc !== null && pc.lastApiInventory > 0 && (pc.lastApiDeviceDetail.get('R1') ?? 0) > pc.lastApiInventory;
      },
    },
    {
      id: 'select-management-interface-via-api',
      text: 'ADMIN-PC: query R1 interfaces, then query Gi0/0 directly as the management interface',
      check: (_state, _history, session) => {
        const pc = adminPc(session);
        if (!pc) return false;
        const interfaceList = pc.lastApiInterfaces.get('R1') ?? 0;
        const gi00Detail = pc.lastApiInterfaceDetail.get('R1:Gi0/0') ?? 0;
        return interfaceList > 0 && gi00Detail > interfaceList;
      },
    },
    {
      id: 'prove-reachability-and-ssh-denial',
      text: `ADMIN-PC: ping ${MGMT_IP}, then attempt ssh admin@${MGMT_IP} and observe SSH is denied`,
      check: (_state, _history, session) => {
        const pc = adminPc(session);
        if (!pc) return false;
        const sshAttempts = pc.resolvedHistory.filter((cmd) => cmd === `ssh admin@${MGMT_IP}`).length;
        return (
          pc.lastPing?.target === MGMT_IP &&
          pc.lastPing.ok === true &&
          pc.lastSsh?.target === MGMT_IP &&
          pc.lastSsh.user === 'admin' &&
          (pc.lastSsh.ok === false || sshAttempts >= 2)
        );
      },
    },
    {
      id: 'inspect-vty-acl-policy',
      text: 'R1: inspect show running-config | section line vty and show access-lists before changing the ACL',
      check: (_state, history, session) => {
        const router = r1(session);
        return (
          router !== null &&
          router.device.security.vtyAccessClassIn === MGMT_ACL &&
          (history.R1?.resolved.some((cmd) => cmd === 'show running-config | section line vty') ?? false) &&
          router.lastShowAccessLists > 0
        );
      },
    },
    {
      id: 'apply-narrow-management-acl-repair',
      text: `R1: add only ${ADMIN_SUBNET}/24 to ACL ${MGMT_ACL}; do not permit any source`,
      check: (_state, _history, session) => hasNarrowAdminPermit(session) && !hasAnyPermit(session),
    },
    {
      id: 'verify-ssh-after-acl-repair',
      text: `ADMIN-PC: retest ssh admin@${MGMT_IP} successfully after the ACL repair`,
      check: (_state, _history, session) => {
        const pc = adminPc(session);
        return Boolean(
          pc?.lastSsh?.target === MGMT_IP &&
            pc.lastSsh.user === 'admin' &&
            pc.lastSsh.ok === true &&
            hasNarrowAdminPermit(session) &&
            !hasAnyPermit(session),
        );
      },
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      text: 'Start on ADMIN-PC with `curl http://api.certhead.local/devices`, then inspect R1 and its interfaces before changing the router.',
    },
    {
      afterSeconds: 240,
      text: `Ping ${MGMT_IP} proves L3 reachability. If SSH fails while ping works, inspect the VTY access-class and the referenced ACL with \`show running-config | section line vty\` and \`show access-lists\`.`,
    },
    {
      afterSeconds: 360,
      text: `Repair only the new admin subnet: \`access-list ${MGMT_ACL} permit ${ADMIN_SUBNET} ${ADMIN_WILDCARD}\`. Avoid \`permit any\`, then retest SSH from ADMIN-PC.`,
    },
  ],
  solution: {
    steps: [
      {
        device: 'ADMIN-PC',
        note: 'Use the read-only API to confirm R1 and select its active management interface:',
        commands: [
          'curl http://api.certhead.local/devices',
          'curl http://api.certhead.local/devices/R1',
          'curl http://api.certhead.local/devices/R1/interfaces',
          'curl http://api.certhead.local/devices/R1/interfaces/Gi0%2F0',
          `ping ${MGMT_IP}`,
          `ssh admin@${MGMT_IP}`,
        ],
      },
      {
        device: 'R1',
        note: 'Inspect the VTY restriction and referenced management ACL:',
        commands: ['enable', 'show running-config | section line vty', 'show access-lists'],
      },
      {
        device: 'R1',
        note: 'Add only the migrated admin subnet to the existing standard ACL:',
        commands: [
          'configure terminal',
          `access-list ${MGMT_ACL} permit ${ADMIN_SUBNET} ${ADMIN_WILDCARD}`,
          'end',
          'show access-lists',
        ],
      },
      {
        device: 'ADMIN-PC',
        note: 'Retest SSH after the ACL repair:',
        commands: [`ssh admin@${MGMT_IP}`],
      },
    ],
  },
};
