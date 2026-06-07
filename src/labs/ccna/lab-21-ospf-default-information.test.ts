/**
 * Lab 21 - OSPF default-information originate objective coverage.
 *
 * Drives Lab 21 from a fresh session, verifying that:
 *   - on entry the R1<->R2 area-0 adjacency is FULL, R1 carries the static
 *     default, but R2 has NO default route and PC-B cannot reach 8.8.8.2, so
 *     all three objectives start unsatisfied;
 *   - `default-information originate` on R1 injects an O*E2 0.0.0.0/0 into R2
 *     (the per-command refresh re-runs recomputeOspf), canReach flips ok, and
 *     the lastPing predicate satisfies the reach objective;
 *   - show ip route on R2 renders the O*E2 line + gateway of last resort, show
 *     ip ospf flags R1 as an ASBR, and running-config emits the originate line;
 *   - `no default-information originate` withdraws the default again;
 *   - ADVERSARIAL: configuring originate on the WRONG router (R2, which has no
 *     default) does not complete the lab, and pinging without configuring stays
 *     red.
 */
import { describe, it, expect } from 'vitest';
import { lab21OspfDefaultInformation } from './lab-21-ospf-default-information';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import type { LabState, HistoryView } from '@/engine/types';

function runOn(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  let cur = ls;
  if (cur.activeDeviceId !== deviceId) cur = { ...cur, activeDeviceId: deviceId };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function showOn(ls: LabSession, deviceId: string, line: string): string {
  const { output } = applyToActive({ ...ls, activeDeviceId: deviceId }, line);
  return output.map((o) => o.text).join('\n');
}

function checkAll(ls: LabSession): boolean[] {
  const state: LabState = {};
  for (const [id, dev] of Object.entries(ls.devices)) {
    if (dev.kind === 'router') state[id] = dev.device;
  }
  const history: HistoryView = Object.fromEntries(
    Object.entries(ls.devices).map(([id, dev]) => [
      id,
      { raw: dev.history, resolved: dev.resolvedHistory },
    ]),
  );
  return lab21OspfDefaultInformation.objectives.map((o) => o.check(state, history, ls));
}

/** Canonical fix: enable default-information originate under R1's OSPF. */
function applyFix(ls: LabSession): LabSession {
  return runOn(ls, 'R1', [
    'enable',
    'configure terminal',
    'router ospf 1',
    'default-information originate',
    'end',
  ]);
}

/** Full solution: fix + ping from PC-B. */
function applyFullSolution(ls: LabSession): LabSession {
  return runOn(applyFix(ls), 'PC-B', ['ping 8.8.8.2']);
}

// ---------- Starting-state assertions ----------

describe('Lab 21 - starting state', () => {
  it('R1 carries the static default toward the ISP but does not originate it', () => {
    const ls = initLabSession(lab21OspfDefaultInformation);
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('not router');
    expect(
      r1.staticRoutes.some(
        (r) => r.prefix === '0.0.0.0' && r.mask === '0.0.0.0' && r.nextHop === '203.0.113.2',
      ),
    ).toBe(true);
    expect(r1.device.ospf.defaultInfoOriginate).toBe(false);
  });

  it('R1<->R2 adjacency is FULL on entry (transit OSPF works)', () => {
    const ls = initLabSession(lab21OspfDefaultInformation);
    const r1 = ls.devices.R1;
    const r2 = ls.devices.R2;
    if (r1.kind !== 'router' || r2.kind !== 'router') throw new Error('not router');
    expect(Array.from(r1.device.ospf.neighbors.values()).some((n) => n.state === 'FULL')).toBe(true);
    expect(Array.from(r2.device.ospf.neighbors.values()).some((n) => n.state === 'FULL')).toBe(true);
  });

  it('R2 has NO default route on entry (OSPF does not redistribute it automatically)', () => {
    const ls = initLabSession(lab21OspfDefaultInformation);
    const r2 = ls.devices.R2;
    if (r2.kind !== 'router') throw new Error('not router');
    expect(r2.ospfRoutes.some((r) => r.prefix === '0.0.0.0' && r.mask === '0.0.0.0')).toBe(false);
  });

  it('canReach PC-B -> 8.8.8.2 fails with no-route on entry', () => {
    const ls = initLabSession(lab21OspfDefaultInformation);
    const result = canReach(ls, 'PC-B', '8.8.8.2', undefined, 'icmp');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failedAt.reason).toBe('no-route');
  });

  it('PC-B cannot ping 8.8.8.2 in the starting state', () => {
    let ls = initLabSession(lab21OspfDefaultInformation);
    ls = runOn(ls, 'PC-B', ['ping 8.8.8.2']);
    const pc = ls.devices['PC-B'];
    if (pc.kind !== 'pc') throw new Error('not pc');
    expect(pc.lastPing).toEqual({ target: '8.8.8.2', ok: false });
  });

  it('all three objectives start unmet', () => {
    expect(checkAll(initLabSession(lab21OspfDefaultInformation))).toEqual([false, false, false]);
  });
});

// ---------- Objective: default-info ----------

describe('Lab 21 - objective: default-info', () => {
  it('false on fresh session', () => {
    expect(checkAll(initLabSession(lab21OspfDefaultInformation))[0]).toBe(false);
  });

  it('true once default-information originate is set on R1', () => {
    const ls = applyFix(initLabSession(lab21OspfDefaultInformation));
    expect(checkAll(ls)[0]).toBe(true);
  });

  it('the `always` form also satisfies it', () => {
    const ls = runOn(initLabSession(lab21OspfDefaultInformation), 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'default-information originate always',
      'end',
    ]);
    expect(checkAll(ls)[0]).toBe(true);
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('not router');
    expect(r1.device.ospf.defaultInfoAlways).toBe(true);
  });
});

