import { describe, it, expect } from 'vitest';
import { applyCommand } from './interpret';
import { prompt } from './state';
import { initLabSession, applyToActive, setActive, type LabSession } from '@/engine/lab-session';
import type { Lab } from '@/engine/types';
import type { Session as RouterSession } from './state';

/**
 * OSPF engine tests.
 *
 * Two layers:
 *   1. Per-router behavior (mode transitions, network statements, render).
 *      Drive the router adapter directly with applyCommand — no LabSession
 *      needed; adjacency formation does not run.
 *   2. Topology-level behavior (adjacency, route injection). Build a small
 *      multi-router lab and drive it through applyToActive so the
 *      LabSession's refreshOspf pass fires.
 */

// ----- Per-router (no LabSession) ----------------------------------------

import { createSession, buildDevice, type Session } from './state';

function fresh2iface(id = 'R1'): Session {
  return createSession(buildDevice({ id, platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/2'] }));
}

function configRouter(s: Session): Session {
  return ['enable', 'configure terminal'].reduce((acc, line) => applyCommand(acc, line).session, s);
}

describe('OSPF — config-router mode + network statements', () => {
  it('`router ospf 1` enters config-router with the right prompt', () => {
    const after = applyCommand(configRouter(fresh2iface()), 'router ospf 1');
    expect(after.session.mode).toBe('config-router');
    expect(after.session.device.ospf.process).toBe(1);
    expect(prompt(after.session)).toBe('R1(config-router)#');
  });

  it('prefix-matches `router ospf 1` -> `router ospf 1`', () => {
    // Both `router` and `ospf` should resolve via prefix.
    const after = applyCommand(configRouter(fresh2iface()), 'router o 1');
    expect(after.session.mode).toBe('config-router');
    expect(after.session.device.ospf.process).toBe(1);
  });

  it('`exit` from config-router returns to config; `end` to priv', () => {
    const inRouter = applyCommand(configRouter(fresh2iface()), 'router ospf 1').session;
    expect(applyCommand(inRouter, 'exit').session.mode).toBe('config');
    expect(applyCommand(inRouter, 'end').session.mode).toBe('priv');
  });

  it('`network 192.168.1.0 0.0.0.255 area 0` records a network statement', () => {
    let s = applyCommand(configRouter(fresh2iface()), 'router ospf 1').session;
    s = applyCommand(s, 'network 192.168.1.0 0.0.0.255 area 0').session;
    expect(s.device.ospf.networks).toEqual([
      { prefix: '192.168.1.0', wildcard: '0.0.0.255', area: 0 },
    ]);
  });

  it('`no network ...` removes a previously-added statement', () => {
    let s = applyCommand(configRouter(fresh2iface()), 'router ospf 1').session;
    s = applyCommand(s, 'network 192.168.1.0 0.0.0.255 area 0').session;
    s = applyCommand(s, 'no network 192.168.1.0 0.0.0.255 area 0').session;
    expect(s.device.ospf.networks).toEqual([]);
  });

  it('`net 192.168.1.0 0.0.0.255 area 0` resolves via prefix-match', () => {
    let s = applyCommand(configRouter(fresh2iface()), 'router ospf 1').session;
    s = applyCommand(s, 'net 192.168.1.0 0.0.0.255 area 0').session;
    expect(s.device.ospf.networks).toHaveLength(1);
  });

  it('`do show ip ospf neighbor` works from config-router (no adjacency, prints empty header)', () => {
    const s = applyCommand(configRouter(fresh2iface()), 'router ospf 1').session;
    const out = applyCommand(s, 'do sh ip ospf nei').output;
    const text = out.map((o) => o.text).join('\n');
    // Empty table reads as IOS header row, no data rows. Lab 13's tshoot
    // workflow keys off this — seeing the empty header is the learner's
    // signal that adjacency hasn't formed.
    expect(text).toMatch(/Neighbor ID\s+Pri\s+State\s+Dead Time\s+Address\s+Interface/);
    expect(text).not.toMatch(/FULL/);
  });

  it('`show ip ospf` summary names the process id and router-id', () => {
    // Configure an interface first so deriveRouterId picks something up.
    let s = configRouter(fresh2iface());
    s = applyCommand(s, 'interface gi0/0').session;
    s = applyCommand(s, 'ip address 192.168.1.1 255.255.255.0').session;
    s = applyCommand(s, 'no shutdown').session;
    s = applyCommand(s, 'exit').session;
    s = applyCommand(s, 'router ospf 1').session;
    s = applyCommand(s, 'network 192.168.1.0 0.0.0.255 area 0').session;
    const text = applyCommand(s, 'do show ip ospf')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/Routing Process "ospf 1" with ID 192\.168\.1\.1/);
    expect(text).toMatch(/Number of areas in this router is 1\. 1 normal 0 stub 0 nssa/);
  });
});

// ----- Topology-level (full LabSession + OSPF recompute) -----------------

const ROUTER = { kind: 'router' as const, platform: 'ISR4321' };

function twoRouterLink(): Lab {
  return {
    id: 'ospf-test-2r',
    title: 'ospf test',
    exam: 'TEST',
    difficulty: 1,
    estimatedMinutes: 1,
    isFree: false,
    scenario: 'fixture',
    topology: {
      devices: [
        { id: 'R1', interfaces: ['Gi0/0', 'Gi0/2'], ...ROUTER },
        { id: 'R2', interfaces: ['Gi0/0', 'Gi0/2'], ...ROUTER },
      ],
      links: [
        { a: { deviceId: 'R1', iface: 'Gi0/2' }, b: { deviceId: 'R2', iface: 'Gi0/2' } },
      ],
    },
    // Pre-configure both ends of the WAN link and the LAN on each router.
    setup: {
      R1: [
        'enable',
        'configure terminal',
        'interface gi0/0',
        'ip address 192.168.1.1 255.255.255.0',
        'no shutdown',
        'exit',
        'interface gi0/2',
        'ip address 10.0.0.1 255.255.255.252',
        'no shutdown',
        'exit',
      ],
      R2: [
        'enable',
        'configure terminal',
        'interface gi0/2',
        'ip address 10.0.0.2 255.255.255.252',
        'no shutdown',
        'exit',
        'interface gi0/0',
        'ip address 192.168.2.1 255.255.255.0',
        'no shutdown',
        'exit',
      ],
    },
    objectives: [],
    hints: [],
  };
}

function asRouter(s: LabSession['devices'][string]): RouterSession {
  if (s.kind !== 'router') throw new Error('expected router');
  return s;
}

/** Switch to a device and apply a sequence of lines. Always prepends
 *  `end`/`disable` so the device starts at user> regardless of what mode the
 *  previous block left it in. */
function runOn(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  let cur = setActive(ls, deviceId);
  for (const line of ['end', 'disable', ...lines]) {
    cur = applyToActive(cur, line).session;
  }
  return cur;
}

/** Like runOn, but returns the output of the LAST line — useful for asserting
 *  on `show` output. Wraps state reset so prior config-mode is irrelevant. */
function runOnWithOutput(
  ls: LabSession,
  deviceId: string,
  lines: string[],
): { session: LabSession; lastOutput: string } {
  let cur = setActive(ls, deviceId);
  let lastText = '';
  const all = ['end', 'disable', ...lines];
  for (let i = 0; i < all.length; i++) {
    const r = applyToActive(cur, all[i]);
    cur = r.session;
    if (i === all.length - 1) lastText = r.output.map((o) => o.text).join('\n');
  }
  return { session: cur, lastOutput: lastText };
}

describe('OSPF — adjacency formation across LabSession', () => {
  it('forms FULL neighbors on both sides when both routers are configured for area 0', () => {
    let ls = initLabSession(twoRouterLink());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.1.0 0.0.0.255 area 0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.2.0 0.0.0.255 area 0',
    ]);

    const r1 = asRouter(ls.devices.R1);
    const r2 = asRouter(ls.devices.R2);

    expect(r1.device.ospf.neighbors.size).toBe(1);
    expect(r2.device.ospf.neighbors.size).toBe(1);

    // R1 sees R2 (key = R2 router-id), state FULL, address = R2's WAN IP.
    const r2Rid = r2.device.ospf.routerId!;
    const seenByR1 = r1.device.ospf.neighbors.get(r2Rid);
    expect(seenByR1?.state).toBe('FULL');
    expect(seenByR1?.address).toBe('10.0.0.2');
    expect(seenByR1?.interface).toBe('Gi0/2');
  });

  it('only one side configured → no adjacency', () => {
    let ls = initLabSession(twoRouterLink());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
    ]);
    expect(asRouter(ls.devices.R1).device.ospf.neighbors.size).toBe(0);
    expect(asRouter(ls.devices.R2).device.ospf.neighbors.size).toBe(0);
  });

  it('mismatched area numbers → no adjacency', () => {
    let ls = initLabSession(twoRouterLink());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 1',
    ]);
    expect(asRouter(ls.devices.R1).device.ospf.neighbors.size).toBe(0);
    expect(asRouter(ls.devices.R2).device.ospf.neighbors.size).toBe(0);
  });

  it('interface admin-down → no adjacency even with OSPF configured both sides', () => {
    let ls = initLabSession(twoRouterLink());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
    ]);
    expect(asRouter(ls.devices.R1).device.ospf.neighbors.size).toBe(1);

    // Now shut R1's WAN interface — adjacency must drop.
    ls = runOn(ls, 'R1', ['enable', 'configure terminal', 'interface gi0/2', 'shutdown']);
    expect(asRouter(ls.devices.R1).device.ospf.neighbors.size).toBe(0);
    expect(asRouter(ls.devices.R2).device.ospf.neighbors.size).toBe(0);
  });
});

