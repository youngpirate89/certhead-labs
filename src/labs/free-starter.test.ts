import { describe, expect, it } from 'vitest';
import { FREE_CCNA_STARTER_LAB_IDS, getFreeCcnaStarterLabs, getFreeCcnaStarterLabById } from './free-starter';

describe('free CCNA starter labs', () => {
  it('exposes exactly ten public starter labs in learner order', () => {
    expect(FREE_CCNA_STARTER_LAB_IDS).toEqual([
      'ccna-l01-interface-ip',
      'ccna-lab02-network-discovery',
      'ccna-lab03-ipv4-subnetting-routed-interfaces',
      'ccna-lab04-static-route-fundamentals',
      'ccna-lab05-ospf-single-area',
      'ccna-lab07-vlan-access-ports',
      'ccna-lab08-vlan-trunking',
      'ccna-lab09-intervlan-routing',
      'ccna-lab10-dhcp-server',
      'ccna-lab15-default-static-route',
    ]);

    const labs = getFreeCcnaStarterLabs();
    expect(labs).toHaveLength(10);
    expect(labs.map((lab) => lab.id)).toEqual(FREE_CCNA_STARTER_LAB_IDS);
    expect(labs.every((lab) => lab.isFree)).toBe(true);
  });

  it('resolves only labs in the free starter set', () => {
    expect(getFreeCcnaStarterLabById('ccna-l01-interface-ip')?.title).toContain('Interface');
    expect(getFreeCcnaStarterLabById('ccna-lab11-nat-pat')).toBeNull();
    expect(getFreeCcnaStarterLabById('definitely-not-real')).toBeNull();
  });
});
