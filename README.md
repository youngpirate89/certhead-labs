# CertHead Labs

Browser-based, scenario-scoped CLI simulation engine for IT certification prep.

See `CLAUDE.md` for the product thesis, architecture decisions, and build order.

## Status

**Ship Milestone 1 — public free lab.** Cisco IOS adapter (mode stack,
interface state machine, ~30 commands), declarative grading, and the free
interface-IP lab at the `/try` route, with anonymous PostHog funnel analytics.
Deploy-ready for Cloudflare Pages — see `docs/DEPLOY.md`. The `/embed` Pro route
(JWT) is Milestone 2, gated on 300+ CertHead subscribers.

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
