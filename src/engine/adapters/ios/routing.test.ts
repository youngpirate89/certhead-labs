import { describe, it, expect } from 'vitest';
import {
  connectedRoutes,
  ipInSubnet,
  intToIp,
  ipToInt,
  longestPrefixMatch,
  maskLength,
  networkAddress,
  type Route,
} from './routing';
import { buildDevice } from './state';

describe('routing — bit utilities', () => {
  it('ipToInt / intToIp round-trip', () => {
    for (const ip of ['0.0.0.0', '10.0.0.1', '192.168.1.255', '255.255.255.255']) {
      expect(intToIp(ipToInt(ip))).toBe(ip);
    }
  });

  it('maskLength counts contiguous leading 1 bits', () => {
    expect(maskLength('255.255.255.0')).toBe(24);
    expect(maskLength('255.255.255.252')).toBe(30);
    expect(maskLength('255.255.0.0')).toBe(16);
    expect(maskLength('0.0.0.0')).toBe(0);
    expect(maskLength('255.255.255.255')).toBe(32);
  });

  it('networkAddress clears host bits', () => {
    expect(networkAddress('192.168.1.42', '255.255.255.0')).toBe('192.168.1.0');
    expect(networkAddress('10.0.0.5', '255.0.0.0')).toBe('10.0.0.0');
    expect(networkAddress('192.168.1.0', '255.255.255.0')).toBe('192.168.1.0');
  });

  it('ipInSubnet matches addresses within a prefix/mask', () => {
    expect(ipInSubnet('192.168.1.42', '192.168.1.0', '255.255.255.0')).toBe(true);
    expect(ipInSubnet('192.168.2.1', '192.168.1.0', '255.255.255.0')).toBe(false);
    expect(ipInSubnet('10.0.0.255', '10.0.0.0', '255.0.0.0')).toBe(true);
  });
});

describe('routing — connectedRoutes derivation', () => {
  function device() {
    return buildDevice({ id: 'R1', platform: 'ISR4321', interfaces: ['Gi0/0', 'Gi0/1'] });
  }

  it('produces a route only for interfaces that are up AND have IP/mask', () => {
    const d = device();
    expect(connectedRoutes(d)).toEqual([]); // both down, no IPs

    d.interfaces['Gi0/0'].ip = '192.168.1.1';
    d.interfaces['Gi0/0'].mask = '255.255.255.0';
    expect(connectedRoutes(d)).toEqual([]); // IP set but admin-down

    d.interfaces['Gi0/0'].adminUp = true;
    const routes = connectedRoutes(d);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toEqual({
      prefix: '192.168.1.0',
      mask: '255.255.255.0',
      egressIface: 'Gi0/0',
      source: 'connected',
      adminDistance: 0,
    });
  });

  it('drops the connected route when an interface goes admin-down', () => {
    const d = device();
    d.interfaces['Gi0/0'].ip = '192.168.1.1';
    d.interfaces['Gi0/0'].mask = '255.255.255.0';
    d.interfaces['Gi0/0'].adminUp = true;
    expect(connectedRoutes(d)).toHaveLength(1);

    d.interfaces['Gi0/0'].adminUp = false;
    expect(connectedRoutes(d)).toEqual([]);
  });
});

describe('routing — longestPrefixMatch tiebreaks (§5)', () => {
  function r(prefix: string, mask: string, source: Route['source'], extra: Partial<Route> = {}): Route {
    return {
      prefix,
      mask,
      source,
      adminDistance: source === 'connected' ? 0 : 1,
      ...extra,
    };
  }

  it('picks the most specific (longest mask) match', () => {
    const table: Route[] = [
      r('0.0.0.0', '0.0.0.0', 'static', { nextHop: '10.0.0.1' }),       // default
      r('10.0.0.0', '255.0.0.0', 'static', { nextHop: '192.168.0.1' }), // /8
      r('10.1.0.0', '255.255.0.0', 'static', { nextHop: '192.168.0.2' }), // /16
    ];
    const match = longestPrefixMatch(table, '10.1.2.3');
    expect(match?.prefix).toBe('10.1.0.0');
    expect(match?.mask).toBe('255.255.0.0');
  });

  it('on equal mask length, prefers lower adminDistance (connected < static)', () => {
    const table: Route[] = [
      r('192.168.1.0', '255.255.255.0', 'static', { nextHop: '10.0.0.1' }),
      r('192.168.1.0', '255.255.255.0', 'connected', { egressIface: 'Gi0/0' }),
    ];
    const match = longestPrefixMatch(table, '192.168.1.42');
    expect(match?.source).toBe('connected');
  });

  it('on equal mask + equal adminDistance, uses insertion order (stable)', () => {
    const table: Route[] = [
      r('192.168.1.0', '255.255.255.0', 'static', { nextHop: '10.0.0.1' }),
      r('192.168.1.0', '255.255.255.0', 'static', { nextHop: '10.0.0.2' }),
    ];
    const match = longestPrefixMatch(table, '192.168.1.42');
    expect(match?.nextHop).toBe('10.0.0.1');
  });

  it('returns undefined when no route covers the destination', () => {
    const table: Route[] = [
      r('192.168.1.0', '255.255.255.0', 'static', { nextHop: '10.0.0.1' }),
    ];
    expect(longestPrefixMatch(table, '8.8.8.8')).toBeUndefined();
  });

  it('matches the default route 0.0.0.0/0 only when nothing else fits', () => {
    const table: Route[] = [
      r('0.0.0.0', '0.0.0.0', 'static', { nextHop: '10.0.0.1' }),
      r('192.168.1.0', '255.255.255.0', 'static', { nextHop: '10.0.0.2' }),
    ];
    expect(longestPrefixMatch(table, '8.8.8.8')?.prefix).toBe('0.0.0.0');
    expect(longestPrefixMatch(table, '192.168.1.5')?.prefix).toBe('192.168.1.0');
  });
});
