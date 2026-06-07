# DEPLOY.md: Public Free Lab (`/try`)

Ship target: `labs.certhead.com/try` as a static site on Cloudflare Pages.
Standalone marketing asset. No CertHead code changes are required to ship the free lab.

> Only deploy once CertHead web is live. Never deploy during CertHead launch
> week, per the sequencing rule in `CLAUDE.md`.

## Build output

- Build command: `npm run build`
- Output directory: `dist`
- `wrangler.toml` sets `pages_build_output_dir = "dist"` for Cloudflare Pages.
- `public/_redirects` ships an SPA fallback (`/* /index.html 200`) so `/try`
  resolves client-side. Vite copies `public/` into `dist/` automatically.

## 1. Cloudflare Pages project

1. Cloudflare dashboard: **Workers & Pages**: **Create**: **Pages**:
   **Connect to Git**.
2. Authorise GitHub, pick `youngpirate89/certhead-labs`, branch `main`.
3. Framework preset: **Vite** or **None**. Set:
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Deploy. You get a `https://certhead-labs-xxxx.pages.dev` URL. Smoke-test
   there before touching DNS.

## 2. PostHog key, anonymous analytics

1. Create or open a PostHog project, then copy the **public project key**.
2. In the Pages project: **Settings**: **Environment variables**, add
   `VITE_POSTHOG_KEY` for Production. Optionally add `VITE_POSTHOG_HOST`.
3. Redeploy so the build picks it up. Without the key, analytics no-ops and the
   lab still works.

Events emitted, anonymous and without user identity:

- `lab_viewed`
- `lab_started`
- `lab_brief_dismissed`
- `lab_completed`
- `lab_reset`
- `hint_shown`
- `cta_clicked`

Funnel: viewed, started, completed, CTA.

## 3. Custom domain `labs.certhead.com`

`labs` is a subdomain of the `certhead.com` you already own. No purchase is needed.

1. In the Pages project: **Custom domains**: **Set up a domain**:
   `labs.certhead.com`. Cloudflare shows the CNAME target.
2. In **Namecheap**, same DNS zone as `certhead.com` and `api.certhead.com`:
   **Advanced DNS**, add record:
   - Type: **CNAME**
   - Host: `labs`
   - Value: the Pages target, for example `certhead-labs-xxxx.pages.dev`
   - TTL: Automatic
3. Wait for propagation. Cloudflare provisions TLS automatically. Verify
   `https://labs.certhead.com/try` loads and grades end-to-end.

## 4. Link from CertHead, Stage 1 integration in the CertHead repo

Add a link on the CertHead landing or pricing page to `labs.certhead.com/try`,
for example: "Try a free hands-on lab, no signup required."

That is the entire Stage 1 integration: one `<a href>`, zero shared code. Keep
this change in the main CertHead repo, not here.

## Smoke test checklist

- [ ] `/try` loads on the `.pages.dev` URL.
- [ ] Solution grades green: `en`, `conf t`, `int gi0/0`,
      `ip address 192.168.1.1 255.255.255.0`, `no shut`, `end`,
      `sh ip int br`.
- [ ] Completion card appears with the CTA to
      `certhead.com/register?source=free-lab`.
- [ ] Custom domain serves over HTTPS.
- [ ] PostHog receives `lab_viewed`, `lab_started`, `lab_completed`, and
      `cta_clicked` during a real browser smoke test.
