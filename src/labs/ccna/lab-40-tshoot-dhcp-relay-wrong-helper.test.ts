import { describe, expect, it } from 'vitest';
import { grade } from '@/engine/grading';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { lab40TshootDhcpRelayWrongHelper } from './lab-40-tshoot-dhcp-relay-wrong-helper';

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
  let cur = runOn(ls, 'PC-FINANCE', ['ipconfig']);
  cur = runOn(cur, 'PC-HR', ['ipconfig']);
  cur = runOn(cur, 'R1', [
    'enable',
    'show running-config interface gi0/1',
    'configure terminal',
    'interface gi0/1',
    'ip helper-address 10.80.0.10',
    'end',
    'show running-config interface gi0/1',
  ]);
  cur = runOn(cur, 'PC-FINANCE', ['ipconfig']);
  cur = runOn(cur, 'PC-HR', ['ipconfig']);
  return cur;
}

describe('Lab 40 - Troubleshoot wrong DHCP relay helper address', () => {
  it('starts with Finance relay pointing at the wrong helper while HR relay works', () => {
    const ls = initLabSession(lab40TshootDhcpRelayWrongHelper);
    const r1 = ls.devices.R1;
    const finance = ls.devices['PC-FINANCE'];
    const hr = ls.devices['PC-HR'];
    if (r1.kind !== 'router' || finance.kind !== 'pc' || hr.kind !== 'pc') throw new Error('shape');

    expect(r1.device.interfaces['Gi0/0'].helperAddress).toBe('10.80.0.10');
    expect(r1.device.interfaces['Gi0/1'].helperAddress).toBe('10.80.0.99');
    expect(finance.ip).toBeNull();
    expect(hr.ip).toMatch(/^10\.40\.40\./);
    expect(outputOn(ls, 'R1', 'show running-config interface gi0/1')).toContain('ip helper-address 10.80.0.99');
    expect(grade(lab40TshootDhcpRelayWrongHelper, ls).allMet).toBe(false);
  });

  it('requires comparing DHCP symptoms, correcting the helper, and verifying both subnets after repair', () => {
    const ls = applySolution(initLabSession(lab40TshootDhcpRelayWrongHelper));
    const r1 = ls.devices.R1;
    const finance = ls.devices['PC-FINANCE'];
    const hr = ls.devices['PC-HR'];
    if (r1.kind !== 'router' || finance.kind !== 'pc' || hr.kind !== 'pc') throw new Error('shape');

    expect(r1.device.interfaces['Gi0/1'].helperAddress).toBe('10.80.0.10');
    expect(finance.ip).toMatch(/^10\.50\.50\./);
    expect(finance.gateway).toBe('10.50.50.1');
    expect(hr.ip).toMatch(/^10\.40\.40\./);
    expect(hr.gateway).toBe('10.40.40.1');
    expect(outputOn(ls, 'R1', 'show running-config interface gi0/1')).toContain('ip helper-address 10.80.0.10');

    const g = grade(lab40TshootDhcpRelayWrongHelper, ls);
    expect(g.allMet).toBe(true);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual([
      ['compare-dhcp-symptoms', true],
      ['inspect-finance-helper', true],
      ['correct-finance-helper', true],
      ['verify-finance-lease', true],
      ['preserve-hr-lease', true],
    ]);
  });
});
