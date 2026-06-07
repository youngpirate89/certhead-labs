# CLAUDE.md — CertHead Labs (Prototype)

> Load this file every session. This is a separate project from `certhead/` —
> the question-bank product. Do not conflate the two; they have different
> architectures, different priorities, and different timelines.
>
> Last updated: 2026-05-30 (Lab 21 — OSPF default-information originate: redistribute a default route into OSPF as O*E2)

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

## 🎯 CURRENT FOCUS — CATALOG AT 21 LABS, ALL COMMITTED

Status: Engine has generalized well past the original troubleshooting-pilot scope. Switch + VLAN + trunking landed; on-demand hint reveal landed; DHCP server landed; "See Solution" disclosure landed across the entire catalog; NAT/PAT landed; named extended ACLs landed (grammar hardened with explicit coverage for the 4 src/dst×any/host/bare combinations + `eq` port forms); Lab 13 (OSPF tshoot — mismatched area) signed off via tests + cold-run; Lab 14 (DHCP relay via `ip helper-address`) added relay-path allocator + PC `lastIpconfig` verify gate; Lab 15 (default static route — `ip route 0.0.0.0 0.0.0.0 <nh>`) needed a one-shim engine fix — split `isValidRouteMask` off `isValidMask` so the route grammar accepts the /0 default mask while interface-IP validation still rejects `ip address X 0.0.0.0` as nonsense; Lab 16 (floating static route — `ip route <net> <mask> <nh> <ad>`) extended the `ip route` grammar with an optional trailing AD slot (validated 1..255), wired AD through `addStaticRoute` with idempotent same-target replacement, and RIB-filtered `show ip route` so per (prefix, mask) only the lowest-AD entry renders while losers remain in the routing table for LPM to promote on withdrawal; Lab 17 (OSPF passive-interface) added `[no] passive-interface <iface>` in config-router, an `OspfState.passive: Set<string>` of canonical iface ids (cleared on process-id change), neighbor-formation suppression in `recomputeOspf` when either endpoint is on its router's passive set (route advertisement path untouched — prefixes still advertised, matching IOS), a `Passive Interface(s):` section in `show ip ospf`, and first-time emission of the `router ospf <pid>` block in `show running-config` (network + passive-interface lines); Lab 18 (OSPF tshoot — passive-interface on the transit link) needed ZERO engine work — it reuses Lab 17's passive grammar/set/suppression and exercises the `no passive-interface` removal path plus the cross-device re-form on refresh (removing the WAN mark re-runs `recomputeOspf` and the R1↔R2 adjacency comes back); Lab 19 (OSPF tshoot — hello/dead timer mismatch) needed real engine work — `InterfaceState` gained `ospfHelloInterval`/`ospfDeadInterval` overrides (unset = `OSPF_DEFAULT_HELLO_INTERVAL`/`_DEAD_INTERVAL` = 10/40), `[no] ip ospf hello-interval|dead-interval <1-65535>` grammar + handlers in config-if, a timer-match gate in `recomputeOspf` (effective hello AND dead must agree on both ends or no neighbor forms — compared as static config, not simulated timers; this is a deliberate, documented departure from ospf.ts's original "timers intentionally omitted" stance), a new `show ip ospf interface [<iface>]` renderer (the `Timer intervals configured` line is the diagnostic; reuses an exported `matchingNetwork` from ospf.ts to pick OSPF-enabled interfaces + their area), and non-default `ip ospf hello-interval`/`dead-interval` lines in `show running-config`; Lab 20 (OSPF tshoot — MD5 auth mismatch) added `InterfaceState.ospfAuthMessageDigest`/`ospfMd5KeyId`/`ospfMd5Key`, `[no] ip ospf authentication message-digest` + `[no] ip ospf message-digest-key <id> md5 <key>` grammar/handlers in config-if, an auth-match gate in `recomputeOspf` (both ends must agree on auth-enabled, and when enabled share key-id + key string, else no neighbor — RFC 2328 App. D), and auth lines in `show running-config`/`show ip ospf interface`; Lab 21 (OSPF default-information originate) added `OspfState.defaultInfoOriginate`/`defaultInfoAlways` (both cleared on process-id change), `[no] default-information originate [always]` grammar + handler in config-router, a `Route.ospfExternal` flag, default-route injection in `recomputeOspf` (a FULL neighbor of a router that has `default-information originate` set AND a 0.0.0.0/0 in its RIB — or `always` — installs an `O*E2 0.0.0.0/0` at AD 110/metric 1; the originator keeps only its own static default, never a self-learned copy), and `show ip route` rendering of the `O*E2` code + "Gateway of last resort" header (scoped to the OSPF-external-default path so static-default labs 15/16 keep their existing simpler header verbatim), an ASBR/"Originate Default Route" line in `show ip ospf`, and a `default-information originate` line in `show running-config`. Catalog is at 21 labs, all committed (solution field standard across every catalog lab).

**Catalog (21 labs):**
- Lab 01: Interface IP — free lab, live at `/try` ✅ (ships a passive upstream switch peer, SW1, cabled to Gi0/0 — data-only, no objectives/setup — so `no shutdown` brings the line protocol genuinely up/up, matching the verify objective + completion copy; before it, Gi0/0 stays admin-down/protocol-down)
- Lab 02: Tshoot — wrong return route ✅
- Lab 03: Tshoot — wrong next-hop ✅
- Lab 04: Tshoot — WAN subnet mismatch ✅
- egress-down: Tshoot — WAN admin-down ✅
- Lab 05: OSPF single-area (configure + verify adjacency) ✅
- Lab 06: Standard ACL (deny host, permit subnet, apply outbound) ✅
- Lab 07: VLAN access ports (create VLANs, assign ports, verify segmentation) ✅
- Lab 08: VLAN trunking across two switches (configure trunk, verify, cross-switch reachability) ✅
- Lab 09: Inter-VLAN Routing — Router-on-a-Stick (ROAS) ✅
- Lab 10: DHCP server — exclude range, pool config, binding, verify ✅
- Lab 11: NAT/PAT overload — inside/outside roles, ACL-selected source, `ip nat inside source list ... overload`, verify ✅
- Lab 12: Named Extended ACL — `ip access-list extended <name>`, `permit/deny <proto> <src> <dst>`, apply inbound close to source, verify ✅
- Lab 13: OSPF tshoot — diagnose missing/wrong adjacency via `show ip ospf neighbor` (empty header rendered IOS-style) ✅
- Lab 14: DHCP relay — `ip helper-address` forwards client broadcasts across subnets to a remote pool ✅
- Lab 15: Default static route — `ip route 0.0.0.0 0.0.0.0 <next-hop>`, verify with `show ip route`, ping through the gateway of last resort ✅
- Lab 16: Floating static route — `ip route 0.0.0.0 0.0.0.0 <next-hop> <ad>`, primary at AD 1 + backup at AD 200, RIB shows only the winner ✅
- Lab 17: OSPF passive-interface — `passive-interface <iface>` under `router ospf <pid>` quiets hellos on LAN segments while keeping prefixes advertised; WAN adjacency stays FULL ✅
- Lab 18: OSPF tshoot — passive-interface on the transit link — R1's WAN port (Gi0/2) is mistakenly passive, so no adjacency forms and PC-A can't reach PC-B; diagnose via `show ip ospf`, `no passive-interface` the WAN, move passive to the LAN (Gi0/0) where it belongs ✅
- Lab 19: OSPF tshoot — hello/dead timer mismatch — R2's WAN port (Gi0/2) carries non-default `ip ospf hello-interval 5`/`dead-interval 20` vs R1's defaults (10/40); timers must match for adjacency, so no neighbor forms; diagnose via `show ip ospf interface`, align R2's timers (explicit 10/40 or `no` reset) ✅
- Lab 20: OSPF tshoot — MD5 authentication mismatch — the transit link runs `ip ospf authentication message-digest` with key-id 1 on both ends, but R2's key string is wrong (WrongKey99 vs R1's CISCO123); key-id AND key string must match or no adjacency forms; diagnose via `show ip ospf neighbor` (empty) + `show running-config interface`, align R2's key, confirm with a ping ✅
- Lab 21: OSPF default-information originate — R1 (edge) has a static default toward the ISP but R2 has no way out; `default-information originate` under `router ospf 1` on R1 redistributes the default into OSPF as `O*E2 0.0.0.0/0`, which R2 installs (gateway of last resort); verify on R2's `show ip route` + ping the internet host (8.8.8.2) from PC-B ✅

