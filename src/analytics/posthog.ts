/**
 * Anonymous analytics for the public free lab.
 *
 * `/try` runs with no user identity. Autocapture, automatic pageviews, session
 * recording, and anonymous person profiles are disabled; only explicit funnel
 * events are emitted. PostHog is lazy-loaded only when a public project key is
 * configured, and events emitted during that load are queued.
 */
import type posthogType from 'posthog-js';
import {
  sanitizeOptionalCampaignAttribution,
  type CampaignAttribution,
} from '@/conversion/campaignAttribution';

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
const MAX_LAB_ID_LENGTH = 96;
const MAX_COMMAND_COUNT = 100_000;
const MAX_HINT_INDEX = 1_000;
const SAFE_LAB_ID = /^ccna-(?:starter-\d{2}|lab\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface LabIdProperties extends Partial<CampaignAttribution> {
  readonly labId: string;
}

interface CanonicalLabIdProperties extends Partial<CampaignAttribution> {
  readonly lab_id: string;
}

export interface LabEventProperties {
  readonly lab_viewed: LabIdProperties;
  readonly lab_started: LabIdProperties;
  readonly lab_brief_dismissed: LabIdProperties;
  readonly lab_completed: LabIdProperties & { readonly commandCount: number };
  readonly lab_reset: LabIdProperties;
  readonly hint_shown: LabIdProperties & { readonly hintIndex: number };
  readonly cta_clicked: LabIdProperties;
  readonly free_lab_viewed: CanonicalLabIdProperties;
  readonly free_lab_started: CanonicalLabIdProperties;
  readonly free_lab_completed: CanonicalLabIdProperties & { readonly command_count: number };
}

export type LabEvent = keyof LabEventProperties;

type SanitizedEvent = {
  [Event in LabEvent]: {
    readonly event: Event;
    readonly props: LabEventProperties[Event];
  };
}[LabEvent];

function isPropertyObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeLabId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_LAB_ID_LENGTH
    && SAFE_LAB_ID.test(value);
}

function isBoundedNonnegativeInteger(value: unknown, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
    && value <= maximum;
}

/**
 * Runtime privacy boundary. Unknown properties are discarded. If an approved
 * property is missing or malformed, the whole event is rejected rather than
 * emitting ambiguous analytics without its required lab context.
 */
function sanitizeEvent(event: unknown, props: unknown): SanitizedEvent | null {
  if (!isPropertyObject(props)) return null;
  const campaign = sanitizeOptionalCampaignAttribution(props);
  if (campaign === null) return null;
  const campaignProperties = campaign ?? {};

  switch (event) {
    case 'free_lab_viewed':
    case 'free_lab_started':
      if (!isSafeLabId(props.lab_id)) return null;
      return { event, props: { lab_id: props.lab_id, ...campaignProperties } };
    case 'free_lab_completed':
      if (!isSafeLabId(props.lab_id)
        || !isBoundedNonnegativeInteger(props.command_count, MAX_COMMAND_COUNT)) return null;
      return {
        event,
        props: { lab_id: props.lab_id, command_count: props.command_count, ...campaignProperties },
      };
    case 'lab_viewed':
    case 'lab_started':
    case 'lab_brief_dismissed':
    case 'lab_reset':
    case 'cta_clicked':
      if (!isSafeLabId(props.labId)) return null;
      {
        const labId = props.labId;
        return { event, props: { labId, ...campaignProperties } };
      }
    case 'lab_completed':
      if (!isSafeLabId(props.labId)
        || !isBoundedNonnegativeInteger(props.commandCount, MAX_COMMAND_COUNT)) return null;
      {
        const labId = props.labId;
        return { event, props: { labId, commandCount: props.commandCount, ...campaignProperties } };
      }
    case 'hint_shown':
      if (!isSafeLabId(props.labId)
        || !isBoundedNonnegativeInteger(props.hintIndex, MAX_HINT_INDEX)) return null;
      return {
        event,
        props: { labId: props.labId, hintIndex: props.hintIndex, ...campaignProperties },
      };
    default:
      return null;
  }
}

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
  const queue: SanitizedEvent[] = [];

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
          save_campaign_params: false,
          save_referrer: false,
          before_send: (payload) => {
            if (!payload) return null;
            const sanitized = sanitizeEvent(payload.event, payload.properties);
            if (!sanitized) return null;
            payload.properties = sanitized.props;
            delete payload.$set;
            delete payload.$set_once;
            return payload;
          },
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

  function track<Event extends LabEvent>(event: Event, props: LabEventProperties[Event]): void {
    if (typeof window === 'undefined' || !config.key) return;
    const sanitized = sanitizeEvent(event, props);
    if (!sanitized) return;
    if (client) {
      client.capture(sanitized.event, sanitized.props);
      return;
    }
    // Retain the newest funnel context when blocked; discard the oldest event
    // once the fixed-size queue reaches its cap.
    if (queue.length >= maxQueueSize) queue.shift();
    queue.push(sanitized);
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

export function track<Event extends LabEvent>(event: Event, props: LabEventProperties[Event]): void {
  analytics.track(event, props);
}
