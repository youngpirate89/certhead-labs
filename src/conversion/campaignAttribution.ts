export const CAMPAIGN_SOURCES = ['x', 'instagram', 'youtube', 'email', 'partner'] as const;
export const CAMPAIGN_MEDIA = ['organic-social', 'email', 'referral', 'paid-social', 'cpc'] as const;

export type CampaignSource = (typeof CAMPAIGN_SOURCES)[number];
export type CampaignMedium = (typeof CAMPAIGN_MEDIA)[number];

export interface CampaignAttribution {
  readonly utm_source: CampaignSource;
  readonly utm_medium: CampaignMedium;
  readonly utm_campaign: string;
  readonly utm_content: string;
}

const CAMPAIGN_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;
const MAX_CAMPAIGN_SLUG_LENGTH = 64;
const SAFE_CAMPAIGN_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isPropertyObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCampaignSource(value: unknown): value is CampaignSource {
  return typeof value === 'string' && (CAMPAIGN_SOURCES as readonly string[]).includes(value);
}

function isCampaignMedium(value: unknown): value is CampaignMedium {
  return typeof value === 'string' && (CAMPAIGN_MEDIA as readonly string[]).includes(value);
}

function isCampaignSlug(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_CAMPAIGN_SLUG_LENGTH
    && SAFE_CAMPAIGN_SLUG.test(value);
}

/**
 * Runtime campaign privacy boundary. `undefined` means no campaign fields were
 * supplied; `null` means a partial or malformed campaign attempted to cross
 * the boundary. A valid result is always a newly reconstructed object.
 */
export function sanitizeOptionalCampaignAttribution(
  value: unknown,
): CampaignAttribution | null | undefined {
  if (!isPropertyObject(value)) return undefined;
  const hasCampaignField = CAMPAIGN_KEYS.some((key) => Object.hasOwn(value, key));
  if (!hasCampaignField) return undefined;

  if (!isCampaignSource(value.utm_source)
    || !isCampaignMedium(value.utm_medium)
    || !isCampaignSlug(value.utm_campaign)
    || !isCampaignSlug(value.utm_content)) {
    return null;
  }

  return {
    utm_source: value.utm_source,
    utm_medium: value.utm_medium,
    utm_campaign: value.utm_campaign,
    utm_content: value.utm_content,
  };
}

/** Parse one complete, unambiguous first-touch campaign from a URL search. */
export function parseCampaignAttribution(search: string): CampaignAttribution | null {
  const params = new URLSearchParams(search);
  if (CAMPAIGN_KEYS.some((key) => params.getAll(key).length !== 1)) return null;

  return sanitizeOptionalCampaignAttribution({
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
    utm_content: params.get('utm_content'),
  }) ?? null;
}

export function appendCampaignAttribution(
  href: string,
  attribution: CampaignAttribution | null | undefined,
): string {
  const sanitized = sanitizeOptionalCampaignAttribution(attribution);
  if (!sanitized) return href;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(href);
  const isAbsolute = /^https:\/\//.test(href);
  if ((hasScheme && !isAbsolute) || href.startsWith('//')) return href;
  const url = new URL(href, 'https://labs.certhead.com');
  const approvedOrigins = new Set([
    'https://certhead.com',
    'https://www.certhead.com',
    'https://labs.certhead.com',
  ]);
  if (isAbsolute && (!approvedOrigins.has(url.origin) || url.username || url.password)) {
    return href;
  }
  for (const key of CAMPAIGN_KEYS) url.searchParams.set(key, sanitized[key]);

  return isAbsolute
    ? url.toString()
    : `${url.pathname}${url.search}${url.hash}`;
}
