import { describe, it, expect } from 'vitest';
import { applyCommand } from './interpret';
import { createSession, buildDevice, type Session } from './state';
import {
  initLabSession,
  applyToActive,
  setActive,
  type LabSession,
} from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import type { Lab } from '@/engine/types';
import { evaluateAcl, matchesEntry } from './acl';

/**
 * Standard numbered ACL — engine tests.
 *
 * Three layers:
 *   1. Pure evaluator (`evaluateAcl`, `matchesEntry`) — bit-level matching.
 *   2. Per-router state mutation — `access-list` / `ip access-group` lines
 *      modify acls/accessGroups correctly through applyCommand.
 *   3. Topology-level — canReach surfaces `acl-deny` with the FailPoint shape
 *      that the `[sim]` sentence relies on.
 */

// ---------- Layer 1: evaluator -------------------------------------------

describe('ACL evaluator — matchesEntry', () => {
  it('host (wildcard:null) matches exact IP only', () => {
    const entry = { sequence: 10, action: 'permit' as const, source: '192.168.1.10', wildcard: null };
    expect(matchesEntry(entry, '192.168.1.10')).toBe(true);
    expect(matchesEntry(entry, '192.168.1.11')).toBe(false);
    expect(matchesEntry(entry, '192.168.2.10')).toBe(false);
  });

  it('any (wildcard 255.255.255.255) matches every IP', () => {
    const entry = {
      sequence: 10,
      action: 'permit' as const,
      source: '0.0.0.0',
      wildcard: '255.255.255.255',
    };
    expect(matchesEntry(entry, '0.0.0.0')).toBe(true);
    expect(matchesEntry(entry, '192.168.1.42')).toBe(true);
    expect(matchesEntry(entry, '255.255.255.255')).toBe(true);
  });

  it('subnet + wildcard matches the /24 it describes', () => {
    const entry = {
      sequence: 10,
      action: 'permit' as const,
      source: '192.168.1.0',
      wildcard: '0.0.0.255',
    };
    expect(matchesEntry(entry, '192.168.1.0')).toBe(true);
    expect(matchesEntry(entry, '192.168.1.10')).toBe(true);
    expect(matchesEntry(entry, '192.168.1.255')).toBe(true);
    expect(matchesEntry(entry, '192.168.2.10')).toBe(false);
  });
});

describe('ACL evaluator — first-match-wins + implicit deny', () => {
  it('first matching entry wins (deny host then permit subnet → host denied)', () => {
    const acl = {
      number: 1,
      type: 'standard' as const,
      entries: [
        { sequence: 10, action: 'deny' as const, source: '192.168.1.10', wildcard: null },
        { sequence: 20, action: 'permit' as const, source: '192.168.1.0', wildcard: '0.0.0.255' },
      ],
    };
    expect(evaluateAcl(acl, '192.168.1.10')).toBe('deny');
    expect(evaluateAcl(acl, '192.168.1.11')).toBe('permit');
  });

  it('implicit deny when no entry matches', () => {
    const acl = {
      number: 1,
      type: 'standard' as const,
      entries: [
        { sequence: 10, action: 'permit' as const, source: '10.0.0.0', wildcard: '0.0.0.255' },
      ],
    };
    expect(evaluateAcl(acl, '192.168.1.10')).toBe('deny');
  });

  it('empty ACL = implicit deny for every source', () => {
    const acl = { number: 1, type: 'standard' as const, entries: [] };
    expect(evaluateAcl(acl, '10.0.0.1')).toBe('deny');
    expect(evaluateAcl(acl, '192.168.1.1')).toBe('deny');
  });
});

// ---------- Layer 2: per-router state mutation ---------------------------

function fresh(): Session {
  return createSession(buildDevice({ id: 'R1', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] }));
}

function inConfig(s: Session): Session {
  return ['enable', 'configure terminal'].reduce(
    (acc, line) => applyCommand(acc, line).session,
    s,
  );
}

