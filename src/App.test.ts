import { describe, expect, it } from 'vitest';
import { resolveDevLabSelection } from '@/routing/devLabSelection';

describe('App route contract', () => {
  it('keeps query lab selection disabled for production public routes', () => {
    expect(resolveDevLabSelection('?lab=ccna-lab30-vlan-dhcp-ticket', false)).toBeNull();
    expect(resolveDevLabSelection('?pilot=static-routing', false)).toBeNull();
  });

  it('allows lab and pilot query selection only in dev mode', () => {
    expect(resolveDevLabSelection('?lab=ccna-lab30-vlan-dhcp-ticket', true)).toEqual({
      labId: 'ccna-lab30-vlan-dhcp-ticket',
      pilotSlug: null,
    });
    expect(resolveDevLabSelection('?pilot=static-routing', true)).toEqual({
      labId: null,
      pilotSlug: 'static-routing',
    });
  });

  it('falls back to TryMode when dev mode receives empty or unknown query keys', () => {
    expect(resolveDevLabSelection('', true)).toBeNull();
    expect(resolveDevLabSelection('?foo=ccna-lab30-vlan-dhcp-ticket', true)).toBeNull();
  });
});
