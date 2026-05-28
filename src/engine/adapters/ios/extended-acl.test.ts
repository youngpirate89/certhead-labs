/**
 * Named extended ACL engine tests (Lab 12).
 *
 * Three layers, mirroring acl.test.ts:
 *   1. Pure evaluator — protocol + source + destination matching.
 *   2. Per-router state mutation — `ip access-list extended <name>` enters
 *      config-ext-nacl, permit/deny add entries with correct shape, exit
 *      returns to config and clears activeAcl.
 *   3. Reachability — canReach honors extended `deny icmp` entries when
 *      the caller passes `protocol: 'icmp'`; default 'ip' protocol leaves
 *      the deny inactive (backward compat with non-ping callers).
 */
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

// ---------- Layer 1: evaluator -------------------------------------------

describe('Extended ACL evaluator — matchesEntry', () => {
  it('deny icmp matches icmp traffic to the right dst', () => {
    const entry = {
      sequence: 10,
      action: 'deny' as const,
      source: '192.168.1.0',
      wildcard: '0.0.0.255',
      protocol: 'icmp' as const,
      srcIp: '192.168.1.0',
      srcWildcard: '0.0.0.255',
      dstIp: '192.168.2.10',
      dstWildcard: '0.0.0.0',
    };
    expect(matchesEntry(entry, '192.168.1.10', 'icmp', '192.168.2.10')).toBe(true);
  });

  it('deny icmp does NOT match TCP traffic (protocol mismatch)', () => {
    const entry = {
      sequence: 10,
      action: 'deny' as const,
      source: '192.168.1.0',
      wildcard: '0.0.0.255',
      protocol: 'icmp' as const,
      srcIp: '192.168.1.0',
      srcWildcard: '0.0.0.255',
      dstIp: '192.168.2.10',
      dstWildcard: '0.0.0.0',
    };
    expect(matchesEntry(entry, '192.168.1.10', 'tcp', '192.168.2.10')).toBe(false);
  });

  it('deny icmp does NOT match traffic to a different dst', () => {
    const entry = {
      sequence: 10,
      action: 'deny' as const,
      source: '192.168.1.0',
      wildcard: '0.0.0.255',
      protocol: 'icmp' as const,
      srcIp: '192.168.1.0',
      srcWildcard: '0.0.0.255',
      dstIp: '192.168.2.10',
      dstWildcard: '0.0.0.0',
    };
    expect(matchesEntry(entry, '192.168.1.10', 'icmp', '192.168.2.99')).toBe(false);
  });

  it('permit ip any any matches ICMP traffic (ip = wildcard protocol)', () => {
    const entry = {
      sequence: 10,
      action: 'permit' as const,
      source: '0.0.0.0',
      wildcard: '255.255.255.255',
      protocol: 'ip' as const,
      srcIp: '0.0.0.0',
      srcWildcard: '255.255.255.255',
      dstIp: '0.0.0.0',
      dstWildcard: '255.255.255.255',
    };
    expect(matchesEntry(entry, '10.1.1.1', 'icmp', '8.8.8.8')).toBe(true);
    expect(matchesEntry(entry, '10.1.1.1', 'tcp', '8.8.8.8')).toBe(true);
    expect(matchesEntry(entry, '10.1.1.1', 'udp', '8.8.8.8')).toBe(true);
  });

  it('standard entry (no protocol field) ignores protocol arg — no regression', () => {
    const entry = {
      sequence: 10,
      action: 'permit' as const,
      source: '192.168.1.0',
      wildcard: '0.0.0.255',
    };
    expect(matchesEntry(entry, '192.168.1.10', 'icmp', '10.10.10.10')).toBe(true);
    expect(matchesEntry(entry, '10.10.10.10', 'icmp', '10.10.10.10')).toBe(false);
  });
});

