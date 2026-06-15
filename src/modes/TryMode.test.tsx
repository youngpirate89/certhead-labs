import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CompletionBanner, FREE_LAB_REGISTER_URL } from './TryMode';
import { resolveTryModeLabId } from '@/routing/tryLabSelection';

vi.mock('@/analytics/posthog', () => ({
  initAnalytics: vi.fn(),
  track: vi.fn(),
}));

describe('TryMode public lab selection', () => {
  it('defaults to the first starter lab when no public lab query is present', () => {
    expect(resolveTryModeLabId('')).toBe('ccna-l01-interface-ip');
    expect(resolveTryModeLabId('?foo=ccna-lab07-vlan-access-ports')).toBe('ccna-l01-interface-ip');
  });

  it('allows only CCNA starter lab ids on the public try route', () => {
    expect(resolveTryModeLabId('?lab=ccna-lab07-vlan-access-ports')).toBe('ccna-lab07-vlan-access-ports');
    expect(resolveTryModeLabId('?lab=ccna-lab11-nat-pat')).toBe('ccna-l01-interface-ip');
  });
});

describe('TryMode completion CTA', () => {
  it('continues starter labs 1 through 9 to the next free starter lab in the same window', () => {
    render(<CompletionBanner labId="ccna-lab07-vlan-access-ports" />);

    expect(screen.getByText(/Next:/)).toHaveTextContent('Next: Starter 7, VLAN Trunking: Span One VLAN Across Two Switches.');

    const cta = screen.getByRole('link', { name: /Continue to next free lab/i });
    expect(cta.getAttribute('href')).toBe('/try?lab=ccna-lab08-vlan-trunking');
    expect(cta.getAttribute('target')).toBeNull();
    expect(cta.getAttribute('rel')).toBeNull();
  });

  it('sends the final free starter lab to the Pro unlock CTA outside the embedded lab iframe', () => {
    render(<CompletionBanner labId="ccna-lab15-default-static-route" />);

    expect(screen.getByText(/Next:/)).toHaveTextContent('Next: full CCNA lab track (Pro). Pro includes the full 50-lab CCNA library.');

    const cta = screen.getByRole('link', { name: /Unlock with CertHead Pro/i });
    expect(cta.getAttribute('href')).toBe(FREE_LAB_REGISTER_URL);
    expect(cta.getAttribute('target')).toBe('_blank');
    expect(cta.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