describe('OSPF — route injection', () => {
  it('FULL neighbor → peer prefixes installed as O routes; show ip route renders them', () => {
    let ls = initLabSession(twoRouterLink());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.1.0 0.0.0.255 area 0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.2.0 0.0.0.255 area 0',
    ]);

    const r1 = asRouter(ls.devices.R1);
    // R1 must have learned R2's LAN 192.168.2.0/24 via 10.0.0.2 on Gi0/2.
    expect(r1.ospfRoutes).toEqual([
      expect.objectContaining({
        prefix: '192.168.2.0',
        mask: '255.255.255.0',
        nextHop: '10.0.0.2',
        egressIface: 'Gi0/2',
        source: 'ospf',
        adminDistance: 110,
        metric: 1,
      }),
    ]);

    // Render — must include the O line with the [110/1] tag.
    const { lastOutput } = runOnWithOutput(ls, 'R1', ['enable', 'show ip route']);
    expect(lastOutput).toMatch(/Codes:.*O - OSPF/);
    expect(lastOutput).toMatch(
      /O\s+192\.168\.2\.0\/24 \[110\/1\] via 10\.0\.0\.2, GigabitEthernet0\/2/,
    );
  });

  it('removing a peer network statement withdraws the learned route AND drops adjacency', () => {
    let ls = initLabSession(twoRouterLink());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.1.0 0.0.0.255 area 0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.2.0 0.0.0.255 area 0',
    ]);
    expect(asRouter(ls.devices.R1).ospfRoutes).toHaveLength(1);

    // Withdraw R2's WAN network statement — adjacency on the shared link
    // is no longer mutually-advertised, so it must drop.
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'no network 10.0.0.0 0.0.0.3 area 0',
    ]);
    expect(asRouter(ls.devices.R1).device.ospf.neighbors.size).toBe(0);
    expect(asRouter(ls.devices.R1).ospfRoutes).toEqual([]);
  });
});

