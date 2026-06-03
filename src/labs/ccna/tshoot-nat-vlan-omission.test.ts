import { describe, expect, it } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { getLabById } from '@/labs/catalog';
import { tshootNatVlanOmission as lab } from './tshoot-nat-vlan-omission';

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

describe('tshoot-nat-vlan-omission — starting ticket state', () => {
  it('declares a non-free CCNA ticket lab and resolves from the catalog', () => {
    expect(lab.id).toBe('ccna-tshoot-nat-vlan-omission');
    expect(lab.title).toMatch(/NAT Omits One VLAN/i);
    expect(lab.scenario).toMatch(/Training/i);
    expect(lab.scenario).toMatch(/NAT ACL/i);
    expect(lab.isFree).toBe(false);
    expect(getLabById('ccna-tshoot-nat-vlan-omission')).toBe(lab);
  });

  it('starts with Admin translated successfully while Training fails because ACL 1 omits 10.120.20.0/24', () => {
    const ls = initLabSession(lab);
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('R1 shape');

    expect(canReach(ls, 'PC-ADMIN', '203.0.113.10')).toEqual({ ok: true });
    const training = canReach(ls, 'PC-TRAINING', '203.0.113.10');
    expect(training.ok).toBe(false);
    if (!training.ok) {
      expect(training.failedAt.direction).toBe('return');
      expect(training.failedAt.reason).toBe('no-route');
    }

    expect(r1.device.interfaces['Gi0/0'].natRole).toBe('inside');
    expect(r1.device.interfaces['Gi0/1'].natRole).toBe('inside');
    expect(r1.device.interfaces['Gi0/2'].natRole).toBe('outside');
    expect(r1.device.natStatements).toEqual([
      { type: 'inside-source-list-overload', aclId: 1, outsideInterface: 'Gi0/2' },
    ]);
    const acl = r1.device.acls.get(1);
    expect(acl?.entries.map((e) => [e.action, e.source, e.wildcard])).toEqual([
      ['permit', '10.110.10.0', '0.0.0.255'],
    ]);
    expect(r1.device.natTranslations.get('10.110.10.10')).toEqual({
      insideLocal: '10.110.10.10',
      insideGlobal: '203.0.113.1',
    });
    expect(r1.device.natTranslations.has('10.120.20.10')).toBe(false);
  });

  it('all objectives are unmet at the start', () => {
    const g = grade(lab, initLabSession(lab));
    expect(g.objectives).toHaveLength(5);
    expect(g.objectives.map((o) => o.met)).toEqual([false, false, false, false, false]);
    expect(g.allMet).toBe(false);
  });
});

describe('tshoot-nat-vlan-omission — repair path', () => {
  it('requires comparing the working and broken clients before the config objective is complete', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'PC-ADMIN', ['ping 203.0.113.10']);
    ls = runOn(ls, 'PC-TRAINING', ['ping 203.0.113.10']);

    expect(objectiveMet(ls, 'compare-clients')).toBe(true);
    expect(objectiveMet(ls, 'permit-training-subnet')).toBe(false);
  });

  it('show access-lists and show ip nat translations reveal only the Admin subnet is selected', () => {
    const ls = initLabSession(lab);
    const aclOutput = textOf(ls, 'R1', 'show access-lists');
    const natOutput = textOf(ls, 'R1', 'show ip nat translations');

    expect(aclOutput).toMatch(/Standard IP access list 1/);
    expect(aclOutput).toMatch(/permit 10\.110\.10\.0, wildcard bits 0\.0\.0\.255/);
    expect(aclOutput).not.toMatch(/10\.120\.20\.0/);
    expect(natOutput).toMatch(/10\.110\.10\.10/);
    expect(natOutput).not.toMatch(/10\.120\.20\.10/);
  });

  it('published solution exits config mode before post-fix show commands', () => {
    const steps = lab.solution?.steps ?? [];
    const verifyStepIndex = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.commands.includes('show ip nat translations'))
      .at(-1)?.index;
    expect(verifyStepIndex).toBeGreaterThan(0);
    const previousStep = steps[verifyStepIndex! - 1];
    expect(previousStep?.commands.at(-1)).toBe('end');
  });

  it('published troubleshooting workflow satisfies every objective and restores Training internet reachability', () => {
    let ls = initLabSession(lab);
    for (const step of lab.solution!.steps) {
      ls = runOn(ls, step.device, step.commands);
    }

    expect(canReach(ls, 'PC-ADMIN', '203.0.113.10')).toEqual({ ok: true });
    expect(canReach(ls, 'PC-TRAINING', '203.0.113.10')).toEqual({ ok: true });

    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('R1 shape');
    expect(r1.device.natTranslations.get('10.120.20.10')).toEqual({
      insideLocal: '10.120.20.10',
      insideGlobal: '203.0.113.1',
    });

    const g = grade(lab, ls);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual(g.objectives.map((o) => [o.id, true]));
    expect(g.allMet).toBe(true);
  });
});
