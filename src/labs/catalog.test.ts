import { describe, it, expect } from 'vitest';
import { getLabById } from './catalog';
import { lab01InterfaceIp } from './ccna/lab-01-interface-ip';

// Stable, permanent ids the embed/JWT contract will encode. Adding a lab to
// the catalog requires adding its id here — that's the point: the test is the
// catalog membership contract.
const CATALOG_IDS = [
  'ccna-l01-interface-ip',
  'ccna-lab05-ospf-single-area',
  'ccna-lab06-standard-acl',
  'ccna-lab07-vlan-access-ports',
  'ccna-lab08-vlan-trunking',
  'ccna-lab09-intervlan-routing',
  'ccna-tshoot-return-route',
  'ccna-tshoot-wrong-next-hop',
  'ccna-tshoot-wan-subnet-mismatch',
  'ccna-tshoot-egress-down',
] as const;

describe('lab catalog — getLabById', () => {
  it.each(CATALOG_IDS)('resolves catalog id %s to a Lab', (id) => {
    const lab = getLabById(id);
    expect(lab).not.toBeNull();
    // Belt-and-braces: the returned lab's id matches the lookup key.
    expect(lab?.id).toBe(id);
  });

  it('returns null for an unknown id', () => {
    expect(getLabById('definitely-not-a-real-lab')).toBeNull();
  });

  it('returns null for the empty string', () => {
    expect(getLabById('')).toBeNull();
  });

  it('still resolves the free lab — same object, isFree intact, id unchanged', () => {
    const lab = getLabById('ccna-l01-interface-ip');
    expect(lab).toBe(lab01InterfaceIp);
    expect(lab?.isFree).toBe(true);
    expect(lab?.id).toBe('ccna-l01-interface-ip');
  });

  it('the free lab is the only catalog member with isFree: true', () => {
    const free = CATALOG_IDS.map((id) => getLabById(id)).filter((l) => l?.isFree === true);
    expect(free).toHaveLength(1);
    expect(free[0]?.id).toBe('ccna-l01-interface-ip');
  });
});