**Engine capabilities now span:**
- **Router:** interface config, static routes (with optional trailing AD on `ip route` — floating backups supported, RIB filters `show ip route` to the lowest-AD entry per prefix), OSPF single-area (neighbor state + O routes, `passive-interface <iface>` suppresses hellos on that segment while leaving the prefix advertised — `show ip ospf` lists passive interfaces; `show running-config` emits the `router ospf` block with network + passive-interface lines; per-interface `[no] ip ospf hello-interval|dead-interval <n>` with effective-value matching gating adjacency, surfaced by `show ip ospf interface`; per-interface MD5 auth `[no] ip ospf authentication message-digest` + `[no] ip ospf message-digest-key <id> md5 <key>` with both-ends key-id/key matching gating adjacency; `[no] default-information originate [always]` in config-router redistributes a default route as `O*E2 0.0.0.0/0` into FULL neighbors when the originator has a default in its RIB or `always` is set — `show ip route` renders the `O*E2` code + "Gateway of last resort" header and `show ip ospf` flags the ASBR), standard ACLs (numbered 1–99) AND named extended ACLs (`ip access-list extended <name>` enters config-ext-nacl mode; `permit/deny <proto> <src> <dst> [eq <port>]` lines auto-sequence in 10s; `ip access-group <name|number> in|out` binds), protocol + destination matching in `evaluateAcl`/`canReach` (PC/router ping handlers + tracert pass `protocol: 'icmp'` so extended `deny icmp` entries fire), subinterfaces with config-subif mode (`interface Gi0/0.10`), `encapsulation dot1q <vlan>` (native option), subif-aware `canReach` for inter-VLAN routing, DHCP server (`ip dhcp pool`, `ip dhcp excluded-address`, `network` / `default-router` / `dns-server` / `lease` in config-dhcp mode), deterministic binding allocator that propagates ip/mask/gateway into DHCP-client PCs, NAT/PAT overload (`ip nat inside`/`outside` on interfaces, `ip nat inside source list <acl> interface <iface> overload` in config) with canReach-integrated `effectiveSrcIp` translation at the inside→outside boundary and a LabSession-refresh-populated translation table, full show suite incl. `show run interface <iface>`, `show ip dhcp pool|binding|conflict`, `show ip nat translations|statistics`, and `show access-lists` (renders Standard and Extended ACLs; stamps Session.lastShowAccessLists as the verify gate).
- **Switch:** VLAN database, access + trunk ports, native VLAN, `switchport trunk allowed vlan`, VLAN-aware forwarding (same-VLAN reachable, different-VLAN blocked, trunk-aware across switches), `show vlan`, `show interfaces trunk`, `show run interface <iface>`. Verify-style objectives (e.g. `show interfaces trunk`) use a `lastShowInterfacesTrunk` session field written at command-eval time (mirrors PC `lastPing`) so they require an observe-after-configure action and cannot auto-complete from state alone.
- **PC:** ping (4 packets, engine-wide), tracert (streamed 150ms/hop, cancel-on-reset), ipconfig (with `(DHCP request pending)` and `/all DHCP Enabled: Yes` for `dhcpMode` PCs), redirect tier for out-of-scope commands.
- **Terminal:** streaming with input-lock, `[sim]` dim failure sentences, reset cancels in-flight streams.
- **Terminal panel:** `FloatingTerminalPanel` — single tabbed panel, draggable, drag-to-resize (right/bottom/corner), minimizes to snap-bar at bottom-center of viewport. Replaces per-device panels.
- **CLI theming:** Settings pill button, `TerminalThemePanel` with PuTTY-world bg/text color presets (Solarized Dark, Tomorrow Night, Monokai, Zenburn, Gruvbox, Matrix green), font size slider 12–18px, persists to localStorage.
- **Topology:** topology-first layout (canvas dominates viewport, terminal floats over it), device-specific icons (`RouterIcon`, `SwitchIcon`, `WorkstationIcon`) via `DeviceIcon` dispatcher, port-edge LEDs on cable-facing card edges (`EdgePortDot`) initialized from `startingState` on lab load, perpendicular label offset for diagonal cable edges, interface name labels pulled to 22%/78% along cables to clear card edges (3-label layout: source-iface @ 0.22, CIDR @ 0.5, target-iface @ 0.78), uniform card height 120px, IP centered, prompt line removed from cards, `NODE_GAP` tuned, platform badge and hint contrast at `#9ca3af`.
- **Hint system:** on-demand reveal — timer gates *availability*, learner clicks to reveal (deliberate flip from auto-print, which interrupted learners mid-typing).
- **Solution disclosure:** every catalog lab ships a `solution: LabSolution` block. `LabSolution = { steps: SolutionStep[] }`, step = `{ device, commands, note? }`. Collapsible "See Solution" panel under the hints — closed by default, muted text + chevron, no warning copy. **Solution field is now standard on the Lab type — every new lab requires a solution block, authored at the same time as the lab (not added retroactively).** The type stays optional so pilot/throwaway labs in `_pilots/` can omit it; catalog membership implies a solution. Command block renders one `<div>` per command (no `.join('\n')` into a single string) with `whitespace-pre` to preserve leading indents — learners can read the block top to bottom and type each line exactly as shown.
- **Extended ACL grammar:** hardened across the 4 src×dst combinations (`any|host <ip>|<ip> <wc>` for both source and destination) plus optional `eq <port|name>`. `show running-config interface <iface>` now mirrors the full `show running-config` and includes `ip access-group ... in|out` lines so the single-iface form doesn't silently drop bindings.

