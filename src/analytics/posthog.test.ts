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

    expect(posthog.init).toHaveBeenCalledWith('phc_public_test_key', expect.objectContaining({
      api_host: 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      save_campaign_params: false,
      save_referrer: false,
      before_send: expect.any(Function),
    }));
  });

  it('sanitizes the SDK-enriched final payload before network delivery', async () => {
    const posthog = createPostHogMock();
    const analytics = createAnalytics({ key: 'phc_public_test_key' }, async () => posthog);
    await analytics.init();
    const config = posthog.init.mock.calls[0]?.[1] as {
      before_send: (payload: {
        event: string;
        properties: Record<string, unknown>;
        $set?: Record<string, unknown>;
        $set_once?: Record<string, unknown>;
      }) => unknown;
    };

    expect(config.before_send({
      event: 'free_lab_viewed',
      properties: {
        lab_id: 'ccna-starter-01-interface-ip',
        utm_source: 'x',
        utm_medium: 'organic-social',
        utm_campaign: 'ccna-starter-launch',
        utm_content: 'hero',
        $current_url: 'https://labs.certhead.com/try?token=secret',
        $referrer: 'https://example.com/private',
        email: 'learner@example.com',
      },
      $set: { email: 'learner@example.com' },
      $set_once: { initial_url: 'https://labs.certhead.com/try?token=secret' },
    })).toEqual({
      event: 'free_lab_viewed',
      properties: {
        lab_id: 'ccna-starter-01-interface-ip',
        utm_source: 'x',
        utm_medium: 'organic-social',
        utm_campaign: 'ccna-starter-launch',
        utm_content: 'hero',
      },
    });

    expect(config.before_send({
      event: 'lab_viewed',
      properties: {
        labId: 'ccna-starter-01-interface-ip',
        utm_content: 'learner@example.com',
        $current_url: 'https://labs.certhead.com/try?utm_content=learner%40example.com',
      },
    })).toBeNull();
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

  it('strips arbitrary and PII properties before a queued event reaches PostHog', async () => {
    const posthog = createPostHogMock();
    let resolveLoad!: (client: typeof posthog) => void;
    const load = vi.fn(
      () => new Promise<typeof posthog>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const analytics = createAnalytics({ key: 'phc_public_test_key' }, load);

    const initialization = analytics.init();
    analytics.track('lab_completed', {
      labId: 'ccna-starter-10-default-route',
      commandCount: 7,
      utm_source: 'youtube',
      utm_medium: 'organic-social',
      utm_campaign: 'ccna-starter-launch',
      utm_content: 'routing-demo',
      email: 'learner@example.com',
      userId: 'user_123',
      token: 'secret-jwt',
      billing: { customerId: 'cus_123' },
      arbitrary: 'must-not-leave-the-browser',
    } as never);

    resolveLoad(posthog);
    await initialization;

    expect(posthog.capture).toHaveBeenCalledOnce();
    expect(posthog.capture).toHaveBeenCalledWith('lab_completed', {
      labId: 'ccna-starter-10-default-route',
      commandCount: 7,
      utm_source: 'youtube',
      utm_medium: 'organic-social',
      utm_campaign: 'ccna-starter-launch',
      utm_content: 'routing-demo',
    });
  });

  it('sanitizes runtime-cast properties before immediate capture', async () => {
    const posthog = createPostHogMock();
    const analytics = createAnalytics({ key: 'phc_public_test_key' }, async () => posthog);
    await analytics.init();

    analytics.track('hint_shown', {
      labId: 'ccna-starter-01-interface-ip',
      hintIndex: 0,
      utm_source: 'x',
      utm_medium: 'cpc',
      utm_campaign: 'routing-practice',
      utm_content: 'hint-zero',
      email: 'learner@example.com',
      token: 'secret-jwt',
    } as never);

    expect(posthog.capture).toHaveBeenCalledWith('hint_shown', {
      labId: 'ccna-starter-01-interface-ip',
      hintIndex: 0,
      utm_source: 'x',
      utm_medium: 'cpc',
      utm_campaign: 'routing-practice',
      utm_content: 'hint-zero',
    });
  });

  it('rejects malformed campaign fields with PII before a queued event can reach PostHog', async () => {
    const posthog = createPostHogMock();
    let resolveLoad!: (client: typeof posthog) => void;
    const load = vi.fn(() => new Promise<typeof posthog>((resolve) => {
      resolveLoad = resolve;
    }));
    const analytics = createAnalytics({ key: 'phc_public_test_key' }, load);

    const initialization = analytics.init();
    analytics.track('lab_viewed', {
      labId: 'ccna-starter-01-interface-ip',
      utm_source: 'facebook',
      utm_medium: 'paid-social',
      utm_campaign: 'ccna-launch',
      utm_content: 'hero',
      email: 'learner@example.com',
    } as never);
    resolveLoad(posthog);
    await initialization;

    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('rejects malformed campaign fields with PII on the initialized path', async () => {
    const posthog = createPostHogMock();
    const analytics = createAnalytics({ key: 'phc_public_test_key' }, async () => posthog);
    await analytics.init();

    analytics.track('lab_viewed', {
      labId: 'ccna-starter-01-interface-ip',
      utm_source: 'x',
      utm_medium: 'paid-social',
      utm_campaign: 'Contains-Uppercase',
      utm_content: 'hero',
      email: 'learner@example.com',
    } as never);

    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it.each([
    ['unsafe lab id', 'lab_viewed', { labId: 'learner@example.com' }],
    ['overlong lab id', 'lab_started', { labId: `ccna-starter-01-${'x'.repeat(100)}` }],
    ['fractional command count', 'lab_completed', { labId: 'ccna-starter-01-interface-ip', commandCount: 1.5 }],
    ['negative command count', 'lab_completed', { labId: 'ccna-starter-01-interface-ip', commandCount: -1 }],
    ['unbounded command count', 'lab_completed', { labId: 'ccna-starter-01-interface-ip', commandCount: 100_001 }],
    ['non-finite hint index', 'hint_shown', { labId: 'ccna-starter-01-interface-ip', hintIndex: Number.POSITIVE_INFINITY }],
    ['negative hint index', 'hint_shown', { labId: 'ccna-starter-01-interface-ip', hintIndex: -1 }],
    ['unbounded hint index', 'hint_shown', { labId: 'ccna-starter-01-interface-ip', hintIndex: 1_001 }],
  ])('rejects an event with a malformed allowed property: %s', async (_case, event, properties) => {
    const posthog = createPostHogMock();
    const analytics = createAnalytics({ key: 'phc_public_test_key' }, async () => posthog);
    await analytics.init();

    analytics.track(event as never, properties as never);

    expect(posthog.capture).not.toHaveBeenCalled();
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

    analytics.track('lab_viewed', { labId: 'ccna-starter-01-queue-1' });
    await analytics.init();
    now = 10;
    analytics.track('lab_started', { labId: 'ccna-starter-01-queue-2' });
    await analytics.init();

    for (let sequence = 3; sequence <= 8; sequence += 1) {
      analytics.track('hint_shown', { labId: 'ccna-starter-01-interface-ip', hintIndex: sequence });
      await analytics.init();
    }

    expect(load).toHaveBeenCalledTimes(2);

    load.mockResolvedValueOnce(posthog);
    now = 1_010;
    analytics.track('lab_completed', { labId: 'ccna-starter-01-interface-ip', commandCount: 9 });
    await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalledTimes(3));

    expect(load).toHaveBeenCalledTimes(3);
    expect(posthog.capture.mock.calls).toEqual([
      ['hint_shown', { labId: 'ccna-starter-01-interface-ip', hintIndex: 7 }],
      ['hint_shown', { labId: 'ccna-starter-01-interface-ip', hintIndex: 8 }],
      ['lab_completed', { labId: 'ccna-starter-01-interface-ip', commandCount: 9 }],
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

    analytics.track('lab_viewed', { labId: 'ccna-starter-01-queue-1' });
    await analytics.init();
    analytics.track('lab_started', { labId: 'ccna-starter-01-queue-2' });
    analytics.track('hint_shown', { labId: 'ccna-starter-01-interface-ip', hintIndex: 3 });

    now = 5;
    analytics.track('lab_completed', { labId: 'ccna-starter-01-interface-ip', commandCount: 4 });
    await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalledTimes(2));

    expect(posthog.capture.mock.calls).toEqual([
      ['hint_shown', { labId: 'ccna-starter-01-interface-ip', hintIndex: 3 }],
      ['lab_completed', { labId: 'ccna-starter-01-interface-ip', commandCount: 4 }],
    ]);
  });
});
