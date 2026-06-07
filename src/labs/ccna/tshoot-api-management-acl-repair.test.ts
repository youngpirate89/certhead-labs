import { describe, expect, it } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToDevice, initLabSession, type LabSession } from '@/engine/lab-session';
import { tshootApiManagementAclRepair as lab } from './tshoot-api-management-acl-repair';

const MGMT_IP = '10.48.10.1';

function run(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

function objectiveMet(ls: LabSession, objectiveId: string): boolean | undefined {
  return grade(lab, ls).objectives.find((objective) => objective.id === objectiveId)?.met;
}

describe('Lab 48 — API-assisted management ACL repair ticket', () => {
  it('starts incomplete before API discovery, SSH testing, and ACL repair', () => {
    const ls = initLabSession(lab);
    const pc = ls.devices['ADMIN-PC'];
    if (pc?.kind !== 'pc') throw new Error('ADMIN-PC should be modeled as a workstation');

    expect(pc.lastApiInventory).toBe(0);
    expect(pc.lastSsh).toBeNull();
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('requires API discovery before the learner can complete the management ACL repair workflow', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'ADMIN-PC', [`ping ${MGMT_IP}`, `ssh admin@${MGMT_IP}`]);
    ls = run(ls, 'R1', [
      'enable',
      'show running-config | section line vty',
      'show access-lists',
      'configure terminal',
      'access-list 48 permit 10.48.10.0 0.0.0.255',
      'end',
      'show access-lists',
    ]);
    ls = run(ls, 'ADMIN-PC', [`ssh admin@${MGMT_IP}`]);

    expect(objectiveMet(ls, 'discover-management-device-via-api')).toBe(false);
    expect(objectiveMet(ls, 'select-management-interface-via-api')).toBe(false);
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('does not satisfy interface selection when the API interface detail is queried before the interface list', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'ADMIN-PC', [
      'curl http://api.certhead.local/devices',
      'curl http://api.certhead.local/devices/R1',
      'curl http://api.certhead.local/devices/R1/interfaces/Gi0%2F0',
      'curl http://api.certhead.local/devices/R1/interfaces',
    ]);

    expect(objectiveMet(ls, 'select-management-interface-via-api')).toBe(false);
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('grades complete after API discovery, denied SSH observation, narrow ACL repair, and SSH retest', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'ADMIN-PC', [
      'curl http://api.certhead.local/devices',
      'curl http://api.certhead.local/devices/R1',
      'curl http://api.certhead.local/devices/R1/interfaces',
      'curl http://api.certhead.local/devices/R1/interfaces/Gi0%2F0',
      `ping ${MGMT_IP}`,
      `ssh admin@${MGMT_IP}`,
    ]);
    ls = run(ls, 'R1', [
      'enable',
      'show running-config | section line vty',
      'show access-lists',
      'configure terminal',
      'access-list 48 permit 10.48.10.0 0.0.0.255',
      'end',
      'show access-lists',
    ]);
    ls = run(ls, 'ADMIN-PC', [`ssh admin@${MGMT_IP}`]);

    const result = grade(lab, ls);
    expect(result.objectives.map((objective) => [objective.id, objective.met])).toEqual(
      result.objectives.map((objective) => [objective.id, true]),
    );
    expect(result.allMet).toBe(true);
  });

  it('rejects opening the management ACL to any source as the repair', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'ADMIN-PC', [
      'curl http://api.certhead.local/devices',
      'curl http://api.certhead.local/devices/R1',
      'curl http://api.certhead.local/devices/R1/interfaces',
      'curl http://api.certhead.local/devices/R1/interfaces/Gi0%2F0',
      `ping ${MGMT_IP}`,
      `ssh admin@${MGMT_IP}`,
    ]);
    ls = run(ls, 'R1', [
      'enable',
      'show running-config | section line vty',
      'show access-lists',
      'configure terminal',
      'access-list 48 permit any',
      'end',
      'show access-lists',
    ]);

    expect(objectiveMet(ls, 'apply-narrow-management-acl-repair')).toBe(false);
    expect(grade(lab, ls).allMet).toBe(false);
  });
});