describe('Extended ACL evaluator — first-match wins + implicit deny', () => {
  it('deny icmp before permit ip — icmp blocked, tcp permitted', () => {
    const acl = {
      type: 'extended' as const,
      name: 'BLOCK-ICMP',
      entries: [
        {
          sequence: 10,
          action: 'deny' as const,
          source: '192.168.1.0',
          wildcard: '0.0.0.255',
          protocol: 'icmp' as const,
          srcIp: '192.168.1.0',
          srcWildcard: '0.0.0.255',
          dstIp: '192.168.2.10',
          dstWildcard: '0.0.0.0',
        },
        {
          sequence: 20,
          action: 'permit' as const,
          source: '0.0.0.0',
          wildcard: '255.255.255.255',
          protocol: 'ip' as const,
          srcIp: '0.0.0.0',
          srcWildcard: '255.255.255.255',
          dstIp: '0.0.0.0',
          dstWildcard: '255.255.255.255',
        },
      ],
    };
    expect(evaluateAcl(acl, '192.168.1.10', 'icmp', '192.168.2.10')).toBe('deny');
    expect(evaluateAcl(acl, '192.168.1.10', 'tcp', '192.168.2.10')).toBe('permit');
    // icmp to a different host: deny doesn't match, permit catches it.
    expect(evaluateAcl(acl, '192.168.1.10', 'icmp', '192.168.2.99')).toBe('permit');
  });
});

// ---------- Layer 2: per-router state mutation ---------------------------

function fresh(): Session {
  return createSession(
    buildDevice({ id: 'R1', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] }),
  );
}

function inConfig(s: Session): Session {
  return ['enable', 'configure terminal'].reduce(
    (acc, line) => applyCommand(acc, line).session,
    s,
  );
}

describe('ip access-list extended — mode transition + state', () => {
  it('creates the named ACL and enters config-ext-nacl mode', () => {
    const s = applyCommand(inConfig(fresh()), 'ip access-list extended BLOCK-ICMP').session;
    expect(s.mode).toBe('config-ext-nacl');
    expect(s.activeAcl).toBe('BLOCK-ICMP');
    const acl = s.device.acls.get('BLOCK-ICMP');
    expect(acl?.type).toBe('extended');
    expect(acl?.entries).toEqual([]);
  });

  it('prompt updates to (config-ext-nacl)#', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'ip access-list extended BLOCK-ICMP').session;
    // Prompt is rendered by `promptFor` — we can verify the mode drove it
    // by checking the mode directly; the prompt formatter follows the mode.
    expect(s.mode).toBe('config-ext-nacl');
  });

  it('exit returns to config and clears activeAcl', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'ip access-list extended BLOCK-ICMP').session;
    s = applyCommand(s, 'exit').session;
    expect(s.mode).toBe('config');
    expect(s.activeAcl).toBeNull();
  });

  it('end returns to priv and clears activeAcl', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'ip access-list extended BLOCK-ICMP').session;
    s = applyCommand(s, 'end').session;
    expect(s.mode).toBe('priv');
    expect(s.activeAcl).toBeNull();
  });

  it('re-entering an existing extended ACL reuses it (no duplicate)', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'ip access-list extended BLOCK-ICMP').session;
    s = applyCommand(s, 'deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10').session;
    s = applyCommand(s, 'exit').session;
    s = applyCommand(s, 'ip access-list extended BLOCK-ICMP').session;
    const acl = s.device.acls.get('BLOCK-ICMP');
    expect(acl?.entries.length).toBe(1);
  });
});

