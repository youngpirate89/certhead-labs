import type { Lab } from '@/engine/types';
import { canReach } from '@/engine/reachability';

const FINANCE_VLAN = 30;
const APP_IP = '198.51.50.10';

function hasStaticRoutes(device: unknown): device is {
  staticRoutes: readonly { prefix: string; mask: string; nextHop?: string | null }[];
} {
  return typeof device === 'object' && device !== null && 'staticRoutes' in device;
}

function trunkAllowsFinanceVlan(port: { mode: string; trunkAllowedVlans: 'all' | readonly number[] } | undefined): boolean {
  return port?.mode === 'trunk' && (port.trunkAllowedVlans === 'all' || port.trunkAllowedVlans.includes(FINANCE_VLAN));
}

function hasPostFixTrunkShow(history: readonly string[]): boolean {
  const fixIndex = history.findIndex((line) => /switchport trunk allowed vlan add 30/i.test(line));
  if (fixIndex < 0) return false;
  return history.slice(fixIndex + 1).some((line) => /^show interfaces trunk$/i.test(line) || /^sh(?:ow)? int(?:erfaces)? tr(?:unk)?$/i.test(line));
}

/**
 * Lab 50 — final private-lab capstone ticket.
 *
 * One realistic cleanup mistake creates several noisy symptoms: Finance users
 * have APIPA/no default gateway, DHCP appears broken, and the HQ app is down.
 * The router default route and HQ side are healthy; VLAN 30 was removed from
 * the SW1-to-R1 trunk. Learners must prove the symptom, avoid shotgun routing
 * changes, repair the trunk allowed list, and verify both the affected and
 * unaffected VLANs.
 */