describe('OSPF — passive-interface', () => {
  it('`passive-interface gi0/0` in config-router stores the canonical id', () => {
    let s = configRouter(fresh2iface());
    s = applyCommand(s, 'router ospf 1').session;
    s = applyCommand(s, 'passive-interface gi0/0').session;
    expect(s.device.ospf.passive.has('Gi0/0')).toBe(true);
  });

  it('`no passive-interface gi0/0` clears it', () => {
    let s = configRouter(fresh2iface());
    s = applyCommand(s, 'router ospf 1').session;
    s = applyCommand(s, 'passive-interface gi0/0').session;
    s = applyCommand(s, 'no passive-interface gi0/0').session;
    expect(s.device.ospf.passive.has('Gi0/0')).toBe(false);
  });

  it('rejects an unknown interface with an IOS-style error', () => {
    let s = configRouter(fresh2iface());
    s = applyCommand(s, 'router ospf 1').session;
    const after = applyCommand(s, 'passive-interface gi9/9');
    const text = after.output.map((o) => o.text).join('\n');
    expect(text).toMatch(/% Invalid interface/);
    expect(after.session.device.ospf.passive.size).toBe(0);
  });

  it('`show ip ospf` lists passive interfaces under a Passive Interface(s) block', () => {
    let s = configRouter(fresh2iface());
    s = applyCommand(s, 'interface gi0/0').session;
    s = applyCommand(s, 'ip address 192.168.1.1 255.255.255.0').session;
    s = applyCommand(s, 'no shutdown').session;
    s = applyCommand(s, 'exit').session;
    s = applyCommand(s, 'router ospf 1').session;
    s = applyCommand(s, 'network 192.168.1.0 0.0.0.255 area 0').session;
    s = applyCommand(s, 'passive-interface gi0/0').session;
    const text = applyCommand(s, 'do show ip ospf')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/Passive Interface\(s\):/);
    expect(text).toMatch(/GigabitEthernet0\/0/);
  });

  it('changing the process id clears the passive set', () => {
    let s = configRouter(fresh2iface());
    s = applyCommand(s, 'router ospf 1').session;
    s = applyCommand(s, 'passive-interface gi0/0').session;
    expect(s.device.ospf.passive.size).toBe(1);
    // `router ospf <pid>` only resolves from config, so step back out first.
    s = applyCommand(s, 'exit').session;
    s = applyCommand(s, 'router ospf 2').session;
    expect(s.device.ospf.passive.size).toBe(0);
  });

  it('marking the WAN iface passive on one side drops the FULL adjacency', () => {
    let ls = initLabSession(twoRouterLink());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
    ]);
    expect(asRouter(ls.devices.R1).device.ospf.neighbors.size).toBe(1);
    // Mark the WAN iface passive on R1 — neighbor must drop on both sides.
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'passive-interface gi0/2',
    ]);
    expect(asRouter(ls.devices.R1).device.ospf.neighbors.size).toBe(0);
    expect(asRouter(ls.devices.R2).device.ospf.neighbors.size).toBe(0);
  });

  it('marking only the LAN iface passive leaves the WAN adjacency intact and routes flowing', () => {
    let ls = initLabSession(twoRouterLink());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.1.0 0.0.0.255 area 0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.2.0 0.0.0.255 area 0',
    ]);
    expect(asRouter(ls.devices.R1).device.ospf.neighbors.size).toBe(1);
    // Tag the LAN iface passive on both routers — WAN adjacency unaffected.
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'passive-interface gi0/0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'passive-interface gi0/0',
    ]);
    const r1 = asRouter(ls.devices.R1);
    expect(r1.device.ospf.neighbors.size).toBe(1);
    expect(r1.ospfRoutes).toEqual([
      expect.objectContaining({
        prefix: '192.168.2.0',
        mask: '255.255.255.0',
        source: 'ospf',
      }),
    ]);
  });

  it('show running-config emits the router ospf block with network + passive-interface lines', () => {
    let ls = initLabSession(twoRouterLink());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 192.168.1.0 0.0.0.255 area 0',
      'passive-interface gi0/0',
    ]);
    const { lastOutput } = runOnWithOutput(ls, 'R1', ['enable', 'show running-config']);
    expect(lastOutput).toMatch(/router ospf 1/);
    expect(lastOutput).toMatch(/ network 192\.168\.1\.0 0\.0\.0\.255 area 0/);
    expect(lastOutput).toMatch(/ passive-interface GigabitEthernet0\/0/);
  });
});

