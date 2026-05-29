# Lessons Learned — CertHead Labs Fidelity & Grading Review (Labs 01-10)

A capture of what the fidelity/grading review of Labs 01 through 10 surfaced.
Organized by kind, because the lessons are not all the same kind of thing and
shouldn't be acted on the same way:

- **Part 1 - Authoring patterns:** recurring mistakes catchable by a checklist,
  a lint, or an authoring self-audit. These belong in `LAB_AUTHORING.md` and the
  work-order template.
- **Part 2 - Engine-fidelity findings:** facts about real Cisco IOS behavior the
  engine got wrong or simplified. These are caught only by sourcing against
  Cisco/Odom and by the fidelity review itself - NOT by any checklist. They live
  in the engine and in `CLAUDE.md` deferred-work.
- **Part 3 - Process lessons:** how the review and fix work itself went, and what
  to keep doing.

The single most important meta-lesson up front: **most fidelity issues are not
preventable by process. They were caught because each new lab got a fidelity
review against real Cisco sources. Keep running that review on every new lab.
The checklists below catch the mechanical patterns; only sourced review catches
"the engine models IOS wrong."**

---

## Part 1 - Authoring Patterns (checklist-enforceable)

### Pattern 1 - Objectives must prove the OUTCOME, not the gesture

The single most recurring bug across the whole review. A `check()` that confirms
the learner *typed a command* or that *some object exists*, rather than that the
*configured end-state is actually true*. None of these caused a false LAB
completion (sibling objectives always gated that), but each mis-credited a single
objective and could mislead a learner into thinking a wrong/incomplete config was
correct.

Where it bit:

- **Lab 01 `verify`** - completed on a `show ip interface brief` in history even
  with the interface still admin-down / no IP. History-match, not state.
- **Lab 05 `ospf-config`** - passed on any two area-0 `network` statements
  (`length >= 2`), even two junk networks matching no interface. Fixed to require
  the statements to COVER the connected interfaces.
- **Lab 06 `acl-verified`** - completed on ANY failed ping + a `show access-lists`
  in history, even with no ACL present (a stray `shutdown` ticked it). Fixed to
  require the failure reason === `acl-deny`.
- **Lab 07 `segmentation-verified`** - completed on a ping that failed for
  `no-gateway` (different subnets, no router) - a failure unrelated to VLANs.
  Reframed to prove segmentation structurally via VLAN membership.
- **Lab 08 `trunk-verified`** - passed on a factory-default port because an
  unconfigured port carries `trunkAllowedVlans: 'all'`; the check never confirmed
  `mode === 'trunk'` first. Fixed to gate on trunk mode.
- **Lab 10 `excluded`** - rigidly required one exact exclusion range; a valid
  two-command equivalent that achieves the identical result would false-fail.
  (Defensible since the objective names the range, but noted as rigidity.)

**Rule:** For each objective, write down what END-STATE it proves and how a wrong
config could still satisfy it. If the answer is "a command appears in history" or
"a field is non-empty," the check tests the gesture - tighten it to the outcome.
Reserve history-matching only for genuine "learner performed a verification
action" steps (see Pattern 3).

### Pattern 2 - canReach and the show/diagnostic surface must agree

A learner debugs by comparing what they SEE in show output against what actually
works. If those disagree, the lab teaches a wrong mental model.

Where it bit:

- **Lab 08 admin-down trunk** - `show interfaces trunk` reported the port
  `not-trunking` while the ping STILL SUCCEEDED across it. The forwarding walk
  checked `mode === 'trunk'` but never `adminUp/protocolUp`. This is a
  config/show CONTRADICTION, not just a fidelity gap - the most consequential
  finding in the review. Fixed so a trunk hop requires protocol-up, and show
  output and forwarding now agree in all four states (both up, each end down,
  both down).

