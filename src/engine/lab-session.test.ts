import { describe, it, expect } from 'vitest';
import {
  initLabSession,
  applyToActive,
  setActive,
  activeSession,
  activePrompt,
  adapterFor,
  type LabSession,
} from './lab-session';
import type { Lab } from './types';

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
      const s = ls.devices[id];
      expect(s.kind).toBe('router');
      expect(s.mode).toBe('user');
      expect(s.device.id).toBe(id);
      expect(s.history).toEqual([]);
    }
  });

  it('rejects unsupported device kinds with a clear error (3b/3c gating)', () => {
    expect(() => adapterFor('switch')).toThrow(/switch.*not yet supported/);
    expect(() => adapterFor('pc')).toThrow(/pc.*not yet supported/);
  });
});

describe('lab-session — applyToActive routes commands to the active device only', () => {
  it('mutates R1 when R1 is active, leaves R2 untouched (independent state machines)', () => {
    const initial = initLabSession(twoRouterLab());
    const after = applyToActive(initial, 'enable').session;

    expect(after.devices.R1.mode).toBe('priv');
    expect(after.devices.R2.mode).toBe('user'); // unchanged
    expect(after.devices.R1.history).toEqual(['enable']);
    expect(after.devices.R2.history).toEqual([]);
    // Original LabSession not mutated.
    expect(initial.devices.R1.mode).toBe('user');
  });

  it('after setActive(R2), commands target R2 only', () => {
    let ls = initLabSession(twoRouterLab());
    ls = applyToActive(ls, 'enable').session; // R1 → priv
    ls = setActive(ls, 'R2');
    ls = applyToActive(ls, 'enable').session; // R2 → priv

    expect(ls.devices.R1.mode).toBe('priv');
    expect(ls.devices.R2.mode).toBe('priv');
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
    expect(ls.devices.R1.mode).toBe('config');
    // R2's separate state intact too.
    expect(ls.devices.R2.history).toEqual(['enable']);
    expect(ls.devices.R2.mode).toBe('priv');
  });

  it('activePrompt + activeSession follow the active device', () => {
    let ls = initLabSession(twoRouterLab());
    expect(activePrompt(ls)).toBe('R1>');
    ls = applyToActive(ls, 'enable').session;
    expect(activePrompt(ls)).toBe('R1#');
    ls = setActive(ls, 'R2');
    expect(activePrompt(ls)).toBe('R2>'); // R2 was never enabled
    expect(activeSession(ls).device.id).toBe('R2');
  });

  it('setActive throws on unknown device id', () => {
    const ls = initLabSession(twoRouterLab());
    expect(() => setActive(ls, 'R9')).toThrow(/unknown device id/);
  });
});

describe('lab-session — N=1 free lab path is unchanged', () => {
  it('one-device LabSession applies commands like the legacy Session', () => {
    let ls: LabSession = initLabSession(oneRouterLab());
    for (const line of ['enable', 'configure terminal', 'interface gi0/0', 'no shutdown']) {
      ls = applyToActive(ls, line).session;
    }
    expect(ls.devices.R1.mode).toBe('config-if');
    expect(ls.devices.R1.device.interfaces['Gi0/0'].adminUp).toBe(true);
  });
});
