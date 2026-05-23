# CLAUDE.md — CertHead Labs (Prototype)

> Load this file every session. This is a separate project from `certhead/` —
> the question-bank product. Do not conflate the two; they have different
> architectures, different priorities, and different timelines.
>
> Last updated: 2026-05-16

---

## 🎯 PRODUCT THESIS

**CertHead Labs is a browser-based, scenario-scoped CLI simulation engine for IT certification prep.** It serves two roles:

1. **Marketing surface (public free lab)** — A single, polished lab at `labs.certhead.com/try` accessible with zero auth. Top-of-funnel asset that converts curiosity into signups by letting prospects experience the product before paying.
2. **Pro subscriber feature** — Full lab library at `labs.certhead.com/embed?token=...` available to CertHead Pro subscribers, gated by JWT minted from CertHead's existing entitlement check.

**It is not a general-purpose network simulator.** It is not competing with Packet Tracer, GNS3, or Boson NetSim on simulator breadth or fidelity. It competes by being scenario-scoped, auto-graded, embedded in cert-prep study flows, and unified across multiple technology stacks (networking + Linux + cloud + databases).

**Why this exists as a separate project:**

1. Different tech stack from CertHead — frontend-heavy, parser-driven, minimal backend.
2. Different deploy cadence — the public free lab can ship independently of CertHead's launch sequence; the full Pro integration lands months later.
3. Protects CertHead from scope creep. Guardrail #21 from CertHead's CLAUDE.md applies double here: default to dumb implementations, build for hypothetical customers only when evidence demands it.
4. Allows the prototype to sit fallow for weeks at a time without affecting CertHead's launch velocity.

**Integration with CertHead happens in two stages, both deliberately thin:**

- **Stage 1 (early):** A link from `certhead.com` to `labs.certhead.com/try`. No code integration — just a hyperlink in marketing copy.
- **Stage 2 (later):** Iframe embed with JWT auth and `postMessage` for completion events. Both codebases stay independent forever.

---

## 📅 STRATEGIC SEQUENCING

This project is **explicitly subordinate to CertHead's launch sequence.** Work on this project happens on weekends, evenings, or other CertHead-non-blocking time only.

| Phase | CertHead milestone | Labs project status |
|-------|-------------------|---------------------|
| Now | Launch CCNA on web | Engine + free lab in development |
| +0-4 weeks | Web launch, then mobile (iOS/Android) | Free lab shipping at `labs.certhead.com/try`; linked from CertHead landing page |
| +4-12 weeks | N10-009 + SY0-701 ship as exams #2/#3 | Build out 15-25 Pro-tier labs in private; engine generalized to bash syntax |
| +3-6 months | First 300-500 paid customers, validate retention | Wire up `/embed` mode + JWT integration with CertHead API; soft-launch Pro labs to existing subscribers |
| +6-9 months | Multi-exam catalog established | Full Phase 2 launch: Labs as headline Pro feature, marketed broadly |

**Hard rules:**

- No `/embed` (Pro-tier) integration ships to production CertHead until the question-bank product has validated demand (≥300 paid customers, retention metrics on track).
- The public free lab at `/try` CAN ship before that bar is met — it generates marketing value standalone, with zero risk to CertHead's launch.
- The free lab and the Pro labs use the same engine. The only difference between modes is the entry point and the auth check.

---

## 🎯 CURRENT FOCUS — ENGINE COMPLETE; NEXT MOVE IS A SEQUENCING DECISION

Status: The multi-device engine is STRUCTURALLY COMPLETE and shipped to origin/main.

**DONE and pushed:**
- Single-device lab FEEL (the original focus) — locked. Free lab LIVE and unchanged.
- **Phase 3a — multi-device foundation:** DeviceAdapter seam (grammarFor / applyCommand
  / prompt / buildDevice / toTopologyView); LabSession = N independent device state
  machines, no global state; per-device terminal binding + active-device switching;
  React Flow canvas (kind-agnostic, renders toTopologyView objects; click node →
  active console).
- **Phase 3b — L3-static reachability:** router routing table (connected/static,
  `ip route`, `show ip route`, longest-prefix match); pc adapter (`ipconfig` / `ping`);
  `canReach` (full round-trip, hop-granular `failedAt`, pure/deterministic, loop guard).
  The Packet-Tracer ping moment works end-to-end — PC-A → PC-B across two routers, and
  a missing return route teaches via a specific failure message.