**Rule:** This is the same invariant as the existing ping/tracert mirror rule,
generalized: **ping, tracert, canReach, and show output are one truth.** Any
reachability/forwarding change must keep all four consistent. The Lab 09 subif
fix had to be reconciled against the Lab 08 trunk fix for exactly this reason -
both touched the same forwarding path and the same `protocolUp` derivation.

### Pattern 3 - History-based checks are sticky; choose deliberately

A `check()` that matches command history (e.g. `/^show .../`) completes once and
CANNOT un-complete when the underlying config is later removed.

Where it appeared:

- **Lab 01 `verify`** and **Lab 02 `reach`** (lastPing latch) - both stay green
  after the config that justified them is torn down. The lab as a whole correctly
  reverts (sibling state-based objectives un-complete), so no false completion -
  but the stale tick is a known artifact.

**Rule:** Sticky history-matching is sometimes the right choice for a "did you
run the verification command" step, but it must be a CONSCIOUS choice, not an
accident. Prefer live-state gating where the objective is about an outcome.

### Pattern 4 - No em-dashes / smart punctuation in lab copy

Browser smart-punctuation and authored em-dashes in lab copy are a known input/
display problem and a house-style rule. This kept recurring (Lab 03/04 had
em-dashes; others flagged) precisely BECAUSE it was a manual checklist item.

**Rule:** Make this a FAILING TEST/lint over lab-definition copy (scenario,
objective text, hints, solution notes), not a checklist line. Scope to authored
lab copy only - the engine's own `[sim]` failure sentences are a separate
house-style decision (the engine uses em-dashes there intentionally).

### Pattern 5 - Card instructions and objectives must cover each other

The inverse of Pattern 1. Pattern 1 is an objective that grades too loosely; this is a card
instruction with NO objective behind it at all. A full-catalog card-vs-objective audit found
it is systemic:

- The "confirm the break" diagnostic ping is instructed in the scenario of ALL 7
  troubleshooting labs (02, 03, 04, egress-down, 11, 13, 18, 19) but graded in none - only
  the final successful ping is graded.
- Diagnostic `show` commands are graded inconsistently: Lab 13 grades none; Labs 18/19 grade
  the cause command (`show ip ospf` / `show ip ospf interface`) but not the symptom command
  (`show ip ospf neighbor`) the card tells the learner to run.

Benign for completion (sibling objectives gate the lab), but it trains learners that
instructed diagnostic steps don't matter - the opposite of the troubleshooting discipline
the labs exist to teach.

**Rule:** Audit card/scenario imperatives against `objectives[]` in BOTH directions -
instructed-but-ungraded actions AND objectives with no matching card instruction. Per lab,
decide deliberately: either grade the instructed step, or reword the copy as a suggestion
("Try pinging PC-B - you'll see it fail") rather than a step that implies credit. Do not
leave the mismatch. This is mechanizable - see Part 4.

---

## Part 2 - Engine-Fidelity Findings (sourced; NOT checklist-enforceable)

These are facts about real Cisco IOS behavior. Each required sourcing against
Cisco documentation / Odom OCG. A checklist cannot catch these - only a fidelity
review against sources can. Listed with their disposition.

### Fixed this review

- **Lab 01 uncabled interface never reaches up/up.** A single-device lab with
  `links: []` can't bring the line protocol up, so the "up/up" objective and
  banner contradicted the rendered `up/down`. Sourced: with a connected up peer,
  `no shutdown` brings both up; the uncabled case is IOS-version-dependent
  (down/down on older, up/down on newer) and ambiguous. Fixed by modeling a
  passive upstream switch so the protocol legitimately comes up. (The teaching
  point - admin state vs protocol state - only works if the protocol actually
  flips.)

- **Lab 09 subinterface line state must follow the physical parent.** The sim
  required a per-subinterface `no shutdown` and false-failed the canonical
  textbook ROAS recipe (physical `no shutdown` only). Sourced firmly against the
  Cisco CCNA curriculum and Cisco Press: a dot1Q subinterface's line state
  follows its parent; per-subif `no shutdown` is not required and has no effect.
  Fixed by deriving subif state from the parent and removing the spurious
  per-subif admin flag entirely (chose the honest model over a dead always-true
  field). `shutdown` on the physical still correctly disables all subifs.