describe('OSPF — interface hello/dead timers (config-if)', () => {
  function ifaceConfig(s: Session, iface: string): Session {
    return applyCommand(configRouter(s), `interface ${iface}`).session;
  }

  it('`ip ospf hello-interval 5` stores the override on the interface', () => {
    const s = applyCommand(ifaceConfig(fresh2iface(), 'gi0/2'), 'ip ospf hello-interval 5').session;
    expect(s.device.interfaces['Gi0/2'].ospfHelloInterval).toBe(5);
  });

  it('`ip ospf dead-interval 20` stores the override on the interface', () => {
    const s = applyCommand(ifaceConfig(fresh2iface(), 'gi0/2'), 'ip ospf dead-interval 20').session;
    expect(s.device.interfaces['Gi0/2'].ospfDeadInterval).toBe(20);
  });

  it('`no ip ospf hello-interval` resets to default (clears the override)', () => {
    let s = applyCommand(ifaceConfig(fresh2iface(), 'gi0/2'), 'ip ospf hello-interval 5').session;
    s = applyCommand(s, 'no ip ospf hello-interval').session;
    expect(s.device.interfaces['Gi0/2'].ospfHelloInterval).toBeUndefined();
  });

  it('rejects an out-of-range interval with an IOS-style error', () => {
    const after = applyCommand(ifaceConfig(fresh2iface(), 'gi0/2'), 'ip ospf hello-interval 70000');
    const text = after.output.map((o) => o.text).join('\n');
    expect(text).toMatch(/% Invalid input detected/);
    expect(after.session.device.interfaces['Gi0/2'].ospfHelloInterval).toBeUndefined();
  });

  it('rejects a zero interval', () => {
    const after = applyCommand(ifaceConfig(fresh2iface(), 'gi0/2'), 'ip ospf hello-interval 0');
    expect(after.output.map((o) => o.text).join('\n')).toMatch(/% Invalid input detected/);
    expect(after.session.device.interfaces['Gi0/2'].ospfHelloInterval).toBeUndefined();
  });
});