export const tshootBranchMultiSymptomFinal: Lab = {
  id: 'ccna-tshoot-branch-multi-symptom-final',
  title: 'Troubleshoot: Branch Multi-Symptom Final Ticket',
  exam: 'CCNA 200-301',
  difficulty: 4,
  estimatedMinutes: 16,
  isFree: false,
  scenario:
    'Trouble ticket: after a branch switch cleanup, Finance users cannot get normal IP settings and cannot reach the HQ finance application at 198.51.50.10. Operations users on the same access switch are still working, and monitoring says the branch router is up.\n\nThis final ticket has noisy symptoms but one root cause. Start at the affected workstation, compare a working VLAN, verify the router still has its default route toward HQ, inspect the access switch uplink, then make the smallest safe repair. Restore Finance DHCP/default-gateway service and confirm the HQ application path works without breaking Operations.',
  topology: {
    devices: [
      {
        id: 'PC-FINANCE',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { dhcp: true },
        position: { x: 0, y: 100 },
      },
      {
        id: 'PC-OPS',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { dhcp: true },
        position: { x: 0, y: 360 },
      },
      {
        id: 'SW1',
        kind: 'switch',
        platform: 'C2960',
        interfaces: ['Fa0/10', 'Fa0/30', 'Gi0/1'],
        position: { x: 290, y: 230 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 560, y: 230 },
      },
      {
        id: 'EDGE',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0', 'Gi0/1'],
        position: { x: 810, y: 230 },
      },
      {
        id: 'HQ-APP',
        kind: 'pc',
        platform: 'Server',
        deviceClass: 'server',
        interfaces: ['Eth0'],
        pc: { ip: APP_IP, mask: '255.255.255.0', gateway: '198.51.50.1' },
        position: { x: 1060, y: 230 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-FINANCE', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/30' } },
      { a: { deviceId: 'PC-OPS', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/10' } },
      { a: { deviceId: 'SW1', iface: 'Gi0/1' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'EDGE', iface: 'Gi0/0' } },
      { a: { deviceId: 'EDGE', iface: 'Gi0/1' }, b: { deviceId: 'HQ-APP', iface: 'Eth0' } },
    ],
    decorations: [
      { id: 'WAN', kind: 'wan-cloud', label: 'HQ WAN / Finance App', variant: 'isp', position: { x: 690, y: 80 } },
    ],
  },
  setup: {
    SW1: [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Operations',
      'exit',
      'vlan 30',
      'name Finance',
      'exit',
      'interface Fa0/10',
      'description Operations workstation - working VLAN',
      'switchport mode access',
      'switchport access vlan 10',
      'exit',
      'interface Fa0/30',
      'description Finance workstation - affected VLAN',
      'switchport mode access',
      'switchport access vlan 30',
      'exit',
      'interface Gi0/1',
      'description Trunk to R1 router-on-a-stick',
      'switchport mode trunk',
      'switchport trunk allowed vlan 10',
      'end',
    ],
    R1: [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'description Router-on-a-stick trunk to SW1',
      'no shutdown',
      'exit',
      'interface Gi0/0.10',
      'encapsulation dot1q 10',
      'ip address 10.50.10.1 255.255.255.0',
      'exit',
      'interface Gi0/0.30',
      'encapsulation dot1q 30',
      'ip address 10.50.30.1 255.255.255.0',
      'exit',
      'interface Gi0/1',
      'description WAN to EDGE',
      'ip address 10.50.0.1 255.255.255.252',
      'no shutdown',
      'exit',
      'ip dhcp excluded-address 10.50.10.1 10.50.10.20',
      'ip dhcp excluded-address 10.50.30.1 10.50.30.20',
      'ip dhcp pool OPS',
      'network 10.50.10.0 255.255.255.0',
      'default-router 10.50.10.1',
      'dns-server 8.8.8.8',
      'exit',
      'ip dhcp pool FINANCE',
      'network 10.50.30.0 255.255.255.0',
      'default-router 10.50.30.1',
      'dns-server 8.8.8.8',
      'exit',
      'ip route 0.0.0.0 0.0.0.0 10.50.0.2',
      'end',
    ],
    EDGE: [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'description WAN to R1',
      'ip address 10.50.0.2 255.255.255.252',
      'no shutdown',
      'exit',
      'interface Gi0/1',
      'description HQ finance app segment',
      'ip address 198.51.50.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip route 10.50.10.0 255.255.255.0 10.50.0.1',
      'ip route 10.50.30.0 255.255.255.0 10.50.0.1',
      'end',
    ],
  },
  objectives: [
    {
      id: 'confirm-finance-symptoms',
      text: 'PC-FINANCE: confirm the affected workstation has no valid DHCP lease and cannot reach 198.51.50.10.',
      check: (_state, history, session) => {
        const pc = session.devices['PC-FINANCE'];
        const ranIpconfig = pc?.kind === 'pc' && pc.lastIpconfig > 0;
        const triedAppPing = history['PC-FINANCE']?.raw.some((cmd) => new RegExp(`^ping\\s+${APP_IP.replace(/\./g, '\\.')}$`, 'i').test(cmd)) ?? false;
        return ranIpconfig && triedAppPing;
      },
    },
    {
      id: 'compare-working-vlan',
      text: 'PC-OPS: confirm the working VLAN still receives a valid 10.50.10.0/24 DHCP lease.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-OPS'];
        return pc?.kind === 'pc' && pc.lastIpconfig > 0 && pc.ip?.startsWith('10.50.10.') === true && pc.gateway === '10.50.10.1';
      },
    },
    {
      id: 'verify-router-default-route',
      text: 'R1: run show ip route and verify the branch router still has a static default route toward HQ.',
      check: (_state, history, session) => {
        const r1 = session.devices.R1;
        const showedRoute = history.R1?.resolved.some((cmd) => /^(do\s+)?show ip route$/.test(cmd)) ?? false;
        return r1?.kind === 'router' && showedRoute && hasStaticRoutes(r1) && r1.staticRoutes.some((route) => route.prefix === '0.0.0.0' && route.mask === '0.0.0.0' && route.nextHop === '10.50.0.2');
      },
    },
    {
      id: 'restore-finance-trunk-vlan',
      text: 'SW1: restore VLAN 30 to the Gi0/1 trunk allowed list without removing VLAN 10.',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        const trunk = sw1.device.switchports['Gi0/1'];
        const opsStillAllowed = trunk?.trunkAllowedVlans === 'all' || trunk?.trunkAllowedVlans.includes(10) === true;
        return trunkAllowsFinanceVlan(trunk) && opsStillAllowed;
      },
    },
    {
      id: 'verify-trunk-after-repair',
      text: 'SW1: after the repair, run show interfaces trunk and verify VLAN 30 is allowed on Gi0/1.',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        if (sw1?.kind !== 'switch') return false;
        const trunk = sw1.device.switchports['Gi0/1'];
        const verified = sw1.lastShowInterfacesTrunk?.trunkPortIds.includes('Gi0/1') ?? false;
        return trunkAllowsFinanceVlan(trunk) && verified && hasPostFixTrunkShow(sw1.resolvedHistory);
      },
    },
    {
      id: 'verify-finance-dhcp-lease',
      text: 'PC-FINANCE: verify it receives a valid 10.50.30.0/24 DHCP lease and default gateway after the trunk fix.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-FINANCE'];
        return pc?.kind === 'pc' && pc.lastIpconfig > 0 && pc.ip?.startsWith('10.50.30.') === true && pc.gateway === '10.50.30.1';
      },
    },
    {
      id: 'verify-hq-app-restored',
      text: 'PC-FINANCE: verify the HQ finance application path at 198.51.50.10 is reachable after DHCP is restored.',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-FINANCE'];
        return pc?.kind === 'pc' && pc.lastPing?.target === APP_IP && pc.lastPing.ok === true && canReach(session, 'PC-FINANCE', APP_IP).ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Use endpoint evidence first: APIPA/no gateway on one VLAN while another VLAN still has DHCP points away from a total router or WAN failure.',
    },
    {
      afterSeconds: 180,
      text: 'R1 can have a valid static default route and still be unable to serve Finance if VLAN 30 never crosses the switch trunk.',
    },
    {
      afterSeconds: 300,
      text: 'On SW1, check `show interfaces trunk`. If VLAN 30 is missing, add it with `switchport trunk allowed vlan add 30` so VLAN 10 remains allowed.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'PC-FINANCE',
        note: 'Confirm the reported Finance symptoms from the affected endpoint:',
        commands: ['ipconfig', `ping ${APP_IP}`],
      },
      {
        device: 'PC-OPS',
        note: 'Compare with the unaffected Operations VLAN:',
        commands: ['ipconfig'],
      },
      {
        device: 'R1',
        note: 'Verify the router default route is present before changing routing:',
        commands: ['enable', 'show ip route'],
      },
      {
        device: 'SW1',
        note: 'Inspect and repair the router trunk allowed list:',
        commands: [
          'enable',
          'show interfaces trunk',
          'configure terminal',
          'interface Gi0/1',
          'switchport trunk allowed vlan add 30',
          'end',
          'show interfaces trunk',
        ],
      },
      {
        device: 'PC-FINANCE',
        note: 'Verify DHCP/default-gateway service and the HQ app path are restored:',
        commands: ['ipconfig', `ping ${APP_IP}`],
      },
      {
        device: 'PC-OPS',
        note: 'Confirm the working VLAN was preserved:',
        commands: ['ipconfig'],
      },
    ],
  },
};
