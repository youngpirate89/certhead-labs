import { describe, expect, it } from 'vitest';
import { initLabSession, applyToDevice, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab28WirelessWlanVlanMapping as lab } from './lab-28-wireless-wlan-vlan-mapping';

function run(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

describe('Lab 28 — Wireless WLAN-to-VLAN mapping', () => {
  it('starts incomplete with the controller cabled but no WLAN mapped to VLAN 20', () => {
    const ls = initLabSession(lab);
    const wlc = ls.devices.WLC1;
    if (wlc?.kind !== 'pc') throw new Error('WLC1 is not modeled by the scoped controller adapter');

    expect(wlc.wirelessController?.interfaces.has('CORP-USERS')).toBe(false);
    expect(wlc.wirelessController?.wlans.has(1)).toBe(false);
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('grades complete after creating a VLAN 20 dynamic interface, WLAN, mapping, enabling, and verifying', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'WLC1', [
      'config interface create CORP-USERS 20',
      'config wlan create 1 CORP-WIFI CORP-WIFI',
      'config wlan interface 1 CORP-USERS',
      'config wlan enable 1',
      'show wlan summary',
      'show wlan 1',
      'show client summary',
    ]);

    expect(grade(lab, ls).allMet).toBe(true);
  });

  it('does not satisfy verification objectives from show commands run before the WLAN is mapped', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'WLC1', ['show wlan summary', 'show wlan 1']);
    ls = run(ls, 'WLC1', [
      'config interface create CORP-USERS 20',
      'config wlan create 1 CORP-WIFI CORP-WIFI',
      'config wlan interface 1 CORP-USERS',
      'config wlan enable 1',
    ]);

    const result = grade(lab, ls);
    expect(result.objectives.find((o) => o.id === 'verify-wlan-summary')?.met).toBe(false);
    expect(result.objectives.find((o) => o.id === 'verify-wlan-detail')?.met).toBe(false);
    expect(result.allMet).toBe(false);
  });

  it('does not satisfy wireless-client outcome verification from show client summary run before the WLAN is enabled', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'WLC1', ['show client summary']);
    ls = run(ls, 'WLC1', [
      'config interface create CORP-USERS 20',
      'config wlan create 1 CORP-WIFI CORP-WIFI',
      'config wlan interface 1 CORP-USERS',
      'config wlan enable 1',
      'show wlan summary',
      'show wlan 1',
    ]);

    const result = grade(lab, ls);
    expect(result.objectives.find((o) => o.id === 'verify-client-service')?.met).toBe(false);
    expect(result.allMet).toBe(false);
  });
});
