/**
 * VLAN-aware L2 reachability — switch-mediated PC↔PC tests.
 *
 * These cover the Session-1 switch wiring in canReach: a switch sitting
 * between two PCs gates delivery by VLAN membership. Same VLAN → ok; different
 * VLAN → fails with `vlan-mismatch` and the verbatim sentence the work order
 * requires (the same sentence the ping `[sim]` line renders).
 */
import { describe, it, expect } from 'vitest';
import { canReach } from './reachability';
import {
  applyToActive,
  initLabSession,
  type LabSession,
} from './lab-session';
import type { Lab, Link } from './types';

/** PC-A — SW1 — PC-B, two cables. Both PCs on 192.168.1.0/24. */
function vlanLab(): Lab {
  return {
    id: 'fixture-vlan',
    title: 'vlan-fixture',
    exam: 'TEST',
    difficulty: 1,
    estimatedMinutes: 1,
    isFree: false,
    scenario: 'fixture',
    topology: {
      devices: [
        {
          id: 'PC-A',
          kind: 'pc',
          platform: 'Workstation',
          interfaces: ['Eth0'],
          pc: { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
        },
        { id: 'SW1', kind: 'switch', platform: 'C2960', interfaces: ['Fa0/1', 'Fa0/2'] },
        {
          id: 'PC-B',
          kind: 'pc',
          platform: 'Workstation',
          interfaces: ['Eth0'],
          pc: { ip: '192.168.1.20', mask: '255.255.255.0', gateway: '192.168.1.1' },
        },
      ],
      links: [
        { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'SW1', iface: 'Fa0/1' } },
        { a: { deviceId: 'SW1', iface: 'Fa0/2' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
      ] satisfies Link[],
    },
    objectives: [],
    hints: [],
  };
}

function runOn(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  let cur = ls;
  if (cur.activeDeviceId !== deviceId) cur = { ...cur, activeDeviceId: deviceId };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

describe('canReach — VLAN-aware L2 forwarding via a switch', () => {
  it('same VLAN (default 1) → reachable PC↔PC across the switch', () => {
    const ls = initLabSession(vlanLab());
    const fwd = canReach(ls, 'PC-A', '192.168.1.20');
    expect(fwd.ok).toBe(true);
  });

  it('different VLANs → vlan-mismatch with both VLAN ids in context', () => {
    let ls = initLabSession(vlanLab());
    // SW1: create VLAN 10 + 20, assign Fa0/1 → 10, Fa0/2 → 20.
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'vlan 20',
      'name Engineering',
      'exit',
      'interface fa0/1',
      'switchport mode access',
      'switchport access vlan 10',
      'exit',
      'interface fa0/2',
      'switchport mode access',
      'switchport access vlan 20',
      'end',
    ]);
    const result = canReach(ls, 'PC-A', '192.168.1.20');
    if (result.ok) throw new Error('expected vlan-mismatch failure');
    expect(result.failedAt.reason).toBe('vlan-mismatch');
    expect(result.failedAt.vlan).toEqual({
      aId: 'PC-A',
      aVlan: 10,
      bId: 'PC-B',
      bVlan: 20,
    });
  });

  it('one PC reassigned to a non-default VLAN, the other on VLAN 1 → vlan-mismatch', () => {
    let ls = initLabSession(vlanLab());
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/1',
      'switchport access vlan 10',
      'end',
    ]);
    const result = canReach(ls, 'PC-A', '192.168.1.20');
    if (result.ok) throw new Error('expected vlan-mismatch failure');
    expect(result.failedAt.reason).toBe('vlan-mismatch');
    expect(result.failedAt.vlan).toMatchObject({ aVlan: 10, bVlan: 1 });
  });

  it('returns to reachable once both ports land in the same VLAN', () => {
    let ls = initLabSession(vlanLab());
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/1',
      'switchport access vlan 10',
      'exit',
      'interface fa0/2',
      'switchport access vlan 10',
      'end',
    ]);
    const result = canReach(ls, 'PC-A', '192.168.1.20');
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Session 2 — trunk links between switches
// ---------------------------------------------------------------------------

/** PC-A — SW1 ── (trunk) ── SW2 — PC-B. Same /24 subnet, both ends seeded to
 *  VLAN 10 on the access ports; the inter-switch link is the variable. */
function twoSwitchLab(): Lab {
  return {
    id: 'fixture-trunk',
    title: 'trunk-fixture',
    exam: 'TEST',
    difficulty: 1,
    estimatedMinutes: 1,
    isFree: false,
    scenario: 'fixture',
    topology: {
      devices: [
        {
          id: 'PC-A',
          kind: 'pc',
          platform: 'Workstation',
          interfaces: ['Eth0'],
          pc: { ip: '192.168.10.10', mask: '255.255.255.0', gateway: '192.168.10.1' },
        },
        {
          id: 'SW1',
          kind: 'switch',
          platform: 'C2960',
          interfaces: ['Fa0/1', 'Fa0/24'],
        },
        {
          id: 'SW2',
          kind: 'switch',
          platform: 'C2960',
          interfaces: ['Fa0/1', 'Fa0/24'],
        },
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
      ] satisfies Link[],
    },
    setup: {
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
    objectives: [],
    hints: [],
  };
}

describe('canReach — trunk links between switches', () => {
  it('same VLAN both sides but no trunk → trunk-not-configured with both ends named', () => {
    const ls = initLabSession(twoSwitchLab());
    const r = canReach(ls, 'PC-A', '192.168.10.20');
    if (r.ok) throw new Error('expected trunk-not-configured');
    expect(r.failedAt.reason).toBe('trunk-not-configured');
    expect(r.failedAt.trunk).toEqual({
      aDevice: 'SW1',
      aIface: 'Fa0/24',
      bDevice: 'SW2',
      bIface: 'Fa0/24',
    });
  });

  it('both ends trunk + VLAN 10 allowed → reachable', () => {
    let ls = initLabSession(twoSwitchLab());
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    ls = runOn(ls, 'SW2', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    const r = canReach(ls, 'PC-A', '192.168.10.20');
    expect(r.ok).toBe(true);
  });

  it('trunk configured but VLAN 10 removed from allowed list → vlan-not-allowed', () => {
    let ls = initLabSession(twoSwitchLab());
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'switchport trunk allowed vlan 20', // VLAN 10 absent
      'end',
    ]);
    ls = runOn(ls, 'SW2', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    const r = canReach(ls, 'PC-A', '192.168.10.20');
    if (r.ok) throw new Error('expected vlan-not-allowed');
    expect(r.failedAt.reason).toBe('vlan-not-allowed');
    expect(r.failedAt.vlanAllow).toEqual({ vlanId: 10 });
    expect(r.failedAt.deviceId).toBe('SW1');
    expect(r.failedAt.iface).toBe('Fa0/24');
  });

  it('different VLANs across the trunk → vlan-mismatch (NOT trunk-not-configured)', () => {
    let ls = initLabSession(twoSwitchLab());
    // SW2's PC-facing port lands in VLAN 20 instead of 10.
    ls = runOn(ls, 'SW2', [
      'enable',
      'configure terminal',
      'vlan 20',
      'name Engineering',
      'exit',
      'interface fa0/1',
      'switchport access vlan 20',
      'exit',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    ls = runOn(ls, 'SW1', [
      'enable',
      'configure terminal',
      'interface fa0/24',
      'switchport mode trunk',
      'end',
    ]);
    const r = canReach(ls, 'PC-A', '192.168.10.20');
    if (r.ok) throw new Error('expected vlan-mismatch');
    expect(r.failedAt.reason).toBe('vlan-mismatch');
    expect(r.failedAt.vlan).toMatchObject({ aVlan: 10, bVlan: 20 });
  });
});
