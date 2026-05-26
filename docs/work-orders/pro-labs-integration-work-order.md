# Work order — Pro full-labs (`/embed`) integration

**Decision in effect:** the ≥300-paid bar is removed. We are building the Pro `/embed` integration and the CertHead-side plumbing now. This document is the build plan; hand it to Claude Code one phase at a time.

## Source of truth (read before writing anything)

This work order describes intent and sequence. It does **not** know the real repo internals. Before each CertHead-side commit, Claude Code must read and conform to the actual code, not this document's guesses:

- Labs repo: `docs/ENGINE_ARCHITECTURE.md`, `docs/LAB_AUTHORING.md`, the existing `TryMode.tsx`, and how `_pilots/` are currently registered + tree-shaken.
- CertHead repo: the real auth middleware and `requireEntitlement` pattern, the existing streak/XP services, the Prisma schema, and the secret-management mechanism.

If anything here conflicts with the repos, the repos win — flag the conflict, don't paper over it.

## Non-negotiables carried in

- **Guardrail #9 — CertHead launch priority.** No CertHead-side commit in this plan deploys during CertHead launch week. Labs-side commits are independent and safe to ship anytime.
- **Determinism (#8)** and **free-lab behavioral identity (N=1 polish bar).** This work touches routing, a lab registry, and an embed entry point. It must not change the free lab's behavior or the engine's input→output determinism. The `/try` bundle stays byte-for-behavior identical.
- **Production-quality (#6):** conventional commits, ESLint `--max-warnings 0`, `tsc -b` green before commit (Vitest green ≠ prod build green), no TODOs in `src/`.
- **Cold human run is the sign-off (LAB_AUTHORING §7).** Programmatic in-browser checks do not count as verification. Every phase that produces a usable surface ends with a real mouse + keyboard run.
- **Never paste secrets** into chat, commits, or this doc. Keys live in the platforms' secret stores.

---

## Security correction — asymmetric JWT (do this first, it gates everything)

The `INTEGRATION CONTRACT` sketch verifies `jwt.verify(token, LAB_JWT_SECRET)` on the Labs side. Labs is a **static client-side app**, so a symmetric (HS256) secret would ship in the browser bundle and let anyone mint valid Pro tokens. Switch to asymmetric:

- **CertHead** holds `LAB_JWT_PRIVATE_KEY` and signs (RS256 or EdDSA).
- **Labs** embeds only `VITE_LAB_JWT_PUBLIC_KEY` (public, safe to ship) and verifies.
- Use **`jose`** (Web Crypto, browser-safe) on the Labs side — not `jsonwebtoken` (Node-only).
- Trust model, stated explicitly so it's not re-debated: the Labs client verifies **authenticity + expiry + `labId` match only**. The **entitlement decision** lives entirely in CertHead refusing to mint a token for a non-entitled user, with a short (60s) TTL. This keeps the engine tier-agnostic (guardrail #7).

Record this decision in `ARCHITECTURE DECISIONS` (Phase C) so the symmetric sketch isn't resurrected.

---

## Phase A — Labs side (independent, zero CertHead coupling, ship anytime)

### A1 — `feat: lab registry with getLabById`
- Build a real catalog: `getLabById(id): Lab | null` over all labs.
- Promote the 3 troubleshooting pilots out of `_pilots/` into `src/labs/ccna/` with stable, permanent ids (e.g. `ccna-tshoot-return-route`). Keep them **out of the `/try` bundle** (still tree-shaken from public) but **in the `/embed` catalog**.
- Tests: every catalog id resolves; unknown id → `null`; the free lab still resolves and is unchanged.
- Gate: `tsc -b` green, Vitest green.

### A1.5 — `feat: endpoint-aware links + port-state LEDs`
Presentational + topology-schema change only. Reads existing interface state; introduces **no** new engine state. Determinism and free-lab behavior are unaffected (a lab with zero links renders exactly as today).

- **Schema:** enrich `topology.links` from an opaque list into endpoint-aware records naming the interface/NIC at each end:
  ```typescript
  links: [
    { a: { device: 'PC-A', port: 'NIC'   }, b: { device: 'R1',   port: 'Gi0/0' } },
    { a: { device: 'R1',   port: 'Gi0/2' }, b: { device: 'R2',   port: 'Gi0/2' } },
    { a: { device: 'R2',   port: 'Gi0/0' }, b: { device: 'PC-B', port: 'NIC'   } }
  ]
  ```
- **Renderer:** draw a cable between the two endpoints and a port LED (small ringed dot) at each end, anchored to the device edge at the named interface.
- **LED rule:** the port is green only if that interface is `adminUp && protocolUp`; otherwise red. The LED is a **pure function of interface state** — derive it, never store it.
- **Both-ends-down convention:** a link is down if *either* endpoint is down → both LEDs red (Packet-Tracer semantics; simpler and more honest than amber-one-side).
- **Authoring:** show the interface/NIC name beside each LED and the network/subnet at mid-cable (matches the diagnostic value: learner sees exactly which port is down).
- **Backfill:** populate `links` for every existing multi-device lab (the single-device free lab keeps `links: []` and is visually unchanged). Add the link-endpoint fields to `docs/LAB_AUTHORING.md`.
- **Tests (golden, determinism-enabled):** given a device-state fixture, assert each LED color; flipping one interface `adminUp` flips both LEDs on its link; zero-link lab renders identically to current snapshot.

### A2 — `feat: EmbedMode route with asymmetric JWT verification`
- New `EmbedMode.tsx` at `/embed`. Read `token` + `labId` from the URL.
- Verify with `jose` + `VITE_LAB_JWT_PUBLIC_KEY`: signature, `exp`, and `claims.labId === labId`.
- Success → render the lab via `getLabById`. Any failure → `renderUnauthorizedScreen()` (no lab, no leak of why beyond "unauthorized").
- No upgrade CTA in embed mode.
- Tests: valid token renders the claimed lab; bad signature / expired / mismatched `labId` / unknown `labId` all render unauthorized.
- Gate: `tsc -b` + Vitest green.

### A3 — `feat: embed completion via postMessage`
- On lab completion in embed mode only, post to parent with an **explicit origin** from `VITE_CERTHEAD_ORIGIN`:
  `{ type: 'lab.completed', labId, durationSeconds, objectivesMet, hintsUsed }`.
- Embed completion screen variant (no CTA). `/try` completion screen unchanged.
- Tests: completion in embed mode posts exactly once with correct payload + origin; `/try` mode posts nothing.

### A4 — Cold human run (Labs side) — **sign-off gate**
- Generate a dev keypair locally. Sign a test token for one troubleshooting lab.
- Open `/embed?token=…&labId=…` against a tiny local parent harness page that logs received messages.
- Real mouse + keyboard, full lab end-to-end. Confirm: lab renders, objectives behave (lastPing reachability intact), completion `postMessage` arrives in the harness with the right origin.
- Bad-token paths show the unauthorized screen.
- **Viewport matrix (added — this is where today's panel-overlap bug lived):** run the cold human pass at three widths, not just dev-desktop — (1) wide desktop, (2) a *narrow embed iframe* (~520px, the real CertHead embed width), (3) mobile portrait. Confirm no panel text overflows into a neighbour (terminal `show` output is the usual culprit — flex children carrying wide `white-space: pre` content need `min-width: 0`), the three panels collapse/stack legibly, and port LEDs stay anchored to their device edges as the SVG scales.
- **Terminal clipboard:** confirm paste-into-terminal works (a known friction point on competing browser labs).

**Labs side is now shippable.** Static deploy (`npx wrangler pages deploy` — direct-upload, not deploy-on-push). No CertHead coupling, so this is launch-week-safe.

---

## Phase B — CertHead side (additive; **do not deploy during launch week**)

### B1 — `feat: LabCompletion model + migration`
- Add the `LabCompletion` Prisma model exactly as specified in CLAUDE.md (userId, labId, examId?, completedAt, durationSeconds, objectivesMet[], hintsUsed, indexes, `@@map`).
- Generate + run the migration. No backfill needed.

### B2 — `feat: POST /api/labs/mint-token`
- Read the **real** auth middleware + `requireEntitlement` pattern first; reuse it, don't invent one.
- Entitlement check → on fail, the existing forbidden error.
- Sign with `LAB_JWT_PRIVATE_KEY` (RS256/EdDSA), claims `{ sub: user.id, labId, tier, iat, exp }`, `exp = now + 60s`.
- `tier` is for analytics only, never authz.

### B3 — `feat: POST /api/labs/completions`
- Validate the posting user matches the token `sub`.
- Write a `LabCompletion` row. Let existing streak/XP/analytics services trigger off the row — **do not reimplement them**.

### B4 — `feat: lab list + iframe embed in study session`
- Lab-list UI in the study session (Pro-gated via existing entitlement UI).
- Render `<iframe src={`${LABS_ORIGIN}/embed?token=${token}&labId=${labId}`} sandbox="allow-scripts allow-same-origin" />`.
- `window` `message` listener guarded by `e.origin === LABS_ORIGIN`; on `lab.completed` → `POST /api/labs/completions`.

### B5 — `chore: env + origin wiring`
- CertHead: `LAB_JWT_PRIVATE_KEY`, `LABS_ORIGIN`. Labs: `VITE_LAB_JWT_PUBLIC_KEY`, `VITE_CERTHEAD_ORIGIN`. All via the platforms' secret stores.
- Origin checks enforced on **both** ends.

### B6 — Cold human run (full loop) — **sign-off gate**
- `tsc -b` + tests green both repos.
- From inside CertHead as a Pro user: open a lab → token mints → iframe loads → complete the lab → completion persists → streak fires. Real mouse + keyboard.
- Confirm a non-entitled user cannot mint a token and the iframe shows unauthorized.

---

## Phase C — docs + doc truth (don't let CLAUDE.md go stale)

### C1 — `docs: create INTEGRATION_SPEC.md`
- The contract is now real (CLAUDE.md says create this when Stage 2 starts). Capture: the asymmetric-JWT trust model, env vars, the `lab.completed` payload, origin checks, and the `LabCompletion` shape.

### C2 — `docs: update CLAUDE.md for Pro-labs-now`
- Remove the ≥300-paid hard rule from `STRATEGIC SEQUENCING`.
- Refresh `CURRENT FOCUS` and the phase table to reflect Pro labs shipping now.
- Add the asymmetric-JWT decision to `ARCHITECTURE DECISIONS` so the symmetric sketch is never reused.
- Keep it lean (guardrail #10 — long CLAUDE.md files become stale CLAUDE.md files).

---

## Suggested order of operations

Phase A end-to-end first (shippable, safe, proves the embed surface with a dev keypair). Then Phase B behind the launch-week guard. Phase C alongside B. Each numbered item is one commit and, where it produces a surface, one cold human run.
