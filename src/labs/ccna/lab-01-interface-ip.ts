import type { Lab } from '@/engine/types';

/**
 * Paid CCNA source lab. The public `/try` starter path uses a separate
 * `ccna-starter-*` wrapper so free labs have distinct public ids/copy while
 * the full catalog remains Pro-only.
 */
export const lab01InterfaceIp: Lab = {
  id: 'ccna-l01-interface-ip',
  title: 'Configure Interface IP & Bring Link Up',
  exam: 'CCNA 200-301',
  difficulty: 1,
  estimatedMinutes: 5,
  isFree: false,
  scenario:
    "You've just unboxed an ISR4321 router for a new branch office. The chassis is racked and powered, but every interface is administratively down - a fresh-from-the-box state. The network team has assigned 192.168.1.1/24 to GigabitEthernet0/0, the uplink into the branch access switch (SW1), and they're waiting on you to bring the link up.\n\nConfigure the interface, bring it up, and verify it with show ip interface brief. The terminal behaves like a real Cisco router - abbreviations work, ? shows context help, and Tab completes unique prefixes.",
  topology: {
    // R1 is the only device the learner configures. SW1 is a passive upstream
    // access switch (the router's first hop is normally a switch): it carries
    // no objectives, no solution steps, and needs no setup — its ports are
    // admin-up by default. Its sole purpose is to give Gi0/0 a real link
    // partner so `no shutdown` brings the line protocol genuinely up (up/up),
    // which the verify objective and completion copy promise. Before
    // `no shutdown`, Gi0/0 is still admin-down → protocol down (the lab's
    // whole point); after, it reads up/up and the cable LED goes green.
    devices: [
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1', 'Gi0/2'] },
      { id: 'SW1', kind: 'switch', platform: 'C2960', interfaces: ['Gi0/1'] },
    ],
    links: [{ a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'SW1', iface: 'Gi0/1' } }],
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
      // History is per-device. R1 is the learner's device (SW1 is a passive
      // peer with no commands), so match on R1's history. Accept the command
      // from priv mode OR via `do` from config-family modes; both forms appear
      // in resolvedHistory as canonical strings.
      check: (state, history) =>
        state.R1.interfaces['Gi0/0'].ip === '192.168.1.1' &&
        state.R1.interfaces['Gi0/0'].mask === '255.255.255.0' &&
        state.R1.interfaces['Gi0/0'].adminUp === true &&
        state.R1.interfaces['Gi0/0'].protocolUp === true &&
        (history.R1?.resolved.some((cmd) =>
          /^(do\s+)?show ip interface brief$/.test(cmd),
        ) ?? false),
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
