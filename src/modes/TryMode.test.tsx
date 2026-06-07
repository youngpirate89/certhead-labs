import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CompletionBanner, FREE_LAB_REGISTER_URL } from './TryMode';

vi.mock('@/analytics/posthog', () => ({
  initAnalytics: vi.fn(),
  track: vi.fn(),
}));

describe('TryMode completion CTA', () => {
  it('opens the CertHead registration upsell outside the embedded lab iframe', () => {
    render(<CompletionBanner labId="ccna-l01-interface-ip" />);

    const cta = screen.getByRole('link', { name: /Unlock with CertHead Pro/i });
    expect(cta.getAttribute('href')).toBe(FREE_LAB_REGISTER_URL);
    expect(cta.getAttribute('target')).toBe('_blank');
    expect(cta.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
