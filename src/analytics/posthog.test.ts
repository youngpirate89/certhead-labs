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

  it('retries a failed lazy load when a later event is tracked and flushes every queued event once', async () => {
    const posthog = createPostHogMock();
    const load = vi
      .fn<() => Promise<typeof posthog>>()
      .mockRejectedValueOnce(new Error('simulated lazy load failure'))
      .mockResolvedValueOnce(posthog);
    let now = 0;
    const analytics = createAnalytics(
      { key: 'phc_public_test_key' },
      load,
      { now: () => now, retryBaseMs: 100 },
    );

    const firstInitialization = analytics.init();
    analytics.track('lab_viewed', { labId: 'ccna-starter-01-interface-ip' });
    await firstInitialization;

    now = 100;
    analytics.track('lab_started', { labId: 'ccna-starter-01-interface-ip' });
    await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalledTimes(2));

    expect(load).toHaveBeenCalledTimes(2);
    expect(posthog.init).toHaveBeenCalledOnce();
    expect(posthog.capture.mock.calls).toEqual([
      ['lab_viewed', { labId: 'ccna-starter-01-interface-ip' }],
      ['lab_started', { labId: 'ccna-starter-01-interface-ip' }],
    ]);
  });

  it('bounds the retained queue and load attempts during sustained failures', async () => {
    const posthog = createPostHogMock();
    let now = 0;
    const load = vi.fn<() => Promise<typeof posthog>>().mockRejectedValue(new Error('blocked'));
    const analytics = createAnalytics(
      { key: 'phc_public_test_key' },
      load,
      { maxQueueSize: 3, maxAttempts: 2, retryBaseMs: 10, cooldownMs: 1_000, now: () => now },
    );

    analytics.track('lab_viewed', { sequence: 1 });
    await analytics.init();
    now = 10;
    analytics.track('lab_started', { sequence: 2 });
    await analytics.init();

    for (let sequence = 3; sequence <= 8; sequence += 1) {
      analytics.track('hint_shown', { sequence });
      await analytics.init();
    }

    expect(load).toHaveBeenCalledTimes(2);

    load.mockResolvedValueOnce(posthog);
    now = 1_010;
    analytics.track('lab_completed', { sequence: 9 });
    await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalledTimes(3));

    expect(load).toHaveBeenCalledTimes(3);
    expect(posthog.capture.mock.calls).toEqual([
      ['hint_shown', { sequence: 7 }],
      ['hint_shown', { sequence: 8 }],
      ['lab_completed', { sequence: 9 }],
    ]);
  });

  it('drops the oldest queued event and recovers in order before retry exhaustion', async () => {
    const posthog = createPostHogMock();
    let now = 0;
    const load = vi
      .fn<() => Promise<typeof posthog>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(posthog);
    const analytics = createAnalytics(
      { key: 'phc_public_test_key' },
      load,
      { maxQueueSize: 2, maxAttempts: 3, retryBaseMs: 5, now: () => now },
    );

    analytics.track('lab_viewed', { sequence: 1 });
    await analytics.init();
    analytics.track('lab_started', { sequence: 2 });
    analytics.track('hint_shown', { sequence: 3 });

    now = 5;
    analytics.track('lab_completed', { sequence: 4 });
    await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalledTimes(2));

    expect(posthog.capture.mock.calls).toEqual([
      ['hint_shown', { sequence: 3 }],
      ['lab_completed', { sequence: 4 }],
    ]);
  });
});
