/**
 * Anonymous analytics for the public free lab.
 *
 * `/try` runs with no user identity. Autocapture, automatic pageviews, session
 * recording, and anonymous person profiles are disabled; only explicit funnel
 * events are emitted. PostHog is lazy-loaded only when a public project key is
 * configured, and events emitted during that load are queued.
 */
import type posthogType from 'posthog-js';

type PostHog = Pick<typeof posthogType, 'init' | 'capture'>;
type PostHogLoader = () => Promise<PostHog>;

interface AnalyticsConfig {
  readonly key?: string;
  readonly host?: string;
}

interface AnalyticsRetryOptions {
  readonly maxQueueSize?: number;
  readonly maxAttempts?: number;
  readonly retryBaseMs?: number;
  readonly cooldownMs?: number;
  readonly now?: () => number;
}

const DEFAULT_MAX_QUEUE_SIZE = 100;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_COOLDOWN_MS = 60_000;

export type LabEvent =
  | 'lab_viewed'
  | 'lab_started'
  | 'lab_brief_dismissed'
  | 'lab_completed'
  | 'lab_reset'
  | 'hint_shown'
  | 'cta_clicked';

export function createAnalytics(
  config: AnalyticsConfig,
  loadPostHog: PostHogLoader = () => import('posthog-js').then(({ default: posthog }) => posthog),
  retryOptions: AnalyticsRetryOptions = {},
) {
  const maxQueueSize = retryOptions.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  const maxAttempts = retryOptions.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryBaseMs = retryOptions.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const cooldownMs = retryOptions.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const now = retryOptions.now ?? Date.now;
  let client: PostHog | null = null;
  let loading: Promise<void> | null = null;
  let failedAttempts = 0;
  let retryAfter = 0;
  const queue: { event: LabEvent; props?: Record<string, unknown> }[] = [];

  function init(): Promise<void> {
    if (loading) return loading;
    if (client || typeof window === 'undefined' || !config.key) return Promise.resolve();
    const currentTime = now();
    if (currentTime < retryAfter) return Promise.resolve();
    if (failedAttempts >= maxAttempts) {
      failedAttempts = 0;
    }

    loading = loadPostHog()
      .then((posthog) => {
        posthog.init(config.key!, {
          api_host: config.host ?? 'https://us.i.posthog.com',
          person_profiles: 'identified_only',
          autocapture: false,
          capture_pageview: false,
          disable_session_recording: true,
        });
        client = posthog;
        failedAttempts = 0;
        retryAfter = 0;
        for (const queued of queue) client.capture(queued.event, queued.props);
        queue.length = 0;
      })
      .catch(() => {
        // Analytics must never block the lab. Retry only after backoff, and
        // enter a longer cooldown after the bounded attempt budget is spent.
        failedAttempts += 1;
        retryAfter = now() + (failedAttempts >= maxAttempts
          ? cooldownMs
          : retryBaseMs * 2 ** (failedAttempts - 1));
      })
      .finally(() => {
        loading = null;
      });

    return loading;
  }

  function track(event: LabEvent, props?: Record<string, unknown>): void {
    if (typeof window === 'undefined' || !config.key) return;
    if (client) {
      client.capture(event, props);
      return;
    }
    // Retain the newest funnel context when blocked; discard the oldest event
    // once the fixed-size queue reaches its cap.
    if (queue.length >= maxQueueSize) queue.shift();
    queue.push({ event, props });
    // A later event is the retry signal after a failed lazy import. init()
    // reuses an in-flight promise, so bursts cannot start concurrent imports.
    void init();
  }

  return { init, track };
}

const analytics = createAnalytics({
  key: import.meta.env.VITE_POSTHOG_KEY,
  host: import.meta.env.VITE_POSTHOG_HOST,
});

export function initAnalytics(): void {
  void analytics.init();
}

export function track(event: LabEvent, props?: Record<string, unknown>): void {
  analytics.track(event, props);
}
