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
) {
  let client: PostHog | null = null;
  let loading: Promise<void> | null = null;
  const queue: { event: LabEvent; props?: Record<string, unknown> }[] = [];

  function init(): Promise<void> {
    if (loading) return loading;
    if (client || typeof window === 'undefined' || !config.key) return Promise.resolve();

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
        for (const queued of queue) client.capture(queued.event, queued.props);
        queue.length = 0;
      })
      .catch(() => {
        // Analytics must never block the lab. Keep queued events for a retry.
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
    queue.push({ event, props });
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
