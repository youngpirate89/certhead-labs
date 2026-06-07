import { describe, expect, it } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToDevice, initLabSession, type LabSession } from '@/engine/lab-session';
import { getLabById } from '@/labs/catalog';
import { tshootIpv6MissingDefaultGateway as lab } from './tshoot-ipv6-missing-default-gateway';

function run(ls: LabSession, deviceId: string, lines: readonly string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

function textOf(ls: LabSession, deviceId: string, command: string): string {
  return applyToDevice(ls, deviceId, command).output.map((o) => o.text).join('\n');
}

function objectiveMet(ls: LabSession, id: string): boolean {
  return grade(lab, ls).objectives.find((o) => o.id === id)?.met ?? false;
}

describe('Ticket 17 — IPv6 missing default gateway', () => {
  it('is a cataloged non-free CCNA ticket lab', () => {
    expect(lab.id).toBe('ccna-tshoot-ipv6-missing-default-gateway');
    expect(lab.title).toMatch(/IPv6 Default Gateway Missing/i);
    expect(lab.scenario).toMatch(/default gateway/i);
    expect(lab.isFree).toBe(false);
    expect(getLabById('ccna-tshoot-ipv6-missing-default-gateway')).toBe(lab);
  });

  it('starts with a configured IPv6 address on PC-OPS but no IPv6 default gateway', () => {
    const ls = initLabSession(lab);
    const pc = ls.devices['PC-OPS'];
    const r1 = ls.devices.R1;

    if (pc?.kind !== 'pc') throw new Error('PC-OPS is not a PC');
    if (r1?.kind !== 'router') throw new Error('R1 is not a router');

    expect(pc.ipv6).toBe('2001:db8:47:10::50/64');
    expect(pc.gateway6).toBeNull();
    expect(r1.device.interfaces['Gi0/0'].ipv6Addresses).toContain('2001:db8:47:10::1/64');
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('represents the off-link IPv6 application as passive visual context without orphan interfaces', () => {
    expect(lab.topology.devices.map((device) => device.id)).toEqual(['PC-OPS', 'R1']);
    expect(lab.topology.decorations).toContainEqual(
      expect.objectContaining({ id: 'IPV6-APP-NET', kind: 'wan-cloud', label: 'IPv6 App Network' }),
    );
  });

  it('renders the missing IPv6 default gateway in Get-NetIPConfiguration', () => {
    const ls = initLabSession(lab);

    const output = textOf(ls, 'PC-OPS', 'Get-NetIPConfiguration');
    expect(output).toMatch(/IPv6 Address.*2001:db8:47:10::50\/64/);
    expect(output).toMatch(/IPv6 Default Gateway .*\(none\)/);
  });

  it('grades complete only after inspecting PC and router state, configuring the gateway, and verifying again', () => {
    let ls = initLabSession(lab);

    ls = run(ls, 'PC-OPS', ['Get-NetIPConfiguration']);
    expect(objectiveMet(ls, 'inspect-pc-ipv6-state')).toBe(true);
    expect(objectiveMet(ls, 'verify-pc-gateway-after-fix')).toBe(false);

    ls = run(ls, 'R1', ['enable', 'show ipv6 interface brief']);
    expect(objectiveMet(ls, 'verify-router-gateway-address')).toBe(true);

    ls = run(ls, 'PC-OPS', [
      'New-NetIPAddress -InterfaceAlias Eth0 -IPAddress 2001:db8:47:10::50 -PrefixLength 64 -DefaultGateway 2001:db8:47:10::1',
    ]);
    expect(objectiveMet(ls, 'configure-pc-ipv6-default-gateway')).toBe(true);
    expect(objectiveMet(ls, 'verify-pc-gateway-after-fix')).toBe(false);

    ls = run(ls, 'PC-OPS', ['Get-NetIPConfiguration']);
    expect(grade(lab, ls).allMet).toBe(true);
  });

  it('does not complete if the PC is pointed at the wrong IPv6 gateway', () => {
    let ls = initLabSession(lab);

    ls = run(ls, 'PC-OPS', ['Get-NetIPConfiguration']);
    ls = run(ls, 'R1', ['enable', 'show ipv6 interface brief']);
    ls = run(ls, 'PC-OPS', [
      'New-NetIPAddress -InterfaceAlias Eth0 -IPAddress 2001:db8:47:10::50 -PrefixLength 64 -DefaultGateway 2001:db8:47:10::254',
      'Get-NetIPConfiguration',
    ]);

    expect(objectiveMet(ls, 'configure-pc-ipv6-default-gateway')).toBe(false);
    expect(grade(lab, ls).allMet).toBe(false);
  });
});
