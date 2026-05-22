import { describe, it, expect } from 'vitest';
import { applyCommand } from '@/engine/adapters/ios/interpret';
import { createSession, buildDevice, type Session } from '@/engine/adapters/ios/state';
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
});
