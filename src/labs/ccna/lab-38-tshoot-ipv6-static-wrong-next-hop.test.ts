import { describe, expect, it } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { lab38TshootIpv6StaticWrongNextHop } from './lab-38-tshoot-ipv6-static-wrong-next-hop';

function runOn(ls: LabSession, id: string, lines: readonly string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function outputOn(ls: LabSession, id: string, command: string): string {
  const { output } = applyToActive({ ...ls, activeDeviceId: id }, command);
  return output.map((o) => o.text).join('\n');
}

function applySolution(ls: LabSession): LabSession {
  let cur = runOn(ls, 'R1', ['enable', 'show ipv6 route']);
  cur = runOn(cur, 'R1', [
    'configure terminal',
    'no ipv6 route 2001:db8:acad:38:20::/64 2001:db8:acad:38:12::3',
    'ipv6 route 2001:db8:acad:38:20::/64 2001:db8:acad:38:12::2',
    'end',
    'show ipv6 route',
  ]);
  return cur;
}

describe('Lab 38 - Troubleshoot IPv6 static route wrong next-hop', () => {
  it('starts with R1 pointing the remote IPv6 LAN at the wrong next-hop', () => {
    const ls = initLabSession(lab38TshootIpv6StaticWrongNextHop);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('shape');

    expect(r1.ipv6StaticRoutes).toContainEqual(expect.objectContaining({
      prefix: '2001:db8:acad:38:20::/64',
      nextHop: '2001:db8:acad:38:12::3',
    }));
    expect(r1.ipv6StaticRoutes).not.toContainEqual(expect.objectContaining({
      prefix: '2001:db8:acad:38:20::/64',
      nextHop: '2001:db8:acad:38:12::2',
    }));
    expect(outputOn(ls, 'R1', 'show ipv6 route')).toMatch(/S\s+2001:DB8:ACAD:38:20::\/64.*2001:db8:acad:38:12::3/is);
    expect(grade(lab38TshootIpv6StaticWrongNextHop, ls).allMet).toBe(false);
  });

  it('requires diagnosis, removing the bad route, adding the correct route, and verifying after repair', () => {
    const ls = applySolution(initLabSession(lab38TshootIpv6StaticWrongNextHop));
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('shape');

    expect(r1.ipv6StaticRoutes).not.toContainEqual(expect.objectContaining({
      prefix: '2001:db8:acad:38:20::/64',
      nextHop: '2001:db8:acad:38:12::3',
    }));
    expect(r1.ipv6StaticRoutes).toContainEqual(expect.objectContaining({
      prefix: '2001:db8:acad:38:20::/64',
      nextHop: '2001:db8:acad:38:12::2',
    }));
    expect(outputOn(ls, 'R1', 'show ipv6 route')).toMatch(/S\s+2001:DB8:ACAD:38:20::\/64.*2001:db8:acad:38:12::2/is);

    const g = grade(lab38TshootIpv6StaticWrongNextHop, ls);
    expect(g.allMet).toBe(true);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual([
      ['diagnose-wrong-ipv6-next-hop', true],
      ['remove-bad-ipv6-route', true],
      ['add-correct-ipv6-route', true],
      ['verify-correct-ipv6-route', true],
    ]);
  });
});