describe('access-list command — state mutation', () => {
  it('`access-list 1 permit 192.168.1.0 0.0.0.255` creates ACL 1 with one entry', () => {
    const s = applyCommand(inConfig(fresh()), 'access-list 1 permit 192.168.1.0 0.0.0.255').session;
    const acl = s.device.acls.get(1);
    expect(acl).toBeDefined();
    expect(acl?.type).toBe('standard');
    expect(acl?.entries).toEqual([
      { sequence: 10, action: 'permit', source: '192.168.1.0', wildcard: '0.0.0.255' },
    ]);
  });

  it('`access-list 1 deny host 192.168.1.10` records wildcard:null (host form)', () => {
    const s = applyCommand(inConfig(fresh()), 'access-list 1 deny host 192.168.1.10').session;
    const acl = s.device.acls.get(1);
    expect(acl?.entries[0]).toEqual({
      sequence: 10,
      action: 'deny',
      source: '192.168.1.10',
      wildcard: null,
    });
  });

  it('`access-list 1 permit any` records 0.0.0.0 / 255.255.255.255', () => {
    const s = applyCommand(inConfig(fresh()), 'access-list 1 permit any').session;
    expect(s.device.acls.get(1)?.entries[0]).toEqual({
      sequence: 10,
      action: 'permit',
      source: '0.0.0.0',
      wildcard: '255.255.255.255',
    });
  });

  it('successive entries auto-number in sequence 10, 20, 30', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'access-list 1 deny host 192.168.1.10').session;
    s = applyCommand(s, 'access-list 1 permit 192.168.1.0 0.0.0.255').session;
    s = applyCommand(s, 'access-list 1 deny any').session;
    expect(s.device.acls.get(1)?.entries.map((e) => e.sequence)).toEqual([10, 20, 30]);
  });

  it('`no access-list 1` removes the entire ACL', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'access-list 1 permit any').session;
    s = applyCommand(s, 'no access-list 1').session;
    expect(s.device.acls.has(1)).toBe(false);
  });

  it('rejects an out-of-range ACL number with the IOS caret error', () => {
    const out = applyCommand(inConfig(fresh()), 'access-list 200 permit any').output;
    expect(out[0].text).toMatch(/Invalid input/);
    // ACL must not be created.
    const s = applyCommand(inConfig(fresh()), 'access-list 200 permit any').session;
    expect(s.device.acls.size).toBe(0);
  });

  it('prefix-match: `acc` resolves to `access-list`', () => {
    const s = applyCommand(inConfig(fresh()), 'acc 1 permit any').session;
    expect(s.device.acls.get(1)).toBeDefined();
  });
});

describe('ip access-group command — interface binding', () => {
  function configIf(): Session {
    let s = inConfig(fresh());
    s = applyCommand(s, 'interface gi0/1').session;
    return s;
  }

  it('`ip access-group 1 out` sets accessGroups.out = 1', () => {
    const s = applyCommand(configIf(), 'ip access-group 1 out').session;
    expect(s.device.interfaces['Gi0/1'].accessGroups.out).toBe(1);
    expect(s.device.interfaces['Gi0/1'].accessGroups.in).toBeNull();
  });

  it('`ip access-group 5 in` sets accessGroups.in = 5', () => {
    const s = applyCommand(configIf(), 'ip access-group 5 in').session;
    expect(s.device.interfaces['Gi0/1'].accessGroups.in).toBe(5);
  });

  it('`no ip access-group 1 out` clears the outbound binding', () => {
    let s = applyCommand(configIf(), 'ip access-group 1 out').session;
    s = applyCommand(s, 'no ip access-group 1 out').session;
    expect(s.device.interfaces['Gi0/1'].accessGroups.out).toBeNull();
  });

  it('prefix-match: `ip acc 1 o` resolves to `ip access-group 1 out`', () => {
    const s = applyCommand(configIf(), 'ip acc 1 o').session;
    expect(s.device.interfaces['Gi0/1'].accessGroups.out).toBe(1);
  });
});

// ---------- Layer 3: show output -----------------------------------------

