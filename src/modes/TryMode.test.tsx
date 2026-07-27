import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompletionBanner, TryMode } from './TryMode';
import { resolveTryModeLabId } from '@/routing/tryLabSelection';
import { track } from '@/analytics/posthog';

const mocked = vi.hoisted(() => ({
  session: {
    commandCount: 0,
    allMet: false,
  },
}));

vi.mock('@/analytics/posthog', () => ({
  initAnalytics: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@/engine/terminal/useLabSession', () => ({
  useLabSession: () => ({
    ...mocked.session,
    devices: [],
    objectives: [],
    activeDeviceId: 'R1',
    openDeviceIds: [],
    resetToken: 0,
    reset: vi.fn(),
    setActiveDevice: vi.fn(),
    forDevice: vi.fn(),
    deviceKind: vi.fn(),
    pcNetwork: vi.fn(),
    updatePcNetwork: vi.fn(),
    closeDevice: vi.fn(),
    closeAllDevices: vi.fn(),
  }),
}));

vi.mock('@/components/Layout', () => ({
  Layout: () => <div>Lab workspace</div>,
}));
vi.mock('@/components/LabBrief', () => ({
  LabBrief: ({ onStart }: { onStart: () => void }) => <button onClick={onStart}>Start lab</button>,
}));

beforeEach(() => {
  mocked.session.commandCount = 0;
  mocked.session.allMet = false;
  vi.mocked(track).mockClear();
  window.history.replaceState({}, '', '/try?lab=ccna-starter-10-default-route');
});

describe('TryMode public lab selection', () => {
  it('defaults to the first starter lab when no public lab query is present', () => {
    expect(resolveTryModeLabId('')).toBe('ccna-starter-01-interface-ip');
    expect(resolveTryModeLabId('?foo=ccna-starter-06-vlan-access-port')).toBe('ccna-starter-01-interface-ip');
  });

  it('allows only CCNA starter lab ids on the public try route', () => {
    expect(resolveTryModeLabId('?lab=ccna-starter-06-vlan-access-port')).toBe('ccna-starter-06-vlan-access-port');
    expect(resolveTryModeLabId('?lab=ccna-lab11-nat-pat')).toBe('ccna-starter-01-interface-ip');
  });
});

describe('TryMode completion CTA', () => {
  it('continues starter labs 1 through 9 to the next free starter lab in the same window', () => {
    render(<CompletionBanner labId="ccna-starter-06-vlan-access-port" />);

    expect(screen.getByText(/Next:/)).toHaveTextContent('Next: Starter 7, Allow a VLAN Across a Trunk.');

    const cta = screen.getByRole('link', { name: /Continue to next free lab/i });
    expect(cta.getAttribute('href')).toBe('/try?lab=ccna-starter-07-vlan-trunk');
    expect(cta.getAttribute('target')).toBeNull();
    expect(cta.getAttribute('rel')).toBeNull();
  });

  it('sends the final free starter lab to the Pro unlock CTA outside the embedded lab iframe', () => {
    render(<CompletionBanner labId="ccna-starter-10-default-route" />);

    expect(screen.getByText(/Next:/)).toHaveTextContent('Next: full CCNA lab track (Pro). Pro includes the full 60-lab CCNA library.');

    const cta = screen.getByRole('link', { name: /Unlock with CertHead Pro/i });
    const registerUrl = new URL(cta.getAttribute('href')!);
    expect(registerUrl.searchParams.get('source')).toBe('free-lab');
    expect(registerUrl.searchParams.get('lab')).toBe('ccna-starter-10-default-route');
    const upgradeUrl = new URL(registerUrl.searchParams.get('redirect')!, registerUrl.origin);
    expect(upgradeUrl.pathname).toBe('/upgrade');
    expect(upgradeUrl.searchParams.get('redirect')).toBe('/labs');
    expect(cta.getAttribute('target')).toBe('_blank');
    expect(cta.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('emits the anonymous conversion funnel with only lab-scoped non-PII properties', async () => {
    const view = render(<TryMode />);
    await waitFor(() => expect(track).toHaveBeenCalledWith('lab_viewed', { labId: 'ccna-starter-10-default-route' }));

    fireEvent.click(screen.getByRole('button', { name: 'Start lab' }));
    mocked.session.commandCount = 1;
    view.rerender(<TryMode />);
    mocked.session.allMet = true;
    view.rerender(<TryMode />);

    await waitFor(() => {
      expect(track).toHaveBeenCalledWith('lab_started', { labId: 'ccna-starter-10-default-route' });
      expect(track).toHaveBeenCalledWith('lab_completed', {
        labId: 'ccna-starter-10-default-route',
        commandCount: 1,
      });
    });

    fireEvent.click(screen.getByRole('link', { name: /Unlock with CertHead Pro/i }));
    expect(track).toHaveBeenCalledWith('cta_clicked', { labId: 'ccna-starter-10-default-route' });

    for (const [, properties] of vi.mocked(track).mock.calls) {
      expect(Object.keys(properties ?? {}).every((key) => ['labId', 'commandCount'].includes(key))).toBe(true);
      expect(properties).not.toHaveProperty('email');
      expect(properties).not.toHaveProperty('userId');
      expect(properties).not.toHaveProperty('token');
    }
  });
});