- **Lab 09 Hint #2 was wrong, not the sim.** The hint claimed IOS rejects an
  `ip address` typed before `encapsulation dot1q`. Sourced: order is not
  enforced; the subif simply won't forward until encapsulation is set. The sim
  correctly did NOT enforce order, so the hint was reworded to match.

### Confirmed already-correct (no change)

- **Lab 06 ACL-denied ping shows `Request timed out`, not `Destination
  unreachable`.** Initially looked like a fidelity gap. Sourced: the display is
  position-and-direction-dependent. Lab 06 places the standard ACL outbound
  closest to the destination, so the block bites on the RETURN leg - the router
  drops its own echo reply and ping.exe prints a timeout with no ICMP involved.
  `Request timed out` is faithful for this placement. Left as-is.

### Banked - build only when a lab demands it

(These are real deviations or simplifications, all P2, none blocking, all on
ungraded or off-path surface. Grouped so they can be done together in a focused
fidelity pass when a lab actually teaches the relevant topic.)

- **OSPF neighbor renderer trio** (shared across Labs 05/13/17/18/19): missing
  DR/BDR role suffix on broadcast LAN segments (renders `FULL/  -`, correct only
  for true point-to-point); static placeholder Dead Time; no `show ip ospf
  neighbor detail` (grammar has no `detail` node, so loosening any lab regex is a
  no-op). Build when a lab teaches DR/BDR election or OSPF timers.

- **Lab 03 next-hop resolvability + ECMP rendering.** The engine installs static
  routes without validating next-hop reachability, so an unresolvable seeded
  next-hop appears in `show ip route` and creates a fake equal-AD tie. Correct
  IOS behavior (route not installed until next-hop resolves via a connected/up
  interface) requires RIB recomputation on admin-state change - a load-bearing
  refactor touching all static-route labs. Held: the bug only manifests off the
  solution path, causes no false completion, and the faithful fix would collapse
  Lab 03's "wrong next-hop" identity into Lab 02's "missing route" shape. Build
  alongside a future lab that intentionally teaches ECMP or static recursion.
  **(Update: the GRADING-layer hole here was closed separately - `fix-r2-next-hop` now
  requires the wrong static be removed, not just the correct one added. This ENGINE-layer
  fidelity deviation - an unresolvable next-hop still installs into `show ip route` - remains
  deferred. The two are distinct; Lab 03's grading is sound, its routing-engine fidelity is
  still banked.)**

- **DTP / dynamic switchport mode.** The 2960 default is `dynamic auto`, not
  static `access`, and DTP negotiation is not modeled. Sourced as a real
  deviation, but Lab 08 deliberately teaches explicit both-ends `switchport mode
  trunk` (also best practice), so pedagogy is sound. Build a DTP state machine
  only when a lab teaches DTP.

- **Lab 10 DHCP fidelity polish** (all ungraded, graded path sound): `show ip
  dhcp pool` shows a config echo instead of utilization stats (the most
  likely-noticed deviation - source first if a DHCP-fidelity pass happens);
  Client-ID column shows hostname not MAC; binding appears from server config
  without client DORA; lowest-address-first allocation. Possible enhancement:
  add a client-side `ipconfig` verify step to close the DORA loop.

---

## Part 3 - Process Lessons (how the work went)

- **One clean reproduction before any fix.** "It's not working" is not a bug report. Before
  scoping a fix, reset the lab and walk the exact failing path - and for grading fixes, walk
  the ADVERSARIAL path (do the wrong thing and confirm the objective stays red), not just the
  happy path. Multiple apparent bugs this session turned out to be config-entry slips (an
  incomplete subnet mask) or working-as-designed pedagogy (a tshoot lab correctly withholding
  the answer the learner must derive). A vague symptom handed to an implementing agent sends
  it changing engine code to chase a problem that may not exist. The reproduction is the
  cheapest possible filter between "real bug" and "user error / by design."

