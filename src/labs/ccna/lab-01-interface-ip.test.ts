import { describe, it, expect } from 'vitest';
import { applyCommand } from '@/engine/adapters/ios/interpret';
import { createSession, buildDevice, type Session } from '@/engine/adapters/ios/state';
import { initLabSession, applyToDevice, type LabSession } from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab01InterfaceIp as lab } from './lab-01-interface-ip';

function start(): Session {
  return createSession(buildDevice(lab.topology.devices[0]));
}

function run(s: Session, lines: string[]): Session {
  return lines.reduce((acc, line) => applyCommand(acc, line).session, s);
}

describe('free lab — pilot validation', () => {
  it('declares exactly one free lab via isFree', () => {
    expect(lab.isFree).toBe(true);
  });

  it('starts with no objectives met', () => {
    expect(grade(lab, start()).allMet).toBe(false);
  });

  it('grades complete after the full solution (canonical commands)', () => {
    const s = run(start(), [
      'enable',
      'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'end',
      'show ip interface brief',
    ]);
    expect(grade(lab, s).allMet).toBe(true);
  });

  it('grades complete with abbreviated commands too', () => {
    const s = run(start(), [
      'en',
      'conf t',
      'int gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shut',
      'end',
      'sh ip int br',
    ]);
    expect(grade(lab, s).allMet).toBe(true);
  });

  // Regression: every valid abbreviation of `show ip interface brief` must
  // satisfy the verify objective. Previously the objective regex only matched
  // `sh`/`show`, `int`/`interface`, `br`/`brief`, so forms like `sho`, `inte`,
  // `bri`, `brie` silently failed even though the resolver accepted them.
  it.each([
    'show ip interface brief',
    'sho ip interface brief',
    'sh ip interface brief',
    'show ip int br',
    'show ip int brie',
    'sh ip inte bri',
  ])('marks verify met for valid abbreviation: "%s"', (line) => {
    const s = run(start(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'end',
      line,
    ]);
    const verify = grade(lab, s).objectives.find((o) => o.id === 'verify');
    expect(verify?.met).toBe(true);
  });

  it('leaves verify unmet until show ip interface brief is run', () => {
    const s = run(start(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
    ]);
    const result = grade(lab, s);
    expect(result.objectives.find((o) => o.id === 'ip')?.met).toBe(true);
    expect(result.objectives.find((o) => o.id === 'noshut')?.met).toBe(true);
    expect(result.objectives.find((o) => o.id === 'verify')?.met).toBe(false);
    expect(result.allMet).toBe(false);
  });

  it('does not satisfy verify when show ip interface brief still shows Gi0/0 down', () => {
    const s = run(start(), ['enable', 'show ip interface brief']);
    const result = grade(lab, s);
    expect(result.objectives.find((o) => o.id === 'ip')?.met).toBe(false);
    expect(result.objectives.find((o) => o.id === 'noshut')?.met).toBe(false);
    expect(result.objectives.find((o) => o.id === 'verify')?.met).toBe(false);
    expect(result.allMet).toBe(false);
  });

  it('does not mark the IP objective complete for the wrong address on Gi0/0', () => {
    const s = run(start(), [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.10.1 255.255.255.0',
      'no shutdown',
      'end',
      'show ip interface brief',
    ]);
    const result = grade(lab, s);
    expect(result.objectives.find((o) => o.id === 'ip')?.met).toBe(false);
    expect(result.objectives.find((o) => o.id === 'noshut')?.met).toBe(true);
    expect(result.objectives.find((o) => o.id === 'verify')?.met).toBe(false);
    expect(result.allMet).toBe(false);
  });
});

/**
 * Topology contract for the up/up fix: R1 has a passive upstream switch peer
 * on Gi0/0 so `no shutdown` brings the line protocol genuinely up. The peer
 * carries no objectives and no setup — it exists only as a link partner.
 */
describe('free lab — Gi0/0 reaches genuine up/up via the upstream switch peer', () => {
  function r1Gi0(ls: LabSession) {
    const r1 = ls.devices.R1;
    if (r1.kind !== 'router') throw new Error('R1 is not a router');
    return r1.device.interfaces['Gi0/0'];
  }

  it('declares R1 + a passive switch peer cabled to Gi0/0 (R1 stays first)', () => {
    expect(lab.topology.devices).toHaveLength(2);
    expect(lab.topology.devices[0].id).toBe('R1');
    const peer = lab.topology.devices[1];
    expect(peer.kind).toBe('switch');
    expect(lab.topology.links).toHaveLength(1);
    expect(lab.topology.links[0]).toEqual({
      a: { deviceId: 'R1', iface: 'Gi0/0' },
      b: { deviceId: peer.id, iface: peer.interfaces[0] },
    });
    // No objective and no solution step references the peer — it is data-only.
    const ids = [peer.id];
    for (const o of lab.objectives) expect(o.text).not.toContain(peer.id);
    for (const step of lab.solution?.steps ?? []) {
      expect(ids).not.toContain(step.device);
    }
  });

  it('Gi0/0 is admin-down + protocol-down at load (the lab\'s whole point)', () => {
    const gi0 = r1Gi0(initLabSession(lab));
    expect(gi0.adminUp).toBe(false);
    expect(gi0.protocolUp).toBe(false);
  });

  it('after the full solution Gi0/0 is genuinely up/up (admin + line protocol)', () => {
    let ls = initLabSession(lab);
    for (const line of [
      'enable',
      'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'end',
      'show ip interface brief',
    ]) {
      ls = applyToDevice(ls, 'R1', line).session;
    }
    const gi0 = r1Gi0(ls);
    expect(gi0.adminUp).toBe(true);
    expect(gi0.protocolUp).toBe(true);
    expect(grade(lab, ls).allMet).toBe(true);
  });

  it('shutdown after coming up drops Gi0/0 back to protocol-down', () => {
    let ls = initLabSession(lab);
    for (const line of [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'shutdown',
    ]) {
      ls = applyToDevice(ls, 'R1', line).session;
    }
    const gi0 = r1Gi0(ls);
    expect(gi0.adminUp).toBe(false);
    expect(gi0.protocolUp).toBe(false);
  });
});
