import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { grade } from '@/engine/grading';
import { lab06StandardAcl as lab } from './lab-06-standard-acl';

/**
 * Tests for the standard-ACL lab. Mirrors the lab-05 / tshoot test shape:
 * golden starting state, happy-path walkthrough, and pitfall coverage.
 */

function runOn(ls: LabSession, id: string, lines: string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

describe('lab-06-standard-acl — starting state', () => {
  it('topology shape: 3 devices (2 PCs, 1 router), 2 links, isFree:false', () => {
    expect(lab.topology.devices).toHaveLength(3);
    expect(lab.topology.links).toHaveLength(2);
    expect(lab.isFree).toBe(false);
  });

  it('seeded interfaces are up and addressed; no ACLs at start', () => {
    const ls = initLabSession(lab);
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('shape');

    expect(r1.device.interfaces['Gi0/0'].ip).toBe('192.168.1.1');
    expect(r1.device.interfaces['Gi0/0'].adminUp).toBe(true);
    expect(r1.device.interfaces['Gi0/1'].ip).toBe('192.168.2.1');
    expect(r1.device.interfaces['Gi0/1'].adminUp).toBe(true);
    expect(r1.device.acls.size).toBe(0);
    expect(r1.device.interfaces['Gi0/1'].accessGroups.out).toBeNull();
    expect(r1.mode).toBe('user');
    expect(r1.history).toEqual([]);
  });

  it('PC-A CAN reach PC-B at lab start (baseline — connected routes only)', () => {
    const ls = initLabSession(lab);
    expect(canReach(ls, 'PC-A', '192.168.2.10').ok).toBe(true);
  });

  it('all three objectives are unmet at start', () => {
    const ls = initLabSession(lab);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(false);
    expect(g.objectives.find((o) => o.id === 'acl-defined')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'acl-applied')?.met).toBe(false);
    expect(g.objectives.find((o) => o.id === 'acl-verified')?.met).toBe(false);
  });
});

describe('lab-06-standard-acl — happy path', () => {
  it('writing the ACL entries (deny host then permit subnet) ticks acl-defined', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 deny host 192.168.1.10',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
    ]);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'acl-defined')?.met).toBe(true);
  });

  it('binding ACL 1 to Gi0/1 outbound ticks acl-applied', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 deny host 192.168.1.10',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'interface gi0/1',
      'ip access-group 1 out',
    ]);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'acl-applied')?.met).toBe(true);
  });

  it('once applied, PC-A → PC-B fails with the acl-deny [sim] sentence', () => {
    let ls = initLabSession(lab);
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

  it('acl-verified needs BOTH a failed ping AND `show access-lists` on R1', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 deny host 192.168.1.10',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'interface gi0/1',
      'ip access-group 1 out',
    ]);

    // Ping fails — but show access-lists not run yet.
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    let g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'acl-verified')?.met).toBe(false);

    // Now run the show — must tick.
    ls = runOn(ls, 'R1', ['end', 'show access-lists']);
    g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'acl-verified')?.met).toBe(true);
  });

  it('full walkthrough: all three objectives met, allMet true', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 deny host 192.168.1.10',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'interface gi0/1',
      'ip access-group 1 out',
      'end',
      'show access-lists',
    ]);
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    const g = grade(lab, ls);
    expect(g.allMet).toBe(true);
  });
});

describe('lab-06-standard-acl — partial-credit guards', () => {
  it('permit before deny → acl-defined unmet (deny-then-permit ordering matters)', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'access-list 1 deny host 192.168.1.10',
    ]);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'acl-defined')?.met).toBe(false);
  });

  it('ACL applied INBOUND on Gi0/0 (still blocks but wrong placement) → acl-applied unmet', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 deny host 192.168.1.10',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'interface gi0/0',
      'ip access-group 1 in',
    ]);
    // Block actually works — but the lab is grading the IOS-best-practice
    // placement (closest to destination, outbound).
    expect(canReach(ls, 'PC-A', '192.168.2.10').ok).toBe(false);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'acl-applied')?.met).toBe(false);
  });

  it('ping fails for a NON-ACL reason (egress shut, no ACL) + show access-lists → acl-verified unmet', () => {
    let ls = initLabSession(lab);
    // No ACL defined or applied; instead break the PC-B path with a shutdown.
    // The ping fails (egress-down), and `show access-lists` is in history, but
    // the failure is not the ACL block — acl-verified must NOT credit it.
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/1',
      'shutdown',
      'end',
      'show access-lists',
    ]);
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'acl-verified')?.met).toBe(false);
  });

  it('ACL defined + show run but never applied → ping still succeeds → acl-verified unmet', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'access-list 1 deny host 192.168.1.10',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'end',
      'show access-lists',
    ]);
    ls = runOn(ls, 'PC-A', ['ping 192.168.2.10']);
    const g = grade(lab, ls);
    expect(g.objectives.find((o) => o.id === 'acl-verified')?.met).toBe(false);
  });
});
