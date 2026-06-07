import type { Lab } from '@/engine/types';

/**
 * Lab 02 — network discovery fundamentals.
 *
 * This fills the numbered gap between the free interface-IP lab and the first
 * dynamic-routing lab. It is intentionally inspection-first: the devices are
 * already configured, and the learner practices reading the network with real
 * operational commands before changing anything.
 */
export const lab02NetworkDiscovery: Lab = {
  id: 'ccna-lab02-network-discovery',
  title: 'Network Discovery: Interfaces, VLANs, Routes, and Ping',
  exam: 'CCNA 200-301',
  difficulty: 1,
  estimatedMinutes: 7,
  isFree: false,
  scenario:
    "You're taking over a small branch network from another technician. The branch is already cabled and configured, but before making any changes you need to build a quick operational picture: which router interfaces are up, what VLAN/port state the access switch shows, what IP settings the workstation has, and whether the workstation can reach its default gateway.\n\nThis lab is about disciplined discovery. Do not configure anything. Use show commands on R1 and SW1, then use the PC to confirm its IP settings and gateway reachability.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.2.10', mask: '255.255.255.0', gateway: '192.168.2.1' },
      },
      { id: 'SW1', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/1', 'Fa0/24'] },
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0'] },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/1' } },
      { a: { deviceId: 'SW1', iface: 'Fa0/24' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'description Branch LAN gateway',
      'ip address 192.168.2.1 255.255.255.0',
      'no shutdown',
      'exit',
    ],
  },
  objectives: [
    {
      id: 'router-discovery',
      text: 'R1: inspect interfaces and routing with show ip interface brief, show interfaces, and show ip route',
      check: (_state, history) => {
        const commands = history.R1?.resolved ?? [];
        const brief = commands.some((cmd) => /^(do\s+)?show ip interface brief$/.test(cmd));
        const interfaces = commands.some((cmd) => /^(do\s+)?show interfaces$/.test(cmd));
        const route = commands.some((cmd) => /^(do\s+)?show ip route$/.test(cmd));
        return brief && interfaces && route;
      },
    },
    {
      id: 'switch-discovery',
      text: 'SW1: inspect VLAN membership and interface status with show vlan brief and show interfaces',
      check: (_state, history) => {
        const commands = history.SW1?.resolved ?? [];
        const vlan = commands.some((cmd) => /^(do\s+)?show vlan( brief)?$/.test(cmd));
        const interfaces = commands.some((cmd) => /^(do\s+)?show interfaces$/.test(cmd));
        return vlan && interfaces;
      },
    },
    {
      id: 'endpoint-discovery',
      text: 'PC-A: run ipconfig, then ping the default gateway 192.168.2.1 successfully',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-A'];
        if (pc?.kind !== 'pc') return false;
        return (
          pc.lastIpconfig > 0 &&
          pc.lastPing?.target === '192.168.2.1' &&
          pc.lastPing.ok === true
        );
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Start on R1 with `enable`, then inspect interface and route state before changing anything.',
    },
    {
      afterSeconds: 150,
      text: 'On SW1, `show vlan brief` tells you which ports are in VLAN 1; `show interfaces` shows link/admin state.',
    },
    {
      afterSeconds: 240,
      text: 'On PC-A, use `ipconfig` to read its address/gateway, then ping 192.168.2.1 to prove the default gateway is reachable.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Inspect R1 interface and routing state:',
        commands: ['enable', 'show ip interface brief', 'show interfaces', 'show ip route'],
      },
      {
        device: 'SW1',
        note: 'Inspect the access switch VLAN and interface state:',
        commands: ['enable', 'show vlan brief', 'show interfaces'],
      },
      {
        device: 'PC-A',
        note: 'Check the workstation IP settings and verify gateway reachability:',
        commands: ['ipconfig', 'ping 192.168.2.1'],
      },
    ],
  },
};