Free lab is LIVE at main.certhead-labs.pages.dev (redeploy after any change —
Cloudflare is direct-upload via `npx wrangler pages deploy`, not auto-deploy-on-push).
Pilot routes are tree-shaken out of the prod bundle; prod serves the free lab only.

Specs: engine algorithm in `docs/ENGINE_ARCHITECTURE.md`; topology in
`docs/MULTI_DEVICE_TOPOLOGY.md`.

**NEXT — a real fork, gated on CertHead revenue, NOT the spec's phase order:**

Remaining engine phases are 3c (switch + L2 reachability), 3d (OSPF), 3e (ACLs +
remaining L2). The architectural seams are in place — 3c/3d/3e are extensions against
contracts that already held under real use (the routing-table seam absorbs OSPF as
data; DeviceAdapter absorbs new device kinds; the FailReason contract feeds 3e).

But the next move is **NOT automatically 3c.** The law (this file): labs follow
revenue-validated question banks, and `/embed` Pro integration is gated on ≥300 paid
CertHead subscribers. The open decision is:
  (a) extend the engine into 3c, or
  (b) consolidate — build more labs on the proven 3a/3b engine and let the question
      bank catch up.
This hinges on CertHead's live exams + paid-subscriber count vs the 300 bar. Decide
with that number, not by defaulting into the next phase.

**DO NOT LOSE:** the multi-device engine was the committed headline build and it
landed. Phases 3c–3e unlock the full Phase 3 catalog + capstones C3/C4/C5 — but only
when revenue signal justifies the next investment.

---

## 🆓 THE PUBLIC FREE LAB — TOP-OF-FUNNEL ASSET

**One lab. Permanently free. No auth. Maximum quality.**

The free lab is the marketing pivot point for the entire labs strategy. A customer cannot evaluate "is a hands-on lab worth $9.99/mo" from a screenshot or feature list — they need to feel it. The free lab is the cheapest possible filter for product-market fit: people who try it and love it convert at a much higher rate than people who sign up sight-unseen.

**Design principles:**

- **One lab, not a free tier.** Multiple "free labs" creates a boundary-hunting UX where users feel ripped off when they find the wall. One lab framed as a try-before-you-buy is a different psychological contract.
- **Genuinely complete experience.** The free lab is not a stripped-down demo. It is a fully polished, end-to-end lab covering a real CCNA exam topic. Same engine, same UI, same auto-grading as paid labs.
- **No login required.** The free lab is accessible from a public URL with zero friction. Signup is the natural next step after completion, not the gate before starting.
- **Upgrade prompt comes after completion, not during.** When the learner finishes, show "Next: Lab 04 — Static Routing — Pro only" with a clear path to CertHead signup. The customer finishes knowing exactly what they'd be paying for.
- **Permanent.** Not time-limited, not feature-limited within the lab, not "first 5 commands free." Constraint by quantity (one), not by quality or duration.

**Which lab is free:**

The interface configuration lab from the original prototype demo. Specifically: "Configure GigabitEthernet0/0 with IP 192.168.1.1/24 and bring the interface up, then verify with `show ip interface brief`."

Rationale:
- Foundational — every CCNA student needs this skill
- Complete in 5-7 minutes (low commitment to try)
- Demonstrates the full engine capability surface (mode stack, IOS-realistic errors, auto-grading, topology visualization)
- Searches well organically ("how to configure Cisco router interface IP", "no shutdown command tutorial")
- Single-device — ships in the earliest version of the engine, no multi-device state machines needed

**Marketing leverage:**

Once the free lab is live, it becomes the link target for content marketing:

- Blog: "Configure a Cisco router interface — interactive walkthrough"
- Blog: "CCNA Lab 1: Your first router configuration (free, in-browser)"
- Reddit posts in r/ccna referencing the free lab
- YouTube tutorial videos with the free lab linked in description

Every piece of content drives traffic to the free lab, which drives signups for the question bank, which converts to Pro through the existing funnel. The free lab is the marketing asset that makes content marketing actually convert in this category.

---

