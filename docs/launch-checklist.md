# Launch checklist: integration-readiness items outside this repo

Purpose: track validation that must happen in the main CertHead app or API, the hosting provider, DNS, or analytics. This Labs repo stays static and does not invent auth, billing, persistence, secrets, or production credentials.

## Scope rules

- Public route: keep `labs.certhead.com/try` limited to the single free lab, `ccna-l01-interface-ip`.
- Private catalog: keep the remaining 49 labs gated for the $9.99 CertHead Pro bundle.
- Do not expose private labs through the question and exam tier.
- Do not add server auth in this repo unless the main CertHead app or API integration contract is already defined.

## Main CertHead app or API

- [ ] Add the landing or pricing page link to `https://labs.certhead.com/try`.
- [ ] Confirm the link copy frames the lab as one free hands-on lab, not a free lab tier.
- [ ] Confirm Pro labs remain part of the $9.99 CertHead Pro bundle.
- [ ] For future `/embed`, define token minting, token validation, entitlement checks, replay controls, and completion persistence in the main app or API.
- [ ] For future `/embed`, define the allowed iframe parent origin and postMessage target origin. The target origin must never be `*`.

## Hosting provider

- [ ] Configure Cloudflare Pages or the selected static host with build command `npm run build`.
- [ ] Configure build output directory `dist`.
- [ ] Confirm the deployed artifact includes `_redirects` with `/* /index.html 200` so `/try` serves the app shell.
- [ ] Configure `VITE_POSTHOG_KEY` as a production environment variable if analytics should run.
- [ ] Configure `VITE_POSTHOG_HOST` only if CertHead needs a non-default PostHog host.
- [ ] Do not configure JWT secrets, API tokens, billing secrets, or user credentials in this static Labs repo.

## DNS and launch validation

- [ ] Point `labs.certhead.com` to the Pages target with a CNAME.
- [ ] Confirm TLS is active for `https://labs.certhead.com/try`.
- [ ] Run the free-lab smoke path on the production domain.
- [ ] Confirm the completion CTA points to `https://certhead.com/register?source=free-lab`.
- [ ] Confirm PostHog receives anonymous `lab_viewed`, `lab_started`, `lab_completed`, and `cta_clicked` events.
- [ ] Confirm no analytics payload includes email, account id, billing data, JWTs, or secrets.
