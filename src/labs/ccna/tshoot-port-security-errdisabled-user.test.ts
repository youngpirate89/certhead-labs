import { describe, expect, it } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToDevice, initLabSession, type LabSession } from '@/engine/lab-session';
import { canReach } from '@/engine/reachability';
import { getLabById } from '@/labs/catalog';
import { tshootPortSecurityErrdisabledUser as lab } from './tshoot-port-security-errdisabled-user';

function run(ls: LabSession, deviceId: string, lines: readonly string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

function textOf(ls: LabSession, deviceId: string, command: string): string {
  return applyToDevice(ls, deviceId, command).output.map((o) => o.text).join('\n');
}

function objectiveMet(ls: LabSession, id: string): boolean {
  return grade(lab, ls).objectives.find((o) => o.id === id)?.met ?? false;
}

describe('Ticket 16 — port-security err-disabled user', () => {
  it('is a cataloged non-free CCNA ticket lab', () => {
    expect(lab.id).toBe('ccna-tshoot-port-security-errdisabled-user');
    expect(lab.title).toMatch(/Port Security Err-Disabled User/i);
    expect(lab.scenario).toMatch(/desk move/i);
    expect(lab.isFree).toBe(false);
    expect(getLabById('ccna-tshoot-port-security-errdisabled-user')).toBe(lab);
  });

  it('starts with the user access port secure-shutdown/err-disabled and reachability broken', () => {
    const ls = initLabSession(lab);
    const sw1 = ls.devices.SW1;
    if (sw1.kind !== 'switch') throw new Error('SW1 should be a switch');
    const port = sw1.device.switchports['Fa0/12'];

    expect(port).toMatchObject({
      mode: 'access',
      accessVlan: 20,
      adminUp: false,
      portSecurity: {
        enabled: true,
        maximum: 1,
        violationMode: 'shutdown',
        violation: true,
        secureMac: '0011.2233.4455',
        sticky: true,
      },
    });
    expect(canReach(ls, 'PC-USER', '10.200.20.60')).toEqual({
      ok: false,
      failedAt: { direction: 'forward', deviceId: 'PC-USER', iface: null, reason: 'source-nic-down' },
    });
    expect(grade(lab, ls).objectives.map((o) => o.met)).toEqual([false, false, false, false, false]);
  });

  it('renders Cisco-style show interfaces status and show port-security interface output', () => {
    const ls = initLabSession(lab);

    const status = textOf(ls, 'SW1', 'show interfaces status');
    expect(status).toMatch(/Port\s+Name\s+Status\s+Vlan\s+Duplex\s+Speed\s+Type/);
    expect(status).toMatch(/Fa0\/12\s+User-desk-move\s+err-disabled\s+20\s+auto\s+auto\s+10\/100BaseTX/);

    const portSecurity = textOf(ls, 'SW1', 'show port-security interface Fa0/12');
    expect(portSecurity).toMatch(/Port Security\s+: Enabled/);
    expect(portSecurity).toMatch(/Port Status\s+: Secure-shutdown/);
    expect(portSecurity).toMatch(/Violation Mode\s+: Shutdown/);
    expect(portSecurity).toMatch(/Maximum MAC Addresses\s+: 1/);
    expect(portSecurity).toMatch(/Sticky MAC Addresses\s+: 1/);
    expect(portSecurity).toMatch(/Last Source Address:Vlan\s+: 00aa\.bbbb\.cccc:20/);
  });

  it('requires symptom ping, switch inspection, narrow secure-MAC cleanup, bounce, status verification, and final ping', () => {
    let ls = initLabSession(lab);

    ls = run(ls, 'PC-USER', ['ping 10.200.20.60']);
    expect(objectiveMet(ls, 'confirm-user-reachability-failure')).toBe(true);

    ls = run(ls, 'SW1', ['enable', 'show interfaces status', 'show port-security interface Fa0/12']);
    expect(objectiveMet(ls, 'inspect-port-security-state')).toBe(true);

    ls = run(ls, 'SW1', [
      'configure terminal',
      'interface Fa0/12',
      'no switchport port-security mac-address sticky 0011.2233.4455',
      'shutdown',
      'no shutdown',
      'end',
    ]);
    expect(objectiveMet(ls, 'remove-stale-secure-mac')).toBe(true);
    expect(objectiveMet(ls, 'recover-access-port')).toBe(false);

    ls = run(ls, 'SW1', ['show interfaces status']);
    expect(objectiveMet(ls, 'recover-access-port')).toBe(true);
    expect(canReach(ls, 'PC-USER', '10.200.20.60')).toEqual({ ok: true });

    ls = run(ls, 'PC-USER', ['ping 10.200.20.60']);
    expect(grade(lab, ls).allMet).toBe(true);
  });

  it('does not accept a blind bounce without removing the stale secure MAC', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'PC-USER', ['ping 10.200.20.60']);
    ls = run(ls, 'SW1', [
      'enable',
      'show interfaces status',
      'show port-security interface Fa0/12',
      'configure terminal',
      'interface Fa0/12',
      'shutdown',
      'no shutdown',
      'end',
      'show interfaces status',
    ]);
    ls = run(ls, 'PC-USER', ['ping 10.200.20.60']);

    expect(objectiveMet(ls, 'remove-stale-secure-mac')).toBe(false);
    expect(grade(lab, ls).allMet).toBe(false);
  });
});
