import { describe, it, expect } from 'vitest';
import {
  buildDevice,
  isSubInterfaceId,
  normaliseInterface,
  parentInterfaceId,
} from './state';

describe('normaliseInterface — physical', () => {
  it.each([
    ['gi0/0', 'Gi0/0'],
    ['Gig0/1', 'Gi0/1'],
    ['GigabitEthernet0/2', 'Gi0/2'],
    ['fa0/0', 'Fa0/0'],
    ['FastEthernet0/1', 'Fa0/1'],
    ['G0/0/1', 'Gi0/0/1'],
  ])('%s → %s', (input, expected) => {
    expect(normaliseInterface(input)).toBe(expected);
  });

  it('rejects garbage', () => {
    expect(normaliseInterface('eth0')).toBeNull();
    expect(normaliseInterface('gi0')).toBeNull();
    expect(normaliseInterface('gi0/0.')).toBeNull();
    expect(normaliseInterface('')).toBeNull();
  });
});

describe('normaliseInterface — subinterface', () => {
  it.each([
    ['gi0/0.10', 'Gi0/0.10'],
    ['gigabitethernet0/0.10', 'Gi0/0.10'],
    ['GigabitEthernet0/0.20', 'Gi0/0.20'],
    ['Fa0/1.99', 'Fa0/1.99'],
    ['G0/0/1.5', 'Gi0/0/1.5'],
  ])('%s → %s', (input, expected) => {
    expect(normaliseInterface(input)).toBe(expected);
  });

  it('preserves the dot-suffix on physical names too', () => {
    // A subif id is the parent id + .<vlan>; round-tripping never confuses them.
    expect(normaliseInterface('Gi0/0')).toBe('Gi0/0');
    expect(normaliseInterface('Gi0/0.10')).toBe('Gi0/0.10');
  });

  it('isSubInterfaceId distinguishes physical from subif', () => {
    expect(isSubInterfaceId('Gi0/0')).toBe(false);
    expect(isSubInterfaceId('Gi0/0.10')).toBe(true);
    expect(isSubInterfaceId('Fa0/1.99')).toBe(true);
  });

  it('parentInterfaceId strips the dot-suffix', () => {
    expect(parentInterfaceId('Gi0/0.10')).toBe('Gi0/0');
    expect(parentInterfaceId('Fa0/1.99')).toBe('Fa0/1');
    // Non-subif id passes through unchanged.
    expect(parentInterfaceId('Gi0/0')).toBe('Gi0/0');
  });
});

describe('buildDevice', () => {
  it('initialises an empty subInterfaces map', () => {
    const d = buildDevice({ id: 'R1', platform: 'ISR4321', interfaces: ['Gi0/0'] });
    expect(d.subInterfaces).toEqual({});
  });
});
