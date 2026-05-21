# CertHead Labs

Browser-based, scenario-scoped CLI simulation engine for IT certification prep.

See `CLAUDE.md` for the product thesis, architecture decisions, and build order.

## Status

**Weekend 1-2 — Foundation.** Vite + React + TS scaffold, three-panel layout,
terminal primitive, and parser primitive (tokenizer + prefix-match resolution)
with unit tests. The Cisco IOS adapter and the free lab are next (Weekend 3-4).

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
