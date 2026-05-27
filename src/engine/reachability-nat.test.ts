/**
 * canReach NAT integration — full LabSession topology covering Lab 11's
 * teaching scenario: PC-A behind R1 trying to reach an ISP router on a
 * documentation-public subnet, with the ISP deliberately missing a return
 * route to the LAN. Without NAT, the return walk fails. With NAT, R1
 * translates PC-A's source to its WAN IP so the reply naturally lands
 * inside the WAN's connected subnet.
 *
 * Tests pair the canReach outcome with the underlying mechanism — ACL
 * permits / interface roles / statement bindings — so a regression in any
 * one piece pins the failure to its source.
 */
import { describe, it, expect } from 'vitest';
import { canReach } from './reachability';
import { applyToActive, initLabSession, type LabSession } from './lab-session';
import type { Lab, Link } from './types';

// ---------- Fixture: PC-A — R1 — ISP, with WAN pre-cabled ----------

function natLab(): Lab {
  return {
    id: 'fixture-nat',
    title: 'nat-fixture',
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
        { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] },
        { id: 'ISP', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0'] },
      ],
      links: [
        { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
        { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'ISP', iface: 'Gi0/0' } },
      ] satisfies Link[],
    },
    setup: {
      R1: [
        'enable',
        'configure terminal',
        'interface Gi0/0',
        'ip address 192.168.1.1 255.255.255.0',
        'no shutdown',
        'exit',
        'interface Gi0/1',
        'ip address 203.0.113.1 255.255.255.252',
        'no shutdown',
      ],
      ISP: [
        'enable',
        'configure terminal',
        'interface Gi0/0',
        'ip address 203.0.113.2 255.255.255.252',
        'no shutdown',
      ],
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

/** Apply the full NAT configuration that turns PC-A→ISP into a passing ping. */
function applyFullNat(ls: LabSession): LabSession {
  return runOn(ls, 'R1', [
    'enable',
    'configure terminal',
    'access-list 1 permit 192.168.1.0 0.0.0.255',
    'interface Gi0/0',
    'ip nat inside',
    'exit',
    'interface Gi0/1',
    'ip nat outside',
    'exit',
    'ip nat inside source list 1 interface Gi0/1 overload',
  ]);
}

// ---------- Tests ----------

describe('canReach + NAT — baseline (no NAT) fails on return', () => {
  it('PC-A → ISP fails with return-direction no-route on ISP', () => {
    const ls = initLabSession(natLab());
    const result = canReach(ls, 'PC-A', '203.0.113.2');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedAt.direction).toBe('return');
    expect(result.failedAt.reason).toBe('no-route');
    expect(result.failedAt.deviceId).toBe('ISP');
  });
});

describe('canReach + NAT — full PAT config succeeds', () => {
  it('PC-A → ISP succeeds after access-list + inside + outside + overload', () => {
    const ls = applyFullNat(initLabSession(natLab()));
    expect(canReach(ls, 'PC-A', '203.0.113.2')).toEqual({ ok: true });
  });

  it('translation lands in R1.natTranslations after refresh', () => {
    const ls = applyFullNat(initLabSession(natLab()));
    const r1 = ls.devices.R1;
    if (r1?.kind !== 'router') throw new Error('R1 missing');
    const translation = r1.device.natTranslations.get('192.168.1.10');
    expect(translation).toEqual({
      insideLocal: '192.168.1.10',
      insideGlobal: '203.0.113.1',
    });
  });
});

describe('canReach + NAT — partial / missing config still fails', () => {
  it('ACL alone does not translate (no statement, no inside/outside roles)', () => {
    let ls = initLabSession(natLab());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
    ]);
    const result = canReach(ls, 'PC-A', '203.0.113.2');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedAt.direction).toBe('return');
  });

  it('inside marking missing → NAT does not fire, return walk fails', () => {
    let ls = initLabSession(natLab());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      // Gi0/0 NOT marked inside.
      'interface Gi0/1',
      'ip nat outside',
      'exit',
      'ip nat inside source list 1 interface Gi0/1 overload',
    ]);
    expect(canReach(ls, 'PC-A', '203.0.113.2').ok).toBe(false);
  });

  it('outside marking missing → NAT does not fire, return walk fails', () => {
    let ls = initLabSession(natLab());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'interface Gi0/0',
      'ip nat inside',
      'exit',
      // Gi0/1 NOT marked outside.
      'ip nat inside source list 1 interface Gi0/1 overload',
    ]);
    expect(canReach(ls, 'PC-A', '203.0.113.2').ok).toBe(false);
  });

  it('overload statement missing → NAT does not fire, return walk fails', () => {
    let ls = initLabSession(natLab());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'interface Gi0/0',
      'ip nat inside',
      'exit',
      'interface Gi0/1',
      'ip nat outside',
      // No `ip nat inside source list ... overload`.
    ]);
    expect(canReach(ls, 'PC-A', '203.0.113.2').ok).toBe(false);
  });

  it('ACL does not permit the source → NAT does not fire', () => {
    let ls = initLabSession(natLab());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      // ACL covers a DIFFERENT subnet — PC-A's 192.168.1.10 is denied.
      'access-list 1 permit 10.0.0.0 0.0.0.255',
      'interface Gi0/0',
      'ip nat inside',
      'exit',
      'interface Gi0/1',
      'ip nat outside',
      'exit',
      'ip nat inside source list 1 interface Gi0/1 overload',
    ]);
    expect(canReach(ls, 'PC-A', '203.0.113.2').ok).toBe(false);
  });

  it('referenced ACL does not exist → NAT does not fire (permissive fallback)', () => {
    let ls = initLabSession(natLab());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      // No access-list 1 ever defined.
      'interface Gi0/0',
      'ip nat inside',
      'exit',
      'interface Gi0/1',
      'ip nat outside',
      'exit',
      'ip nat inside source list 1 interface Gi0/1 overload',
    ]);
    expect(canReach(ls, 'PC-A', '203.0.113.2').ok).toBe(false);
  });
});

describe('canReach + NAT — translation table reacts to mutations', () => {
  it('removing the overload statement clears the translation entry', () => {
    let ls = applyFullNat(initLabSession(natLab()));
    const r1Before = ls.devices.R1;
    if (r1Before?.kind !== 'router') throw new Error('R1 missing');
    expect(r1Before.device.natTranslations.size).toBe(1);

    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'no ip nat inside source list 1 interface Gi0/1 overload',
    ]);
    const r1After = ls.devices.R1;
    if (r1After?.kind !== 'router') throw new Error('R1 missing');
    expect(r1After.device.natTranslations.size).toBe(0);
  });

  it('clearing the inside marking on Gi0/0 clears the translation entry', () => {
    let ls = applyFullNat(initLabSession(natLab()));
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'no ip nat inside',
    ]);
    const r1 = ls.devices.R1;
    if (r1?.kind !== 'router') throw new Error('R1 missing');
    expect(r1.device.natTranslations.size).toBe(0);
  });
});
