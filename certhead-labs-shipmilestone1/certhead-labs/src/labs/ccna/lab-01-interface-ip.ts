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
  topology: {
    devices: [{ id: 'R1', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1', 'Gi0/2'] }],
    links: [],
  },
  objectives: [
    {
      id: 'ip',
      text: 'Assign IP 192.168.1.1/24 to GigabitEthernet0/0',
      check: (state) =>
        state.R1.interfaces['Gi0/0'].ip === '192.168.1.1' &&
        state.R1.interfaces['Gi0/0'].mask === '255.255.255.0',
    },
    {
      id: 'noshut',
      text: 'Bring the interface up with no shutdown',
      check: (state) => state.R1.interfaces['Gi0/0'].adminUp === true,
    },
    {
      id: 'verify',
      text: 'Verify with show ip interface brief',
      check: (_state, history) =>
        history.some((cmd) => /^sh(?:ow)?\s+ip\s+int(?:erface)?\s+br(?:ief)?$/i.test(cmd)),
    },
  ],
  hints: [
    { afterSeconds: 60, text: 'Start with `enable` to enter privileged mode, then `configure terminal`.' },
    { afterSeconds: 180, text: 'Use `interface GigabitEthernet0/0` to configure the interface, then `ip address 192.168.1.1 255.255.255.0`.' },
  ],
};