## 🏗️ ARCHITECTURE DECISIONS — DECIDED, DO NOT RE-DEBATE

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | TypeScript everywhere | Consistency with CertHead. |
| Framework | React 18 + Vite | Same as CertHead web app for eventual integration. |
| Styling | Tailwind CSS | Same design tokens as CertHead. |
| Terminal | Custom (HTML/CSS) for now; xterm.js if features demand | xterm.js is heavy. Build with vanilla until features justify the dep. |
| Topology | React Flow or Konva for multi-device; SVG for single-device | Decided when first multi-device lab is built. |
| State | React state + reducers for now | No Redux/Zustand until complexity demands. |
| Persistence | Local storage only (prototype + free lab); backend at CertHead when integrated | Lab state stays ephemeral. Persistence lives in CertHead. |
| Backend | None during prototype phase | All client-side. Backend = CertHead API when embedded. |
| Hosting | Cloudflare Pages or Vercel (static deploy) | Free lab ships as static site to `labs.certhead.com`. |
| Domain | `labs.certhead.com` | CNAME from same Namecheap DNS as `certhead.com` / `api.certhead.com`. |
| Testing | Vitest | Same as CertHead. Unit tests on parser + state machines mandatory. |

**Repo structure (target):**

```
certhead-labs/
├── CLAUDE.md                      # This file
├── README.md
├── docs/
│   ├── ENGINE_ARCHITECTURE.md     # Parser, state machine, grading framework
│   ├── LAB_AUTHORING.md           # How to author a new lab
│   └── INTEGRATION_SPEC.md        # Eventual CertHead integration contract
├── src/
│   ├── engine/                    # The reusable simulation engine
│   │   ├── parser/                # Command parsing per syntax family
│   │   ├── state/                 # Device state machines
│   │   ├── grading/               # Objective evaluation
│   │   └── terminal/              # Terminal UI primitives
│   ├── labs/                      # Lab definitions (content artifacts)
│   │   ├── ccna/
│   │   │   ├── lab-01-interface-ip.ts  # The free lab
│   │   │   └── ...
│   │   ├── linux-plus/            # Future
│   │   └── ...
│   ├── modes/
│   │   ├── TryMode.tsx            # Public /try route — no auth, hardcoded free lab
│   │   └── EmbedMode.tsx          # /embed route — JWT auth, lab from URL param
│   ├── components/                # Topology, panels, layout
│   └── App.tsx
├── prototypes/                    # Throwaway demos
│   └── demo-01-single-device.html # The initial demo
└── package.json
```

---

## 🔀 DUAL-MODE ENGINE ARCHITECTURE

The engine runs in two modes that share 100% of the underlying code. The difference is entirely at the entry point.

```
                    ┌──────────────────────────┐
                    │   labs.certhead.com      │
                    └──────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
       ┌─────────────┐                 ┌─────────────┐
       │   /try      │                 │   /embed    │
       │ (public)    │                 │ (Pro only)  │
       └─────────────┘                 └─────────────┘
              │                               │
       No auth check               Verify JWT from URL param
       Hardcoded labId              Read labId from JWT claims
              │                               │
              └───────────────┬───────────────┘
                              ▼
                    ┌──────────────────────────┐
                    │     Lab Engine Core      │
                    │  (identical in both)     │
                    └──────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
       Completion CTA:                Completion via postMessage:
       "Sign up for CertHead"         { type: 'lab.completed', ... }
       → links to certhead.com         → CertHead persists via existing APIs
```

**Mode 1: `/try` (public free lab)**

- No authentication
- Hardcoded to load the single free lab definition
- On completion, shows upgrade CTA linking to `certhead.com/register?source=free-lab`
- No analytics tied to user identity (PostHog anonymous events only)
- Hosted as a static page; no API calls

**Mode 2: `/embed` (Pro-tier embedded)**

- Requires JWT in URL: `?token=<lab-jwt>&labId=<id>`
- Verifies JWT signature, expiry, and that claimed `labId` matches URL `labId`
- Loads lab definition by ID
- On completion, posts `{ type: 'lab.completed', labId, durationSeconds, objectivesMet, hintsUsed }` to parent window via `postMessage`
- Parent window is `certhead.com`; origin check enforced on both ends
- No upgrade CTA (user is already Pro)

