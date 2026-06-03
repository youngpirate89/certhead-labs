import { describe, expect, it } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToDevice, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { tshootOspfAclOverlapTicket as lab } from './tshoot-ospf-acl-overlap-ticket';

const APP_IP = '172.49.50.20';

function run(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

function objectiveMet(ls: LabSession, objectiveId: string): boolean | undefined {
  return grade(lab, ls).objectives.find((objective) => objective.id === objectiveId)?.met;
}

describe('Lab 49 — OSPF default plus ACL overlap ticket', () => {
  it('starts incomplete with a full OSPF neighbor but no learned default and app traffic denied', () => {
    const ls = initLabSession(lab);
    const branch = ls.devices.BRANCH;
    const edge = ls.devices.EDGE;
    if (branch?.kind !== 'router' || edge?.kind !== 'router') throw new Error('BRANCH and EDGE should be routers');

    expect(Array.from(branch.device.ospf.neighbors.values()).some((neighbor) => neighbor.state === 'FULL')).toBe(true);
    expect(branch.ospfRoutes.some((route) => route.prefix === '0.0.0.0' && route.mask === '0.0.0.0')).toBe(false);
    expect(canReach(ls, 'PC-BRANCH', APP_IP, undefined, 'tcp').ok).toBe(false);
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('does not complete when the learner fixes only OSPF but leaves the app ACL blocking TCP/8443', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'EDGE', ['enable', 'show ip route', 'show access-lists']);
    ls = run(ls, 'EDGE', ['configure terminal', 'router ospf 1', 'default-information originate', 'end', 'show ip route']);
    ls = run(ls, 'BRANCH', ['enable', 'show ip route']);
    ls = run(ls, 'PC-BRANCH', [`ping ${APP_IP}`]);

    expect(objectiveMet(ls, 'learn-ospf-default')).toBe(true);
    expect(objectiveMet(ls, 'verify-basic-reachability')).toBe(true);
    expect(objectiveMet(ls, 'permit-business-app')).toBe(false);
    expect(objectiveMet(ls, 'verify-business-app-path')).toBe(false);
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('rejects opening the branch-to-app ACL broadly as the policy repair', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'EDGE', [
      'enable',
      'configure terminal',
      'router ospf 1',
      'default-information originate',
      'exit',
      'ip access-list extended BRANCH-APP-POLICY',
      'no 20',
      'permit ip any any',
      'end',
      'show access-lists',
    ]);
    ls = run(ls, 'BRANCH', ['enable', 'show ip route']);
    ls = run(ls, 'PC-BRANCH', [`ping ${APP_IP}`]);

    expect(objectiveMet(ls, 'permit-business-app')).toBe(false);
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('grades complete after route-table diagnosis, OSPF default origination, narrow ACL repair, and post-fix verification', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'PC-BRANCH', [`ping ${APP_IP}`]);
    ls = run(ls, 'BRANCH', ['enable', 'show ip route']);
    ls = run(ls, 'EDGE', ['enable', 'show ip route', 'show access-lists']);
    ls = run(ls, 'EDGE', [
      'configure terminal',
      'router ospf 1',
      'default-information originate',
      'exit',
      'ip access-list extended BRANCH-APP-POLICY',
      'no 20',
      'permit tcp 10.49.10.0 0.0.0.255 host 172.49.50.20 eq 8443',
      'deny ip any any',
      'end',
      'show access-lists',
    ]);
    ls = run(ls, 'BRANCH', ['show ip route']);
    ls = run(ls, 'PC-BRANCH', [`ping ${APP_IP}`]);

    const result = grade(lab, ls);
    expect(result.objectives.map((objective) => [objective.id, objective.met])).toEqual(
      result.objectives.map((objective) => [objective.id, true]),
    );
    expect(canReach(ls, 'PC-BRANCH', APP_IP, undefined, 'tcp').ok).toBe(true);
    expect(result.allMet).toBe(true);
  });
});
