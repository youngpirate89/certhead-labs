import { describe, it, expect } from 'vitest';
import {
  initLabSession,
  applyToActive,
  setActive,
  updatePcNetwork,
  activeSession,
  activePrompt,
  adapterFor,
  type DeviceSession,
  type LabSession,
} from './lab-session';
import type { Session as RouterSession } from './adapters/ios/state';
import type { Lab } from './types';

/** Narrowing helper for tests that need router internals. */
function asRouter(s: DeviceSession): RouterSession {
  if (s.kind !== 'router') throw new Error(`expected router, got ${s.kind}`);
  return s;
}

const ROUTER = { kind: 'router' as const, platform: 'ISR4321' };

function twoRouterLab(): Lab {
  return {
    id: 'test-2r',
    title: '2-router fixture',
    exam: 'TEST',
    difficulty: 1,
    estimatedMinutes: 1,
    isFree: false,
    scenario: 'fixture',
    topology: {
      devices: [
        { id: 'R1', interfaces: ['Gi0/0'], ...ROUTER },
        { id: 'R2', interfaces: ['Gi0/0'], ...ROUTER },
      ],
      links: [
        {
          a: { deviceId: 'R1', iface: 'Gi0/0' },
          b: { deviceId: 'R2', iface: 'Gi0/0' },
        },
      ],
    },
    objectives: [],
    hints: [],
  };
}

function oneRouterLab(): Lab {
  return {
    id: 'test-1r',
    title: '1-router fixture',
    exam: 'TEST',
    difficulty: 1,
    estimatedMinutes: 1,
    isFree: false,
    scenario: 'fixture',
    topology: {
      devices: [{ id: 'R1', interfaces: ['Gi0/0'], ...ROUTER }],
      links: [],
    },
    objectives: [],
    hints: [],
  };
}

describe('lab-session — init', () => {
  it('builds one DeviceSession per lab device, first device active', () => {
    const ls = initLabSession(twoRouterLab());
    expect(Object.keys(ls.devices)).toEqual(['R1', 'R2']);
    expect(ls.activeDeviceId).toBe('R1');
    expect(ls.links).toHaveLength(1);
  });

  it('N=1 lab collapses to a single device session', () => {
    const ls = initLabSession(oneRouterLab());
    expect(Object.keys(ls.devices)).toEqual(['R1']);
    expect(ls.activeDeviceId).toBe('R1');
    expect(ls.links).toEqual([]);
  });

  it('every device session is at the fresh router boot state', () => {
    const ls = initLabSession(twoRouterLab());
    for (const id of ['R1', 'R2']) {
      const s = asRouter(ls.devices[id]);
      expect(s.kind).toBe('router');
      expect(s.mode).toBe('user');
      expect(s.device.id).toBe(id);
      expect(s.history).toEqual([]);
    }
  });

  it('resolves an adapter for every supported device kind (router/pc/switch)', () => {
    // pc landed in 3b, switch in Session 1 of the switch build. router has
    // been here since 3a. All three must return an adapter whose kind
    // matches its registration.
    expect(adapterFor('router').kind).toBe('router');
    expect(adapterFor('pc').kind).toBe('pc');
    expect(adapterFor('switch').kind).toBe('switch');
  });
});