**Shared code:**

- The entire engine (parser, state machine, grading, terminal UI, topology rendering)
- All lab definitions (free lab is just `labs.ccna[0]` — paid labs are `labs.ccna[1..]`)
- All UI components except the completion screen

---

## 🧱 ENGINE ARCHITECTURE — CORE INSIGHT

**The engine is a CLI-simulation framework, not a Cisco simulator.** Every CLI-driven technology stack is addressable through the same engine architecture:

```
┌──────────────────────────────────────────────────┐
│              Lab Definition (content)             │
│  topology · starting state · objectives · hints   │
└──────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────┐
│             Engine Core (reusable)                │
│                                                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │  Parser    │  │   State    │  │  Grading   │ │
│  │  (syntax)  │→ │  Machine   │→ │   Engine   │ │
│  └────────────┘  └────────────┘  └────────────┘ │
│        ▲                                          │
│        │                                          │
│  Syntax adapters (per tech stack):                │
│  · Cisco IOS    · Linux/bash    · PowerShell      │
│  · SQL          · kubectl       · Git             │
└──────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────┐
│              Terminal UI (presentation)           │
│  prompt rendering · history · context help        │
└──────────────────────────────────────────────────┘
```

**Syntax adapters are pluggable.** Adding a new technology stack means writing a new parser adapter + new state machine modules; the terminal UI, grading framework, and lab definition format are reused.

**State machines are per-device.** A multi-device lab is N independent state machines with explicit message-passing between them (e.g., OSPF hellos between R1 and R2). No global state.

**Grading is declarative.** Each lab objective is a query against device state, expressed in a small DSL. Examples:
- `device('R1').interface('Gi0/0').ip === '192.168.1.1/24'`
- `device('R1').ospf.neighbors.includes('R2', state: 'FULL')`
- `service('apache2').status === 'active'`

---

## 🎓 ADDRESSABLE CERTIFICATIONS (RANKED BY ENGINE FIT)

This is the long-term scope. Do not build any of these speculatively. Each is unlocked only when the corresponding question bank in CertHead is generating revenue.

**Tier 1 — Direct parser reuse from CCNA work:**
- **Cisco CCNA (200-301)** — first build, validates the engine, source of the free lab
- **CompTIA Network+ (N10-009)** — same protocol coverage, vendor-neutral framing
- **Linux+ (XK0-005), LPIC-1, RHCSA** — bash parser, file system state, services
- **Microsoft AZ-104, MD-102, MS-102** — PowerShell parser (`Verb-Noun` syntax is cleaner than IOS)

**Tier 2 — Different paradigm, same engine pattern:**
- **AWS SAA-C03, Azure cloud certs** — UI simulation (clickable console) rather than CLI
- **CKA, CKAD, CKS (Kubernetes)** — `kubectl` parser, manifest validation, cluster state simulation
- **Docker DCA** — narrow scope, fast content sprint

**Tier 3 — Security & analysis:**
- **Security+ (SY0-701), CySA+ (CS0-003)** — Linux investigation labs, pre-staged log analysis
- **Wireshark/packet analysis labs** — PCAP-driven, guided analysis

**Tier 4 — Data:**
- **DP-900, Oracle Associate, MySQL DBA** — SQL parser, result-set grading

**Tier 5 — DevOps:**
- **Git mastery (cert-adjacent)** — underserved, real demand
- **Terraform Associate, Ansible** — IaC parser, simulated apply

**Strategic sequencing rule:**

Labs follow question banks. Linux+ labs only get built after Linux+ question bank exists in CertHead and is generating revenue. The question bank validates demand cheaply; labs deepen the relationship and justify the price step-up.

---

## ⚠️ NON-NEGOTIABLE CONSTRAINTS

1. **No Cisco IP infringement.** We do not embed, reskin, redistribute, or reverse-engineer Packet Tracer, IOS images, or any Cisco proprietary asset. We simulate CLI behavior in our own code from public exam objectives. Same posture as the question bank's "no verbatim exam content" rule.

2. **No general-purpose simulator ambition.** Every lab is a scoped scenario with a curated command surface. If a learner types a command outside scope, we return a friendly redirect, not a fake response.

