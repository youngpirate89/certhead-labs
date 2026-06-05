import { describe, expect, it } from 'vitest';
import { initLabSession, applyToDevice, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab25Ipv6StaticRoute as lab } from './lab-25-ipv6-static-route';

function run(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

describe('Lab 25 — IPv6 static route', () => {
  it('starts incomplete with IPv6 LAN/WAN addressing seeded but no learner static routes or verification', () => {
    const ls = initLabSession(lab);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;

    if (r1?.kind !== 'router') throw new Error('R1 is not a router');
    if (r2?.kind !== 'router') throw new Error('R2 is not a router');

    expect(r1.device.interfaces['Gi0/0'].ipv6Addresses).toContain('2001:db8:acad:10::1/64');
    expect(r1.device.interfaces['Gi0/1'].ipv6Addresses).toContain('2001:db8:acad:12::1/64');
    expect(r2.device.interfaces['Gi0/0'].ipv6Addresses).toContain('2001:db8:acad:12::2/64');
    expect(r2.device.interfaces['Gi0/1'].ipv6Addresses).toContain('2001:db8:acad:20::1/64');
    expect(r1.ipv6StaticRoutes ?? []).toEqual([]);
    expect(r2.ipv6StaticRoutes ?? []).toEqual([]);
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('keeps PC-A and R1 far enough apart for readable interface labels', () => {
    const pc = lab.topology.devices.find((device) => device.id === 'PC-A');
    const r1 = lab.topology.devices.find((device) => device.id === 'R1');

    expect(pc?.position?.x).toBe(0);
    expect(r1?.position?.x).toBeGreaterThanOrEqual(320);
  });

  it('grades complete after adding reciprocal IPv6 static routes and running show ipv6 route on both routers', () => {
    let ls = initLabSession(lab);

    ls = run(ls, 'R1', [
      'enable',
      'configure terminal',
      'ipv6 route 2001:db8:acad:20::/64 2001:db8:acad:12::2',
      'end',
      'show ipv6 route',
    ]);
    ls = run(ls, 'R2', [
      'enable',
      'configure terminal',
      'ipv6 route 2001:db8:acad:10::/64 2001:db8:acad:12::1',
      'end',
      'show ipv6 route',
    ]);

    expect(grade(lab, ls).allMet).toBe(true);
  });

  it('does not mark route verification complete until show ipv6 route is run after the static route exists', () => {
    let ls = initLabSession(lab);

    ls = run(ls, 'R1', ['enable', 'show ipv6 route']);
    ls = run(ls, 'R1', [
      'configure terminal',
      'ipv6 route 2001:db8:acad:20::/64 2001:db8:acad:12::2',
      'end',
    ]);
    ls = run(ls, 'R2', [
      'enable',
      'configure terminal',
      'ipv6 route 2001:db8:acad:10::/64 2001:db8:acad:12::1',
      'end',
      'show ipv6 route',
    ]);

    const result = grade(lab, ls);
    expect(result.objectives.find((o) => o.id === 'r1-verify-ipv6-route')?.met).toBe(false);
    expect(result.allMet).toBe(false);
  });
});
