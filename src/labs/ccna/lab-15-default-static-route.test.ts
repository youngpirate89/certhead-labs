import { describe, it, expect } from 'vitest';
import {
  initLabSession,
  applyToDevice,
  setActive,
  type LabSession,
} from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab15DefaultStaticRoute } from './lab-15-default-static-route';
import type { Session as RouterSession } from '@/engine/adapters/ios/state';
import type { PcSession } from '@/engine/adapters/pc';

/** Apply a sequence of commands to one device, threading the session. */
function runOn(lab: LabSession, deviceId: string, lines: readonly string[]): LabSession {
  let cur = setActive(lab, deviceId);
  for (const line of lines) {
    cur = applyToDevice(cur, deviceId, line).session;
  }
  return cur;
}

function fresh(): LabSession {
  return initLabSession(lab15DefaultStaticRoute);
}

function router(lab: LabSession, id: string): RouterSession {
  const s = lab.devices[id];
  if (s.kind !== 'router') throw new Error(`${id} is not a router`);
  return s;
}

function pca(lab: LabSession): PcSession {
  const s = lab.devices['PC-A'];
  if (s.kind !== 'pc') throw new Error('PC-A is not a pc');
  return s;
}

/** R1 default-route config — the learner's job. */
const R1_DEFAULT: readonly string[] = [
  'enable',
  'configure terminal',
  'ip route 0.0.0.0 0.0.0.0 203.0.113.2',
  'end',
];

describe('Lab 15 — starting state', () => {
  it('R1 has both interfaces up but no static routes', () => {
    const r1 = router(fresh(), 'R1');
    expect(r1.device.interfaces['Gi0/0'].ip).toBe('192.168.1.1');
    expect(r1.device.interfaces['Gi0/0'].adminUp).toBe(true);
    expect(r1.device.interfaces['Gi0/1'].ip).toBe('203.0.113.1');
    expect(r1.device.interfaces['Gi0/1'].adminUp).toBe(true);
    expect(r1.staticRoutes).toEqual([]);
  });

  it('R2 has the return route to the LAN pre-seeded', () => {
    const r2 = router(fresh(), 'R2');
    expect(r2.staticRoutes).toHaveLength(1);
    expect(r2.staticRoutes[0]).toMatchObject({
      prefix: '192.168.1.0',
      mask: '255.255.255.0',
      nextHop: '203.0.113.1',
      source: 'static',
      adminDistance: 1,
    });
  });

  it('INET has a default route back through R2 pre-seeded', () => {
    const inet = router(fresh(), 'INET');
    expect(inet.device.interfaces['Gi0/0'].ip).toBe('8.8.8.2');
    expect(inet.staticRoutes).toHaveLength(1);
    expect(inet.staticRoutes[0]).toMatchObject({
      prefix: '0.0.0.0',
      mask: '0.0.0.0',
      nextHop: '8.8.8.1',
      source: 'static',
    });
  });

  it('PC-A starts unaddressed-from-DHCP — static IP from the lab definition', () => {
    const pc = pca(fresh());
    expect(pc.ip).toBe('192.168.1.10');
    expect(pc.gateway).toBe('192.168.1.1');
    expect(pc.lastPing).toBeNull();
  });

  it('seed commands do NOT appear in history (verify-route gate stays unmet)', () => {
    // R1 is fully addressed via setup but the learner has not yet run any
    // `show ip route`. The verify-route objective must be false on a fresh
    // session — proves seeds were threaded with record:false.
    const r1 = router(fresh(), 'R1');
    expect(r1.resolvedHistory.some((c) => /show ip route/.test(c))).toBe(false);
  });
});

