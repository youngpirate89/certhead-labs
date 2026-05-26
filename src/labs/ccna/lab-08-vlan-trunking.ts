import type { Lab } from '@/engine/types';

/**
 * Lab 8 — VLAN trunking across two switches.
 *
 * Topology: PC-A — SW1 — (Fa0/24 trunk link) — SW2 — PC-B. Both PCs sit on the
 * same VLAN (10, Sales) and the same /24 subnet (192.168.10.0/24) — one VLAN
 * one subnet per LAB_AUTHORING §2.2. The link between the switches at lab
 * start is NOT configured as a trunk; both ends are still in default access
 * mode in VLAN 1. The learner's task: configure trunk on both ends, verify
 * VLAN 10 traverses the trunk, then prove reachability with a ping.
 *
 * Failure sentence the learner sees at lab start:
 *   "Request timed out — the link between SW1 Fa0/24 and SW2 Fa0/24 is not
 *    configured as a trunk — VLANs cannot pass between switches."
 *
 * Three objectives:
 *   1. `trunk-configured`  — both SW1 Fa0/24 and SW2 Fa0/24 in trunk mode.
 *   2. `trunk-verified`    — the learner ran `show interfaces trunk` on one of
 *      the switches AND VLAN 10 appears in both trunk ports' allowed lists.
 *      Mirrors Lab 06/07's "run the verify command" pedagogy — forces the
 *      observe step, not just configure-and-move-on.
 *   3. `reachability`      — PC-A's lastPing to 192.168.10.20 succeeded.
 *      Uses the same lastPing predicate every other reachability objective
 *      uses; no canReach short-circuit (LAB_AUTHORING §3.4).
 *
 * setup pre-creates VLAN 10 on both switches and assigns the PC-facing access
 * port (Fa0/1) to it — the failure is isolated to the inter-switch link.
 *
 * Pro-tier (`isFree: false`); reachable through getLabById once /embed lands,
 * and via `?pilot=ccna-lab08-vlan-trunking` for dev runs.
 */
export const lab08VlanTrunking: Lab = {
  id: 'ccna-lab08-vlan-trunking',
  title: 'VLAN Trunking: Span One VLAN Across Two Switches',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 10,
  isFree: false,
  scenario:
    'The Sales team (VLAN 10) spans two switches. PC-A is connected to SW1 and PC-B is connected to SW2. Both switches have VLAN 10 configured and the correct access ports assigned. However, PC-A cannot reach PC-B. Your task: identify why, configure the link between SW1 and SW2 as a trunk, verify VLAN 10 passes across it, then confirm PC-A can reach PC-B.\n\nBoth PCs are statically configured with IPs in the 192.168.10.0/24 subnet — PC-A is 192.168.10.10 and PC-B is 192.168.10.20. Because both PCs sit in the same VLAN and same subnet they only need Layer 2 switching between them; no routing required, one VLAN equals one subnet.',
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.10.10', mask: '255.255.255.0', gateway: '192.168.10.1' },
      },
      // Fa0/1 is the PC-facing access port; Fa0/24 is the inter-switch trunk
      // candidate (in default access mode at lab start — that's the break).
      { id: 'SW1', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/1', 'Fa0/24'] },
      { id: 'SW2', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/1', 'Fa0/24'] },
      {
        id: 'PC-B',
        kind: 'pc',
        platform: 'Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.10.20', mask: '255.255.255.0', gateway: '192.168.10.1' },
      },
    ],
    links: [
      { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/1' } },
      { a: { deviceId: 'SW1', iface: 'Fa0/24' }, b: { deviceId: 'SW2', iface: 'Fa0/24' } },
      { a: { deviceId: 'SW2', iface: 'Fa0/1' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
    ],
  },
  setup: {
    // Both switches start with VLAN 10 (Sales) defined and Fa0/1 assigned to
    // it. The inter-switch trunk (Fa0/24) is intentionally LEFT in default
    // access mode — that is the one thing the learner has to fix.
    SW1: [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'interface fa0/1',
      'switchport mode access',
      'switchport access vlan 10',
    ],
    SW2: [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'interface fa0/1',
      'switchport mode access',
      'switchport access vlan 10',
    ],
  },
  objectives: [
    {
      id: 'trunk-configured',
      text: 'Configure the link between SW1 and SW2 as a trunk',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        const sw2 = session.devices.SW2;
        if (sw1?.kind !== 'switch' || sw2?.kind !== 'switch') return false;
        const a = sw1.device.switchports['Fa0/24'];
        const b = sw2.device.switchports['Fa0/24'];
        if (!a || !b) return false;
        return a.mode === 'trunk' && b.mode === 'trunk';
      },
    },
    {
      id: 'trunk-verified',
      text: 'Verify VLAN 10 is active on the trunk (run `show interfaces trunk`)',
      check: (_state, _history, session) => {
        const sw1 = session.devices.SW1;
        const sw2 = session.devices.SW2;
        if (sw1?.kind !== 'switch' || sw2?.kind !== 'switch') return false;
        // Read current port state from the same path trunk-configured uses
        // (session.devices.<id>.device.switchports['Fa0/24']) so the two
        // objectives stay consistent.
        const sw1Port = sw1.device.switchports['Fa0/24'];
        const sw2Port = sw2.device.switchports['Fa0/24'];
        if (!sw1Port || !sw2Port) return false;
        // The verify command must have run on SW1 OR SW2 AT A MOMENT when
        // the local Fa0/24 was already in trunk mode. The engine stamps
        // `lastShowInterfacesTrunk` at command-eval time (mirrors lastPing);
        // a verify run pre-config records trunkPortIds=[] and naturally fails
        // this check. Plain history.some() cannot express this ordering.
        const sw1Verified = sw1.lastShowInterfacesTrunk?.trunkPortIds.includes('Fa0/24') ?? false;
        const sw2Verified = sw2.lastShowInterfacesTrunk?.trunkPortIds.includes('Fa0/24') ?? false;
        if (!sw1Verified && !sw2Verified) return false;
        // VLAN 10 must be present in BOTH trunks' allowed lists — 'all' is the
        // IOS default (every VLAN) and naturally satisfies this.
        const sw1Allows =
          sw1Port.trunkAllowedVlans === 'all' || sw1Port.trunkAllowedVlans.includes(10);
        const sw2Allows =
          sw2Port.trunkAllowedVlans === 'all' || sw2Port.trunkAllowedVlans.includes(10);
        return sw1Allows && sw2Allows;
      },
    },
    {
      id: 'reachability',
      text: 'PC-A can ping PC-B — run `ping 192.168.10.20` from PC-A and confirm a reply',
      check: (_state, _history, session) => {
        const pca = session.devices['PC-A'];
        if (pca?.kind !== 'pc') return false;
        return pca.lastPing?.target === '192.168.10.20' && pca.lastPing.ok === true;
      },
    },
  ],
  hints: [
    {
      afterSeconds: 60,
      text: 'Check which ports connect the two switches. A trunk must be configured on both ends.',
    },
    {
      afterSeconds: 180,
      text: 'From config-if on the inter-switch port: switchport mode trunk',
    },
    {
      afterSeconds: 300,
      text: 'Run show interfaces trunk on SW1 to verify VLAN 10 appears in the allowed and active VLAN list.',
    },
  ],
};