924 tests passing, tsc clean. Free lab unchanged and live.

**CertHead state (drives the next move):** Live exams: CCNA, N10-009, SY0-701. Paid subscribers: 0 — pre-launch, building catalog depth in private is the +4–12 week phase, fully in-bounds. Nothing deployed beyond the free lab; catalog registry, `/embed`, custom domain, and the landing-page link to `/try` all still gated on the ≥300-paid bar.

**Next — Lab 22 candidate selection: check CLAUDE.md strategic sequencing rules before starting. Authoring checklist for every new lab: starting state + objectives + hints + `solution: LabSolution` block — all authored together in the same PR, never as a follow-up.**

### 📌 Parked work (scoped, not started)

- **Tshoot diagnostic-arc standardization** (scope doc: card-vs-objective audit, this session). Two systemic gaps across the troubleshooting labs:
  - **Shape A:** the "confirm the break" diagnostic ping is instructed but ungraded in all 7 tshoot labs (02, 03, 04, egress-down, 11, 13, 18, 19). Benign (can't false-complete) — pedagogy enhancement, not a bug. Decision pending: adopt the 4-objective arc (observe → diagnose → fix → verify) catalog-wide, or leave as-is.
  - **Shape B:** diagnostic show commands graded inconsistently. Lab 13 is the clearest outlier — no diagnose objective at all, unlike siblings 18/19 which grade the cause command. If standardizing, Lab 13 needs a diagnose objective to match.

  This is a deliberate own-session sweep (7+ labs), STOP-checkpointed — not a tail-end add.

- **Per-interface canvas IP labels** (tshoot difficulty-floor enhancement). Topology shows link CIDR (e.g. `192.168.12.0/30`) but not each router's interface IP. Showing per-iface IPs on the cable (the 3-label layout already supports this) lowers the derivation floor for weaker learners without giving away the answer in objective text. Enhancement, not a fix.

- **Lab 09 indirectly-enforced "no shutdown Gi0/0":** acceptable as-is (subifs follow parent, so ping-cross-vlan gates it), noted for completeness — no action needed.

### 🧊 DEFERRED WORK — banked, build only when evidence demands (guardrail #21)

- **Next-hop resolvability + stacked `show ip route` (ECMP) rendering.** Today a static whose next-hop is not in any interface subnet (e.g. Lab 03's seeded `.99`) still renders in `show ip route`, and `canReach`/`showIpRoute` disagree (canReach refuses it as `next-hop-unreachable`, the RIB shows it). Two equal-AD statics to the same prefix also render as only one line (lowest-AD/earliest-insertion winner), not stacked ECMP. **This is a fidelity/clarity deviation, NOT a grading bug** — it only surfaces on the off-path action of adding the correct route *without* removing the seeded wrong one; the intended solution removes the wrong route first, and no adversarial probe in Lab 03/04 produced a false completion. **HOLD** (decided 2026-05-28). The faithful fix requires next-hop resolvability tied to **live** interface up-state (admin-down must withdraw the connected route + its dependent statics — exactly what the egress-down lab relies on for its `egress-down` diagnosis), i.e. RIB recomputation on admin-state change mirrored between the RIB and `canReach`. That is a load-bearing refactor of shared routing code rippling to Lab 02/03/04/egress-down, and it collapses Lab 03's "wrong next-hop" identity into Lab 02's "missing route" shape (requires rewriting a shipped lab). **Build it only when a lab is authored that intentionally teaches ECMP load-balancing or static-route recursion/resolvability — that lab is the evidence that demands it. At that point build the live-up-state resolvability predicate (mirrored RIB ↔ canReach) AND stacked `show ip route` rendering together.**

- **DTP / dynamic switchport-mode negotiation (switching fidelity pass).** Two related gaps, the SAME root cause: (1) the 2960 default switchport mode is `dynamic auto`, not static `access` (Lab 07 models it as `access`); (2) DTP negotiation is not modeled — a `switchport mode trunk` end paired with a `dynamic auto`/`desirable` peer would form a trunk on real IOS, but the engine requires both ends explicitly `trunk` (Lab 08). [CONFIRMED-BY-SOURCE: Cisco Community 2301356; networklessons; study-ccna.] A faithful default-mode requires a DTP state machine, so both gaps are one build. **Pedagogy is sound as-is** — Lab 08 deliberately teaches explicit both-ends `switchport mode trunk`, which is also operational best practice; Lab 07's access-port assignment is unaffected (`switchport access vlan` applies on a dynamic-auto port too). **Build the DTP model only when a lab intentionally teaches DTP / dynamic negotiation — that lab is the evidence that demands it.** Group with the OSPF-renderer items as a single "switching/routing fidelity pass." (Banked 2026-05-28 from the Lab 07/08 fidelity review.)

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

10. **Research official Cisco docs before any engine behavior or lab content.** Sources of record: `cisco.com/c/en/us/td/docs/...`, Wendell Odom's CCNA Official Cert Guide (ICND1/ICND2), IETF RFCs. No assumptions. If a behavior can't be sourced, flag it before implementing — don't ship a lab on a guess and find out at grading time. See `docs/LAB_AUTHORING.md` §8 for the design-rule corollaries (one VLAN = one subnet; static vs DHCP explicit in scenario).

---

## 🛠️ ENGINE BUILD ORDER

Each item is a discrete weekend's work. Don't start item N+1 until N is done and committed. **The first ship target is the public free lab — everything before that is prerequisites.**

**Weekend 1-2: Foundation** ✅ DONE
- Vite + React + TypeScript scaffolding
- Three-panel layout (topology / terminal / objectives)
- Terminal UI primitive (input handling, history, prompt rendering)
- Parser primitive: tokenizer + prefix-match command resolution

**Weekend 3-4: Cisco IOS adapter — single device** ✅ DONE
- Mode stack (user / priv / config / config-if)
- Interface state (IP, mask, admin/protocol state)
- ~30 commands covering interface config + basic show commands
- The free lab definition (interface configuration end-to-end)
- `TryMode.tsx` route with completion CTA → `certhead.com/register?source=free-lab`

**🚀 SHIP MILESTONE 1: Public free lab at `labs.certhead.com/try`** ✅ HIT

- Cloudflare Pages direct-upload deploy (`npx wrangler pages deploy`)
- Live at `https://main.certhead-labs.pages.dev/`
- `labs.certhead.com` CNAME + landing-page link still gated on CertHead launch
- PostHog anonymous analytics on engagement + completion + CTA clicks
- Standalone marketing asset; no CertHead code changes required to ship

**Weekend 5-6: Static routing + ACLs** ✅ DONE
- Static routes (Labs 02–04, egress-down troubleshooting pilots)
- Standard numbered ACLs 1–99 + `ip access-group` + `canReach` evaluation (Lab 06)

**Weekend 7-8: VLANs + switching basics** ✅ DONE (Lab 07 access ports, Lab 08 trunking)
- VLAN database (`vlan <id>`, `name`, `show vlan [brief]`)
- Access ports (`switchport mode access`, `switchport access vlan`)
- Trunk ports (`switchport mode trunk`, `trunk allowed vlan`, `trunk native vlan`, `show interfaces trunk`)
- VLAN-aware forwarding; trunk-aware forwarding across switches
- `show run interface <iface>` on switches (full state, explicit defaults)
- STP not implemented — out of scope until a lab demands it

**Weekend 9-10: Multi-device — OSPF** ✅ DONE (Lab 05)
- Multi-router topology rendering (React Flow, fixed-size clickable nodes, horizontal pan)
- OSPF single-area: `router ospf`, `network`, neighbor state, `O` routes in `show ip route`
- `show ip ospf neighbor`, `show ip ospf`

**Weekend 11-12: Polish + lab authoring docs** ✅ DONE
- On-demand hint reveal (timer gates availability, learner clicks to reveal)
- Reset cancels in-flight streams + clears revealed hint state
- `docs/LAB_AUTHORING.md` current through Lab 08
- Save/resume not implemented — deferred until a learner asks for it

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