3. **Accuracy is per-lab, not global.** We target 98%+ fidelity within each lab's command surface. We do not target broad command-surface accuracy across the platform.

4. **The free lab is permanent and unconstrained.** No time limits, no feature gates within the lab, no nag screens during the experience. Constraint by quantity only (one lab), never by quality.

5. **No persistence in prototype phase.** Lab state is ephemeral. The moment we add backend persistence, this becomes a Real Product with deploy obligations. Even the free lab uses local storage only — no user accounts, no completion history.

6. **Production-quality code only** — same standard as CertHead. TypeScript, ESLint + Prettier, conventional commits, unit tests on all engine code. The free lab needs to feel as polished as any paid feature, because it IS the marketing.

7. **The engine is tier-agnostic.** Entitlement decisions live in CertHead, not in Labs. The lab engine just receives JWTs (in embed mode) or runs publicly (in try mode). It does not know what "Pro" means.

8. **No code generation shortcuts that produce non-deterministic behavior.** The engine must be 100% deterministic — same input always produces same output. This is the opposite of CertHead's AI question generation; lab behavior is rule-based, not probabilistic.

9. **Honor CertHead's launch priority.** If this project is taking time away from CertHead launch tasks, stop. Guardrail #21 is the law: dumb implementations until evidence demands more.

---

## 🛠️ ENGINE BUILD ORDER

Each item is a discrete weekend's work. Don't start item N+1 until N is done and committed. **The first ship target is the public free lab — everything before that is prerequisites.**

**Weekend 1-2: Foundation**
- Vite + React + TypeScript scaffolding
- Three-panel layout (topology / terminal / objectives)
- Terminal UI primitive (input handling, history, prompt rendering)
- Parser primitive: tokenizer + prefix-match command resolution

**Weekend 3-4: Cisco IOS adapter — single device**
- Mode stack (user / priv / config / config-if)
- Interface state (IP, mask, admin/protocol state)
- ~30 commands covering interface config + basic show commands
- The free lab definition (interface configuration end-to-end)
- `TryMode.tsx` route with completion CTA → `certhead.com/register?source=free-lab`

**🚀 SHIP MILESTONE 1: Public free lab at `labs.certhead.com/try`**

- Cloudflare Pages or Vercel static deploy
- CNAME `labs.certhead.com` from Namecheap DNS
- Link added from CertHead landing page once CertHead is live
- PostHog anonymous analytics on engagement + completion + CTA clicks
- Standalone marketing asset; no CertHead code changes required to ship

**Weekend 5-6: Static routing + ACLs**
- Routing table state, static route configuration
- ACL definition + traffic evaluation
- 5 more labs (Pro-tier, built locally, not deployed yet)

**Weekend 7-8: VLANs + switching basics**
- VLAN database, trunk/access mode, STP basics
- 5 more labs

**Weekend 9-10: Multi-device — OSPF**
- Multi-router topology, hello/neighbor state machine
- OSPF process configuration, network statements, area config
- Convergence simulation with realistic timing
- 5 more labs

**Weekend 11-12: Polish + lab authoring docs**
- Hint system, progressive reveal
- Reset, save/resume (local storage only)
- `LAB_AUTHORING.md` so future-me (or an SME) can author labs without engine work

**🚀 SHIP MILESTONE 2: Pro-tier labs available**

- Build `EmbedMode.tsx` route with JWT verification
- CertHead-side: new `LAB_JWT_SECRET` env var, `POST /api/labs/mint-token`, `POST /api/labs/completions`, `LabCompletion` Prisma model, lab list UI in study session
- Soft-launch to existing Pro subscribers
- ~25 CCNA labs total in the catalog

**Output after both milestones: free lab driving top-of-funnel + 25 Pro labs as retention/differentiation moat.**

---

## 📋 LAB AUTHORING FORMAT (DRAFT)

A lab is a TypeScript module exporting a `Lab` object:

