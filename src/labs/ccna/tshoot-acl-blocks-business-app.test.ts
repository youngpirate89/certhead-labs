import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { canReach } from '@/engine/reachability';
import { getLabById } from '@/labs/catalog';
import { tshootAclBlocksBusinessApp as lab } from './tshoot-acl-blocks-business-app';

function runOn(ls: LabSession, id: string, lines: readonly string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function textOf(ls: LabSession, id: string, line: string): string {
  const res = applyToActive({ ...ls, activeDeviceId: id }, line);
  return res.output.map((o) => o.text).join('\n');
}

function objectiveMet(ls: LabSession, id: string): boolean {
  return grade(lab, ls).objectives.find((o) => o.id === id)?.met ?? false;
}

describe('tshoot-acl-blocks-business-app — starting ticket state', () => {
  it('declares a non-free CCNA ticket lab and resolves from the catalog', () => {
    expect(lab.id).toBe('ccna-tshoot-acl-blocks-business-app');
    expect(lab.title).toMatch(/ACL Blocks Business App/i);
    expect(lab.scenario).toMatch(/ping/i);
    expect(lab.scenario).toMatch(/8443/);
    expect(lab.isFree).toBe(false);
    expect(getLabById('ccna-tshoot-acl-blocks-business-app')).toBe(lab);
  });

  it('starts with ICMP reachability allowed but TCP app traffic denied by the ACL', () => {
    const ls = initLabSession(lab);
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('R1 shape');

    expect(canReach(ls, 'PC-STAFF', '172.16.50.20', undefined, 'icmp')).toEqual({ ok: true });
    const tcp = canReach(ls, 'PC-STAFF', '172.16.50.20', undefined, 'tcp');
    expect(tcp.ok).toBe(false);
    if (!tcp.ok) {
      expect(tcp.failedAt.reason).toBe('acl-deny');
      expect(tcp.failedAt.acl?.aclNumber).toBe('STAFF-DMZ-FILTER');
    }

    const acl = r1.device.acls.get('STAFF-DMZ-FILTER');
    expect(acl?.entries.map((e) => [e.sequence, e.action, e.protocol, e.dstPort])).toEqual([
      [10, 'permit', 'icmp', undefined],
      [20, 'deny', 'ip', undefined],
    ]);
  });

  it('all objectives are unmet at the start', () => {
    const g = grade(lab, initLabSession(lab));
    expect(g.allMet).toBe(false);
    expect(g.objectives).toHaveLength(5);
    expect(g.objectives.map((o) => o.met)).toEqual([false, false, false, false, false]);
  });
});

describe('tshoot-acl-blocks-business-app — repair path', () => {
  it('requires demonstrating that ping succeeds before changing the ACL', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'PC-STAFF', ['ping 172.16.50.20']);

    expect(objectiveMet(ls, 'confirm-ping-only')).toBe(true);
    expect(objectiveMet(ls, 'permit-app-port')).toBe(false);
  });

  it('show access-lists displays the broken ICMP permit followed by deny ip any any', () => {
    const ls = initLabSession(lab);
    const output = textOf(ls, 'R1', 'show access-lists');

    expect(output).toMatch(/Extended IP access list STAFF-DMZ-FILTER/);
    expect(output).toMatch(/10 permit icmp 172\.16\.40\.0 0\.0\.0\.255 host 172\.16\.50\.20/);
    expect(output).toMatch(/20 deny ip any any/);
  });

  it('adding the TCP permit after the existing deny does not satisfy order or app path', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', [
      'enable',
      'configure terminal',
      'ip access-list extended STAFF-DMZ-FILTER',
      'permit tcp 172.16.40.0 0.0.0.255 host 172.16.50.20 eq 8443',
      'end',
    ]);

    expect(objectiveMet(ls, 'permit-app-port')).toBe(true);
    expect(objectiveMet(ls, 'acl-order-secure')).toBe(false);
    expect(objectiveMet(ls, 'verify-app-path')).toBe(false);
  });

  it('published solution exits config mode before the post-fix show access-lists', () => {
    const steps = lab.solution?.steps ?? [];
    const verifyStepIndex = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.commands.includes('show access-lists'))
      .at(-1)?.index;
    expect(verifyStepIndex).toBeGreaterThan(0);
    const previousStep = steps[verifyStepIndex! - 1];
    expect(previousStep?.commands.at(-1)).toBe('end');
  });

  it('published troubleshooting workflow satisfies every objective and restores TCP app reachability', () => {
    let ls = initLabSession(lab);
    for (const step of lab.solution!.steps) {
      ls = runOn(ls, step.device, step.commands);
    }

    expect(canReach(ls, 'PC-STAFF', '172.16.50.20', undefined, 'icmp')).toEqual({ ok: true });
    expect(canReach(ls, 'PC-STAFF', '172.16.50.20', undefined, 'tcp')).toEqual({ ok: true });

    const g = grade(lab, ls);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual(g.objectives.map((o) => [o.id, true]));
    expect(g.allMet).toBe(true);
  });
});