describe('OSPF — timer mismatch suppresses adjacency', () => {
  function bothConfigured(): LabSession {
    let ls = initLabSession(twoRouterLink());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.1.0 0.0.0.255 area 0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.2.0 0.0.0.255 area 0',
    ]);
    return ls;
  }

  it('matching defaults on both ends → adjacency forms (baseline)', () => {
    const ls = bothConfigured();
    expect(asRouter(ls.devices.R1).device.ospf.neighbors.size).toBe(1);
  });

  it('mismatched hello-interval on one end → no adjacency', () => {
    let ls = bothConfigured();
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'ip ospf hello-interval 5',
    ]);
    expect(asRouter(ls.devices.R1).device.ospf.neighbors.size).toBe(0);
    expect(asRouter(ls.devices.R2).device.ospf.neighbors.size).toBe(0);
  });

  it('mismatched dead-interval on one end → no adjacency', () => {
    let ls = bothConfigured();
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'ip ospf dead-interval 20',
    ]);
    expect(asRouter(ls.devices.R1).device.ospf.neighbors.size).toBe(0);
  });

  it('aligning the timers back to match re-forms the adjacency', () => {
    let ls = bothConfigured();
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'ip ospf hello-interval 5',
      'ip ospf dead-interval 20',
    ]);
    expect(asRouter(ls.devices.R1).device.ospf.neighbors.size).toBe(0);
    // Match R1's defaults by resetting R2's overrides.
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'no ip ospf hello-interval',
      'no ip ospf dead-interval',
    ]);
    expect(asRouter(ls.devices.R1).device.ospf.neighbors.size).toBe(1);
  });

  it('explicitly setting BOTH ends to the same non-default values forms adjacency', () => {
    let ls = bothConfigured();
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'ip ospf hello-interval 5',
      'ip ospf dead-interval 20',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'interface gi0/2',
      'ip ospf hello-interval 5',
      'ip ospf dead-interval 20',
    ]);
    expect(asRouter(ls.devices.R1).device.ospf.neighbors.size).toBe(1);
  });
});