describe('show access-lists output', () => {
  it('prints the IOS empty-case sentence when no ACLs are configured', () => {
    const out = applyCommand(fresh(), 'show access-lists').output;
    expect(out.map((o) => o.text).join('\n')).toMatch(/There are no access lists\./);
  });

  it('renders subnet, host, and any forms distinctly', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'access-list 1 deny host 192.168.1.10').session;
    s = applyCommand(s, 'access-list 1 permit 192.168.1.0 0.0.0.255').session;
    s = applyCommand(s, 'access-list 1 deny any').session;
    const text = applyCommand(s, 'do show access-lists').output.map((o) => o.text).join('\n');
    expect(text).toMatch(/Standard IP access list 1/);
    expect(text).toMatch(/10 deny\s+host 192\.168\.1\.10/);
    expect(text).toMatch(/20 permit\s+192\.168\.1\.0, wildcard bits 0\.0\.0\.255/);
    expect(text).toMatch(/30 deny\s+any/);
  });

  it('prefix-match: `sh acc` resolves to `show access-lists`', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'access-list 1 permit any').session;
    const text = applyCommand(s, 'do sh acc').output.map((o) => o.text).join('\n');
    expect(text).toMatch(/Standard IP access list 1/);
  });
});

describe('show ip interface <iface> output', () => {
  it('includes Inbound/Outbound access list lines (default: not set)', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'interface gi0/1').session;
    s = applyCommand(s, 'ip address 10.0.0.1 255.255.255.0').session;
    s = applyCommand(s, 'no shutdown').session;
    const text = applyCommand(s, 'do show ip interface gi0/1').output.map((o) => o.text).join('\n');
    expect(text).toMatch(/Inbound\s+access list not set/);
    expect(text).toMatch(/Outbound access list not set/);
  });

  it('shows `is N` once an ACL is bound', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'interface gi0/1').session;
    s = applyCommand(s, 'ip address 10.0.0.1 255.255.255.0').session;
    s = applyCommand(s, 'no shutdown').session;
    s = applyCommand(s, 'ip access-group 1 out').session;
    const text = applyCommand(s, 'do show ip int gi0/1').output.map((o) => o.text).join('\n');
    expect(text).toMatch(/Outbound access list is 1/);
  });

  it('prefix-match: `sh ip int gi0/1` resolves to per-interface form', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'interface gi0/1').session;
    s = applyCommand(s, 'ip address 10.0.0.1 255.255.255.0').session;
    s = applyCommand(s, 'no shutdown').session;
    // 'sh ip int brief' still resolves to brief — 'gi0/1' does NOT prefix-match `brief`,
    // so it falls into the iface argument slot.
    const out = applyCommand(s, 'do sh ip int gi0/1').output;
    expect(out.map((o) => o.text).join('\n')).toMatch(/GigabitEthernet0\/1 is up/);
  });
});

describe('show running-config — access-list lines', () => {
  it('emits `access-list N action source` lines in insertion order after interfaces', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'interface gi0/1').session;
    s = applyCommand(s, 'ip address 10.0.0.1 255.255.255.0').session;
    s = applyCommand(s, 'no shutdown').session;
    s = applyCommand(s, 'ip access-group 1 out').session;
    s = applyCommand(s, 'exit').session;
    s = applyCommand(s, 'access-list 1 deny host 192.168.1.10').session;
    s = applyCommand(s, 'access-list 1 permit 192.168.1.0 0.0.0.255').session;
    const text = applyCommand(s, 'do show running-config').output.map((o) => o.text).join('\n');
    // ip access-group inside interface stanza
    expect(text).toMatch(/interface GigabitEthernet0\/1\n[^!]*ip access-group 1 out/);
    // access-list lines after interfaces
    expect(text).toMatch(/access-list 1 deny host 192\.168\.1\.10/);
    expect(text).toMatch(/access-list 1 permit 192\.168\.1\.0 0\.0\.0\.255/);
  });
});

// ---------- Layer 4: reachability integration ---------------------------

const ROUTER = { kind: 'router' as const, platform: 'ISR4321' };

