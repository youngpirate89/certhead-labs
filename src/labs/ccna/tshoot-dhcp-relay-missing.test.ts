import { describe, it, expect } from 'vitest';
import { applyToActive, initLabSession, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { getLabById } from '@/labs/catalog';
import { tshootDhcpRelayMissing as lab } from './tshoot-dhcp-relay-missing';

function runOn(ls: LabSession, id: string, lines: readonly string[]): LabSession {
  let cur: LabSession = { ...ls, activeDeviceId: id };
  for (const line of lines) cur = applyToActive(cur, line).session;
  return cur;
}

function textOf(ls: LabSession, id: string, line: string): string {
  const res = applyToActive({ ...ls, activeDeviceId: id }, line);
  return res.output.map((o) => o.text).join('\n');
}

function objectiveMet(ls: LabSession, id: string): boolean {
  return grade(lab, ls).objectives.find((o) => o.id === id)?.met ?? false;
}

describe('tshoot-dhcp-relay-missing — starting ticket state', () => {
  it('declares a non-free CCNA ticket lab and resolves from the catalog', () => {
    expect(lab.id).toBe('ccna-tshoot-dhcp-relay-missing');
    expect(lab.title).toMatch(/Missing DHCP Relay/i);
    expect(lab.scenario).toMatch(/APIPA|169\.254/i);
    expect(lab.isFree).toBe(false);
    expect(getLabById('ccna-tshoot-dhcp-relay-missing')).toBe(lab);
  });

  it('starts with a working subnet lease and an affected subnet with APIPA symptoms', () => {
    const ls = initLabSession(lab);
    const working = ls.devices['PC-OPS'];
    const affected = ls.devices['PC-SALES'];
    if (working.kind !== 'pc' || affected.kind !== 'pc') throw new Error('PC shape');

    expect(working.ip).toBe('10.20.20.21');
    expect(working.gateway).toBe('10.20.20.1');
    expect(affected.ip).toBeNull();
    expect(affected.gateway).toBeNull();

    const output = textOf(ls, 'PC-SALES', 'ipconfig');
    expect(output).toMatch(/IPv4 Address.*169\.254\./);
    expect(output).toMatch(/Subnet Mask.*255\.255\.0\.0/);
    expect(output).toMatch(/Default Gateway.*\(none\)/);
  });

  it('has only the working user gateway configured with a DHCP helper-address', () => {
    const r1 = initLabSession(lab).devices.R1;
    if (r1.kind !== 'router') throw new Error('R1 shape');
    expect(r1.device.interfaces['Gi0/0'].helperAddress).toBe('10.60.0.10');
    expect(r1.device.interfaces['Gi0/1'].helperAddress).toBeUndefined();
    expect(r1.device.interfaces['Gi0/2'].ip).toBe('10.60.0.1');
  });

  it('all objectives are unmet at the start', () => {
    const g = grade(lab, initLabSession(lab));
    expect(g.allMet).toBe(false);
    expect(g.objectives).toHaveLength(5);
    for (const o of g.objectives) expect(o.met).toBe(false);
  });
});

describe('tshoot-dhcp-relay-missing — repair path', () => {
  it('running ipconfig on both PCs completes symptom comparison only', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'PC-SALES', ['ipconfig']);
    ls = runOn(ls, 'PC-OPS', ['ipconfig']);
    expect(objectiveMet(ls, 'compare-dhcp-symptoms')).toBe(true);
    expect(objectiveMet(ls, 'restore-sales-helper')).toBe(false);
    expect(objectiveMet(ls, 'verify-sales-lease')).toBe(false);
  });

  it('adding the helper-address restores the lease but still requires a post-fix ipconfig verification', () => {
    let ls = initLabSession(lab);
    ls = runOn(ls, 'R1', ['enable', 'configure terminal', 'interface gi0/1', 'ip helper-address 10.60.0.10', 'end']);
    const pc = ls.devices['PC-SALES'];
    if (pc.kind !== 'pc') throw new Error('PC-SALES shape');

    expect(pc.ip).toBe('10.30.30.21');
    expect(pc.mask).toBe('255.255.255.0');
    expect(pc.gateway).toBe('10.30.30.1');
    expect(objectiveMet(ls, 'restore-sales-helper')).toBe(true);
    expect(objectiveMet(ls, 'verify-sales-lease')).toBe(false);
  });

  it('published troubleshooting workflow satisfies every objective', () => {
    let ls = initLabSession(lab);
    for (const step of lab.solution!.steps) {
      ls = runOn(ls, step.device, step.commands);
    }
    const g = grade(lab, ls);
    expect(g.objectives.map((o) => [o.id, o.met])).toEqual(g.objectives.map((o) => [o.id, true]));
    expect(g.allMet).toBe(true);
  });
});