describe('lab-session — applyToActive routes commands to the active device only', () => {
  it('mutates R1 when R1 is active, leaves R2 untouched (independent state machines)', () => {
    const initial = initLabSession(twoRouterLab());
    const after = applyToActive(initial, 'enable').session;

    expect(asRouter(after.devices.R1).mode).toBe('priv');
    expect(asRouter(after.devices.R2).mode).toBe('user'); // unchanged
    expect(after.devices.R1.history).toEqual(['enable']);
    expect(after.devices.R2.history).toEqual([]);
    // Original LabSession not mutated.
    expect(asRouter(initial.devices.R1).mode).toBe('user');
  });

  it('after setActive(R2), commands target R2 only', () => {
    let ls = initLabSession(twoRouterLab());
    ls = applyToActive(ls, 'enable').session; // R1 → priv
    ls = setActive(ls, 'R2');
    ls = applyToActive(ls, 'enable').session; // R2 → priv

    expect(asRouter(ls.devices.R1).mode).toBe('priv');
    expect(asRouter(ls.devices.R2).mode).toBe('priv');
    expect(ls.devices.R1.history).toEqual(['enable']);
    expect(ls.devices.R2.history).toEqual(['enable']);
  });

  it('preserves per-device histories across active-device switches', () => {
    let ls = initLabSession(twoRouterLab());
    ls = applyToActive(ls, 'enable').session;
    ls = applyToActive(ls, 'configure terminal').session;
    ls = setActive(ls, 'R2');
    ls = applyToActive(ls, 'enable').session;
    ls = setActive(ls, 'R1');

    // R1's history intact after the round-trip.
    expect(ls.devices.R1.history).toEqual(['enable', 'configure terminal']);
    expect(asRouter(ls.devices.R1).mode).toBe('config');
    // R2's separate state intact too.
    expect(ls.devices.R2.history).toEqual(['enable']);
    expect(asRouter(ls.devices.R2).mode).toBe('priv');
  });

  it('activePrompt + activeSession follow the active device', () => {
    let ls = initLabSession(twoRouterLab());
    expect(activePrompt(ls)).toBe('R1>');
    ls = applyToActive(ls, 'enable').session;
    expect(activePrompt(ls)).toBe('R1#');
    ls = setActive(ls, 'R2');
    expect(activePrompt(ls)).toBe('R2>'); // R2 was never enabled
    expect(asRouter(activeSession(ls)).device.id).toBe('R2');
  });

  it('setActive throws on unknown device id', () => {
    const ls = initLabSession(twoRouterLab());
    expect(() => setActive(ls, 'R9')).toThrow(/unknown device id/);
  });
});

