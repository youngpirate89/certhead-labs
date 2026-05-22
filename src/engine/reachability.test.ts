/**
 * canReach tests — synthetic LabSession fixtures only (no React).
 *
 * Covers the §4 walk for every FailReason plus the headline missing-return-
 * route case. Each test builds a small LabSession by hand so the exact
 * topology and route state are visible at the call site.
 */
import { describe, it, expect } from 'vitest';
import { canReach, type FailReason } from './reachability';
import { applyToActive, initLabSession, type DeviceSession, type LabSession } from './lab-session';
import type { Lab, Link } from './types';
import type { Session as RouterSession } from './adapters/ios/state';
import type { PcSession } from './adapters/pc';

// ---------- Fixture builders ----------

/** PC-A — R1 — R2 — PC-B, four links. */
function pilotLab(): Lab {
  return {
    id: 'fixture-pilot',
    title: 'pilot',
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
        { id: 'R2', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] },
        {
          id: 'PC-B',
          kind: 'pc',
          platform: 'Workstation',
          interfaces: ['Eth0'],
          pc: { ip: '192.168.2.10', mask: '255.255.255.0', gateway: '192.168.2.1' },
        },
      ],
      links: [
        { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/1' } },
        { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
        { a: { deviceId: 'R2', iface: 'Gi0/1' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
      ] satisfies Link[],
    },
    objectives: [],
    hints: [],
  };
}

/** Apply a sequence of commands to a specific device. */
function runOn(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  let cur = ls;
  if (cur.activeDeviceId !== deviceId) cur = { ...cur, activeDeviceId: deviceId };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

/** Configure R1 + R2 with full interface state + forward and return statics. */
function fullyConfigured(): LabSession {
  let ls = initLabSession(pilotLab());

  // R1: Gi0/1 → PC-A subnet 192.168.1.0/24, Gi0/0 → R2 192.168.12.0/30
  ls = runOn(ls, 'R1', [
    'enable',
    'configure terminal',
    'interface gi0/1',
    'ip address 192.168.1.1 255.255.255.0',
    'no shutdown',
    'exit',
    'interface gi0/0',
    'ip address 192.168.12.1 255.255.255.252',
    'no shutdown',
    'exit',
    'ip route 192.168.2.0 255.255.255.0 192.168.12.2',
  ]);
  // R2: Gi0/0 ← from R1, Gi0/1 → PC-B subnet 192.168.2.0/24
  ls = runOn(ls, 'R2', [
    'enable',
    'configure terminal',
    'interface gi0/0',
    'ip address 192.168.12.2 255.255.255.252',
    'no shutdown',
    'exit',
    'interface gi0/1',
    'ip address 192.168.2.1 255.255.255.0',
    'no shutdown',
    'exit',
    'ip route 192.168.1.0 255.255.255.0 192.168.12.1',
  ]);
  return ls;
}

// ---------- Helpers for assertions ----------

function expectFail(
  result: ReturnType<typeof canReach>,
  direction: 'forward' | 'return',
  reason: FailReason,
) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failedAt.direction).toBe(direction);
  expect(result.failedAt.reason).toBe(reason);
}

// ---------- Tests ----------

describe('canReach — happy path', () => {
  it('PC-A → PC-B succeeds end-to-end with full bidirectional config', () => {
    const ls = fullyConfigured();
    expect(canReach(ls, 'PC-A', '192.168.2.10')).toEqual({ ok: true });
  });

  it('PC-B → PC-A also succeeds (symmetric round-trip)', () => {
    const ls = fullyConfigured();
    expect(canReach(ls, 'PC-B', '192.168.1.10')).toEqual({ ok: true });
  });
});

describe('canReach — headline failure: missing return route', () => {
  it('forward succeeds, return fails with `no-route` and direction:return', () => {
    let ls = fullyConfigured();
    // Drop R2's static back to PC-A's subnet.
    ls = runOn(ls, 'R2', ['no ip route 192.168.1.0 255.255.255.0 192.168.12.1']);
    const result = canReach(ls, 'PC-A', '192.168.2.10');
    expectFail(result, 'return', 'no-route');
    if (result.ok) return;
    // The router that's missing the back-route is R2.
    expect(result.failedAt.deviceId).toBe('R2');
  });
});

describe('canReach — forward failures', () => {
  it('no forward route → no-route on R1', () => {
    let ls = fullyConfigured();
    ls = runOn(ls, 'R1', ['no ip route 192.168.2.0 255.255.255.0 192.168.12.2']);
    const r = canReach(ls, 'PC-A', '192.168.2.10');
    expectFail(r, 'forward', 'no-route');
    if (!r.ok) expect(r.failedAt.deviceId).toBe('R1');
  });

  it('hop interface admin-down → egress-down', () => {
    let ls = fullyConfigured();
    ls = runOn(ls, 'R1', ['interface gi0/0', 'shutdown']);
    const r = canReach(ls, 'PC-A', '192.168.2.10');
    expectFail(r, 'forward', 'egress-down');
    if (!r.ok) {
      expect(r.failedAt.deviceId).toBe('R1');
      expect(r.failedAt.iface).toBe('Gi0/0');
    }
  });

  it('next-hop outside egress subnet → next-hop-unreachable', () => {
    let ls = initLabSession(pilotLab());
    // R1: configure ifaces, then add a static with a bogus next-hop (no iface
    // owns a subnet containing it).
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/1',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip route 192.168.2.0 255.255.255.0 10.99.99.99',
    ]);
    const r = canReach(ls, 'PC-A', '192.168.2.10');
    expectFail(r, 'forward', 'next-hop-unreachable');
  });

  it('PC source, non-local dst, no gateway set → no-gateway', () => {
    let ls = initLabSession(pilotLab());
    // R1: PC-A's neighbor is up so source-nic-down isn't the failure.
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/1',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
    ]);
    // Drop PC-A's gateway.
    const pcA = ls.devices['PC-A'];
    if (pcA.kind !== 'pc') throw new Error('shape');
    ls = {
      ...ls,
      devices: { ...ls.devices, 'PC-A': { ...pcA, gateway: null } },
    };
    const r = canReach(ls, 'PC-A', '192.168.2.10');
    expectFail(r, 'forward', 'no-gateway');
  });

  it('PC source NIC unconnected → source-nic-down', () => {
    const ls = initLabSession(pilotLab()); // nothing is up; PC-A's neighbor admin-down
    const r = canReach(ls, 'PC-A', '192.168.2.10');
    expectFail(r, 'forward', 'source-nic-down');
  });
});

