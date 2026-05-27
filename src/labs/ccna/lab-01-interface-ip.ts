import type { Lab } from '@/engine/types';

/**
 * The public free lab — top-of-funnel marketing asset (CLAUDE.md).
 *
 * "Configure GigabitEthernet0/0 with IP 192.168.1.1/24 and bring the interface
 * up, then verify with `show ip interface brief`." Foundational, ~5 minutes,
 * single device. This is the ONE lab with isFree: true.
 */
export const lab01InterfaceIp: Lab = {
  id: 'ccna-l01-interface-ip',
  title: 'Configure Interface IP & Bring Link Up',
  exam: 'CCNA 200-301',
  difficulty: 1,
  estimatedMinutes: 5,
  isFree: true,
  scenario:
    "You've just unboxed an ISR4321 router for a new branch office. The chassis is racked and powered, but every interface is administratively down — a fresh-from-the-box state. The network team has assigned 192.168.1.1/24 to GigabitEthernet0/0 for the WAN uplink, and they're waiting on you to bring the link up.\n\nConfigure the interface, bring it up, and verify it with show ip interface brief. The terminal behaves like a real Cisco router — abbreviations work, ? shows context help, and Tab completes unique prefixes.",
  topology: {
    devices: [
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1', 'Gi0/2'] },
    ],
    links: [],
  },
  objectives: [
    {
      id: 'ip',
      text: 'R1 Gi0/0: assign ip address 192.168.1.1 255.255.255.0',
      check: (state) =>
        state.R1.interfaces['Gi0/0'].ip === '192.168.1.1' &&
        state.R1.interfaces['Gi0/0'].mask === '255.255.255.0',
    },
    {
      id: 'noshut',
      text: 'R1 Gi0/0: bring the interface up with no shutdown',
      check: (state) => state.R1.interfaces['Gi0/0'].adminUp === true,
    },
    {
      id: 'verify',
      text: 'R1: run show ip interface brief to confirm Gi0/0 is up/up',
      // History is per-device — lab-01 has one device, R1. Accept the command
      // from priv mode OR via `do` from config-family modes; both forms appear
      // in resolvedHistory as canonical strings.
      check: (_state, history) =>
        history.R1?.resolved.some((cmd) =>
          /^(do\s+)?show ip interface brief$/.test(cmd),
        ) ?? false,
    },
  ],
  hints: [
    { afterSeconds: 60, text: 'Start with `enable` to enter privileged mode, then `configure terminal`.' },
    { afterSeconds: 180, text: 'Use `interface GigabitEthernet0/0` to configure the interface, then `ip address 192.168.1.1 255.255.255.0`.' },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Enter config, set the IP, bring the interface up, and verify:',
        commands: [
          'enable',
          'configure terminal',
          'interface GigabitEthernet0/0',
          'ip address 192.168.1.1 255.255.255.0',
          'no shutdown',
          'exit',
          'end',
          'show ip interface brief',
        ],
      },
    ],
  },
};