```typescript
export const lab01: Lab = {
  id: 'ccna-l01-interface-ip',
  title: 'Configure Interface IP & Bring Link Up',
  exam: 'CCNA-200-301',
  difficulty: 1, // 1-5
  estimatedMinutes: 5,
  isFree: true,  // The free lab. Exactly one lab has this set across the catalog.
  topology: {
    devices: [
      { id: 'R1', platform: 'isr-4321', interfaces: ['Gi0/0', 'Gi0/1', 'Gi0/2'] }
    ],
    links: []
  },
  startingState: {
    'R1': { /* all interfaces admin-down, no IPs */ }
  },
  objectives: [
    {
      id: 'ip',
      text: 'Assign IP 192.168.1.1/24 to GigabitEthernet0/0',
      check: (state) => state.R1.interfaces['Gi0/0'].ip === '192.168.1.1'
                     && state.R1.interfaces['Gi0/0'].mask === '255.255.255.0'
    },
    {
      id: 'noshut',
      text: 'Bring the interface up with no shutdown',
      check: (state) => state.R1.interfaces['Gi0/0'].adminUp === true
    },
    {
      id: 'verify',
      text: 'Verify with show ip interface brief',
      check: (state, history) => history.some(cmd => /^sh(ow)?\s+ip\s+int(erface)?\s+br(ief)?$/.test(cmd))
    }
  ],
  hints: [
    { afterSeconds: 60, text: 'Start with `enable` to enter privileged mode.' },
    { afterSeconds: 180, text: 'Use `interface GigabitEthernet0/0` to enter config mode for the interface.' }
  ]
};
```

---

## 🚫 WHAT THIS PROJECT IS NOT

- Not a Packet Tracer clone
- Not a network engineer's daily-driver simulator
- Not a CCIE-level fidelity environment
- Not a free product overall (one free lab as marketing surface, rest is Pro)
- Not in CertHead's monorepo
- Not allowed to delay CertHead's launch sequence by a single day
- Not a standalone subscription — Pro labs unlock through existing CertHead Pro tier

---

## 🔗 INTEGRATION CONTRACT — DETAILED

### Stage 1: Free lab linking (ship target: alongside CertHead launch)

The only "integration" needed is a hyperlink. CertHead's landing page and pricing page link to `labs.certhead.com/try` with copy like "Try a free hands-on lab — no signup required." Zero code changes in CertHead.

Completion CTA on the free lab links back to `certhead.com/register?source=free-lab` so the funnel is tracked.

### Stage 2: Embedded Pro integration (ship target: +6-9 months)

When a Pro subscriber opens a lab from inside CertHead:

```typescript
// CertHead side: when user clicks a lab
// New endpoint: POST /api/labs/mint-token
async function mintLabToken(req, res) {
  const user = req.user; // from existing auth middleware
  const { labId } = req.body;

  // Entitlement check — same pattern as existing requireEntitlement
  if (user.tier !== 'PRO' && !user.examIds?.includes(getExamForLab(labId))) {
    throw Errors.forbidden('Pro subscription required for labs');
  }

  const labToken = jwt.sign({
    sub: user.id,
    labId,
    tier: user.tier,       // for analytics, not authz
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60  // 60 seconds
  }, env.LAB_JWT_SECRET);

  res.json({ token: labToken });
}

// CertHead consumer web app renders iframe
<iframe
  src={`https://labs.certhead.com/embed?token=${labToken}&labId=${labId}`}
  sandbox="allow-scripts allow-same-origin"
/>

// CertHead listens for completion events
window.addEventListener('message', async (e) => {
  if (e.origin !== 'https://labs.certhead.com') return;
  if (e.data.type === 'lab.completed') {
    await api.post('/api/labs/completions', e.data);
    // Existing streak service fires automatically off the completion record
  }
});
```

```typescript
// Labs side: on /embed route
const params = new URLSearchParams(location.search);
const token = params.get('token');
const labId = params.get('labId');

