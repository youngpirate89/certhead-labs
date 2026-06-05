import { describe, expect, it } from 'vitest';
import { initLabSession, applyToDevice, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { tshootSshManagementDenied as lab } from './tshoot-ssh-management-denied';

function run(ls: LabSession, deviceId: string, lines: readonly string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

function textOf(ls: LabSession, deviceId: string, command: string): string {
  return applyToDevice(ls, deviceId, command).output.map((o) => o.text).join('\n');
}

describe('Troubleshoot: SSH management denied', () => {
  it('starts with data-plane reachability but SSH denied by the VTY access-class', () => {
    let ls = initLabSession(lab);

    ls = run(ls, 'ADMIN-PC', ['ping 10.180.10.5']);
    const pcAfterPing = ls.devices['ADMIN-PC'];
    expect(pcAfterPing?.kind).toBe('pc');
    if (pcAfterPing?.kind !== 'pc') throw new Error('ADMIN-PC is not a PC');
    expect(pcAfterPing.lastPing).toEqual({ target: '10.180.10.5', ok: true });

    const sshDenied = textOf(ls, 'ADMIN-PC', 'ssh admin@10.180.10.5');
    expect(sshDenied).toMatch(/Connection refused/);
    expect(sshDenied).toMatch(/VTY access-class 23 denies 10\.180\.10\.50/);

    const r1 = ls.devices.R1;
    if (r1?.kind !== 'router') throw new Error('R1 is not a router');
    expect(r1.device.security.vtyAccessClassIn).toBe(23);
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('keeps ADMIN-PC and R1 far enough apart for readable interface labels', () => {
    const pc = lab.topology.devices.find((device) => device.id === 'ADMIN-PC');
    const r1 = lab.topology.devices.find((device) => device.id === 'R1');

    expect(pc?.position?.x).toBe(0);
    expect(r1?.position?.x).toBeGreaterThanOrEqual(320);
  });

  it('shows the VTY access-class and the stale management ACL with Cisco-style commands', () => {
    const ls = initLabSession(lab);

    const vtySection = textOf(ls, 'R1', 'show running-config | section line vty');
    expect(vtySection).toMatch(/line vty 0 4/);
    expect(vtySection).toMatch(/ login local/);
    expect(vtySection).toMatch(/ transport input ssh/);
    expect(vtySection).toMatch(/ access-class 23 in/);

    const aclOutput = textOf(ls, 'R1', 'show access-lists');
    expect(aclOutput).toMatch(/Standard IP access list 23/);
    expect(aclOutput).toMatch(/permit\s+10\.180\.20\.0, wildcard bits 0\.0\.0\.255/);
    expect(aclOutput).not.toMatch(/10\.180\.10\.0, wildcard bits 0\.0\.0\.255/);
  });

  it('grades complete only after the narrow admin subnet permit is added, verified, and SSH is retested', () => {
    let ls = initLabSession(lab);

    ls = run(ls, 'ADMIN-PC', ['ping 10.180.10.5', 'ssh admin@10.180.10.5']);
    ls = run(ls, 'R1', ['enable', 'show running-config | section line vty', 'show access-lists']);
    ls = run(ls, 'R1', [
      'configure terminal',
      'access-list 23 permit 10.180.10.0 0.0.0.255',
      'end',
      'show access-lists',
    ]);
    ls = run(ls, 'ADMIN-PC', ['ssh admin@10.180.10.5']);

    const pc = ls.devices['ADMIN-PC'];
    if (pc?.kind !== 'pc') throw new Error('ADMIN-PC is not a PC');
    expect(pc.lastSsh).toEqual({ target: '10.180.10.5', user: 'admin', ok: true });

    const result = grade(lab, ls);
    expect(result.objectives.map((o) => [o.id, o.met])).toEqual(result.objectives.map((o) => [o.id, true]));
    expect(result.allMet).toBe(true);
  });

  it('does not accept opening management SSH to any source', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'ADMIN-PC', ['ping 10.180.10.5', 'ssh admin@10.180.10.5']);
    ls = run(ls, 'R1', ['enable', 'show running-config | section line vty', 'show access-lists']);
    ls = run(ls, 'R1', ['configure terminal', 'access-list 23 permit any', 'end', 'show access-lists']);
    ls = run(ls, 'ADMIN-PC', ['ssh admin@10.180.10.5']);

    const fixObjective = grade(lab, ls).objectives.find((o) => o.id === 'narrow-acl-fix');
    expect(fixObjective?.met).toBe(false);
    expect(grade(lab, ls).allMet).toBe(false);
  });
});