describe('config-ext-nacl: permit / deny entries', () => {
  function inExtAcl(name: string): Session {
    let s = inConfig(fresh());
    s = applyCommand(s, `ip access-list extended ${name}`).session;
    return s;
  }

  it('deny icmp <src> <wc> host <ip> adds entry with sequence 10', () => {
    const s = applyCommand(
      inExtAcl('A'),
      'deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10',
    ).session;
    const acl = s.device.acls.get('A');
    expect(acl?.entries.length).toBe(1);
    expect(acl?.entries[0]).toMatchObject({
      sequence: 10,
      action: 'deny',
      protocol: 'icmp',
      srcIp: '192.168.1.0',
      srcWildcard: '0.0.0.255',
      dstIp: '192.168.2.10',
      dstWildcard: '0.0.0.0',
    });
  });

  it('permit ip any any adds entry with full wildcards', () => {
    const s = applyCommand(inExtAcl('A'), 'permit ip any any').session;
    expect(s.device.acls.get('A')?.entries[0]).toMatchObject({
      sequence: 10,
      action: 'permit',
      protocol: 'ip',
      srcIp: '0.0.0.0',
      srcWildcard: '255.255.255.255',
      dstIp: '0.0.0.0',
      dstWildcard: '255.255.255.255',
    });
  });

  it('successive entries auto-number 10, 20, 30', () => {
    let s = inExtAcl('A');
    s = applyCommand(s, 'deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10').session;
    s = applyCommand(s, 'permit ip any any').session;
    s = applyCommand(s, 'deny tcp any host 192.168.2.10 eq www').session;
    expect(s.device.acls.get('A')?.entries.map((e) => e.sequence)).toEqual([10, 20, 30]);
  });

  it('eq www resolves to port 80', () => {
    const s = applyCommand(inExtAcl('A'), 'permit tcp any host 192.168.2.10 eq www').session;
    expect(s.device.acls.get('A')?.entries[0]?.dstPort).toBe(80);
  });

  it('eq 23 stores port 23', () => {
    const s = applyCommand(inExtAcl('A'), 'permit tcp any host 192.168.2.10 eq 23').session;
    expect(s.device.acls.get('A')?.entries[0]?.dstPort).toBe(23);
  });

  // The cases below pin down the 4 src/dst combinations called out by the
  // emdash-any-servericon bugfix work order — adds explicit coverage for
  // `deny tcp any host <ip> eq <port>` and `permit udp <ip> <wc> any eq <port>`
  // so a regression in the src-then-dst grammar walk fails loudly.
  it('deny tcp any host 10.0.0.1 eq 23 — src=any, dst=host, with eq', () => {
    const s = applyCommand(inExtAcl('A'), 'deny tcp any host 10.0.0.1 eq 23').session;
    expect(s.device.acls.get('A')?.entries[0]).toMatchObject({
      action: 'deny',
      protocol: 'tcp',
      srcIp: '0.0.0.0',
      srcWildcard: '255.255.255.255',
      dstIp: '10.0.0.1',
      dstWildcard: '0.0.0.0',
      dstPort: 23,
    });
  });

  it('permit udp 10.0.0.0 0.0.0.255 any eq 53 — src=bare, dst=any, with eq', () => {
    const s = applyCommand(inExtAcl('A'), 'permit udp 10.0.0.0 0.0.0.255 any eq 53').session;
    expect(s.device.acls.get('A')?.entries[0]).toMatchObject({
      action: 'permit',
      protocol: 'udp',
      srcIp: '10.0.0.0',
      srcWildcard: '0.0.0.255',
      dstIp: '0.0.0.0',
      dstWildcard: '255.255.255.255',
      dstPort: 53,
    });
  });

  it('eq on icmp returns an error and does not add the entry', () => {
    const result = applyCommand(inExtAcl('A'), 'permit icmp any any eq 80');
    expect(result.output[0]?.kind).toBe('error');
    expect(result.session.device.acls.get('A')?.entries.length).toBe(0);
  });

  it('no <sequence> removes the entry with that line number', () => {
    let s = inExtAcl('A');
    s = applyCommand(s, 'deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10').session;
    s = applyCommand(s, 'permit ip any any').session;
    s = applyCommand(s, 'no 10').session;
    expect(s.device.acls.get('A')?.entries.map((e) => e.sequence)).toEqual([20]);
  });
});

describe('ip access-group with a named extended ACL', () => {
  it('binds the name onto the interface accessGroups field', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'ip access-list extended BLOCK-ICMP').session;
    s = applyCommand(s, 'permit ip any any').session;
    s = applyCommand(s, 'exit').session;
    s = applyCommand(s, 'interface Gi0/0').session;
    s = applyCommand(s, 'ip access-group BLOCK-ICMP in').session;
    expect(s.device.interfaces['Gi0/0'].accessGroups.in).toBe('BLOCK-ICMP');
    expect(s.device.interfaces['Gi0/0'].accessGroups.out).toBeNull();
  });

  it('named ACL lookup uses string key (not coerced to number)', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'ip access-list extended FOO').session;
    s = applyCommand(s, 'exit').session;
    expect(s.device.acls.get('FOO')).toBeDefined();
    expect(s.device.acls.get('FOO')?.type).toBe('extended');
  });
});