try {
  const claims = jwt.verify(token, LAB_JWT_SECRET);
  if (claims.exp < Date.now() / 1000) throw new Error('expired');
  if (claims.labId !== labId) throw new Error('lab mismatch');

  // Render the lab specified by claims.labId
  renderLab(getLabById(claims.labId));
} catch (err) {
  renderUnauthorizedScreen();
}
```

**On lab completion (embed mode only):**

```typescript
window.parent.postMessage({
  type: 'lab.completed',
  labId: claims.labId,
  durationSeconds: 247,
  objectivesMet: ['ip', 'noshut', 'verify'],
  hintsUsed: 0
}, 'https://certhead.com'); // explicit origin
```

### CertHead-side data model (when integration ships)

New Prisma model:

```prisma
model LabCompletion {
  id              String   @id @default(cuid())
  userId          String
  labId           String   // e.g. 'ccna-l03-interface-ip'
  examId          String?  // resolved at write time for joins
  completedAt     DateTime @default(now())
  durationSeconds Int
  objectivesMet   String[] // objective IDs
  hintsUsed       Int      @default(0)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, completedAt])
  @@index([labId])
  @@map("lab_completions")
}
```

Existing services (streak, XP if added, analytics) trigger off `LabCompletion` row creation. The lab engine has zero knowledge of these systems.

---

## 💰 PRICING STRATEGY — DEFERRED

**Decision deferred to post-launch + 3 months of data.** Two paths to consider:

**Path A: Labs in existing Pro tier ($9.99/mo).** Strengthens Pro value, drives conversion, no upside to ARPU.

**Path B: Pro+ tier at $19.99/mo with labs.** Segments the market, creates upgrade path, requires confidence that customers value labs enough to pay 2x.

**Recommended approach:** Launch labs as part of existing Pro at $9.99 initially. Use them to drive conversion and retention on the existing tier. After 3-6 months of engagement data, if labs are clearly the highest-engagement feature, introduce Pro+ at $19.99 with additional capabilities (more labs, advanced certs, priority generation of new exams) and grandfather existing Pro users.

This is a Phase 2 launch decision, not a foundation-doc decision. Banked here so it's not forgotten.

---

## 🧠 OPERATING NOTES (CARRIED FROM CERTHEAD)

These are CertHead guardrails that apply directly here:

- **Production-quality code only.** No TODOs, no demos in `src/`. Demos go in `prototypes/`.
- **Conventional commits** (feat:, fix:, chore:, docs:).
- **One clarifying question at a time** when blocked.
- **Be opinionated.** Direct recommendations, no menus.
- **Never paste secrets into chat** (guardrail #6 + #8 from CertHead). Eventually `LAB_JWT_SECRET` will exist — treat it like any other secret.
- **Pilot before any expansion.** Before adding a new syntax adapter, build one minimal lab end-to-end to validate the adapter. Don't write 15 lab definitions for an unproven parser.
- **The free lab is the polish bar.** It's seen by everyone, including non-customers. It must feel like a finished product, not a prototype. Quality > velocity on this surface.

---

## 📚 REFERENCE DOCS — CREATE AS NEEDED

| File | Create when... |
|------|---------------|
| `docs/ENGINE_ARCHITECTURE.md` | First multi-device lab is being designed |
| `docs/LAB_AUTHORING.md` | Authoring the 5th lab — patterns will be clear |
| `docs/INTEGRATION_SPEC.md` | Starting Stage 2 (embed mode + CertHead integration) |
| `docs/PARSER_ADAPTERS.md` | Adding the second syntax (bash after Cisco) |
| `docs/FREE_LAB_ANALYTICS.md` | First month of free-lab traffic data needs interpretation |

---

## 🎬 NEXT STEPS

1. Create the repo: `C:\Dev\certhead-labs` (separate from `C:\Dev\certhead`)
2. Drop the demo HTML into `prototypes/demo-01-single-device.html`
3. Initialize Vite + React + TypeScript in the repo root
4. Set up the three-panel layout as the first real component
5. Extract the parser logic from the demo into `src/engine/parser/`
6. Build the free lab as a proper `Lab` module
7. Wire up `TryMode.tsx` as the public entry point
8. Deploy to `labs.certhead.com/try` once CertHead launches
9. Add link from CertHead landing page

**Do not touch this project during CertHead launch week. The labs can wait. The launch cannot.**

**Ship Milestone 1 (free lab) within ~4 weeks of CertHead web launch.** That's the marketing asset that pays compounding dividends on every blog post, Reddit post, and tutorial video.

**Ship Milestone 2 (Pro embed) only after CertHead hits 300+ paid subscribers and customer signal supports labs as the next investment.** Until then, the free lab is doing real work and the rest is private development.

---

*Foundation document. Will evolve. Keep it lean — long CLAUDE.md files become stale CLAUDE.md files (see CertHead guardrail #10).*
