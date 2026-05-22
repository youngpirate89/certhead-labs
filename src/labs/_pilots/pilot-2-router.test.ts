import { describe, it, expect } from 'vitest';
import { initLabSession, applyToActive, setActive } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { pilot2Router as lab } from './pilot-2-router';

describe('pilot 3a — 2-router lab', () => {
  it('instantiates two independent DeviceSessions + one link', () => {
    const ls = initLabSession(lab);
    expect(Object.keys(ls.devices)).toEqual(['R1', 'R2']);
    expect(ls.activeDeviceId).toBe('R1');
    expect(ls.links).toEqual([
      { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
    ]);
  });

  it('configuring R1 does NOT affect R2 (independent state machines)', () => {
    let ls = initLabSession(lab);
    for (const line of [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 10.0.0.1 255.255.255.0',
      'no shutdown',
    ]) {
      ls = applyToActive(ls, line).session;
    }
    expect(ls.devices.R1.device.interfaces['Gi0/0'].ip).toBe('10.0.0.1');
    expect(ls.devices.R1.device.interfaces['Gi0/0'].adminUp).toBe(true);
    expect(ls.devices.R2.device.interfaces['Gi0/0'].ip).toBeNull();
    expect(ls.devices.R2.device.interfaces['Gi0/0'].adminUp).toBe(false);
  });

  it('grades complete after both devices configured (state-only, no reachability)', () => {
    let ls = initLabSession(lab);
    for (const line of [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 10.0.0.1 255.255.255.0',
      'no shutdown',
    ]) {
      ls = applyToActive(ls, line).session;
    }
    expect(grade(lab, ls).allMet).toBe(false); // R2 still untouched

    ls = setActive(ls, 'R2');
    for (const line of [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 10.0.0.2 255.255.255.0',
      'no shutdown',
    ]) {
      ls = applyToActive(ls, line).session;
    }
    const result = grade(lab, ls);
    expect(result.allMet).toBe(true);
    expect(result.objectives.map((o) => o.id).sort()).toEqual([
      'r1-ip',
      'r1-up',
      'r2-ip',
      'r2-up',
    ]);
  });

  it('is not the free lab (must never appear in the deployed catalog)', () => {
    expect(lab.isFree).toBe(false);
  });
});
