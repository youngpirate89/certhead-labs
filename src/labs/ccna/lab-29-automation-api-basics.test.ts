import { describe, expect, it } from 'vitest';
import { initLabSession, applyToDevice, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab29AutomationApiBasics as lab } from './lab-29-automation-api-basics';

function run(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

describe('Lab 29 — Automation/API basics', () => {
  it('starts incomplete before any API facts have been queried', () => {
    const ls = initLabSession(lab);
    const admin = ls.devices['Admin-PC'];
    if (admin?.kind !== 'pc') throw new Error('Admin-PC should be modeled as a workstation');

    expect(admin.lastApiInventory).toBe(0);
    expect(admin.lastApiDeviceDetail.get('R1')).toBeUndefined();
    expect(grade(lab, ls).allMet).toBe(false);
  });

  it('grades complete after the learner queries inventory, R1 detail, SW1 detail, R1 interfaces, and selects Gi0/0 as management', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'Admin-PC', [
      'curl http://api.certhead.local/devices',
      'curl http://api.certhead.local/devices/R1',
      'curl http://api.certhead.local/devices/SW1',
      'curl http://api.certhead.local/devices/R1/interfaces',
      'curl http://api.certhead.local/devices/R1/interfaces/Gi0%2F0',
    ]);

    expect(grade(lab, ls).allMet).toBe(true);
  });

  it('does not satisfy R1 management-interface selection from inventory and device detail only', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'Admin-PC', [
      'curl http://api.certhead.local/devices',
      'curl http://api.certhead.local/devices/R1',
      'curl http://api.certhead.local/devices/SW1',
    ]);

    const result = grade(lab, ls);
    expect(result.objectives.find((o) => o.id === 'select-r1-management-interface')?.met).toBe(false);
    expect(result.allMet).toBe(false);
  });

  it('does not satisfy R1 management-interface selection until Gi0/0 is queried after the interface list', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'Admin-PC', [
      'curl http://api.certhead.local/devices',
      'curl http://api.certhead.local/devices/R1',
      'curl http://api.certhead.local/devices/SW1',
      'curl http://api.certhead.local/devices/R1/interfaces/Gi0%2F0',
      'curl http://api.certhead.local/devices/R1/interfaces',
    ]);

    const result = grade(lab, ls);
    expect(result.objectives.find((o) => o.id === 'select-r1-management-interface')?.met).toBe(false);
    expect(result.allMet).toBe(false);
  });
});
