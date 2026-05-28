import { describe, it, expect } from 'vitest';
import {
  initLabSession,
  applyToDevice,
  setActive,
  type LabSession,
} from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab16FloatingStaticRoute } from './lab-16-floating-static-route';
import type { Session as RouterSession } from '@/engine/adapters/ios/state';

function runOn(lab: LabSession, deviceId: string, lines: readonly string[]): LabSession {
  let cur = setActive(lab, deviceId);
  for (const line of lines) {
    cur = applyToDevice(cur, deviceId, line).session;
  }
  return cur;
}

function fresh(): LabSession {
  return initLabSession(lab16FloatingStaticRoute);
}

function router(lab: LabSession, id: string): RouterSession {
  const s = lab.devices[id];
  if (s.kind !== 'router') throw new Error(`${id} is not a router`);
  return s;
}

/** Both default-route lines — the learner's job. */
const R1_FLOATING: readonly string[] = [
  'enable',
  'configure terminal',
  'ip route 0.0.0.0 0.0.0.0 10.1.1.2',
  'ip route 0.0.0.0 0.0.0.0 10.1.2.2 200',
  'end',
];

describe('Lab 16 — starting state', () => {
  it('R1 has all three interfaces up but no static routes', () => {
    const r1 = router(fresh(), 'R1');
    expect(r1.device.interfaces['Gi0/0'].ip).toBe('192.168.1.1');
    expect(r1.device.interfaces['Gi0/0'].adminUp).toBe(true);
    expect(r1.device.interfaces['Gi0/1'].ip).toBe('10.1.1.1');
    expect(r1.device.interfaces['Gi0/1'].adminUp).toBe(true);
    expect(r1.device.interfaces['Gi0/2'].ip).toBe('10.1.2.1');
    expect(r1.device.interfaces['Gi0/2'].adminUp).toBe(true);
    expect(r1.staticRoutes).toEqual([]);
  });

  it('R2 and R3 each have their WAN-side interface up', () => {
    const r2 = router(fresh(), 'R2');
    const r3 = router(fresh(), 'R3');
    expect(r2.device.interfaces['Gi0/0'].ip).toBe('10.1.1.2');
    expect(r2.device.interfaces['Gi0/0'].adminUp).toBe(true);
    expect(r3.device.interfaces['Gi0/0'].ip).toBe('10.1.2.2');
    expect(r3.device.interfaces['Gi0/0'].adminUp).toBe(true);
  });

  it('seed commands do NOT appear in history (verify-route gate stays unmet)', () => {
    const r1 = router(fresh(), 'R1');
    expect(r1.resolvedHistory.some((c) => /show ip route/.test(c))).toBe(false);
  });
});

describe('Lab 16 — floating static configuration', () => {
  it('primary and backup are both stored, with the floating AD on the backup', () => {
    const lab = runOn(fresh(), 'R1', R1_FLOATING);
    const r1 = router(lab, 'R1');
    expect(r1.staticRoutes).toHaveLength(2);
    expect(r1.staticRoutes[0]).toMatchObject({
      prefix: '0.0.0.0',
      mask: '0.0.0.0',
      nextHop: '10.1.1.2',
      adminDistance: 1,
    });
    expect(r1.staticRoutes[1]).toMatchObject({
      prefix: '0.0.0.0',
      mask: '0.0.0.0',
      nextHop: '10.1.2.2',
      adminDistance: 200,
    });
  });

  it('show ip route renders only the primary while both are configured', () => {
    const lab = runOn(fresh(), 'R1', [...R1_FLOATING, 'show ip route']);
    const { output } = applyToDevice(setActive(lab, 'R1'), 'R1', 'show ip route');
    const text = output.map((o) => o.text).join('\n');
    expect(text).toContain('S    0.0.0.0/0 [1/0] via 10.1.1.2');
    expect(text).not.toContain('via 10.1.2.2');
  });

  it('withdrawing the primary promotes the backup into the RIB', () => {
    let lab = runOn(fresh(), 'R1', R1_FLOATING);
    lab = runOn(lab, 'R1', [
      'configure terminal',
      'no ip route 0.0.0.0 0.0.0.0 10.1.1.2',
      'end',
    ]);
    const { output } = applyToDevice(setActive(lab, 'R1'), 'R1', 'show ip route');
    const text = output.map((o) => o.text).join('\n');
    expect(text).toContain('S    0.0.0.0/0 [200/0] via 10.1.2.2');
    expect(text).not.toContain('via 10.1.1.2');
  });
});

describe('Lab 16 — objective coverage', () => {
  it('all objectives unmet on a fresh session', () => {
    const result = grade(lab16FloatingStaticRoute, fresh());
    expect(result.allMet).toBe(false);
    for (const o of result.objectives) {
      expect(o.met).toBe(false);
    }
  });

  it('primary-route flips after `ip route 0.0.0.0 0.0.0.0 10.1.1.2`', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip route 0.0.0.0 0.0.0.0 10.1.1.2',
      'end',
    ]);
    const o = grade(lab16FloatingStaticRoute, lab).objectives.find((x) => x.id === 'primary-route');
    expect(o?.met).toBe(true);
  });

  it('backup-route requires the AD 200 — bare backup at AD 1 does not satisfy it', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip route 0.0.0.0 0.0.0.0 10.1.2.2',
      'end',
    ]);
    const o = grade(lab16FloatingStaticRoute, lab).objectives.find((x) => x.id === 'backup-route');
    expect(o?.met).toBe(false);
  });

  it('backup-route flips after `ip route 0.0.0.0 0.0.0.0 10.1.2.2 200`', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip route 0.0.0.0 0.0.0.0 10.1.2.2 200',
      'end',
    ]);
    const o = grade(lab16FloatingStaticRoute, lab).objectives.find((x) => x.id === 'backup-route');
    expect(o?.met).toBe(true);
  });

  it('verify-route requires the learner to actually run show ip route', () => {
    let lab = runOn(fresh(), 'R1', R1_FLOATING);
    expect(
      grade(lab16FloatingStaticRoute, lab).objectives.find((x) => x.id === 'verify-route')?.met,
    ).toBe(false);
    lab = runOn(lab, 'R1', ['show ip route']);
    expect(
      grade(lab16FloatingStaticRoute, lab).objectives.find((x) => x.id === 'verify-route')?.met,
    ).toBe(true);
  });

  it('verify-route accepts an abbreviated form (resolved history is canonical)', () => {
    let lab = runOn(fresh(), 'R1', R1_FLOATING);
    lab = runOn(lab, 'R1', ['sh ip ro']);
    expect(
      grade(lab16FloatingStaticRoute, lab).objectives.find((x) => x.id === 'verify-route')?.met,
    ).toBe(true);
  });

  it('full happy-path satisfies every objective', () => {
    let lab = runOn(fresh(), 'R1', R1_FLOATING);
    lab = runOn(lab, 'R1', ['show ip route']);
    const result = grade(lab16FloatingStaticRoute, lab);
    const unmet = result.objectives.filter((o) => !o.met).map((o) => o.id);
    expect(unmet).toEqual([]);
    expect(result.allMet).toBe(true);
  });
});
