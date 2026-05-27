import { describe, it, expect } from 'vitest';
import {
  computeBinding,
  findPoolForIp,
  isExcluded,
  recomputeBindings,
  type DhcpClientRequest,
} from './dhcp';
import type { DhcpPool } from './state';

function pool(over: Partial<DhcpPool> = {}): DhcpPool {
  return {
    name: 'LAN',
    network: '192.168.1.0',
    mask: '255.255.255.0',
    defaultRouter: '192.168.1.1',
    dnsServer: '8.8.8.8',
    leaseDays: 1,
    ...over,
  };
}

describe('isExcluded', () => {
  it('returns true for an IP at the start of an inclusive range', () => {
    expect(isExcluded('192.168.1.1', [{ start: '192.168.1.1', end: '192.168.1.10' }])).toBe(true);
  });

  it('returns true for an IP at the end of an inclusive range', () => {
    expect(isExcluded('192.168.1.10', [{ start: '192.168.1.1', end: '192.168.1.10' }])).toBe(true);
  });

  it('returns false for an IP just past the end of a range', () => {
    expect(isExcluded('192.168.1.11', [{ start: '192.168.1.1', end: '192.168.1.10' }])).toBe(false);
  });

  it('handles single-host exclusion (start === end)', () => {
    const ex = [{ start: '192.168.1.5', end: '192.168.1.5' }];
    expect(isExcluded('192.168.1.5', ex)).toBe(true);
    expect(isExcluded('192.168.1.4', ex)).toBe(false);
    expect(isExcluded('192.168.1.6', ex)).toBe(false);
  });

  it('returns false for empty excluded list', () => {
    expect(isExcluded('192.168.1.5', [])).toBe(false);
  });
});

describe('computeBinding — single client', () => {
  it('returns the first available IP after the excluded range', () => {
    const ip = computeBinding(
      pool(),
      [{ start: '192.168.1.1', end: '192.168.1.10' }],
      'PC-A',
      ['PC-A'],
    );
    expect(ip).toBe('192.168.1.11');
  });

  it('skips the network and broadcast addresses', () => {
    // With no exclusions, the first allocatable address on 192.168.1.0/24
    // is .1 (network is .0, broadcast is .255). Both are reserved.
    const ip = computeBinding(pool(), [], 'PC-A', ['PC-A']);
    expect(ip).toBe('192.168.1.1');
  });

  it('returns undefined when the pool has no network configured', () => {
    expect(computeBinding(pool({ network: null }), [], 'PC-A', ['PC-A'])).toBeUndefined();
  });

  it('returns undefined when the pool has no mask configured', () => {
    expect(computeBinding(pool({ mask: null }), [], 'PC-A', ['PC-A'])).toBeUndefined();
  });

  it('skips single-host exclusions interleaved with the range', () => {
    const ip = computeBinding(
      pool(),
      [{ start: '192.168.1.1', end: '192.168.1.1' }],
      'PC-A',
      ['PC-A'],
    );
    // .1 is excluded; .0 is the network address; allocator returns .2.
    expect(ip).toBe('192.168.1.2');
  });
});

describe('computeBinding — multiple clients', () => {
  it('allocates sequential IPs deterministically by clientId sort', () => {
    const clients = ['PC-B', 'PC-A', 'PC-C'];
    const a = computeBinding(pool(), [], 'PC-A', clients);
    const b = computeBinding(pool(), [], 'PC-B', clients);
    const c = computeBinding(pool(), [], 'PC-C', clients);
    // Sorted order: PC-A, PC-B, PC-C → .1, .2, .3
    expect(a).toBe('192.168.1.1');
    expect(b).toBe('192.168.1.2');
    expect(c).toBe('192.168.1.3');
  });

  it('produces the same binding on repeated calls', () => {
    const clients = ['PC-A', 'PC-B'];
    expect(computeBinding(pool(), [], 'PC-A', clients)).toBe(
      computeBinding(pool(), [], 'PC-A', clients),
    );
  });
});

describe('recomputeBindings', () => {
  it('returns an empty map when there are no clients', () => {
    const pools = new Map<string, DhcpPool>([['LAN', pool()]]);
    expect(recomputeBindings(pools, [], []).size).toBe(0);
  });

  it('skips clients whose pool name is not in the router', () => {
    const pools = new Map<string, DhcpPool>([['LAN', pool()]]);
    const reqs: DhcpClientRequest[] = [{ clientId: 'PC-A', poolName: 'WAN' }];
    expect(recomputeBindings(pools, [], reqs).size).toBe(0);
  });

  it('skips clients whose pool is not ready', () => {
    const pools = new Map<string, DhcpPool>([['LAN', pool({ network: null })]]);
    const reqs: DhcpClientRequest[] = [{ clientId: 'PC-A', poolName: 'LAN' }];
    expect(recomputeBindings(pools, [], reqs).size).toBe(0);
  });

  it('allocates from the excluded-aware order', () => {
    const pools = new Map<string, DhcpPool>([['LAN', pool()]]);
    const reqs: DhcpClientRequest[] = [{ clientId: 'PC-A', poolName: 'LAN' }];
    const bindings = recomputeBindings(
      pools,
      [{ start: '192.168.1.1', end: '192.168.1.10' }],
      reqs,
    );
    expect(bindings.get('PC-A')?.ip).toBe('192.168.1.11');
    expect(bindings.get('PC-A')?.poolName).toBe('LAN');
  });

  it('is deterministic across runs', () => {
    const pools = new Map<string, DhcpPool>([['LAN', pool()]]);
    const reqs: DhcpClientRequest[] = [
      { clientId: 'PC-A', poolName: 'LAN' },
      { clientId: 'PC-B', poolName: 'LAN' },
    ];
    const a = recomputeBindings(pools, [], reqs);
    const b = recomputeBindings(pools, [], reqs);
    expect(a.get('PC-A')?.ip).toBe(b.get('PC-A')?.ip);
    expect(a.get('PC-B')?.ip).toBe(b.get('PC-B')?.ip);
  });
});

describe('findPoolForIp', () => {
  it('finds a pool whose network covers the IP', () => {
    const pools = new Map<string, DhcpPool>([['LAN', pool()]]);
    expect(findPoolForIp(pools, '192.168.1.50')?.name).toBe('LAN');
  });

  it('returns null when no pool matches', () => {
    const pools = new Map<string, DhcpPool>([['LAN', pool()]]);
    expect(findPoolForIp(pools, '10.0.0.5')).toBeNull();
  });

  it('skips pools that are not ready', () => {
    const pools = new Map<string, DhcpPool>([
      ['UNCFG', pool({ name: 'UNCFG', network: null, mask: null })],
      ['LAN', pool()],
    ]);
    expect(findPoolForIp(pools, '192.168.1.50')?.name).toBe('LAN');
  });
});
