import { describe, expect, it } from 'vitest';
import { initLabSession, applyToDevice, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab24Ipv6AddressingDefaultGateway as lab } from './lab-24-ipv6-addressing-default-gateway';

function run(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

describe('Lab 24 — IPv6 addressing and default gateway', () => {
  it('starts incomplete with no IPv6 address on R1 and no PC default gateway', () => {
    const ls = initLabSession(lab);
    const r1 = ls.devices.R1;
    const pc = ls.devices['PC-A'];

    if (r1?.kind !== 'router') throw new Error('R1 is not a router');
    if (pc?.kind !== 'pc') throw new Error('PC-A is not a PC');

    expect(r1.device.interfaces['Gi0/0'].ipv6Addresses ?? []).toEqual([]);
    expect(pc.ipv6).toBeNull();
    expect(pc.gateway6).toBeNull();
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('grades complete after configuring R1 IPv6, PC-A IPv6, PC-A default gateway, and verification commands', () => {
    let ls = initLabSession(lab);

    ls = run(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ipv6 address 2001:db8:acad:10::1/64',
      'no shutdown',
      'end',
      'show ipv6 interface brief',
    ]);

    ls = run(ls, 'PC-A', [
      'New-NetIPAddress -InterfaceAlias Eth0 -IPAddress 2001:db8:acad:10::10 -PrefixLength 64 -DefaultGateway 2001:db8:acad:10::1',
      'Get-NetIPConfiguration',
    ]);

    expect(grade(lab, ls).allMet).toBe(true);
  });

  it('does not mark PC verification complete until ipconfig is run after the default gateway is configured', () => {
    let ls = initLabSession(lab);

    ls = run(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ipv6 address 2001:db8:acad:10::1/64',
      'no shutdown',
      'end',
      'show ipv6 interface brief',
    ]);
    ls = run(ls, 'PC-A', [
      'New-NetIPAddress -InterfaceAlias Eth0 -IPAddress 2001:db8:acad:10::10 -PrefixLength 64 -DefaultGateway 2001:db8:acad:10::1',
    ]);

    const result = grade(lab, ls);
    expect(result.objectives.find((o) => o.id === 'pc-verify')?.met).toBe(false);
    expect(result.allMet).toBe(false);
  });
});