// ---------- Objective: r2-learns-default ----------

describe('Lab 21 - objective: r2-learns-default', () => {
  it('false on fresh session', () => {
    expect(checkAll(initLabSession(lab21OspfDefaultInformation))[1]).toBe(false);
  });

  it('true after R1 originates the default', () => {
    const ls = applyFix(initLabSession(lab21OspfDefaultInformation));
    expect(checkAll(ls)[1]).toBe(true);
  });

  it('R2 installs the default as an external O*E2 route with the right shape', () => {
    const ls = applyFix(initLabSession(lab21OspfDefaultInformation));
    const r2 = ls.devices.R2;
    if (r2.kind !== 'router') throw new Error('not router');
    expect(r2.ospfRoutes).toContainEqual(
      expect.objectContaining({
        prefix: '0.0.0.0',
        mask: '0.0.0.0',
        nextHop: '10.0.0.1',
        egressIface: 'Gi0/2',
        source: 'ospf',
        adminDistance: 110,
        metric: 1,
        ospfExternal: true,
      }),
    );
  });
});

// ---------- Objective: ping-internet ----------

describe('Lab 21 - objective: ping-internet', () => {
  it('false after the fix but BEFORE the learner re-pings', () => {
    const ls = applyFix(initLabSession(lab21OspfDefaultInformation));
    expect(checkAll(ls)[2]).toBe(false);
  });

  it('false if the learner pings without originating the default', () => {
    let ls = initLabSession(lab21OspfDefaultInformation);
    ls = runOn(ls, 'PC-B', ['ping 8.8.8.2']);
    expect(checkAll(ls)[2]).toBe(false);
  });

  it('true after the full fix + successful ping from PC-B', () => {
    const ls = applyFullSolution(initLabSession(lab21OspfDefaultInformation));
    expect(checkAll(ls)[2]).toBe(true);
  });
});

// ---------- Fix re-forms reachability + renders correctly ----------

describe('Lab 21 - fix propagates and renders', () => {
  it('canReach PC-B -> 8.8.8.2 flips ok after the fix', () => {
    const ls = applyFix(initLabSession(lab21OspfDefaultInformation));
    const result = canReach(ls, 'PC-B', '8.8.8.2', undefined, 'icmp');
    expect(result.ok).toBe(true);
  });

  it('show ip route on R2 renders the O*E2 default + gateway of last resort', () => {
    const ls = applyFix(initLabSession(lab21OspfDefaultInformation));
    const text = showOn(ls, 'R2', 'show ip route');
    expect(text).toMatch(/Gateway of last resort is 10\.0\.0\.1 to network 0\.0\.0\.0/);
    expect(text).toMatch(
      /O\*E2 0\.0\.0\.0\/0 \[110\/1\] via 10\.0\.0\.1, GigabitEthernet0\/2/,
    );
  });

  it('show ip ospf on R1 flags it as an ASBR originating the default', () => {
    const ls = applyFix(initLabSession(lab21OspfDefaultInformation));
    const text = showOn(ls, 'R1', 'show ip ospf');
    expect(text).toMatch(/It is an autonomous system boundary router/);
    expect(text).toMatch(/Originate Default Route/);
  });

  it('running-config on R1 emits the default-information originate line', () => {
    const ls = applyFix(initLabSession(lab21OspfDefaultInformation));
    const text = showOn(ls, 'R1', 'show running-config');
    expect(text).toMatch(/^ default-information originate$/m);
  });

  it('R1 itself does NOT install a self-originated default (keeps only its static)', () => {
    const ls = applyFix(initLabSession(lab21OspfDefaultInformation));
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('not router');
    expect(r1.ospfRoutes.some((r) => r.prefix === '0.0.0.0' && r.mask === '0.0.0.0')).toBe(false);
  });
});

// ---------- Toggle off ----------

describe('Lab 21 - no default-information originate withdraws the default', () => {
  it('removing originate drops the O*E2 from R2 and breaks reachability again', () => {
    let ls = applyFix(initLabSession(lab21OspfDefaultInformation));
    expect(checkAll(ls)[1]).toBe(true);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'no default-information originate',
      'end',
    ]);
    const r2 = ls.devices.R2;
    if (r2.kind !== 'router') throw new Error('not router');
    expect(r2.ospfRoutes.some((r) => r.prefix === '0.0.0.0' && r.mask === '0.0.0.0')).toBe(false);
    expect(canReach(ls, 'PC-B', '8.8.8.2', undefined, 'icmp').ok).toBe(false);
  });
});

// ---------- Adversarial: no false completions ----------

describe('Lab 21 - adversarial', () => {
  it('originating on the WRONG router (R2, which has no default) does not inject a route', () => {
    // R2 has no default route in its RIB, so default-information originate
    // (without `always`) advertises nothing. R1 stays unset, so neither router
    // gets a default and the lab stays red.
    let ls = initLabSession(lab21OspfDefaultInformation);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'default-information originate',
      'end',
    ]);
    ls = runOn(ls, 'PC-B', ['ping 8.8.8.2']);
    expect(checkAll(ls)).toEqual([false, false, false]);
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('not router');
    expect(r1.ospfRoutes.some((r) => r.prefix === '0.0.0.0' && r.mask === '0.0.0.0')).toBe(false);
  });
});

// ---------- Full solution ----------

describe('Lab 21 - full solution', () => {
  it('all three objectives pass after originate + ping', () => {
    const ls = applyFullSolution(initLabSession(lab21OspfDefaultInformation));
    expect(checkAll(ls)).toEqual([true, true, true]);
  });
});
