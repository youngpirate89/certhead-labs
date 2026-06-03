import { describe, expect, it } from 'vitest';
import { initLabSession, applyToDevice, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { tshootWirelessClientWrongVlan as lab } from './tshoot-wireless-client-wrong-vlan';

function run(ls: LabSession, deviceId: string, lines: readonly string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

function objectiveMet(ls: LabSession, id: string): boolean | undefined {
  return grade(lab, ls).objectives.find((objective) => objective.id === id)?.met;
}

describe('Ticket 15 — wireless client in wrong VLAN', () => {
  it('starts with SALES-WIFI mapped to the Guest VLAN and the laptop in the Guest subnet', () => {
    const ls = initLabSession(lab);
    const wlc = ls.devices.WLC;
    const laptop = ls.devices['LAPTOP-SALES'];
    if (wlc?.kind !== 'pc') throw new Error('WLC is not modeled by the scoped controller adapter');
    if (laptop?.kind !== 'pc') throw new Error('LAPTOP-SALES should be a PC endpoint');

    expect(wlc.wirelessController?.interfaces.get('GUEST-USERS')?.vlanId).toBe(99);
    expect(wlc.wirelessController?.interfaces.get('SALES-USERS')?.vlanId).toBe(30);
    expect(wlc.wirelessController?.wlans.get(1)).toMatchObject({
      ssid: 'SALES-WIFI',
      interfaceName: 'GUEST-USERS',
      enabled: true,
    });
    expect(laptop.ip).toMatch(/^10\.170\.99\./);
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('requires client subnet evidence before the WLAN mapping is changed', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'WLC', ['config wlan interface 1 SALES-USERS', 'show wlan summary']);
    ls = run(ls, 'LAPTOP-SALES', ['ipconfig']);

    expect(objectiveMet(ls, 'confirm-client-wrong-subnet')).toBe(false);
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('grades complete after inspecting symptoms, remapping WLAN 1 to Sales VLAN 30, and verifying', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'LAPTOP-SALES', ['ipconfig']);
    ls = run(ls, 'WLC', ['show wlan summary', 'show wlan 1']);
    ls = run(ls, 'WLC', ['config wlan interface 1 SALES-USERS', 'show wlan summary', 'show wlan 1', 'show client summary']);
    ls = run(ls, 'LAPTOP-SALES', ['ipconfig']);

    const wlc = ls.devices.WLC;
    if (wlc?.kind !== 'pc') throw new Error('WLC is not modeled by the scoped controller adapter');

    expect(wlc.wirelessController?.wlans.get(1)?.interfaceName).toBe('SALES-USERS');
    expect(grade(lab, ls).allMet).toBe(true);
  });

  it('does not complete if the learner only verifies the WLC and never rechecks the client after the fix', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'LAPTOP-SALES', ['ipconfig']);
    ls = run(ls, 'WLC', ['show wlan summary', 'config wlan interface 1 SALES-USERS', 'show wlan summary', 'show wlan 1', 'show client summary']);

    expect(objectiveMet(ls, 'verify-client-sales-subnet')).toBe(false);
    expect(grade(lab, ls).allMet).toBe(false);
  });
});