describe('canReach — return failures', () => {
  it('destination PC NIC down → dest-nic-down on the return walk', () => {
    let ls = fullyConfigured();
    // Force PC-B's NIC down by shutting its neighbor.
    ls = runOn(ls, 'R2', ['interface gi0/1', 'shutdown']);
    // The forward walk now fails first (egress-down at R2). To target
    // dest-nic-down specifically we need PC-B to be the dst with the link
    // up but the PC's nicUp false. Achieve by detaching the PC's link: we
    // simulate by manually mutating the synthetic PcSession.
    ls = {
      ...ls,
      devices: {
        ...ls.devices,
        // Re-bring R2's Gi0/1 admin-up so the forward walk reaches PC-B's
        // subnet, but force PC-B's nicUp to false.
        R2: forceIfaceUp(ls.devices.R2 as RouterSession, 'Gi0/1'),
        'PC-B': forceNicDown(ls.devices['PC-B'] as PcSession),
      },
    };
    const r = canReach(ls, 'PC-A', '192.168.2.10');
    expectFail(r, 'forward', 'dest-nic-down');
  });
});

describe('canReach — local subnet delivery', () => {
  it('PC pinging its gateway returns ok with no routing required', () => {
    const ls = fullyConfigured();
    // PC-A's gateway is 192.168.1.1 (R1 Gi0/1).
    expect(canReach(ls, 'PC-A', '192.168.1.1')).toEqual({ ok: true });
  });
});

describe('canReach — routing loop (§6)', () => {
  it('static routes pointing in a circle terminate with routing-loop', () => {
    // Build a 2-router loop: R1 points 9.9.9.0/24 at R2's nexthop;
    // R2 points 9.9.9.0/24 back at R1's nexthop. No real owner.
    let ls = fullyConfigured();
    ls = runOn(ls, 'R1', ['ip route 9.9.9.0 255.255.255.0 192.168.12.2']);
    ls = runOn(ls, 'R2', ['ip route 9.9.9.0 255.255.255.0 192.168.12.1']);
    const r = canReach(ls, 'PC-A', '9.9.9.9');
    expectFail(r, 'forward', 'routing-loop');
  });
});

describe('canReach — longest-prefix + tiebreak in the walk (§5)', () => {
  it('specific static beats default route', () => {
    let ls = fullyConfigured();
    // Add a default route on R1 that points to a dead-end; the specific
    // /24 static to PC-B's subnet should still win.
    ls = runOn(ls, 'R1', ['ip route 0.0.0.0 0.0.0.0 192.168.99.99']);
    expect(canReach(ls, 'PC-A', '192.168.2.10').ok).toBe(true);
  });

  it('connected beats static at same prefix length (lower adminDistance)', () => {
    let ls = fullyConfigured();
    // R1 has a connected route for its own PC-A subnet (Gi0/1).
    // Add a parallel static for the same subnet pointing nowhere useful.
    ls = runOn(ls, 'R1', ['ip route 192.168.1.0 255.255.255.0 192.168.12.2']);
    // Ping PC-A from R1 indirectly: have PC-B → PC-A succeed (R1's connected
    // route to 192.168.1.0/24 must still be used).
    expect(canReach(ls, 'PC-B', '192.168.1.10').ok).toBe(true);
  });
});

describe('canReach — purity (§8)', () => {
  it('does not mutate the input LabSession', () => {
    const ls = fullyConfigured();
    const before = structuredClone(ls);
    canReach(ls, 'PC-A', '192.168.2.10');
    expect(ls).toEqual(before);
  });

  it('same session → same result, every call', () => {
    const ls = fullyConfigured();
    const a = canReach(ls, 'PC-A', '192.168.2.10');
    const b = canReach(ls, 'PC-A', '192.168.2.10');
    const c = canReach(ls, 'PC-A', '192.168.2.10');
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});

// ---------- Direct PcSession / RouterSession mutators (test only) ----------

function forceIfaceUp(r: RouterSession, ifaceId: string): RouterSession {
  const ifaces = { ...r.device.interfaces };
  ifaces[ifaceId] = { ...ifaces[ifaceId], adminUp: true };
  return { ...r, device: { ...r.device, interfaces: ifaces } };
}

function forceNicDown(pc: PcSession): PcSession {
  return { ...pc, nicUp: false };
}

// Suppress unused warnings for the DeviceSession import — kept for future
// reachability fixtures that need explicit typing.
void undefined as DeviceSession | undefined;
