/**
 * Anonymous analytics for the public free lab.
 *
 * CLAUDE.md: "/try" runs with no user identity — PostHog ANONYMOUS events only.
 * Autocapture, pageviews, session recording, and person profiles are all off;
 * we emit only an explicit funnel.
 *
 * posthog-js is heavy, so it is lazy-loaded via dynamic import to keep it out of
 * the initial bundle (this is a marketing surface — first paint matters). Events
 * fired before the import resolves are queued and flushed. If VITE_POSTHOG_KEY
 * is unset (local dev), everything here is a clean no-op and nothing loads.
 */
import type posthogType from 'posthog-js';

type PostHog = typeof posthogType;

let ph: PostHog | null = null;
let loading = false;

export type LabEvent =
  | 'lab_viewed'
  | 'lab_started'
  | 'lab_brief_dismissed'
  | 'lab_completed'
  | 'lab_reset'
  | 'hint_shown'
  | 'cta_clicked';
const queue: { event: LabEvent; props?: Record<string, unknown> }[] = [];

export function initAnalytics(): void {
  if (loading || ph || typeof window === 'undefined') return;
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) return; // unconfigured -> no-op, nothing loads

  loading = true;
  import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: import.meta.env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com',
        person_profiles: 'identified_only', // never create profiles -> anonymous
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
      });
      ph = posthog;
      for (const e of queue) ph.capture(e.event, e.props);
      queue.length = 0;
    })
    .catch(() => {
      loading = false;
    });
}

export function track(event: LabEvent, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  if (ph) {
    ph.capture(event, props);
    return;
  }
  // Queue early events (e.g. lab_viewed on mount) only if we intend to load.
  if (import.meta.env.VITE_POSTHOG_KEY) queue.push({ event, props });
}