- **STOP checkpoints before load-bearing engine changes paid off repeatedly.**
  The prep-question gate before the Lab 09 subif fix surfaced two landmines
  before any code: six duplicated `adminUp` read sites across two near-verbatim
  walkers (`reachability.ts` and `pc.ts`, which must be edited in lockstep or
  ping/tracert diverge), and the `verify-brief` stamp going dead under the new
  model. Both would have been painful mid-implementation. Always prep before
  touching shared reachability/routing code.

- **A correct earlier decision shouldn't be reversed under pressure to "just fix
  it."** Several fidelity items looked like quick fixes but were deferred because
  the faithful fix was a load-bearing refactor with no grading impact (Lab 03
  routing, OSPF renderer, DTP). Guardrail: dumb implementations until evidence
  demands more. One off-path clarity deviation with zero grading impact does not
  justify a routing-engine refactor.

- **"What is this lab teaching?" is a design decision, not a mechanical fix.**
  Twice (Lab 03 Q3, Lab 07 segmentation) the faithful engine fix would have
  changed what the lab teaches. Those are owner decisions, surfaced rather than
  silently applied.

- **Don't let commits get born tangled.** A dirty tree with three streams of work
  sharing engine files (reviewed lab fixes + trunk work + OSPF WIP) repeatedly
  collided. The fix: commit the finished, reviewed work on its own honest message
  and move unfinished work aside (commit-in-sequence or stash) - NEVER hand-split
  246 interleaved lines into one lying commit. Verify build green after EACH
  commit, not just at the end, so a commit is never broken at its own HEAD.

- **`tsc -b` green is not the same as Vitest green.** Build the prod target
  before committing; the gap has caused regressions.

- **Cold-run is required for behavior/consistency/layout changes, even when
  tests are green.** The deterministic-engine argument ("UI didn't change, tests
  cover it") is valid for pure logic changes but NOT for consistency fixes (the
  whole point is human-visible agreement) or busy-topology-at-full-width layout
  (tests don't render the canvas). The Lab 08 trunk fix and Lab 09 subif fix both
  earned the eyeball.

- **Reviewer discipline worked.** The fidelity reviewer correctly classified
  uncertain real-IOS claims as NEEDS-SOURCE rather than guessing, distinguished
  CONFIRMED-BY-TEST (sim matches its own definition) from real-IOS fidelity, and
  flagged a test-harness race as not-an-engine-bug rather than padding the
  report. Keep that classification rigor.

---

## Part 4 - Tooling (graduate mechanical patterns from checklist to lint)

The meta-lesson holds: checklists catch mechanical patterns, only sourced review catches
fidelity. So any pattern that IS mechanical should become a test/lint, not a checklist line
that recurs precisely because it's manual (the Pattern 4 trap). Status of mechanizable checks:

- **Em-dash / smart-punctuation in lab copy (Pattern 4):** promised in Pattern 4, NOT yet
  implemented - still a manual checklist item, which is why it recurred. The only related code
  is `sanitizeInput` (`src/engine/terminal/sanitize.ts`), which maps smart punctuation in
  learner *terminal input* back to ASCII at parse time; it does NOT scan authored
  lab-definition copy (scenario/objective/hint/solution text). No failing test asserts that
  authored copy is em-dash-free.
- **Card/objective coverage (Pattern 5):** NOT yet implemented. A check that parses each lab's
  scenario/hint/solution copy for imperative verbs and flags those with no corresponding
  objective would catch the instructed-but-ungraded gap mechanically. Lower precision than the
  em-dash lint (natural-language imperatives are fuzzier than character matches), so likely a
  warning-level audit rather than a hard failing test. Banked as a candidate.
