import { describe, expect, it, vi } from 'vitest';

import { createAnalytics } from './posthog';

function createPostHogMock() {
  return {
    init: vi.fn(),
    capture: vi.fn(),
  };
}

describe('anonymous PostHog contract', () => {
  it('is a clean no-op and does not load PostHog when no public project key is configured', async () => {
    const posthog = createPostHogMock();
    const load = vi.fn(async () => posthog);
    const analytics = createAnalytics({ key: undefined }, load);

    analytics.init();
    analytics.track('lab_viewed', { labId: 'ccna-starter-01-interface-ip' });

    expect(load).not.toHaveBeenCalled();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('initializes with explicit anonymous privacy protections', async () => {
    const posthog = createPostHogMock();
    const analytics = createAnalytics(
      { key: 'phc_public_test_key' },
      async () => posthog,
    );

    await analytics.init();

    expect(posthog.init).toHaveBeenCalledWith('phc_public_test_key', {
      api_host: 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
    });
  });

  it('flushes events queued while the lazy analytics client loads', async () => {
    const posthog = createPostHogMock();
    let resolveLoad!: (client: typeof posthog) => void;
    const load = vi.fn(
      () => new Promise<typeof posthog>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const analytics = createAnalytics({ key: 'phc_public_test_key' }, load);

    const initialization = analytics.init();
    analytics.track('lab_viewed', { labId: 'ccna-starter-02-network-discovery' });
    expect(posthog.capture).not.toHaveBeenCalled();

    resolveLoad(posthog);
    await initialization;

    expect(posthog.capture).toHaveBeenCalledWith('lab_viewed', {
      labId: 'ccna-starter-02-network-discovery',
    });
  });

  it('allows a later initialization retry after a failed lazy load', async () => {
    const posthog = createPostHogMock();
    const load = vi
      .fn<() => Promise<typeof posthog>>()
      .mockRejectedValueOnce(new Error('simulated lazy load failure'))
      .mockResolvedValueOnce(posthog);
    const analytics = createAnalytics({ key: 'phc_public_test_key' }, load);

    await analytics.init();
    await analytics.init();

    expect(load).toHaveBeenCalledTimes(2);
    expect(posthog.init).toHaveBeenCalledOnce();
  });
});
