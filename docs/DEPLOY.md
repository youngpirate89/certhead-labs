# DEPLOY.md: Public Starter Labs (`/try`)

Ship target: `https://labs.certhead.com/try` as a static site on Cloudflare Pages.
The current offer is **10 dedicated public CCNA starter labs** plus **60 separate Pro catalog labs**. The public starter IDs are distinct from the Pro catalog IDs.

## Build output

- Build command: `npm run build`
- Output directory: `dist`
- `wrangler.toml` sets `pages_build_output_dir = "dist"` for Cloudflare Pages.
- Cloudflare Pages native SPA fallback serves `/try` from the app shell because
  the build has no top-level `404.html`. Do not add a redundant catch-all
  `_redirects` rewrite; it can shadow path-specific `_headers` rules.
- `public/robots.txt`, `public/_headers`, and `public/sitemap.xml` are raw SEO
  assets. Crawling is denied by default, with only `/try` and its built assets
  allowed. Private/development routes receive `X-Robots-Tag: noindex, nofollow`.
  The sitemap contains only the canonical `https://labs.certhead.com/try` route.
- `npm run test:e2e:production` builds and serves the production bundle, checks
  all 10 starter URLs, confirms paid and invalid IDs fail safe, and validates
  the raw SEO responses and page metadata. The test reads `dist/_headers`
  directly because Cloudflare consumes that file as deployment configuration,
  not as a public asset.

## 1. Cloudflare Pages project

1. In Cloudflare Pages, connect the repository and production branch.
2. Set the build command to `npm run build` and output directory to `dist`.
3. Deploy to the generated `.pages.dev` URL and smoke-test it before changing DNS.
4. Do not add server secrets to this static project.

## 2. PostHog public key and anonymous analytics

1. Copy the PostHog **public project key**.
2. In the Pages project Production environment, add `VITE_POSTHOG_KEY`.
   Optionally add `VITE_POSTHOG_HOST` for a non-default ingestion host.
3. Redeploy because Vite reads these variables at build time. Without the key,
   analytics is a clean no-op and the labs still work.

The client disables autocapture, automatic pageviews, session recording, and
anonymous person-profile creation. Explicit events use only non-PII lab context:

- `lab_viewed`
- `lab_started`
- `lab_brief_dismissed`
- `lab_completed`
- `lab_reset`
- `hint_shown`
- `cta_clicked`

Lazy-load failures retain at most 100 events, dropping the oldest when full.
Imports retry with exponential backoff for three attempts, then pause for a
60-second cooldown before a later event can start a new bounded retry cycle.

Funnel: viewed, started, completed, CTA. Never send email, account IDs, billing
data, JWTs, credentials, or other user identity in event properties.

The analytics API and runtime boundary allow only event-specific properties:
every event requires a safe CCNA `labId`; `lab_completed` also requires a finite
integer `commandCount` from 0 through 100,000; and `hint_shown` also requires a
finite integer `hintIndex` from 0 through 1,000. Unknown properties are stripped
before queueing or capture. If a required allowed property is missing, malformed,
or out of bounds, the entire event is rejected.

## 3. Custom domain `labs.certhead.com`

1. Add `labs.certhead.com` as a Pages custom domain.
2. Create the DNS record Cloudflare provides.
3. Wait for TLS provisioning.
4. Verify `https://labs.certhead.com/try`, `/robots.txt`, and `/sitemap.xml`.

## 4. Main-app conversion intent

Starters 1 through 9 continue to the next starter on `/try` in the same window.
Only starter 10 exits to the main app. Its centralized URL builder sends:

- `source=free-lab`
- `lab=<originating starter id>`
- a safe internal `/upgrade?source=free-lab&redirect=/labs` destination in the
  registration `redirect` parameter

The properties remain anonymous and non-PII. The main app owns registration,
upgrade, and the eventual return to `/labs`; this repository does not implement
or deploy those routes.

## Smoke test checklist

- [ ] `npm test`, `npm run lint`, and `npm run build` pass.
- [ ] `npm run test:e2e:production` passes against the production bundle.
- [ ] All 10 dedicated starter URLs open their requested starter.
- [ ] A paid catalog ID and an invalid ID both fall back to starter 1.
- [ ] Starters 1 through 9 continue internally and only starter 10 exits.
- [ ] The final CTA preserves `source`, originating `lab`, `/upgrade`, and `/labs`.
- [ ] `robots.txt` is served as text, denies crawling by default, and allows only `/try` plus its assets.
- [ ] `_headers` adds `X-Robots-Tag: noindex, nofollow` to private/development routes without matching `/try`.
- [ ] Verify those effective response headers on the live Cloudflare deployment; local preview only proves the built `_headers` artifact.
- [ ] `sitemap.xml` is served as XML and contains only the canonical `/try` URL.
- [ ] Raw `index.html` includes the canonical metadata, truthful JSON-LD, and fallback H1.
- [ ] PostHog receives `lab_viewed`, `lab_started`, `lab_completed`, and
      `cta_clicked` during a production browser smoke test after the public key is configured.