describe('show access-lists — extended ACL rendering', () => {
  it('renders the Extended IP access list header with name', () => {
    let s = inConfig(fresh());
    s = applyCommand(s, 'ip access-list extended BLOCK-ICMP').session;
    s = applyCommand(s, 'deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10').session;
    s = applyCommand(s, 'permit ip any any').session;
    const text = applyCommand(s, 'do show access-lists')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/Extended IP access list BLOCK-ICMP/);
    expect(text).toMatch(/10 deny icmp 192\.168\.1\.0 0\.0\.0\.255 host 192\.168\.2\.10/);
    expect(text).toMatch(/20 permit ip any any/);
  });
});

// ---------- Layer 3: reachability integration ---------------------------

const ROUTER = { kind: 'router' as const, platform: 'ISR4321' };

function pcRouterPc(): Lab {
  return {
    id: 'ext-acl-test',
    title: 'extended ACL reach fixture',
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
          id: 'Server',
          kind: 'pc',
          platform: 'Workstation',
          interfaces: ['Eth0'],
          pc: { ip: '192.168.2.10', mask: '255.255.255.0', gateway: '192.168.2.1' },
        },
      ],
      links: [
        { a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } },
        { a: { deviceId: 'R1', iface: 'Gi0/1' }, b: { deviceId: 'Server', iface: 'Eth0' } },
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

describe('canReach — extended ACL integration', () => {
  it('baseline: PC-A can ping the Server with no ACL applied', () => {
    const ls = initLabSession(pcRouterPc());
    expect(canReach(ls, 'PC-A', '192.168.2.10', undefined, 'icmp').ok).toBe(true);
  });

  it('ICMP blocked when BLOCK-ICMP is applied inbound on Gi0/0', () => {
    let ls = initLabSession(pcRouterPc());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'ip access-list extended BLOCK-ICMP',
      'deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10',
      'permit ip any any',
      'exit',
      'interface Gi0/0',
      'ip access-group BLOCK-ICMP in',
    ]);
    const result = canReach(ls, 'PC-A', '192.168.2.10', undefined, 'icmp');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failedAt.reason).toBe('acl-deny');
    expect(result.failedAt.deviceId).toBe('R1');
    expect(result.failedAt.iface).toBe('Gi0/0');
    expect(result.failedAt.acl?.aclNumber).toBe('BLOCK-ICMP');
    expect(result.failedAt.acl?.aclDirection).toBe('in');
  });

  it('non-ICMP traffic (protocol: ip) still passes through the same ACL', () => {
    let ls = initLabSession(pcRouterPc());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'ip access-list extended BLOCK-ICMP',
      'deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10',
      'permit ip any any',
      'exit',
      'interface Gi0/0',
      'ip access-group BLOCK-ICMP in',
    ]);
    // Default protocol is 'ip' — the deny icmp entry doesn't match, the
    // permit ip any any catches the traffic. canReach succeeds.
    expect(canReach(ls, 'PC-A', '192.168.2.10').ok).toBe(true);
  });

  it('order matters: permit-first lets icmp through (deny becomes unreachable)', () => {
    let ls = initLabSession(pcRouterPc());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'ip access-list extended BLOCK-ICMP',
      'permit ip any any',
      'deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10',
      'exit',
      'interface Gi0/0',
      'ip access-group BLOCK-ICMP in',
    ]);
    expect(canReach(ls, 'PC-A', '192.168.2.10', undefined, 'icmp').ok).toBe(true);
  });

  it('PC ping handler passes icmp automatically and surfaces the block', () => {
    let ls = initLabSession(pcRouterPc());
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'ip access-list extended BLOCK-ICMP',
      'deny icmp 192.168.1.0 0.0.0.255 host 192.168.2.10',
      'permit ip any any',
      'exit',
      'interface Gi0/0',
      'ip access-group BLOCK-ICMP in',
    ]);
    // Run ping from PC-A — handler passes 'icmp'; lastPing.ok should be false.
    ls = setActive(ls, 'PC-A');
    ls = applyToActive(ls, 'ping 192.168.2.10').session;
    const pca = ls.devices['PC-A'];
    if (pca.kind !== 'pc') throw new Error('not pc');
    expect(pca.lastPing).toEqual({ target: '192.168.2.10', ok: false });
  });
});
