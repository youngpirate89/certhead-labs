import { describe, expect, it } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToDevice, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { tshootBranchMultiSymptomFinal as lab } from './tshoot-branch-multi-symptom-final';

const APP_IP = '198.51.50.10';

function hasStaticRoutes(device: unknown): device is { staticRoutes: readonly { prefix: string; mask: string }[] } {
  return typeof device === 'object' && device !== null && 'staticRoutes' in device;
}

function run(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

function objectiveMet(ls: LabSession, objectiveId: string): boolean | undefined {
  return grade(lab, ls).objectives.find((objective) => objective.id === objectiveId)?.met;
}

describe('Lab 50 — branch multi-symptom final ticket', () => {
  it('starts as a one-root-cause branch outage with VLAN 30 missing from the router trunk', () => {
    const ls = initLabSession(lab);
    const sw1 = ls.devices.SW1;
    const r1 = ls.devices.R1;
    const affected = ls.devices['PC-FINANCE'];
    const working = ls.devices['PC-OPS'];
    if (sw1?.kind !== 'switch' || r1?.kind !== 'router' || affected?.kind !== 'pc' || working?.kind !== 'pc') {
      throw new Error('unexpected lab device shape');
    }

    expect(lab.id).toBe('ccna-tshoot-branch-multi-symptom-final');
    expect(lab.difficulty).toBe(4);
    expect(lab.isFree).toBe(false);
    expect(lab.scenario).toMatch(/ticket/i);
    expect(lab.scenario).toMatch(/Finance/i);
    expect(sw1.device.switchports['Fa0/30'].accessVlan).toBe(30);
    expect(sw1.device.switchports['Gi0/1'].trunkAllowedVlans).toEqual([10]);
    expect(hasStaticRoutes(r1) && r1.staticRoutes.some((route) => route.prefix === '0.0.0.0' && route.mask === '0.0.0.0')).toBe(true);
    expect(affected.ip).toBeNull();
    expect(working.ip).toMatch(/^10\.50\.10\./);
    expect(canReach(ls, 'PC-FINANCE', APP_IP).ok).toBe(false);
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('does not mark the repair complete if the learner only checks the router default route', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'R1', ['enable', 'show ip route']);

    expect(objectiveMet(ls, 'verify-router-default-route')).toBe(true);
    expect(objectiveMet(ls, 'restore-finance-trunk-vlan')).toBe(false);
    expect(objectiveMet(ls, 'verify-finance-dhcp-lease')).toBe(false);
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('requires a post-fix trunk show and post-fix endpoint checks after adding VLAN 30', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'SW1', [
      'enable',
      'show interfaces trunk',
      'configure terminal',
      'interface Gi0/1',
      'switchport trunk allowed vlan add 30',
      'end',
    ]);

    expect(objectiveMet(ls, 'restore-finance-trunk-vlan')).toBe(true);
    expect(objectiveMet(ls, 'verify-trunk-after-repair')).toBe(false);
    expect(objectiveMet(ls, 'verify-finance-dhcp-lease')).toBe(false);

    ls = run(ls, 'SW1', ['show interfaces trunk']);
    expect(objectiveMet(ls, 'verify-trunk-after-repair')).toBe(true);

    ls = run(ls, 'PC-FINANCE', ['ipconfig']);
    expect(objectiveMet(ls, 'verify-finance-dhcp-lease')).toBe(true);
    expect(objectiveMet(ls, 'verify-hq-app-restored')).toBe(false);
  });

  it('grades complete after symptom confirmation, targeted trunk repair, router-route verification, and final reachability checks', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'PC-FINANCE', ['ipconfig', `ping ${APP_IP}`]);
    ls = run(ls, 'PC-OPS', ['ipconfig']);
    ls = run(ls, 'R1', ['enable', 'show ip route']);
    ls = run(ls, 'SW1', [
      'enable',
      'show interfaces status',
      'show interfaces trunk',
      'configure terminal',
      'interface Gi0/1',
      'switchport trunk allowed vlan add 30',
      'end',
      'show interfaces trunk',
    ]);
    ls = run(ls, 'PC-FINANCE', ['ipconfig', `ping ${APP_IP}`]);
    ls = run(ls, 'PC-OPS', ['ipconfig']);

    const result = grade(lab, ls);
    expect(result.objectives.map((objective) => [objective.id, objective.met])).toEqual(
      result.objectives.map((objective) => [objective.id, true]),
    );
    expect(canReach(ls, 'PC-FINANCE', APP_IP).ok).toBe(true);
    expect(result.allMet).toBe(true);
  });
});
