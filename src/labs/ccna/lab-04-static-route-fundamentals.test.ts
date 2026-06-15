import { describe, it, expect } from 'vitest';
import { initLabSession, applyToDevice, setActive, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { grade } from '@/engine/grading';
import { lab04StaticRouteFundamentals } from './lab-04-static-route-fundamentals';
import type { Session as RouterSession } from '@/engine/adapters/ios/state';
import type { PcSession } from '@/engine/adapters/pc';

function fresh(): LabSession {
  return initLabSession(lab04StaticRouteFundamentals);
}

function runOn(lab: LabSession, deviceId: string, lines: readonly string[]): LabSession {
  let cur = setActive(lab, deviceId);
  for (const line of lines) cur = applyToDevice(cur, deviceId, line).session;
  return cur;
}

function router(lab: LabSession, id: string): RouterSession {
  const s = lab.devices[id];
  if (s.kind !== 'router') throw new Error(`${id} is not a router`);
  return s;
}

function pc(lab: LabSession, id: string): PcSession {
  const s = lab.devices[id];
  if (s.kind !== 'pc') throw new Error(`${id} is not a PC`);
  return s;
}

const R1_STATIC = ['enable', 'configure terminal', 'ip route 172.16.10.64 255.255.255.224 10.10.10.2', 'end'] as const;
const R2_STATIC = ['enable', 'configure terminal', 'ip route 172.16.10.0 255.255.255.192 10.10.10.1', 'end'] as const;

function configureRoutes(lab: LabSession = fresh()): LabSession {
  let cur = runOn(lab, 'R1', R1_STATIC);
  cur = runOn(cur, 'R2', R2_STATIC);
  return cur;
}

describe('Lab 04 — static route fundamentals starting state', () => {
  it('is a free starter lab that fills the numbered Lab 04 gap', () => {
    expect(lab04StaticRouteFundamentals.id).toBe('ccna-lab04-static-route-fundamentals');
    expect(lab04StaticRouteFundamentals.isFree).toBe(true);
    expect(lab04StaticRouteFundamentals.difficulty).toBe(2);
  });

  it('starts with addressed/up interfaces from Lab 03 but no static routes', () => {
    const lab = fresh();
    expect(pc(lab, 'PC-A')).toMatchObject({ ip: '172.16.10.10', mask: '255.255.255.192', gateway: '172.16.10.1' });
    expect(pc(lab, 'PC-B')).toMatchObject({ ip: '172.16.10.70', mask: '255.255.255.224', gateway: '172.16.10.65' });

    expect(router(lab, 'R1').staticRoutes).toEqual([]);
    expect(router(lab, 'R2').staticRoutes).toEqual([]);
    expect(canReach(lab, 'PC-A', '172.16.10.70').ok).toBe(false);
  });

  it('all objectives are unmet on a fresh session and setup history is not credited', () => {
    const lab = fresh();
    expect(router(lab, 'R1').resolvedHistory).toEqual([]);
    expect(router(lab, 'R2').resolvedHistory).toEqual([]);
    const result = grade(lab04StaticRouteFundamentals, lab);
    expect(result.allMet).toBe(false);
    expect(result.objectives.map((o) => [o.id, o.met])).toEqual([
      ['r1-static-route', false],
      ['r2-static-route', false],
      ['verify-routes', false],
      ['end-to-end-ping', false],
    ]);
  });
});

describe('Lab 04 — static route configuration and verification', () => {
  it('R1 route objective requires a static route to PC-B LAN via R2 transit IP', () => {
    const lab = runOn(fresh(), 'R1', R1_STATIC);
    expect(grade(lab04StaticRouteFundamentals, lab).objectives.find((o) => o.id === 'r1-static-route')?.met).toBe(true);
  });

  it('R2 route objective requires a return static route to PC-A LAN via R1 transit IP', () => {
    const lab = runOn(fresh(), 'R2', R2_STATIC);
    expect(grade(lab04StaticRouteFundamentals, lab).objectives.find((o) => o.id === 'r2-static-route')?.met).toBe(true);
  });

  it('verify-routes requires show ip route on both routers after routes are configured', () => {
    let lab = runOn(fresh(), 'R1', ['enable', 'show ip route']);
    lab = runOn(lab, 'R2', ['enable', 'show ip route']);
    expect(grade(lab04StaticRouteFundamentals, lab).objectives.find((o) => o.id === 'verify-routes')?.met).toBe(false);

    lab = configureRoutes(lab);
    expect(grade(lab04StaticRouteFundamentals, lab).objectives.find((o) => o.id === 'verify-routes')?.met).toBe(false);

    lab = runOn(lab, 'R1', ['show ip route']);
    lab = runOn(lab, 'R2', ['show ip route']);
    expect(grade(lab04StaticRouteFundamentals, lab).objectives.find((o) => o.id === 'verify-routes')?.met).toBe(true);
  });

  it('end-to-end objective requires a successful learner ping after both directions route', () => {
    let lab = runOn(fresh(), 'PC-A', ['ping 172.16.10.70']);
    expect(pc(lab, 'PC-A').lastPing).toEqual({ target: '172.16.10.70', ok: false });

    lab = configureRoutes(lab);
    expect(canReach(lab, 'PC-A', '172.16.10.70').ok).toBe(true);
    expect(grade(lab04StaticRouteFundamentals, lab).objectives.find((o) => o.id === 'end-to-end-ping')?.met).toBe(false);

    lab = runOn(lab, 'PC-A', ['ping 172.16.10.70']);
    expect(pc(lab, 'PC-A').lastPing).toEqual({ target: '172.16.10.70', ok: true });
    expect(grade(lab04StaticRouteFundamentals, lab).objectives.find((o) => o.id === 'end-to-end-ping')?.met).toBe(true);
  });

  it('full walkthrough completes every objective', () => {
    let lab = configureRoutes();
    lab = runOn(lab, 'R1', ['show ip route']);
    lab = runOn(lab, 'R2', ['show ip route']);
    lab = runOn(lab, 'PC-A', ['ping 172.16.10.70']);

    const result = grade(lab04StaticRouteFundamentals, lab);
    expect(result.objectives.filter((o) => !o.met).map((o) => o.id)).toEqual([]);
    expect(result.allMet).toBe(true);
  });
});