describe('Lab 15 — default route installation', () => {
  it('ip route 0.0.0.0 0.0.0.0 <nh> in config installs a default route', () => {
    const lab = runOn(fresh(), 'R1', R1_DEFAULT);
    const r1 = router(lab, 'R1');
    expect(r1.staticRoutes).toHaveLength(1);
    expect(r1.staticRoutes[0]).toMatchObject({
      prefix: '0.0.0.0',
      mask: '0.0.0.0',
      nextHop: '203.0.113.2',
      source: 'static',
      adminDistance: 1,
    });
  });

  it('show ip route on R1 renders the S 0.0.0.0/0 line after configuring', () => {
    const lab = runOn(fresh(), 'R1', [...R1_DEFAULT, 'show ip route']);
    const { output } = applyToDevice(setActive(lab, 'R1'), 'R1', 'show ip route');
    const text = output.map((o) => o.text).join('\n');
    expect(text).toContain('S    0.0.0.0/0 [1/0] via 203.0.113.2');
  });
});

describe('Lab 15 — ping reachability through the default route', () => {
  it('PC-A ping 8.8.8.2 FAILS before the default route is configured', () => {
    const lab = runOn(fresh(), 'PC-A', ['ping 8.8.8.2']);
    const pc = pca(lab);
    expect(pc.lastPing).toEqual({ target: '8.8.8.2', ok: false });
  });

  it('PC-A ping 8.8.8.2 SUCCEEDS once R1 has the default route', () => {
    let lab = runOn(fresh(), 'R1', R1_DEFAULT);
    lab = runOn(lab, 'PC-A', ['ping 8.8.8.2']);
    const pc = pca(lab);
    expect(pc.lastPing).toEqual({ target: '8.8.8.2', ok: true });
  });
});

describe('Lab 15 — objective coverage', () => {
  it('all objectives unmet on a fresh session', () => {
    const result = grade(lab15DefaultStaticRoute, fresh());
    expect(result.allMet).toBe(false);
    for (const o of result.objectives) {
      expect(o.met).toBe(false);
    }
  });

  it('default-route objective flips after R1 installs the route', () => {
    const lab = runOn(fresh(), 'R1', R1_DEFAULT);
    const o = grade(lab15DefaultStaticRoute, lab).objectives.find((x) => x.id === 'default-route');
    expect(o?.met).toBe(true);
  });

  it('verify-route objective requires the learner to actually run show ip route', () => {
    let lab = runOn(fresh(), 'R1', R1_DEFAULT);
    expect(
      grade(lab15DefaultStaticRoute, lab).objectives.find((x) => x.id === 'verify-route')?.met,
    ).toBe(false);
    lab = runOn(lab, 'R1', ['show ip route']);
    expect(
      grade(lab15DefaultStaticRoute, lab).objectives.find((x) => x.id === 'verify-route')?.met,
    ).toBe(true);
  });

  it('verify-route accepts an abbreviated form (resolved history is canonical)', () => {
    let lab = runOn(fresh(), 'R1', R1_DEFAULT);
    lab = runOn(lab, 'R1', ['sh ip ro']);
    expect(
      grade(lab15DefaultStaticRoute, lab).objectives.find((x) => x.id === 'verify-route')?.met,
    ).toBe(true);
  });

  it('ping-internet objective flips after PC-A successfully pings 8.8.8.2', () => {
    let lab = runOn(fresh(), 'R1', R1_DEFAULT);
    lab = runOn(lab, 'PC-A', ['ping 8.8.8.2']);
    const o = grade(lab15DefaultStaticRoute, lab).objectives.find((x) => x.id === 'ping-internet');
    expect(o?.met).toBe(true);
  });

  it('a FAILED ping does NOT satisfy ping-internet (lastPing.ok is false)', () => {
    // No default route installed — ping will fail at R1 with no-route.
    const lab = runOn(fresh(), 'PC-A', ['ping 8.8.8.2']);
    const o = grade(lab15DefaultStaticRoute, lab).objectives.find((x) => x.id === 'ping-internet');
    expect(o?.met).toBe(false);
  });

  it('full happy-path satisfies every objective', () => {
    let lab = runOn(fresh(), 'R1', R1_DEFAULT);
    lab = runOn(lab, 'R1', ['show ip route']);
    lab = runOn(lab, 'PC-A', ['ping 8.8.8.2']);
    const result = grade(lab15DefaultStaticRoute, lab);
    const unmet = result.objectives.filter((o) => !o.met).map((o) => o.id);
    expect(unmet).toEqual([]);
    expect(result.allMet).toBe(true);
  });
});
