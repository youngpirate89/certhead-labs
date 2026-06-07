import { describe, expect, it } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { lab39TshootNatOutsideRole } from './lab-39-tshoot-nat-outside-role';

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
  let cur = runOn(ls, 'PC-BRANCH', ['ping 203.0.113.39']);
  cur = runOn(cur, 'R1', ['enable', 'show ip nat translations', 'show running-config']);
  cur = runOn(cur, 'R1', ['configure terminal', 'interface Gi0/1', 'ip nat outside', 'end']);
  cur = runOn(cur, 'PC-BRANCH', ['ping 203.0.113.39']);
  cur = runOn(cur, 'R1', ['show ip nat translations']);
  return cur;
}

describe('Lab 39 - Troubleshoot missing NAT outside role', () => {
  it('starts with ACL and PAT overload present but Gi0/1 missing ip nat outside', () => {
    const ls = initLabSession(lab39TshootNatOutsideRole);
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('shape');

    expect(r1.device.interfaces['Gi0/0']?.natRole).toBe('inside');
    expect(r1.device.interfaces['Gi0/1']?.natRole).toBeUndefined();
    expect(r1.device.acls.get(1)?.entries).toContainEqual(expect.objectContaining({
      action: 'permit',
      source: '172.16.39.0',
      wildcard: '0.0.0.255',
    }));
    expect(r1.device.natStatements).toContainEqual(expect.objectContaining({
      type: 'inside-source-list-overload',
      aclId: 1,
      outsideInterface: 'Gi0/1',
    }));
    expect(outputOn(ls, 'R1', 'show running-config')).toMatch(/ip nat inside source list 1 interface GigabitEthernet0\/1 overload/i);
    expect(outputOn(ls, 'R1', 'show running-config interface Gi0/1')).not.toMatch(/ip nat outside/i);
    const g = grade(lab39TshootNatOutsideRole, ls);
    expect(g.allMet).toBe(false);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual([
      ['confirm-client-symptom', false],
      ['inspect-nat-evidence', false],
      ['repair-outside-role', false],
      ['preserve-existing-nat-policy', false],
      ['verify-translated-reachability', false],
    ]);
  });

  it('requires symptom confirmation, NAT evidence, the outside role repair, and post-fix NAT verification', () => {
    const ls = applySolution(initLabSession(lab39TshootNatOutsideRole));
    const r1 = ls.devices.R1;
    const pc = ls.devices['PC-BRANCH'];
    if (r1.kind !== 'router' || pc.kind !== 'pc') throw new Error('shape');

    expect(r1.device.interfaces['Gi0/1']?.natRole).toBe('outside');
    expect(pc.lastPing).toMatchObject({ target: '203.0.113.39', ok: true });
    expect(r1.device.natTranslations.has('172.16.39.10')).toBe(true);
    expect(outputOn(ls, 'R1', 'show running-config interface Gi0/1')).toMatch(/ip nat outside/i);

    const g = grade(lab39TshootNatOutsideRole, ls);
    expect(g.allMet).toBe(true);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual([
      ['confirm-client-symptom', true],
      ['inspect-nat-evidence', true],
      ['repair-outside-role', true],
      ['preserve-existing-nat-policy', true],
      ['verify-translated-reachability', true],
    ]);
  });
});
