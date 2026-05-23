# LAB_AUTHORING.md

> How to author a lab for certhead-labs. This documents a **proven** pattern — it
> describes what the free lab and the three troubleshooting pilots actually do, not a
> guess at what labs might look like. Keep it current; a stale authoring doc is worse
> than none.
>
> A lab is a pure data artifact (`Lab` in `src/engine/types.ts`). You write topology +
> objectives + (optionally) a seeded starting state. The engine — parser, state
> machines, reachability, terminal UI — is reused unchanged. **Authoring a lab is
> content work, not engine work.** If a lab seems to need an engine change, stop and
> treat that as a separate decision (see CLAUDE.md's phase/sequencing law).

---

## 1. The two archetypes

Every lab built so far is one of two shapes. Pick the one that matches the lesson.

### A. Build-from-scratch
Devices start blank; the learner configures everything. Objectives grade the **end
state** plus (for "did you verify?" steps) **command history**.

This is the **free lab** (`src/labs/ccna/lab-01-interface-ip.ts`): blank router, learner
assigns an IP, brings the interface up, runs `show ip interface brief`. Use this shape
for *teaching a procedure* — config syntax, the order of operations, the verify habit.

### B. Seed-then-break (troubleshooting)
The lab pre-configures a **mostly-working** topology via `setup`, leaving exactly one
thing broken. The learner pings, gets a specific failure sentence that names what's
wrong, diagnoses, and fixes it. The fix is the completion.

This is the three troubleshooting pilots (`pilot-tshoot-return-route`,
`pilot-tshoot-wrong-next-hop`, `pilot-tshoot-wan-subnet-mismatch`). Use this shape for
*teaching diagnosis* — the thing a question bank fundamentally cannot teach, and the
reason hands-on labs justify their price.

**The seed-then-break shape is the higher-value one** and the rest of this doc leans
toward it. Its quality lives almost entirely in **which failure you break** — see §4.

---

## 2. The `Lab` contract

A lab exports a `Lab` object. Fields (see `src/engine/types.ts` for the authoritative
shape):

- `id`, `title`, `exam` — identity + UI labels.
- `difficulty` (1–5), `estimatedMinutes` — UI metadata.
- `isFree` — exactly **one** lab in the deployed catalog has this `true` (the free lab).
  Pilots are `false`.
- `scenario` — one or two short paragraphs of real-world framing shown on the brief
  screen before the terminal. For troubleshooting labs this is where you carry any
  context the failure sentence doesn't (see §4's "generic-sentence" reasons).
- `topology: { devices, links }` — `LabDevice[]` and `Link[]`. PCs may carry an initial
  `pc: { ip, mask, gateway }`; routers/switches start blank unless seeded via `setup`.
- `objectives: LabObjective[]` — see §3.
- `hints: LabHint[]` — see §5.
- `setup?` — the seed primitive; see §3.3. Present only on seed-then-break labs.

---

## 3. Objectives

```ts
check: (state: LabState, history: HistoryView, session: LabSession) => boolean
```

Three arguments, used by different check styles:

- **`state`** — router device state (interfaces) keyed by device id. Most state checks
  read this: `state.R1?.interfaces['Gi0/1'].ip === '192.168.1.1'`.
- **`history`** — per-device command history, with `raw` (as typed) and `resolved`
  (canonical, full-keyword) arrays. **Match verification objectives against `resolved`**
  so any valid abbreviation counts without enumerating them.
- **`session`** — the full `LabSession`. Reachability checks and non-router state live
  here: `canReach(session, 'PC-A', '192.168.2.10').ok`, or
  `session.devices.R2.staticRoutes.some(...)`.

### 3.1 The lean troubleshooting objective set — two objectives, no more

Every troubleshooting pilot uses exactly two:

1. **The fix** — checks the corrected state directly (e.g. R2 now has the return route,
   or R2's WAN interface is re-IP'd into R1's /30).
2. **Reachability** — `canReach(session, '<sourcePC>', '<destIP>').ok`.

**Do not add a "diagnosis" objective** (e.g. "ran `show ip route` on R2"). That grades
*"did you type a specific command,"* not *"did you reach the diagnosis"* — it makes the
lab feel scripted instead of diagnostic. The failed ping already hands the learner the
diagnosis (§4); completing the fix is the proof they understood it. This is a settled
decision across all three pilots — default it off.

### 3.2 Don't re-grade the seed
In a seed-then-break lab, the learner shouldn't have to redo working config. Grade only
the broken thing and the resulting reachability. Everything `setup` configured is
assumed correct and ungraded.

### 3.3 The `setup` primitive
Pre-seeds device state by running real IOS commands through the **same** `applyCommand`
pipeline the learner uses, at session init, before the learner has control.

```ts
readonly setup?: Readonly<Record<string, readonly string[]>>;
// Per-device IOS commands run at session init, BEFORE the learner gets control.
// Seed commands are NOT recorded in history — a verification objective must be
// satisfiable only by the learner, never by setup.
```

Rules that hold because seeding rides the real pipeline:

- Seed commands are real IOS lines and transition the mode stack exactly as typed ones
  do: `enable` → `configure terminal` → `interface gi0/0` → `ip address …` →
  `no shutdown` → `exit` → `ip route …`. The seeder needs no mode awareness.
- Seeding runs with **`record: false`** — seeded commands never appear in
  `history.raw` / `history.resolved`. (Test this: a no-record test must include a
  config-mode seed command, since the `do`-command resolved-history rewrite is the
  easy-to-miss leak.)
- **The engine appends `end` then `disable` automatically** (also un-recorded) at the
  end of each router's seed so the learner arrives at the `user>` prompt rather than
  wherever the last seed command left the mode. Authors don't add these — your seed
  array can end with `ip route …`, `exit`, or anything else.
- `setup` can only produce states the engine can already reach — it's a content field,
  not new engine behavior.

---

## 4. The failure-mode menu (the heart of a troubleshooting lab)

A troubleshooting lab is only as good as the **sentence the learner sees when the ping
fails.** A sharp sentence names the device (and usually the interface) and the failure
class — the learner is handed the diagnosis. A generic sentence forces the scenario
brief to carry the lesson.

`canReach` returns `{ ok: false, failedAt: { direction, deviceId, iface, reason } }`.
`reason` is a `FailReason`; the rendered learner sentence per reason is below
(`<deviceId>`/`<iface>` filled at fail time; `[<iface>]` means iface can be null and the
bracket vanishes). **Only `no-route` differs forward vs. return.**

| Reason | Sharpness | Learner sentence |
|---|---|---|
| `no-route` (fwd) | **Sharp** for missing-route only | `Request timed out — <deviceId> has no route to <target>.` |
| `no-route` (ret) | **Sharp** for missing-route only | `Reply timed out — <deviceId> has no return route to the source.` |
| `egress-down` | **Sharp** | `… <deviceId> <iface> is administratively down.` |
| `link-peer-down` | **Sharp** | `… the peer of <deviceId> <iface> is down.` |
| `link-subnet-mismatch` | **Very sharp** | `… the subnets on the two ends of the link at <deviceId> <iface> do not match.` |
| `next-hop-unreachable` | **Sharp**, dangling-ref caveat | `… the next-hop on <deviceId> [<iface>] is not in that interface's subnet.` |
| `no-gateway` | Semi-generic | `… no default gateway is set, or the gateway is outside the local subnet.` |
| `source-no-ip` | Generic | `… the source has no IP address configured.` |
| `source-nic-down` | Generic | `… the source NIC has no link to a neighbor.` |
| `dest-nic-down` | Generic | `… the destination NIC has no link.` |
| `dest-unreachable` | Generic / fallback | `… the destination is unreachable (no responding interface).` |
| `routing-loop` | Generic, concept-specific | `… static routes form a loop — packets never arrive.` |

(Prefix is `Request timed out —` on the forward walk, `Reply timed out —` on the return
walk.)

### The three authoring rules

1. **Pick a sharp reason first.** `egress-down`, `link-subnet-mismatch`, `link-peer-down`,
   `next-hop-unreachable`, and the missing-route variant of `no-route` all name device +
   (usually) interface. These are the diagnostic-strong building blocks. For a brand-new
   lab, start with `egress-down` (simplest, sharpest), `link-subnet-mismatch` (best
   subnet lesson), or `no-route` as a missing static (the return-route pilot's pattern).

2. **Don't dress wrong-mask up as `no-route`.** A wrong *interface mask* that breaks
   reachability produces `no-route` — identical to a missing route — so the learner
   "fixes" it by adding a route and ships through the wrong lesson. For any subnet/mask
   lesson use **`link-subnet-mismatch`** (re-IP one end of a /30 into a different /30).
   That's exactly the WAN subnet-mismatch pilot, and why it was titled honestly as a
   subnet mismatch rather than a "wrong mask" lab.

3. **Generic-sentence reasons need scenario carry.** `source-no-ip`, `source-nic-down`,
   `no-gateway`, `dest-nic-down`, `dest-unreachable`, `routing-loop` don't name the
   device — the `scenario` brief has to. Doable, but it's the harder authoring path.
   Reach for generic reasons only when the lesson genuinely lives there.

**`next-hop-unreachable` dangling-reference caveat:** when `findEgressForNextHop` returns
null, `iface` is null and the sentence ends "…not in that interface's subnet" with "that
interface" unanchored. Absorb it by naming the relevant interface and link explicitly in
the scenario and the second hint (the wrong-next-hop pilot does this with R2's WAN
interface and the /30).

---

## 5. Hints

Two hints, mirroring the pilots' cadence:

- **~90s** — a nudge toward *observing* (e.g. "ping and read where it breaks", "check
  `show ip route` on each router"). Don't give the answer.
- **~240s** — name the fix concretely (e.g. the exact `ip route …` line, or "re-IP R2's
  WAN interface into R1's /30").

For troubleshooting labs, write the second hint around the **real failure sentence** from
§4 so the brief, the ping output, and the hint all point at the same thing.

---

## 6. Registering a lab

**Today there is no catalog registry.** The deployed surface is the free lab only,
hardcoded in `TryMode.tsx`. New labs are authored as **pilots**:

- Add the lab to the pilot registry (`src/labs/_pilots/registry.ts`, the `{ slug, lab }`
  pattern) and it resolves at `?pilot=<slug>` via `PilotMode.tsx`. Pilot routes are gated
  by `import.meta.env.DEV` and **tree-shaken out of the prod bundle** — verify no pilot
  identifier leaks into `dist/` (grep the built bundle; the only legitimate hit is the
  engine's own `detailFor` runtime template, not pilot content).
- `TryMode` and `PilotMode` share the same data flow — both feed `useLabSession(lab)` and
  the same panel components — so a pilot exercises the real engine and UI, not a reduced
  one.

**Adding a *deployed* (non-pilot, catalog) lab is not a current operation.** Per CLAUDE.md
Ship Milestone 2, the catalog + `/embed` JWT route is a separate, revenue-gated project
(≥300 paid CertHead subscribers). When that bar is met, the catalog lifts the pilot
pattern out of `_pilots/` into a top-level registry (no `import.meta.env.DEV` gate), adds
an `App.tsx` route, and uses the existing `isFree` field to decide free-vs-Pro (JWT)
loading. Until then: **author labs as pilots.**

---

## 7. New-lab checklist

1. Pick the archetype (§1) and — for troubleshooting — a **sharp failure reason** (§4).
2. Write the `Lab` object: topology, `setup` (if seed-then-break), two objectives
   (fix + reachability for troubleshooting), two hints. Mirror the closest existing
   pilot.
3. Write a test mirroring that pilot's test: assert the seeded state, assert `canReach`
   fails with the **expected `failedAt`** before the fix, apply the fix, assert it flips
   to `ok` and both objectives pass.
4. Register as a pilot (§6).
5. Gates before commit: `tsc -b` clean (Vitest green ≠ prod-build green), `eslint
   --max-warnings 0`, full suite green, prod build emits **zero pilot-identifier leak**,
   and the **free lab is behaviorally untouched**.
6. Verify the in-browser moment on the `?pilot=` route: ping → the specific failure
   sentence → fix → ping replies → objectives flip green. If it doesn't *feel* like a
   diagnosis, the failure reason is probably too generic — revisit §4.
7. Commit (conventional commits, one per lab) and push.

---

*Authoring guide. Documents the proven pattern as of the three troubleshooting pilots +
the free lab. Update it when the pattern changes — not before.*