function pcRouterPc(): Lab {
  return {
    id: 'acl-test',
    title: 'acl reach fixture',
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
        { id: 'R1', interfaces: ['Gi0/0', 'Gi0/1'], ...ROUTER },
        {
          id: 'PC-B',
          kind: 'pc',
          platform: 'Workstation',
          interfaces: ['Eth0'],
          pc: { ip: '192.168.2.10', mask: '255.255.255.0', gateway: '192.168.2.1' },
        },
      ],
      links: [
        { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
        { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'PC-B', iface: 'Eth0' } },
      ],
    },
    setup: {
      R1: [
        'enable',
        'configure terminal',
        'interface gi0/0',
        'ip address 192.168.1.1 255.255.255.0',
        'no shutdown',
        'exit',
        'interface gi0/1',
        'ip address 192.168.2.1 255.255.255.0',
        'no shutdown',
        'exit',
      ],
    },
    objectives: [],
    hints: [],
  };
}

function runOn(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  let cur = setActive(ls, deviceId);
  for (const line of ['end', 'disable', ...lines]) {
    cur = applyToActive(cur, line).session;
  }
  return cur;
}

describe('canReach — ACL integration', () => {
  it('baseline (no ACL): PC-A can reach PC-B', () => {
    const ls = initLabSession(pcRouterPc());
    expect(canReach(ls, 'PC-A', '192.168.2.10').ok).toBe(true);
  });

  it('outbound ACL on R1 Gi0/1 denying PC-A blocks PC-A → PC-B', () => {
    let ls = initLabSession(pcRouterPc());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 deny host 192.168.1.10',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'interface gi0/1',
      'ip access-group 1 out',
    ]);
    const result = canReach(ls, 'PC-A', '192.168.2.10');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failedAt.reason).toBe('acl-deny');
    expect(result.failedAt.deviceId).toBe('R1');
    expect(result.failedAt.iface).toBe('Gi0/1');
    expect(result.failedAt.acl).toEqual({
      aclNumber: 1,
      aclDirection: 'out',
      sourceIp: '192.168.1.10',
    });
  });

  it('reverse direction (PC-B → PC-A) is unaffected — out-ACL only filters forward', () => {
    let ls = initLabSession(pcRouterPc());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 deny host 192.168.1.10',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'interface gi0/1',
      'ip access-group 1 out',
    ]);
    // PC-B is the source; packets source from 192.168.2.10 and would exit
    // R1 Gi0/0 (no ACL bound). The return walk sources from 192.168.1.10
    // which DOES hit the OUT ACL on Gi0/1, so this ping must still fail.
    // That asymmetry is the canonical "one-way break" learners diagnose.
    const result = canReach(ls, 'PC-B', '192.168.1.10');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failedAt.reason).toBe('acl-deny');
    expect(result.failedAt.direction).toBe('return');
  });

  it('implicit deny: an ACL with only `deny host X` blocks everything else too', () => {
    let ls = initLabSession(pcRouterPc());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      // ACL with ONLY a deny — every unmatched source hits the implicit deny.
      'access-list 1 deny host 10.10.10.10',
      'interface gi0/1',
      'ip access-group 1 out',
    ]);
    const result = canReach(ls, 'PC-A', '192.168.2.10');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failedAt.reason).toBe('acl-deny');
    expect(result.failedAt.acl?.aclDirection).toBe('out');
  });

  it('inbound ACL on R1 Gi0/0 blocks ingress traffic from PC-A', () => {
    let ls = initLabSession(pcRouterPc());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 deny host 192.168.1.10',
      'access-list 1 permit any',
      'interface gi0/0',
      'ip access-group 1 in',
    ]);
    const result = canReach(ls, 'PC-A', '192.168.2.10');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failedAt.reason).toBe('acl-deny');
    expect(result.failedAt.iface).toBe('Gi0/0');
    expect(result.failedAt.acl?.aclDirection).toBe('in');
  });

  it('ACL bound to a number that has no defined ACL is a no-op (permit-all)', () => {
    let ls = initLabSession(pcRouterPc());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/1',
      // Bind to ACL 99 which was never defined — IOS treats this as no filter.
      'ip access-group 99 out',
    ]);
    expect(canReach(ls, 'PC-A', '192.168.2.10').ok).toBe(true);
  });

  it('explicit permit lets matching traffic through', () => {
    let ls = initLabSession(pcRouterPc());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 permit any',
      'interface gi0/1',
      'ip access-group 1 out',
    ]);
    expect(canReach(ls, 'PC-A', '192.168.2.10').ok).toBe(true);
  });
});