describe('OSPF — show ip ospf interface', () => {
  function r1WithTimers(): LabSession {
    let ls = initLabSession(twoRouterLink());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.1.0 0.0.0.255 area 0',
      'exit',
      'interface gi0/2',
      'ip ospf hello-interval 5',
      'ip ospf dead-interval 20',
    ]);
    return ls;
  }

  it('per-interface form prints the Timer intervals line with the overridden values', () => {
    const { lastOutput } = runOnWithOutput(r1WithTimers(), 'R1', [
      'enable',
      'show ip ospf interface gi0/2',
    ]);
    expect(lastOutput).toMatch(/GigabitEthernet0\/2 is up, line protocol is up/);
    expect(lastOutput).toMatch(/Internet Address 10\.0\.0\.1\/30, Area 0/);
    expect(lastOutput).toMatch(/Timer intervals configured, Hello 5, Dead 20/);
  });

  it('an OSPF interface with no override shows the protocol defaults (Hello 10, Dead 40)', () => {
    let ls = initLabSession(twoRouterLink());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 192.168.1.0 0.0.0.255 area 0',
    ]);
    const { lastOutput } = runOnWithOutput(ls, 'R1', [
      'enable',
      'show ip ospf interface gi0/0',
    ]);
    expect(lastOutput).toMatch(/Timer intervals configured, Hello 10, Dead 40/);
  });

  it('bare form lists every OSPF-enabled interface', () => {
    const { lastOutput } = runOnWithOutput(r1WithTimers(), 'R1', [
      'enable',
      'show ip ospf interface',
    ]);
    expect(lastOutput).toMatch(/GigabitEthernet0\/0 is/);
    expect(lastOutput).toMatch(/GigabitEthernet0\/2 is/);
  });

  it('show running-config emits the non-default ip ospf timer lines', () => {
    const { lastOutput } = runOnWithOutput(r1WithTimers(), 'R1', [
      'enable',
      'show running-config',
    ]);
    expect(lastOutput).toMatch(/ ip ospf hello-interval 5/);
    expect(lastOutput).toMatch(/ ip ospf dead-interval 20/);
  });
});

describe('OSPF — show ip ospf neighbor output', () => {
  it('renders FULL/DR for the elected broadcast neighbor and the iface long-form', () => {
    let ls = initLabSession(twoRouterLink());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.1.0 0.0.0.255 area 0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.2.0 0.0.0.255 area 0',
    ]);
    const { lastOutput } = runOnWithOutput(ls, 'R1', ['enable', 'show ip ospf neighbor']);
    expect(lastOutput).toMatch(/Neighbor ID\s+Pri\s+State\s+Dead Time\s+Address\s+Interface/);
    // R2's router-id (192.168.2.1) is higher than R1's (192.168.1.1), so R2 is
    // the DR on the broadcast WAN segment — R1 sees the neighbor as FULL/DR.
    expect(lastOutput).toMatch(/FULL\/DR/);
    expect(lastOutput).toMatch(/10\.0\.0\.2\s+GigabitEthernet0\/2/);
  });

  it('prints the IOS header (no data rows) when the table is empty', () => {
    const ls = initLabSession(twoRouterLink());
    const { lastOutput } = runOnWithOutput(ls, 'R1', ['enable', 'show ip ospf neighbor']);
    // IOS prints the table header even with no neighbors — Lab 13 (OSPF
    // tshoot) keys its learner's diagnosis off seeing the empty header.
    expect(lastOutput).toMatch(/Neighbor ID\s+Pri\s+State\s+Dead Time\s+Address\s+Interface/);
    expect(lastOutput).not.toMatch(/FULL/);
  });
});

