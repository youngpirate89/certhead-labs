import type { Lab } from '@/engine/types';

/**
 * Lab 5 — OSPF single-area, two-router branch-to-HQ setup.
 *
 * Topology: PC-A — R1 — R2 — PC-B. Both routers' interfaces are seeded
 * (LAN + /30 WAN, all admin-up). No routing is configured at start, so
 * PC-A cannot reach PC-B until OSPF area 0 is brought up on both routers
 * and they exchange the LAN prefixes.
 *
 * Three objectives, in order of completion:
 *   1. `ospf-config`     — both routers have an OSPF process and each has
 *      at least two network statements in area 0 (covering the WAN link +
 *      its local LAN). The check is structural, not output-based — running
 *      the right config satisfies it without needing a verify command.
 *   2. `ospf-neighbor`   — the learner has run `show ip ospf neighbor` on
 *      R1 or R2 AND R1 sees R2 in FULL. Mirrors the lastPing pattern: the
 *      verification command is a deliberate action, not auto-credited.
 *   3. `reachability`    — PC-A's lastPing to 192.168.2.10 succeeded. Same
 *      contract as the troubleshooting labs (LAB_AUTHORING.md §6).
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once the /embed
 * route lands, and via `?pilot=ccna-lab05-ospf-single-area` for dev runs.
 */
export const lab05OspfSingleArea: Lab = {
  id: 'ccna-lab05-ospf-single-area',
  title: 'OSPF Single-Area: Branch to HQ',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    "You're connecting a branch office to HQ. R1 serves the HQ LAN (192.168.1.0/24) and R2 serves the branch LAN (192.168.2.0/24). Interfaces are already configured and up. Your task: configure OSPF area 0 on both routers so routes are exchanged dynamically, verify the neighbor relationship formed, then confirm PC-A can reach PC-B.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
      },
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/2'] },
      { id: 'R2', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/2'] },
      {
        id: 'PC-B',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.2.10', mask: '255.255.255.0', gateway: '192.168.2.1' },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/2' }, b: { deviceId: 'R2', iface: 'Gi0/2' } },
      { a: { deviceId: 'R2', iface: 'Gi0/0' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
    ],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface gi0/2',
      'ip address 10.0.0.1 255.255.255.252',
      'no shutdown',
      'exit',
    ],
    R2: [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'ip address 10.0.0.2 255.255.255.252',
      'no shutdown',
      'exit',
      'interface gi0/0',
      'ip address 192.168.2.1 255.255.255.0',
      'no shutdown',
      'exit',
    ],
  },
  objectives: [
    {
      id: 'ospf-config',
      text: 'R1 & R2: run router ospf 1 and advertise both connected networks in area 0',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        const r2 = session.devices.R2;
        if (r1?.kind !== 'router' || r2?.kind !== 'router') return false;
        if (r1.device.ospf.process === null) return false;
        if (r2.device.ospf.process === null) return false;
        // Each router must actually advertise BOTH of its connected networks
        // into area 0 — every addressed interface's subnet has to be covered by
        // an area-0 network statement. A bare count of statements is not enough:
        // two bogus `network 8.8.8.8 0.0.0.0 area 0` lines would satisfy a count
        // while forming no adjacency and exchanging no routes.
        return (
          advertisesConnectedNetworks(r1.device) &&
          advertisesConnectedNetworks(r2.device)
        );
      },
    },
    {
      id: 'ospf-neighbor',
      text: 'R1 or R2: run show ip ospf neighbor and confirm the adjacency is FULL',
      check: (_state, history, session) => {
        // Same pedagogy as lastPing: the learner must run the verification
        // command. Either router's history satisfies — the lab is symmetric.
        const ranOnR1 = history.R1?.resolved.some((cmd) =>
          /^(do\s+)?show ip ospf neighbor$/.test(cmd),
        );
        const ranOnR2 = history.R2?.resolved.some((cmd) =>
          /^(do\s+)?show ip ospf neighbor$/.test(cmd),
        );
        if (!ranOnR1 && !ranOnR2) return false;
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        for (const n of r1.device.ospf.neighbors.values()) {
          if (n.state === 'FULL') return true;
        }
        return false;
      },
    },
    {
      id: 'reachability',
      text: 'PC-A: ping 192.168.2.10 succeeds',
      check: (_state, _history, session) => {
        const pca = session.devices['PC-A'];
        if (pca?.kind !== 'pc') return false;
        return pca.lastPing?.target === '192.168.2.10' && pca.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Enter OSPF config with: router ospf 1',
    },
    {
      afterSeconds: 180,
      text: 'The network command uses a wildcard mask (inverse of subnet mask). For /24: network 192.168.1.0 0.0.0.255 area 0',
    },
    {
      afterSeconds: 300,
      text: 'Run show ip ospf neighbor on R1. If the output shows FULL, OSPF is working. If empty, check that R2 has matching network statements in area 0.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Enable OSPF on R1 and advertise both networks into area 0:',
        commands: [
          'enable',
          'configure terminal',
          'router ospf 1',
          'network 192.168.1.0 0.0.0.255 area 0',
          'network 10.0.0.0 0.0.0.3 area 0',
          'end',
        ],
      },
      {
        device: 'R2',
        note: 'Mirror the configuration on R2:',
        commands: [
          'enable',
          'configure terminal',
          'router ospf 1',
          'network 192.168.2.0 0.0.0.255 area 0',
          'network 10.0.0.0 0.0.0.3 area 0',
          'end',
          'show ip ospf neighbor',
        ],
      },
      {
        device: 'PC-A',
        note: 'Confirm end-to-end reachability:',
        commands: ['ping 192.168.2.10'],
      },
    ],
  },
};

/** True iff every addressed interface on `device` has its subnet covered by at
 *  least one area-0 OSPF network statement. This mirrors real `network`
 *  semantics: a statement enables OSPF on an interface when its (address,
 *  wildcard) covers the interface IP — so ANY wildcard that correctly covers
 *  the connected subnet counts (the exact `0.0.0.255` form OR a broader
 *  covering wildcard like `0.0.0.0 255.255.255.255`). Kept local to the lab so
 *  the objective check pulls in no engine code. */
function advertisesConnectedNetworks(device: {
  interfaces: Record<string, { ip: string | null; mask: string | null }>;
  ospf: { networks: readonly { prefix: string; wildcard: string; area: number }[] };
}): boolean {
  const area0 = device.ospf.networks.filter((n) => n.area === 0);
  const addressed = Object.values(device.interfaces).filter(
    (i): i is { ip: string; mask: string } => !!i.ip && !!i.mask,
  );
  if (addressed.length === 0) return false;
  return addressed.every((i) =>
    area0.some((n) => wildcardCovers(n.prefix, n.wildcard, i.ip)),
  );
}

/** Wildcard-bitmask cover test: bits set to 1 in `wildcard` are "don't care";
 *  0 bits must match between `prefix` and `ip`. Mirrors the engine's OSPF
 *  network matcher; kept local so this check pulls in no engine code. */
function wildcardCovers(prefix: string, wildcard: string, ip: string): boolean {
  const toInt = (s: string): number =>
    s.split('.').reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0);
  return ((toInt(prefix) ^ toInt(ip)) & (~toInt(wildcard) >>> 0)) === 0;
}