describe('lab-session — pc adapter wired in (3b)', () => {
  function pcRouterLab(initialPcConfig?: { ip: string; mask: string; gateway: string }): Lab {
    return {
      id: 'test-pc-router',
      title: 'PC-Router fixture',
      exam: 'TEST',
      difficulty: 1,
      estimatedMinutes: 1,
      isFree: false,
      scenario: 'fixture',
      topology: {
        devices: [
          { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0'] },
          {
            id: 'PC-A',
            kind: 'pc',
            platform: 'Workstation',
            interfaces: ['Eth0'],
            pc: initialPcConfig,
          },
        ],
        links: [
          {
            a: { deviceId: 'R1', iface: 'Gi0/0' },
            b: { deviceId: 'PC-A', iface: 'Eth0' },
          },
        ],
      },
      objectives: [],
      hints: [],
    };
  }

  it('initLabSession builds a PcSession alongside a RouterSession', () => {
    const ls = initLabSession(
      pcRouterLab({ ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' }),
    );
    expect(ls.devices.PC_A?.kind ?? ls.devices['PC-A'].kind).toBe('pc');
    const pc = ls.devices['PC-A'];
    if (pc.kind !== 'pc') throw new Error('expected pc kind');
    expect(pc.ip).toBe('192.168.1.10');
    expect(pc.mask).toBe('255.255.255.0');
    expect(pc.gateway).toBe('192.168.1.1');
  });

  it('PC nicUp starts false (neighbor interface is admin-down by default)', () => {
    const ls = initLabSession(pcRouterLab());
    const pc = ls.devices['PC-A'];
    if (pc.kind !== 'pc') throw new Error('expected pc kind');
    expect(pc.nicUp).toBe(false);
  });

  it('PC nicUp flips to true when the cabled router interface comes admin-up', () => {
    let ls = initLabSession(pcRouterLab());
    ls = applyToActive(ls, 'enable').session;
    ls = applyToActive(ls, 'configure terminal').session;
    ls = applyToActive(ls, 'interface gi0/0').session;
    ls = applyToActive(ls, 'no shutdown').session;
    const pc = ls.devices['PC-A'];
    if (pc.kind !== 'pc') throw new Error('expected pc kind');
    expect(pc.nicUp).toBe(true);
  });

  it('PC nicUp flips back to false when the neighbor goes admin-down', () => {
    let ls = initLabSession(pcRouterLab());
    ls = applyToActive(ls, 'enable').session;
    ls = applyToActive(ls, 'configure terminal').session;
    ls = applyToActive(ls, 'interface gi0/0').session;
    ls = applyToActive(ls, 'no shutdown').session;
    {
      const pc = ls.devices['PC-A'];
      if (pc.kind !== 'pc') throw new Error('expected pc kind');
      expect(pc.nicUp).toBe(true);
    }
    ls = applyToActive(ls, 'shutdown').session;
    const pc = ls.devices['PC-A'];
    if (pc.kind !== 'pc') throw new Error('expected pc kind');
    expect(pc.nicUp).toBe(false);
  });

  it('commands targeting the PC do not affect the router', () => {
    let ls = initLabSession(pcRouterLab());
    ls = setActive(ls, 'PC-A');
    ls = applyToActive(ls, 'ip 192.168.1.10 255.255.255.0').session;
    const pc = ls.devices['PC-A'];
    const r1 = ls.devices.R1;
    if (pc.kind !== 'pc' || r1.kind !== 'router') throw new Error('shape');
    expect(pc.ip).toBe('192.168.1.10');
    // R1 untouched.
    expect(r1.mode).toBe('user');
    expect(r1.history).toEqual([]);
  });

  it('updatePcNetwork applies static GUI settings to a PC without touching router state', () => {
    const initial = initLabSession(pcRouterLab());
    const after = updatePcNetwork(initial, 'PC-A', {
      mode: 'static',
      ip: '192.168.1.20',
      mask: '255.255.255.0',
      gateway: '192.168.1.1',
      ipv6: '2001:db8:acad:10::20/64',
      gateway6: '2001:db8:acad:10::1',
    });

    const pc = after.devices['PC-A'];
    const r1 = after.devices.R1;
    if (pc.kind !== 'pc' || r1.kind !== 'router') throw new Error('shape');
    expect(pc.dhcpMode).toBe(false);
    expect(pc.ip).toBe('192.168.1.20');
    expect(pc.mask).toBe('255.255.255.0');
    expect(pc.gateway).toBe('192.168.1.1');
    expect(pc.ipv6).toBe('2001:db8:acad:10::20/64');
    expect(pc.gateway6).toBe('2001:db8:acad:10::1');
    expect(r1.history).toEqual([]);
    expect(initial.devices['PC-A']).not.toBe(pc);
  });

  it('updatePcNetwork switches a PC to DHCP mode and clears stale static values', () => {
    const initial = initLabSession(
      pcRouterLab({ ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' }),
    );
    const after = updatePcNetwork(initial, 'PC-A', { mode: 'dhcp' });
    const pc = after.devices['PC-A'];
    if (pc.kind !== 'pc') throw new Error('expected pc kind');
    expect(pc.dhcpMode).toBe(true);
    expect(pc.ip).toBeNull();
    expect(pc.mask).toBeNull();
    expect(pc.gateway).toBeNull();
  });
});

describe('lab-session — N=1 free lab path is unchanged', () => {
  it('one-device LabSession applies commands like the legacy Session', () => {
    let ls: LabSession = initLabSession(oneRouterLab());
    for (const line of ['enable', 'configure terminal', 'interface gi0/0', 'no shutdown']) {
      ls = applyToActive(ls, line).session;
    }
    const r1 = asRouter(ls.devices.R1);
    expect(r1.mode).toBe('config-if');
    expect(r1.device.interfaces['Gi0/0'].adminUp).toBe(true);
  });
});

describe('lab-session — Lab.setup seeds device state without recording history', () => {
  function seededLab(setup: Record<string, readonly string[]>): Lab {
    return {
      id: 'test-setup',
      title: 'setup fixture',
      exam: 'TEST',
      difficulty: 1,
      estimatedMinutes: 1,
      isFree: false,
      scenario: 'fixture',
      topology: {
        devices: [
          { id: 'R1', interfaces: ['Gi0/0', 'Gi0/1'], ...ROUTER },
          { id: 'R2', interfaces: ['Gi0/0', 'Gi0/1'], ...ROUTER },
        ],
        links: [
          { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
        ],
      },
      setup,
      objectives: [],
      hints: [],
    };
  }

  it('seeded commands land in device state but NOT in command history', () => {
    // Mix mode-transition + config-mode commands. The `ip route` line is the
    // critical one — it exercises the dispatch push at interpret.ts (gated on
    // record:false). If the gate leaks, the resolved history will pick it up.
    const ls = initLabSession(
      seededLab({
        R1: [
          'enable',
          'configure terminal',
          'interface gi0/0',
          'ip address 192.168.12.1 255.255.255.252',
          'no shutdown',
          'exit',
          'ip route 192.168.2.0 255.255.255.0 192.168.12.2',
        ],
      }),
    );

    const r1 = asRouter(ls.devices.R1);

    // State landed: interface configured + admin-up, static route present.
    const gi00 = r1.device.interfaces['Gi0/0'];
    expect(gi00.ip).toBe('192.168.12.1');
    expect(gi00.mask).toBe('255.255.255.252');
    expect(gi00.adminUp).toBe(true);
    expect(r1.staticRoutes).toHaveLength(1);
    expect(r1.staticRoutes[0]).toMatchObject({
      prefix: '192.168.2.0',
      mask: '255.255.255.0',
      nextHop: '192.168.12.2',
      source: 'static',
      adminDistance: 1,
    });
  });

  it('seed: no leak in history.raw or history.resolved (config-mode commands included)', () => {
    const ls = initLabSession(
      seededLab({
        R1: [
          'enable',
          'configure terminal',
          'interface gi0/0',
          'ip address 192.168.12.1 255.255.255.252',
          'no shutdown',
          'exit',
          'ip route 192.168.2.0 255.255.255.0 192.168.12.2',
        ],
      }),
    );

    const r1 = asRouter(ls.devices.R1);
    expect(r1.history).toEqual([]);
    expect(r1.resolvedHistory).toEqual([]);
  });

  it('seed leaves the device at the user-mode prompt regardless of last seed command', () => {
    const ls = initLabSession(
      seededLab({
        // Last seed line is a config-mode command — without the end/disable
        // tail the session would otherwise be left in `config` mode.
        R1: ['enable', 'configure terminal', 'ip route 10.0.0.0 255.0.0.0 192.168.12.2'],
      }),
    );

    const r1 = asRouter(ls.devices.R1);
    expect(r1.mode).toBe('user');
    expect(r1.currentInterface).toBe(null);
    // Verify the static route still landed (the tail must not undo state).
    expect(r1.staticRoutes).toHaveLength(1);
    expect(r1.staticRoutes[0].prefix).toBe('10.0.0.0');
  });

  it('only seeds devices listed in setup — unseeded devices stay fresh', () => {
    const ls = initLabSession(
      seededLab({
        R1: ['enable', 'configure terminal', 'interface gi0/0', 'no shutdown'],
      }),
    );
    const r1 = asRouter(ls.devices.R1);
    const r2 = asRouter(ls.devices.R2);
    expect(r1.device.interfaces['Gi0/0'].adminUp).toBe(true);
    expect(r2.device.interfaces['Gi0/0'].adminUp).toBe(false);
    expect(r2.staticRoutes).toEqual([]);
    expect(r2.history).toEqual([]);
  });

  it('throws when setup references an unknown device id', () => {
    expect(() =>
      initLabSession(seededLab({ R9: ['enable'] })),
    ).toThrow(/unknown device 'R9'/);
  });

  it('learner-typed commands after seeding ARE recorded as normal', () => {
    let ls: LabSession = initLabSession(
      seededLab({ R1: ['enable', 'configure terminal', 'interface gi0/0', 'no shutdown'] }),
    );
    // Learner picks up at R1 user prompt; their commands get recorded.
    ls = applyToActive(ls, 'enable').session;
    expect(ls.devices.R1.history).toEqual(['enable']);
    expect(ls.devices.R1.resolvedHistory).toEqual(['enable']);
  });
});