describe('OSPF — default-information originate (Lab 21)', () => {
  // Both routers up + adjacent in area 0. R1 is the would-be originator.
  function bothAdjacent(): LabSession {
    let ls = initLabSession(twoRouterLink());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.1.0 0.0.0.255 area 0',
    ]);
    ls = runOn(ls, 'R2', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'network 10.0.0.0 0.0.0.3 area 0',
      'network 192.168.2.0 0.0.0.255 area 0',
    ]);
    return ls;
  }

  function hasDefault(ls: LabSession, id: string): boolean {
    const r = asRouter(ls.devices[id]);
    return r.ospfRoutes.some((rt) => rt.prefix === '0.0.0.0' && rt.mask === '0.0.0.0');
  }

  it('`default-information originate` stores the flag in config-router', () => {
    let s = configRouter(fresh2iface());
    s = applyCommand(s, 'router ospf 1').session;
    s = applyCommand(s, 'default-information originate').session;
    expect(s.device.ospf.defaultInfoOriginate).toBe(true);
    expect(s.device.ospf.defaultInfoAlways).toBe(false);
  });

  it('`default-information originate always` sets both flags', () => {
    let s = configRouter(fresh2iface());
    s = applyCommand(s, 'router ospf 1').session;
    s = applyCommand(s, 'default-information originate always').session;
    expect(s.device.ospf.defaultInfoOriginate).toBe(true);
    expect(s.device.ospf.defaultInfoAlways).toBe(true);
  });

  it('`no default-information originate` clears both flags', () => {
    let s = configRouter(fresh2iface());
    s = applyCommand(s, 'router ospf 1').session;
    s = applyCommand(s, 'default-information originate always').session;
    s = applyCommand(s, 'no default-information originate').session;
    expect(s.device.ospf.defaultInfoOriginate).toBe(false);
    expect(s.device.ospf.defaultInfoAlways).toBe(false);
  });

  it('originate WITHOUT a default route in the RIB advertises nothing', () => {
    let ls = bothAdjacent();
    // R1 has no static default, so default-information originate (no `always`)
    // must NOT inject a default into R2.
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'default-information originate',
    ]);
    expect(hasDefault(ls, 'R2')).toBe(false);
  });

  it('originate WITH a default route injects an O*E2 default into the neighbor', () => {
    let ls = bothAdjacent();
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'ip route 0.0.0.0 0.0.0.0 192.168.1.2',
      'router ospf 1',
      'default-information originate',
    ]);
    const r2 = asRouter(ls.devices.R2);
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
    // The originator does NOT install a self-learned default.
    expect(hasDefault(ls, 'R1')).toBe(false);
  });

  it('the `always` keyword originates the default even with no default route', () => {
    let ls = bothAdjacent();
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'default-information originate always',
    ]);
    expect(hasDefault(ls, 'R2')).toBe(true);
  });

  it('removing the default route withdraws the originated default (no `always`)', () => {
    let ls = bothAdjacent();
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'ip route 0.0.0.0 0.0.0.0 192.168.1.2',
      'router ospf 1',
      'default-information originate',
    ]);
    expect(hasDefault(ls, 'R2')).toBe(true);
    // Pull the static default — origination condition no longer holds.
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'no ip route 0.0.0.0 0.0.0.0 192.168.1.2',
    ]);
    expect(hasDefault(ls, 'R2')).toBe(false);
  });

  it('show running-config emits the default-information originate line', () => {
    let ls = bothAdjacent();
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'default-information originate',
    ]);
    const { lastOutput } = runOnWithOutput(ls, 'R1', ['enable', 'show running-config']);
    expect(lastOutput).toMatch(/ default-information originate/);
  });
});
