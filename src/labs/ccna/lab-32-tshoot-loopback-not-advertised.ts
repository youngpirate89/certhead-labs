import type { Lab } from '@/engine/types';
import { canReach } from '@/engine/reachability';

function commandCount(commands: readonly string[] | undefined, exact: string): number {
  return commands?.filter((cmd) => cmd === exact).length ?? 0;
}

function hasPingTo(commands: readonly string[] | undefined, target: string): boolean {
  return commands?.some((cmd) => cmd === `ping ${target}`) ?? false;
}

export const lab32TshootLoopbackNotAdvertised: Lab = {
  id: 'ccna-lab32-tshoot-loopback-not-advertised',
  title: 'Troubleshoot: Loopback Missing from OSPF',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 15,
  isFree: false,
  scenario:
    'Monitoring now targets router loopback addresses, but R1 cannot reach R2\'s management loopback 10.255.32.2. The physical transit link is healthy and OSPF adjacency should already be FULL. Troubleshoot from R1, prove the neighbor is healthy, identify that the remote /32 route is missing, then repair OSPF on the router that owns the missing loopback.\n\nDo not change the transit link. The fault is an OSPF advertisement problem, not a cabling or interface-addressing problem.',
  topology: {
    devices: [
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0'] },
      { id: 'R2', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0'] },
    ],
    links: [
      { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 172.16.32.1 255.255.255.252',
      'no shutdown',
      'interface loopback0',
      'ip address 10.255.32.1 255.255.255.255',
      'exit',
      'router ospf 1',
      'router-id 10.255.32.1',
      'network 172.16.32.0 0.0.0.3 area 0',
      'network 10.255.32.1 0.0.0.0 area 0',
      'end',
    ],
    R2: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 172.16.32.2 255.255.255.252',
      'no shutdown',
      'interface loopback0',
      'ip address 10.255.32.2 255.255.255.255',
      'exit',
      'router ospf 1',
      'router-id 10.255.32.2',
      'network 172.16.32.0 0.0.0.3 area 0',
      // Fault: R2's Loopback0 exists but is not advertised into OSPF.
      'end',
    ],
  },
  objectives: [
    {
      id: 'diagnose-ospf-neighbor',
      text: 'R1: verify the OSPF neighbor is FULL so you do not chase the physical link',
      check: (_state, history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const neighborHealthy = Array.from(r1.device.ospf.neighbors.values()).some((n) => n.state === 'FULL');
        return neighborHealthy && commandCount(history.R1?.resolved, 'show ip ospf neighbor') >= 1;
      },
    },
    {
      id: 'diagnose-missing-route',
      text: 'R1: inspect the routing table and identify that 10.255.32.2/32 is missing',
      check: (_state, history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return commandCount(history.R1?.resolved, 'show ip route') >= 1;
      },
    },
    {
      id: 'repair-r2-loopback-advertisement',
      text: 'R2: advertise Loopback0 10.255.32.2/32 into OSPF area 0',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        const r2 = session.devices.R2;
        if (r1?.kind !== 'router' || r2?.kind !== 'router') return false;
        const r2HasNetwork = r2.device.ospf.networks.some(
          (n) => n.prefix === '10.255.32.2' && n.wildcard === '0.0.0.0' && n.area === 0,
        );
        const r1LearnsRoute = r1.ospfRoutes.some((r) => r.prefix === '10.255.32.2' && r.mask === '255.255.255.255');
        return r2HasNetwork && r1LearnsRoute;
      },
    },
    {
      id: 'verify-after-repair',
      text: 'R1: re-check the route table and successfully ping R2\'s loopback after the repair',
      check: (_state, history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const routePresent = r1.ospfRoutes.some((r) => r.prefix === '10.255.32.2' && r.mask === '255.255.255.255');
        const routeCheckedBeforeAndAfter = commandCount(history.R1?.resolved, 'show ip route') >= 2;
        const pingedTarget = hasPingTo(history.R1?.resolved, '10.255.32.2');
        return routePresent && routeCheckedBeforeAndAfter && pingedTarget && canReach(session, 'R1', '10.255.32.2').ok;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Start with show ip ospf neighbor on R1. If the neighbor is FULL, the transit link and OSPF adjacency are probably not the problem.',
    },
    {
      afterSeconds: 180,
      text: 'Use show ip route on R1. You are looking specifically for an OSPF route to 10.255.32.2/32.',
    },
    {
      afterSeconds: 300,
      text: 'The loopback lives on R2, so the missing OSPF network statement belongs under router ospf 1 on R2.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Confirm the neighbor is healthy, then verify the remote loopback route is missing:',
        commands: [
          'enable',
          'show ip ospf neighbor',
          'show ip route',
          'ping 10.255.32.2',
        ],
      },
      {
        device: 'R2',
        note: 'Advertise R2 Loopback0 into OSPF area 0:',
        commands: [
          'enable',
          'configure terminal',
          'router ospf 1',
          'network 10.255.32.2 0.0.0.0 area 0',
          'end',
        ],
      },
      {
        device: 'R1',
        note: 'Verify R1 learned the /32 and can reach R2\'s loopback:',
        commands: [
          'show ip route',
          'ping 10.255.32.2',
        ],
      },
    ],
  },
};
