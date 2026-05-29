import type { Lab } from '@/engine/types';

/**
 * Lab 20 - Troubleshoot OSPF: MD5 Authentication Mismatch.
 *
 * Topology: PC-A - R1 - R2 - PC-B. Distinct HQ/campus addressing (NOT the
 * 192.168.x reuse of Labs 05/13/17/18/19): 10.1.0.0/24 and 10.2.0.0/24 LANs
 * with a 10.255.255.0/30 transit link. PCs are statically addressed (no DHCP
 * in this lab). Both routers run OSPF process 1 in area 0 with correct network
 * statements, every interface is up, and the transit link carries OSPF MD5
 * (message-digest) authentication on both ends with key-id 1 - but R2's key
 * STRING is wrong (R1 uses CISCO123, R2 uses WrongKey99). OSPF requires the
 * key-id AND key string to match on both ends of the link; the engine compares
 * them in recomputeOspf and suppresses neighbor formation on a mismatch (RFC
 * 2328 App. D - authenticated hellos that fail the digest check are dropped).
 * So the R1<->R2 adjacency never forms, routes do not propagate, and PC-A
 * cannot reach PC-B.
 *
 * This is the fourth OSPF troubleshooting lab. Where Lab 13 is an area
 * mismatch, Lab 18 a misplaced passive-interface, and Lab 19 a timer mismatch,
 * this one trains the learner to inspect the interface authentication config.
 * Diagnosis flow:
 *   1. From PC-A, ping 10.2.0.10 - it fails (confirms the break).
 *   2. On R1, show ip ospf neighbor - the table is empty (no adjacency).
 *   3. show running-config interface GigabitEthernet0/2 on R1 and R2 (or
 *      show ip ospf interface GigabitEthernet0/2) - both ends run
 *      message-digest auth with key-id 1, but the key strings differ.
 *   4. Fix R2's key to match R1 (remove key 1, re-add with CISCO123). The
 *      adjacency re-forms (the per-command refresh re-runs recomputeOspf),
 *      routes propagate, and the ping succeeds.
 *
 * Two objectives (Pattern 1 + Authoring section 3.1 - prove the outcome, no
 * separate diagnose objective):
 *   1. auth-match  - R2 Gi0/2's effective OSPF auth (message-digest enabled,
 *      key-id, key string) now MATCHES R1 Gi0/2. Reads the corrected STATE on
 *      both interfaces, not "a command was typed".
 *   2. reachable   - PC-A's lastPing to 10.2.0.10 succeeded end-to-end (uses
 *      the lastPing predicate so it requires an actual re-ping after the fix,
 *      not just state-permits-reachability).
 *
 * Engine deltas (shipped in the preceding feat(engine) commit):
 *   - InterfaceState gains ospfAuthMessageDigest / ospfMd5KeyId / ospfMd5Key.
 *   - config-if grammar: [no] ip ospf authentication message-digest and
 *     [no] ip ospf message-digest-key <key-id> md5 <key>.
 *   - recomputeOspf compares auth-enabled + key-id + key on both ends and
 *     skips neighbor formation on a mismatch.
 *   - show running-config (and ...interface) emit the auth lines; show ip ospf
 *     interface prints the message-digest banner + youngest key id.
 *
 * Pro-tier (isFree: false); reachable through getLabById once /embed lands.
 */
