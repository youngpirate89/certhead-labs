import type { Lab } from '@/engine/types';

const PC_IPV6 = '2001:db8:47:10::50';
const PC_PREFIX = `${PC_IPV6}/64`;
const GATEWAY = '2001:db8:47:10::1';
const WRONG_GATEWAY = '2001:db8:47:10::254';

function pcOps(session: Parameters<NonNullable<Lab['objectives'][number]['check']>>[2]) {
  const device = session.devices['PC-OPS'];
  return device?.kind === 'pc' ? device : null;
}

function r1(session: Parameters<NonNullable<Lab['objectives'][number]['check']>>[2]) {
  const device = session.devices.R1;
  return device?.kind === 'router' ? device : null;
}

export const tshootIpv6MissingDefaultGateway: Lab = {
  id: 'ccna-tshoot-ipv6-missing-default-gateway',
  title: 'Troubleshoot: IPv6 Default Gateway Missing',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 9,
  isFree: false,
  scenario:
    'Trouble ticket: the operations workstation was manually assigned an IPv6 address during a branch migration, but it cannot reach resources outside its local IPv6 subnet. R1 already has the correct IPv6 gateway address on the LAN. The workstation address is valid, but its IPv6 default gateway is missing.\n\nVerify the PC configuration, verify the router gateway address, then correct the workstation with a realistic Windows PowerShell IPv6 command and verify the IPv6 default gateway appears afterward.',
  topology: {
    devices: [
      {
        id: 'PC-OPS',
        kind: 'pc',
        platform: 'Windows Workstation',
        interfaces: ['Eth0'],
        position: { x: 80, y: 140 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0'],
        position: { x: 360, y: 140 },
      },
    ],
    links: [
      { a: { deviceId: 'PC-OPS', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
    ],
    decorations: [
      {
        id: 'IPV6-APP-NET',
        kind: 'wan-cloud',
        label: 'IPv6 App Network',
        variant: 'provider',
        position: { x: 640, y: 140 },
      },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      `ipv6 address ${GATEWAY}/64`,
      'no shutdown',
      'end',
    ],
    'PC-OPS': [`ipv6 ${PC_PREFIX}`],
  },
  objectives: [
    {
      id: 'inspect-pc-ipv6-state',
      text: 'PC-OPS: run Get-NetIPConfiguration and identify that the IPv6 default gateway is missing',
      check: (_state, history, session) => {
        const pc = pcOps(session);
        const pcHistory = history['PC-OPS']?.resolved ?? [];
        const firstIpconfig = pcHistory.findIndex((cmd) => /^(ipconfig|get-netipconfiguration)$/i.test(cmd));
        const gatewayConfig = pcHistory.findIndex((cmd) => /^new-netipaddress\b/i.test(cmd));
        return pc?.ipv6 === PC_PREFIX && firstIpconfig !== -1 && (gatewayConfig === -1 || firstIpconfig < gatewayConfig);
      },
    },
    {
      id: 'verify-router-gateway-address',
      text: `R1: run show ipv6 interface brief and confirm Gi0/0 has ${GATEWAY}/64`,
      check: (_state, history, session) => {
        const router = r1(session);
        return (
          !!router?.device.interfaces['Gi0/0'].ipv6Addresses.includes(`${GATEWAY}/64`) &&
          (history.R1?.resolved.some((cmd) => /^(do\s+)?show ipv6 interface brief$/.test(cmd)) ?? false)
        );
      },
    },
    {
      id: 'configure-pc-ipv6-default-gateway',
      text: `PC-OPS: configure ${GATEWAY} as the IPv6 default gateway with New-NetIPAddress`,
      check: (_state, _history, session) => {
        const pc = pcOps(session);
        return pc?.ipv6 === PC_PREFIX && pc.gateway6 === GATEWAY;
      },
    },
    {
      id: 'verify-pc-gateway-after-fix',
      text: 'PC-OPS: rerun Get-NetIPConfiguration after the fix and verify the IPv6 default gateway',
      check: (_state, history, session) => {
        const pc = pcOps(session);
        const pcIpconfigRuns =
          history['PC-OPS']?.resolved.filter((cmd) => /^(ipconfig|get-netipconfiguration)$/i.test(cmd)).length ?? 0;
        return pc?.ipv6 === PC_PREFIX && pc.gateway6 === GATEWAY && pcIpconfigRuns >= 2;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'A valid IPv6 address is not enough for off-link IPv6 traffic. Check the IPv6 Default Gateway line in `Get-NetIPConfiguration`.',
    },
    {
      afterSeconds: 180,
      text: `R1 already owns the LAN gateway address ${GATEWAY}/64. Use \`show ipv6 interface brief\` on R1 and then correct the PC default gateway.`,
    },
    {
      afterSeconds: 300,
      text: `On PC-OPS, use \`New-NetIPAddress -InterfaceAlias Eth0 -IPAddress ${PC_IPV6} -PrefixLength 64 -DefaultGateway ${GATEWAY}\`, then rerun \`Get-NetIPConfiguration\`. Do not use ${WRONG_GATEWAY}.`,
    },
  ],
  solution: {
    steps: [
      {
        device: 'PC-OPS',
        note: 'Inspect the workstation IPv6 state and notice the missing IPv6 default gateway:',
        commands: ['Get-NetIPConfiguration'],
      },
      {
        device: 'R1',
        note: 'Verify the router already has the correct IPv6 LAN gateway address:',
        commands: ['enable', 'show ipv6 interface brief'],
      },
      {
        device: 'PC-OPS',
        note: 'Configure the correct IPv6 default gateway and verify afterward:',
        commands: [
          `New-NetIPAddress -InterfaceAlias Eth0 -IPAddress ${PC_IPV6} -PrefixLength 64 -DefaultGateway ${GATEWAY}`,
          'Get-NetIPConfiguration',
        ],
      },
    ],
  },
};
