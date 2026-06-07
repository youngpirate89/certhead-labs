import type { Lab } from '@/engine/types';

/**
 * Lab 12 — Named Extended ACL: Block ICMP to a Server.
 *
 * Topology: PC-A — R1 — Server. R1's LAN interfaces are seeded admin-up with
 * their addresses, so PC-A can ping the Server at lab start. The learner's
 * task is to write a named extended ACL (`BLOCK-ICMP`) that denies ICMP from
 * the 192.168.1.0/24 LAN subnet to the Server (192.168.2.10), permits all
 * other IP traffic, and applies it INBOUND on R1 Gi0/0 — the interface
 * closest to the source, matching the IOS "extended ACLs close to the
 * source" best practice.
 *
 * Engine delta this lab exercises (see CLAUDE.md / work order):
 *   - `ip access-list extended <name>` (enters config-ext-nacl)
 *   - `permit/deny <proto> <src-form> <dst-form>` lines with auto-sequence
 *   - `ip access-group <name> in|out` accepts a named ACL identifier
 *   - canReach threads `protocol: 'icmp'` from PC/router ping handlers so
 *     extended `deny icmp` entries fire only on ICMP traffic
 *   - `show access-lists` renders the new Extended header + sequence numbers
 *
 * Six objectives:
 *   1. `acl-deny`     — BLOCK-ICMP contains a deny icmp 192.168.1.0/24 → host .10
 *   2. `acl-permit`   — BLOCK-ICMP contains a permit ip any any
 *   3. `acl-order`    — deny appears BEFORE permit (first-match-wins)
 *   4. `apply`        — ACL bound inbound on R1 Gi0/0 (closest to source)
 *   5. `blocked`      — PC-A's lastPing to 192.168.2.10 FAILED (must actually run)
 *   6. `verify`       — R1 ran `show access-lists` (lastShowAccessLists stamped)
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once /embed lands.
 */
export const lab12ExtendedAcl: Lab = {
  id: 'ccna-lab12-extended-acl',
  title: 'Named Extended ACL: Block ICMP to Server',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    "The security team wants ICMP traffic from the office LAN (192.168.1.0/24) to be blocked at the application server (192.168.2.10) - but all other traffic (HTTP, SSH, DNS, etc.) must continue to flow normally. Create a named extended ACL called BLOCK-ICMP on R1 that denies icmp from the LAN to the server's host address and permits all other IP traffic. Apply it inbound on R1's Gi0/0 - the LAN-facing interface - because Cisco best practice is to filter extended ACL traffic as close to the source as possible. Verify the block by pinging from PC-A.",
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
        id: 'Server',
        kind: 'pc',
        platform: 'Server',
        deviceClass: 'server',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.2.10', mask: '255.255.255.0', gateway: '192.168.2.1' },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'Server', iface: 'Eth0' } },
    ],
  },
  setup: {
    // R1's LAN + DMZ interfaces are pre-configured — the lesson is ACL
    // authoring, not interface bring-up (Lab 01 covers that).
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
      id: 'acl-deny',
      text: 'R1: in ACL BLOCK-ICMP, deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const acl = r1.device.acls.get('BLOCK-ICMP');
        if (!acl || acl.type !== 'extended') return false;
        return acl.entries.some(
          (e) =>
            e.action === 'deny' &&
            e.protocol === 'icmp' &&
            e.srcIp === '192.168.1.0' &&
            e.srcWildcard === '0.0.0.255' &&
            e.dstIp === '192.168.2.10' &&
            e.dstWildcard === '0.0.0.0',
        );
      },
    },
    {
      id: 'acl-permit',
      text: 'R1: in ACL BLOCK-ICMP, permit ip any any',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const acl = r1.device.acls.get('BLOCK-ICMP');
        if (!acl || acl.type !== 'extended') return false;
        return acl.entries.some(
          (e) =>
            e.action === 'permit' &&
            e.protocol === 'ip' &&
            e.srcIp === '0.0.0.0' &&
            e.srcWildcard === '255.255.255.255' &&
            e.dstIp === '0.0.0.0' &&
            e.dstWildcard === '255.255.255.255',
        );
      },
    },
    {
      id: 'acl-order',
      text: 'R1: deny entry appears before permit entry in BLOCK-ICMP (order matters)',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const acl = r1.device.acls.get('BLOCK-ICMP');
        if (!acl || acl.type !== 'extended') return false;
        // Use array index (not sequence number) so a learner who used `no <seq>`
        // and re-added still gets the correct evaluation-order check.
        const denyIdx = acl.entries.findIndex(
          (e) => e.action === 'deny' && e.protocol === 'icmp',
        );
        const permitIdx = acl.entries.findIndex(
          (e) => e.action === 'permit' && e.protocol === 'ip',
        );
        return denyIdx !== -1 && permitIdx !== -1 && denyIdx < permitIdx;
      },
    },
    {
      id: 'apply',
      text: 'R1 Gi0/0 (LAN-facing): apply ip access-group BLOCK-ICMP in',
      check: (state) =>
        state.R1?.interfaces['Gi0/0']?.accessGroups.in === 'BLOCK-ICMP',
    },
    {
      id: 'blocked',
      text: 'PC-A: ping 192.168.2.10 fails (ICMP blocked by ACL)',
      check: (_state, _history, session) => {
        // lastPing pattern: the block must be demonstrated by an actual
        // learner-initiated ping (not state-permits-block alone). Mirrors
        // Lab 06's acl-verified objective.
        const pca = session.devices['PC-A'];
        if (pca?.kind !== 'pc') return false;
        return pca.lastPing?.target === '192.168.2.10' && pca.lastPing.ok === false;
      },
    },
    {
      id: 'verify',
      text: 'R1: run show access-lists to confirm BLOCK-ICMP',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        return r1.lastShowAccessLists > 0;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text:
        "Create the named ACL with `ip access-list extended BLOCK-ICMP` (in global config). The prompt will change to `R1(config-ext-nacl)#` - you're now adding entries to BLOCK-ICMP.",
    },
    {
      afterSeconds: 180,
      text:
        'Inside the ACL: `deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10`, then `permit ip any any`. Order matters - the deny must come first or the permit would catch everything before the deny is reached.',
    },
    {
      afterSeconds: 300,
      text:
        'Apply close to the source: `interface GigabitEthernet0/0` then `ip access-group BLOCK-ICMP in`. Verify with `show access-lists`, then run `ping 192.168.2.10` from PC-A to confirm the block.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Enter privileged and global config mode:',
        commands: ['enable', 'configure terminal'],
      },
      {
        device: 'R1',
        note: 'Create the named extended ACL and add entries - deny first, then permit:',
        commands: [
          'ip access-list extended BLOCK-ICMP',
          ' deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10',
          ' permit ip any any',
          'exit',
        ],
      },
      {
        device: 'R1',
        note: 'Apply inbound on the LAN-facing interface (close to source):',
        commands: [
          'interface GigabitEthernet0/0',
          ' ip access-group BLOCK-ICMP in',
          'end',
        ],
      },
      {
        device: 'R1',
        note: 'Verify the ACL is in place:',
        commands: ['show access-lists'],
      },
      {
        device: 'PC-A',
        note: 'Confirm the block - the ping must fail:',
        commands: ['ping 192.168.2.10'],
      },
    ],
  },
};