export const lab20OspfTshootAuth: Lab = {
  id: 'ccna-lab20-ospf-tshoot-auth',
  title: 'Troubleshoot OSPF: MD5 Authentication Mismatch',
  exam: 'CCNA 200-301',
  difficulty: 3,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    "Trouble ticket: PC-A on 10.1.0.0/24 cannot reach PC-B on 10.2.0.0/24. Both routers run OSPF process 1 in area 0, the addressing is correct, and every interface is up - but the routers will not become neighbors. The transit link between them was secured with OSPF MD5 authentication.\n\nFrom PC-A, run `ping 10.2.0.10` to confirm the break. Then click into R1 and run `show ip ospf neighbor` - the table is empty. The areas match, nothing is passive, and the timers agree, so look at the authentication: `show running-config interface GigabitEthernet0/2` on R1 and on R2. Both ends enable message-digest auth with key-id 1, but the key strings do not match. OSPF will not form an adjacency unless the key-id and key string agree on both ends. Align R2's key to R1's, confirm the neighbor reaches FULL, and verify end-to-end reachability.",
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '10.1.0.10', mask: '255.255.255.0', gateway: '10.1.0.1' },
      },
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/2'] },
      { id: 'R2', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/2'] },
      {
        id: 'PC-B',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '10.2.0.10', mask: '255.255.255.0', gateway: '10.2.0.1' },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
      { a: { deviceId: 'R1', iface: 'Gi0/2' }, b: { deviceId: 'R2', iface: 'Gi0/2' } },
      { a: { deviceId: 'R2', iface: 'Gi0/0' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
    ],
  },
  setup: {
    // R1: interfaces + OSPF area 0 - fully correct. The transit link (Gi0/2)
    // runs MD5 auth, key-id 1, key string CISCO123.
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 10.1.0.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface gi0/2',
      'ip address 10.255.255.1 255.255.255.252',
      'ip ospf authentication message-digest',
      'ip ospf message-digest-key 1 md5 CISCO123',
      'no shutdown',
      'exit',
      'router ospf 1',
      'network 10.1.0.0 0.0.0.255 area 0',
      'network 10.255.255.0 0.0.0.3 area 0',
      'exit',
    ],
    // R2: correctly addressed and advertised in area 0, transit link also runs
    // MD5 auth with key-id 1 - but the key string is WrongKey99, not CISCO123.
    // The key strings disagree, so the digest check fails and adjacency never
    // forms. This is the seeded fault.
    R2: [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'ip address 10.255.255.2 255.255.255.252',
      'ip ospf authentication message-digest',
      'ip ospf message-digest-key 1 md5 WrongKey99',
      'no shutdown',
      'exit',
      'interface gi0/0',
      'ip address 10.2.0.1 255.255.255.0',
      'no shutdown',
      'exit',
      'router ospf 1',
      'network 10.255.255.0 0.0.0.3 area 0',
      'network 10.2.0.0 0.0.0.255 area 0',
      'exit',
    ],
  },
  objectives: [
    {
      id: 'auth-match',
      text: 'R2 Gi0/2: align the OSPF MD5 key to R1 (key-id 1, key CISCO123)',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        const r2 = session.devices.R2;
        if (r1?.kind !== 'router' || r2?.kind !== 'router') return false;
        const a = r1.device.interfaces['Gi0/2'];
        const b = r2.device.interfaces['Gi0/2'];
        if (!a || !b) return false;
        // Prove the outcome: R2's effective auth config matches R1's - both
        // ends have message-digest enabled with the same key-id and key
        // string. This is exactly the recomputeOspf match condition, so it
        // confirms the fix at the protocol level rather than checking that a
        // particular command was typed.
        return (
          a.ospfAuthMessageDigest === true &&
          b.ospfAuthMessageDigest === true &&
          a.ospfMd5KeyId === b.ospfMd5KeyId &&
          a.ospfMd5Key === b.ospfMd5Key
        );
      },
    },
    {
      id: 'reachable',
      text: 'PC-A: ping 10.2.0.10 succeeds',
      check: (_state, _history, session) => {
        const pca = session.devices['PC-A'];
        if (pca?.kind !== 'pc') return false;
        return pca.lastPing?.target === '10.2.0.10' && pca.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text:
        'Start on R1 with `show ip ospf neighbor` - the table is empty, so the adjacency never formed. The areas match, nothing is passive, and the timers agree, so the cause is something else on the transit link.',
    },
    {
      afterSeconds: 180,
      text:
        'Run `show running-config interface GigabitEthernet0/2` on R1, then the same on R2. Both ends enable `ip ospf authentication message-digest` with `ip ospf message-digest-key 1`, but the key strings differ. OSPF requires the key-id and key string to match on both ends.',
    },
    {
      afterSeconds: 300,
      text:
        'R2 Gi0/2 uses key WrongKey99; R1 uses CISCO123. On R2: `interface GigabitEthernet0/2`, then `no ip ospf message-digest-key 1` and `ip ospf message-digest-key 1 md5 CISCO123`. Re-check `show ip ospf neighbor`, then ping from PC-A.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'PC-A',
        note: 'Confirm the break - the ping fails because no route to 10.2.0.0/24 exists:',
        commands: ['ping 10.2.0.10'],
      },
      {
        device: 'R1',
        note: "Diagnose - neighbor table is empty; note R1's Gi0/2 key (key-id 1, CISCO123):",
        commands: [
          'enable',
          'show ip ospf neighbor',
          'show running-config interface GigabitEthernet0/2',
        ],
      },
      {
        device: 'R2',
        note: 'R2 Gi0/2 uses key WrongKey99 - the mismatch that blocks adjacency:',
        commands: ['enable', 'show running-config interface GigabitEthernet0/2'],
      },
      {
        device: 'R2',
        note: "Fix - replace R2's key with the one R1 is using:",
        commands: [
          'configure terminal',
          'interface GigabitEthernet0/2',
          'no ip ospf message-digest-key 1',
          'ip ospf message-digest-key 1 md5 CISCO123',
          'end',
        ],
      },
      {
        device: 'R1',
        note: 'Verify the adjacency comes up FULL:',
        commands: ['show ip ospf neighbor'],
      },
      {
        device: 'PC-A',
        note: 'Confirm end-to-end reachability:',
        commands: ['ping 10.2.0.10'],
      },
    ],
  },
};
