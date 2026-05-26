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
