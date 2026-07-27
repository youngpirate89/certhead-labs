# CertHead Labs

Browser-based, scenario-scoped CLI simulation engine for IT certification prep.

See `CLAUDE.md` for the product thesis, architecture decisions, and build order.

## Status

The current offer has **10 dedicated public CCNA starter labs** at `/try` and
**60 separate Pro catalog labs**. The starter path requires no login, uses
anonymous PostHog funnel analytics when a public project key is configured, and
keeps all source catalog labs Pro-only. Starters 1 through 9 continue inside the
free path; starter 10 preserves the originating lab intent through main-app
registration and upgrade before returning the learner to `/labs`.

The static Cloudflare Pages build is production-ready; see `docs/DEPLOY.md`.
The `/embed` route remains the authenticated Pro surface and is not exposed by
the public sitemap.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # parser unit tests (Vitest)
npm run lint
npm run build
```

## Layout

```
src/
  engine/
    parser/       # tokenizer + prefix-match resolver (tech-stack-agnostic)
    terminal/     # useTerminal reducer hook (presentation state)
  components/     # Terminal, TopologyPanel, ObjectivesPanel, Layout
  App.tsx         # foundation scaffold wiring (replaced by lab modes)
```
