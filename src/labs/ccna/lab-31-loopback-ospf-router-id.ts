import type { Lab } from '@/engine/types';
import { canReach } from '@/engine/reachability';

export const lab31LoopbackOspfRouterId: Lab = {
  id: 'ccna-lab31-loopback-ospf-router-id',
  title: 'Loopback Interfaces: Set a Stable OSPF Router ID',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 15,
  isFree: false,
  scenario:
    'HQ has two routers already exchanging OSPF routes over a transit link. Configure Loopback0 on each router as a stable management identity, set each OSPF router ID to the loopback address, clear the OSPF process so the new router ID takes effect, advertise both loopbacks into area 0, then verify OSPF and loopback reachability.\n\nLoopbacks are logical interfaces. They stay up as long as the router is running, which makes them useful for management reachability and stable protocol identifiers. On IOS, changing an active OSPF router ID requires clearing the OSPF process or reloading before the operational ID changes.',
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
      'ip address 172.16.31.1 255.255.255.252',
      'no shutdown',
      'exit',
      'router ospf 1',
      'network 172.16.31.0 0.0.0.3 area 0',
      'end',
    ],
    R2: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 172.16.31.2 255.255.255.252',
      'no shutdown',
      'exit',
      'router ospf 1',
      'network 172.16.31.0 0.0.0.3 area 0',
      'end',
    ],
  },
  objectives: [
    {
      id: 'loopbacks-configured',
      text: 'Configure Loopback0 on R1 as 10.255.31.1/32 and on R2 as 10.255.31.2/32',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        const r2 = session.devices.R2;
        if (r1?.kind !== 'router' || r2?.kind !== 'router') return false;
        const lo1 = r1.device.interfaces.Lo0;
        const lo2 = r2.device.interfaces.Lo0;
        return lo1?.ip === '10.255.31.1' && lo1.mask === '255.255.255.255' && lo1.adminUp &&
          lo2?.ip === '10.255.31.2' && lo2.mask === '255.255.255.255' && lo2.adminUp;
      },
    },
    {
      id: 'router-ids-set',
      text: 'Set OSPF router IDs to the loopback addresses on both routers and clear OSPF so the changes take effect',
      check: (_state, history, session) => {
        const r1 = session.devices.R1;
        const r2 = session.devices.R2;
        if (r1?.kind !== 'router' || r2?.kind !== 'router') return false;
        const r1Cleared = history.R1?.resolved.some((cmd) => cmd === 'clear ip ospf process');
        const r2Cleared = history.R2?.resolved.some((cmd) => cmd === 'clear ip ospf process');
        return r1.device.ospf.routerId === '10.255.31.1' && r2.device.ospf.routerId === '10.255.31.2' && Boolean(r1Cleared && r2Cleared);
      },
    },
    {
      id: 'loopbacks-advertised',
      text: 'Advertise both loopback /32 addresses into OSPF area 0',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        const r2 = session.devices.R2;
        if (r1?.kind !== 'router' || r2?.kind !== 'router') return false;
        const r1HasR2Loopback = r1.ospfRoutes.some((r) => r.prefix === '10.255.31.2' && r.mask === '255.255.255.255');
        const r2HasR1Loopback = r2.ospfRoutes.some((r) => r.prefix === '10.255.31.1' && r.mask === '255.255.255.255');
        return r1HasR2Loopback && r2HasR1Loopback;
      },
    },
    {
      id: 'verify-ospf-and-reachability',
      text: 'Verify OSPF neighbor state, routes, and successful pings to the remote loopbacks',
      check: (_state, history, session) => {
        const r1 = session.devices.R1;
        const r2 = session.devices.R2;
        if (r1?.kind !== 'router' || r2?.kind !== 'router') return false;
        const r1Verified = history.R1?.resolved.some((cmd) => cmd === 'show ip ospf neighbor') &&
          history.R1?.resolved.some((cmd) => cmd === 'show ip route') &&
          history.R1?.resolved.some((cmd) => cmd.startsWith('ping '));
        const r2Verified = history.R2?.resolved.some((cmd) => cmd === 'show ip ospf neighbor') &&
          history.R2?.resolved.some((cmd) => cmd === 'show ip route') &&
          history.R2?.resolved.some((cmd) => cmd.startsWith('ping '));
        return Boolean(r1Verified && r2Verified && canReach(session, 'R1', '10.255.31.2').ok && canReach(session, 'R2', '10.255.31.1').ok);
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'A /32 loopback uses mask 255.255.255.255. Enter it with interface loopback0.',
    },
    {
      afterSeconds: 180,
      text: 'Under router ospf 1, use router-id <loopback-ip> and a host wildcard such as network 10.255.31.1 0.0.0.0 area 0. Then use clear ip ospf process from privileged EXEC so the new router ID takes effect.',
    },
    {
      afterSeconds: 300,
      text: 'Verify from both routers with show ip ospf neighbor, show ip route, and ping the remote loopback address.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Configure R1 loopback, set OSPF router ID, and advertise the /32:',
        commands: [
          'enable',
          'configure terminal',
          'interface loopback0',
          'ip address 10.255.31.1 255.255.255.255',
          'exit',
          'router ospf 1',
          'router-id 10.255.31.1',
          'network 10.255.31.1 0.0.0.0 area 0',
          'end',
          'clear ip ospf process',
          'show ip ospf neighbor',
          'show ip route',
          'ping 10.255.31.2',
        ],
      },
      {
        device: 'R2',
        note: 'Configure R2 loopback, set OSPF router ID, and advertise the /32:',
        commands: [
          'enable',
          'configure terminal',
          'interface loopback0',
          'ip address 10.255.31.2 255.255.255.255',
          'exit',
          'router ospf 1',
          'router-id 10.255.31.2',
          'network 10.255.31.2 0.0.0.0 area 0',
          'end',
          'clear ip ospf process',
          'show ip ospf neighbor',
          'show ip route',
          'ping 10.255.31.1',
        ],
      },
    ],
  },
};
