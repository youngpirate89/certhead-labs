import type { Lab } from '@/engine/types';
import { canReach } from '@/engine/reachability';

const HELPDESK_IP = '10.200.20.60';
const USER_PORT = 'Fa0/12';
const STALE_SECURE_MAC = '0011.2233.4455';

function sw1(session: Parameters<NonNullable<Lab['objectives'][number]['check']>>[2]) {
  const device = session.devices.SW1;
  return device?.kind === 'switch' ? device : null;
}

function pcUser(session: Parameters<NonNullable<Lab['objectives'][number]['check']>>[2]) {
  const device = session.devices['PC-USER'];
  return device?.kind === 'pc' ? device : null;
}

function saw(history: readonly string[] | undefined, pattern: RegExp): boolean {
  return !!history?.some((cmd) => pattern.test(cmd));
}

function sawShowStatusAfterRecovery(history: readonly string[] | undefined): boolean {
  if (!history) return false;
  let lastNoShutdown = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (/^no shutdown$/.test(history[i])) {
      lastNoShutdown = i;
      break;
    }
  }
  if (lastNoShutdown < 0) return false;
  return history.slice(lastNoShutdown + 1).some((cmd) => /^(do\s+)?show interfaces status$/.test(cmd));
}

export const tshootPortSecurityErrdisabledUser: Lab = {
  id: 'ccna-tshoot-port-security-errdisabled-user',
  title: 'Troubleshoot: Port Security Err-Disabled User',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    'After a desk move, one user reports that the PC has a valid address but cannot reach the helpdesk server on the same user VLAN. The outage is isolated to a single access-layer switch port. Troubleshoot SW1 like a campus support technician: prove the user symptom, inspect interface and port-security state, remove only the stale secure MAC binding, bounce the access port safely, and verify the user is back online.\n\nReal-world lesson: single-user outages often live at Layer 1/Layer 2 on the access switch, not in routing.',
  topology: {
    devices: [
      {
        id: 'PC-USER',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '10.200.20.50', mask: '255.255.255.0', gateway: '10.200.20.1' },
        position: { x: 80, y: 180 },
      },
      {
        id: 'SRV-HELPDESK',
        kind: 'pc',
        platform: 'Helpdesk Server',
        interfaces: ['Eth0'],
        pc: { ip: HELPDESK_IP, mask: '255.255.255.0', gateway: '10.200.20.1' },
        position: { x: 640, y: 180 },
      },
      {
        id: 'SW1',
        kind: 'switch',
        platform: 'C2960',
        interfaces: [USER_PORT, 'Fa0/2'],
        position: { x: 360, y: 180 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-USER', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: USER_PORT } },
      { a: { deviceId: 'SW1', iface: 'Fa0/2' }, b: { deviceId: 'SRV-HELPDESK', iface: 'Eth0' } },
    ],
  },
  setup: {
    SW1: [
      'enable',
      'configure terminal',
      'vlan 20',
      'name USERS',
      'interface Fa0/2',
      'description Helpdesk-server',
      'switchport mode access',
      'switchport access vlan 20',
      `interface ${USER_PORT}`,
      'description User-desk-move',
      'switchport mode access',
      'switchport access vlan 20',
      'switchport port-security',
      'switchport port-security maximum 1',
      `switchport port-security mac-address sticky ${STALE_SECURE_MAC}`,
      'shutdown',
      'end',
    ],
  },
  objectives: [
    {
      id: 'confirm-user-reachability-failure',
      text: `PC-USER: ping ${HELPDESK_IP} and confirm the user cannot reach the helpdesk server`,
      check: (_state, _history, session) => {
        const pc = pcUser(session);
        return pc?.resolvedHistory.some((cmd) => cmd === `ping ${HELPDESK_IP}`) ?? false;
      },
    },
    {
      id: 'inspect-port-security-state',
      text: `SW1: inspect show interfaces status and show port-security interface ${USER_PORT}`,
      check: (_state, history) =>
        saw(history.SW1?.resolved, /^(do\s+)?show interfaces status$/) &&
        saw(history.SW1?.resolved, new RegExp(`^(do\\s+)?show port-security interface ${USER_PORT.replace('/', '\\/')}$`)),
    },
    {
      id: 'remove-stale-secure-mac',
      text: `SW1: remove only the stale sticky secure MAC ${STALE_SECURE_MAC} from ${USER_PORT}`,
      check: (_state, history, session) => {
        const port = sw1(session)?.device.switchports[USER_PORT];
        return (
          !!port?.portSecurity?.enabled &&
          port.portSecurity.secureMac === null &&
          port.portSecurity.violation === false &&
          saw(
            history.SW1?.resolved,
            new RegExp(`^no switchport port-security mac-address sticky ${STALE_SECURE_MAC.replace('.', '\\.')}`),
          )
        );
      },
    },
    {
      id: 'recover-access-port',
      text: `SW1: shutdown/no shutdown ${USER_PORT}, then verify show interfaces status reports connected`,
      check: (_state, history, session) => {
        const port = sw1(session)?.device.switchports[USER_PORT];
        return !!port?.adminUp && !!port.protocolUp && sawShowStatusAfterRecovery(history.SW1?.resolved);
      },
    },
    {
      id: 'verify-user-reachability-restored',
      text: `PC-USER: ping ${HELPDESK_IP} successfully after the port is recovered`,
      check: (_state, _history, session) => {
        const pc = pcUser(session);
        return pc?.lastPing?.target === HELPDESK_IP && pc.lastPing.ok === true && canReach(session, 'PC-USER', HELPDESK_IP).ok;
      },
    },
  ],
  hints: [
    { afterSeconds: 60, text: 'Start with the user symptom: ping the default gateway from PC-USER.' },
    { afterSeconds: 180, text: `On SW1, compare show interfaces status with show port-security interface ${USER_PORT}.` },
    { afterSeconds: 300, text: `Remove the stale sticky secure MAC, then bounce ${USER_PORT} with shutdown and no shutdown.` },
  ],
  solution: {
    steps: [
      {
        device: 'PC-USER',
        note: 'Confirm the user outage from the affected endpoint:',
        commands: [`ping ${HELPDESK_IP}`],
      },
      {
        device: 'SW1',
        note: 'Inspect the access port and port-security state:',
        commands: ['enable', 'show interfaces status', `show port-security interface ${USER_PORT}`],
      },
      {
        device: 'SW1',
        note: 'Remove only the stale sticky secure MAC, then recover the err-disabled port:',
        commands: [
          'configure terminal',
          `interface ${USER_PORT}`,
          `no switchport port-security mac-address sticky ${STALE_SECURE_MAC}`,
          'shutdown',
          'no shutdown',
          'end',
          'show interfaces status',
        ],
      },
      {
        device: 'PC-USER',
        note: 'Verify the user can reach the helpdesk server again:',
        commands: [`ping ${HELPDESK_IP}`],
      },
    ],
  },
};
