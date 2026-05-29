import type { Lab } from '@/engine/types';
import { canReach } from '@/engine/reachability';

/**
 * Lab 6 — Standard numbered ACL, one router between two PCs.
 *
 * Topology: PC-A — R1 — PC-B. Both LAN interfaces are seeded admin-up with
 * their addresses; routing is connected-only, so PC-A can reach PC-B at
 * lab start. The learner's task is to write an ACL that blocks PC-A
 * specifically while permitting the rest of the 192.168.1.0/24 subnet,
 * apply it OUTBOUND on R1 Gi0/1 (the interface facing PC-B — the IOS
 * "place a standard ACL closest to the destination" best practice), and
 * verify the block.
 *
 * Three objectives, in completion order:
 *   1. `acl-defined`  — ACL 1 contains a deny matching host 192.168.1.10
 *      AND a permit covering the 192.168.1.0/24 subnet, deny before permit
 *      so the learner doesn't accidentally permit-all first.
 *   2. `acl-applied`  — ACL 1 is bound out on R1 Gi0/1. The interface AND
 *      the direction are graded; placing it inbound on Gi0/0 would also
 *      block PC-A, but this lab is teaching the "outbound, closest to dest"
 *      placement, so we grade that explicitly.
 *   3. `acl-verified` — PC-A's lastPing to 192.168.2.10 FAILED AND the
 *      learner ran `show access-lists` on R1. Mirrors lab-05's lastPing
 *      pattern: the learner must demonstrate the block AND inspect the ACL,
 *      not just configure-and-move-on.
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once /embed
 * lands, and via `?pilot=ccna-lab06-standard-acl` for dev runs.
 */
export const lab06StandardAcl: Lab = {
  id: 'ccna-lab06-standard-acl',
  title: 'Standard ACL: Block One Host',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    "The security team has flagged that PC-A (192.168.1.10) should not have access to PC-B (192.168.2.10). All other traffic on the 192.168.1.0/24 network should remain permitted. Your task: write a standard ACL on R1 that blocks PC-A specifically, permit the rest of the subnet, apply it to the correct interface in the correct direction, then verify it works.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
      },
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] },
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
      { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
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
      'interface gi0/1',
      'ip address 192.168.2.1 255.255.255.0',
      'no shutdown',
      'exit',
    ],
  },
  objectives: [
    {
      id: 'acl-defined',
      text: 'R1: define ACL 1 - deny host 192.168.1.10, then permit 192.168.1.0 0.0.0.255',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const acl = r1.device.acls.get(1);
        if (!acl) return false;

        // Find the deny entry covering 192.168.1.10 — either `host 192.168.1.10`
        // (wildcard:null) or an equivalent 0.0.0.0 wildcard. The permit entry
        // must cover the /24 (either 192.168.1.0 0.0.0.255 or `any`). The deny
        // must appear before the permit so first-match-wins drops PC-A.
        let denyIdx = -1;
        let permitIdx = -1;
        for (let i = 0; i < acl.entries.length; i++) {
          const e = acl.entries[i];
          if (e.action === 'deny' && denyMatchesPcA(e) && denyIdx === -1) {
            denyIdx = i;
          }
          if (e.action === 'permit' && permitCoversSubnet(e) && permitIdx === -1) {
            permitIdx = i;
          }
        }
        return denyIdx !== -1 && permitIdx !== -1 && denyIdx < permitIdx;
      },
    },
    {
      id: 'acl-applied',
      text: 'R1 Gi0/1 (toward PC-B): apply ip access-group 1 out',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.device.interfaces['Gi0/1']?.accessGroups.out === 1;
      },
    },
    {
      id: 'acl-verified',
      text: 'PC-A: ping 192.168.2.10 fails, and R1: run show access-lists',
      check: (_state, history, session) => {
        // lastPing pattern: the block must be demonstrated by an actual
        // learner-initiated ping (not state-permits-block alone).
        const pca = session.devices['PC-A'];
        if (pca?.kind !== 'pc') return false;
        const pingFailed =
          pca.lastPing?.target === '192.168.2.10' && pca.lastPing.ok === false;
        if (!pingFailed) return false;
        // AND the learner must have inspected the ACL on R1. Forces a
        // discovery step rather than a config-and-go.
        const inspected = history.R1?.resolved.some((cmd) =>
          /^(do\s+)?show access-lists$/.test(cmd),
        );
        if (!inspected) return false;
        // The failure must be the ACL block specifically — not a stray
        // `shutdown` or other misconfig that merely happens to drop the ping.
        // lastPing stores only {target, ok}, so re-derive the reachability
        // failure and confirm it is ACL 1 denying on R1 Gi0/1 outbound —
        // exactly what the `[sim]` trailer reports. This proves the objective's
        // intent: the standard ACL is what blocked PC-A.
        const r = canReach(session, 'PC-A', '192.168.2.10');
        if (r.ok) return false;
        const f = r.failedAt;
        return (
          f.reason === 'acl-deny' &&
          f.deviceId === 'R1' &&
          f.iface === 'Gi0/1' &&
          f.acl?.aclNumber === 1 &&
          f.acl?.aclDirection === 'out'
        );
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Standard ACLs filter by source IP only. Start with: access-list 1 deny host 192.168.1.10',
    },
    {
      afterSeconds: 180,
      text: 'After denying PC-A, permit the rest of the subnet: access-list 1 permit 192.168.1.0 0.0.0.255',
    },
    {
      afterSeconds: 300,
      text: 'Apply the ACL closest to the destination - outbound on the interface facing PC-B: ip access-group 1 out (under interface Gi0/1)',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Define ACL 1 - deny PC-A first, then permit the rest of the subnet:',
        commands: [
          'enable',
          'configure terminal',
          'access-list 1 deny host 192.168.1.10',
          'access-list 1 permit 192.168.1.0 0.0.0.255',
        ],
      },
      {
        device: 'R1',
        note: 'Apply the ACL outbound on the interface facing PC-B:',
        commands: [
          'interface Gi0/1',
          'ip access-group 1 out',
          'end',
          'show access-lists',
        ],
      },
      {
        device: 'PC-A',
        note: 'Confirm PC-A is blocked (the ping should time out):',
        commands: ['ping 192.168.2.10'],
      },
    ],
  },
};

/** True for any entry that denies just PC-A (192.168.1.10): the `host` form
 *  or its 0.0.0.0-wildcard equivalent. Other wildcards that happen to cover
 *  192.168.1.10 (e.g. `0.0.0.255`) are intentionally NOT accepted — they'd
 *  also block other hosts, which violates the scenario. */
function denyMatchesPcA(e: {
  source: string;
  wildcard: string | null;
}): boolean {
  if (e.source !== '192.168.1.10') return false;
  return e.wildcard === null || e.wildcard === '0.0.0.0';
}

/** True for a permit entry that covers the rest of the 192.168.1.0/24 subnet.
 *  Accept either the literal subnet/wildcard form or `any`. */
function permitCoversSubnet(e: {
  source: string;
  wildcard: string | null;
}): boolean {
  if (e.source === '192.168.1.0' && e.wildcard === '0.0.0.255') return true;
  if (e.source === '0.0.0.0' && e.wildcard === '255.255.255.255') return true;
  return false;
}
