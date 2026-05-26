# Work order — author the `egress-down` troubleshooting lab

A single seed-then-break CCNA troubleshooting lab. This is a **content/authoring** task, not engine work. It's the scenario from the topology mockup: one interface administratively shut, reachability broken, learner diagnoses from the failure sentence and fixes with `no shutdown`.

## Read first — source of truth (do NOT trust the sketch below over these)

- `docs/LAB_AUTHORING.md` — both archetypes, the **`setup` primitive** section, the **FailReason menu (§4)** with its verbatim sentences and sharp/generic verdicts, and the **`lastPing` reachability pattern**.
- The FailReason → learner-sentence contract in `reachability.ts` + `pc.ts` (`detailFor`). It lives in **one place**; do not duplicate or re-author it.

The TypeScript below shows **intent and structure only**. Use the repo's actual `Lab` field names, `setup` shape, check DSL, state paths (e.g. how interface `adminUp` is actually read), `FailReason` enum, and the **verbatim egress-down sentence**. Where the sketch and the repo disagree, the repo wins.

## Dependencies & placement

- Depends on **A1** (lab registry) to be discoverable. Its visual payoff — the red port LEDs on the shut interface — lands with **A1.5**. Author it now; verify the LED behavior after A1.5 ships.
- File: `src/labs/ccna/lab-tshoot-egress-down.ts` — a **real lab**, NOT in `_pilots/`.
- Register in the catalog: in the `/embed` catalog, **out of** the `/try` bundle (same treatment as the other troubleshooting pilots).
- **`isFree: false`.** Exactly one lab is `isFree` and it is the interface-IP free lab. Do not change that.

## The scenario

Seed a fully-working `PC-A — R1 — R2 — PC-B` network with static routes in both directions, then administratively **shut R1's WAN interface (`Gi0/2`)**. `PC-A → PC-B` now fails.

**Why this is egress-down and not no-route (important — honors the "don't dress one failure as another" rule):** R1 *has* a route to PC-B's subnet; the route's **egress interface is down**. The seed must therefore include R1's route to `192.168.2.0/24` *and* R2's return route to `192.168.1.0/24`, so the **only** break is the shut interface. If the seeded state produces a `no-route` (or any other) sentence instead of `egress-down`, the seed is wrong — fix the seed, never reword the sentence.

## Module sketch (intent — conform to repo)

```ts
// src/labs/ccna/lab-tshoot-egress-down.ts
export const labTshootEgressDown: Lab = {
  id: 'ccna-tshoot-egress-down',
  title: 'Troubleshoot: interface administratively down',
  exam: 'CCNA-200-301',
  difficulty: 2,
  estimatedMinutes: 5,
  isFree: false,

  topology: {
    devices: [
      { id: 'PC-A', platform: 'host',     interfaces: ['NIC'] },
      { id: 'R1',   platform: 'isr-4321', interfaces: ['Gi0/0', 'Gi0/2'] },
      { id: 'R2',   platform: 'isr-4321', interfaces: ['Gi0/0', 'Gi0/2'] },
      { id: 'PC-B', platform: 'host',     interfaces: ['NIC'] },
    ],
    // endpoint-aware links (A1.5 schema) — drives the port LEDs
    links: [
      { a: { device: 'PC-A', port: 'NIC'   }, b: { device: 'R1',   port: 'Gi0/0' } },
      { a: { device: 'R1',   port: 'Gi0/2' }, b: { device: 'R2',   port: 'Gi0/2' } },
      { a: { device: 'R2',   port: 'Gi0/0' }, b: { device: 'PC-B', port: 'NIC'   } },
    ],
  },

  // SEED via the `setup` primitive — history NOT recorded, engine auto-tails end/disable.
  // Conform to the repo's actual setup shape (per-device IOS command lists).
  setup: {
    'R1': [
      'interface Gi0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown',
      'interface Gi0/2', 'ip address 10.0.0.1 255.255.255.252',  'no shutdown',
      'ip route 192.168.2.0 255.255.255.0 10.0.0.2',
      // --- THE BREAK (must be last): take the egress interface down ---
      'interface Gi0/2', 'shutdown',
    ],
    'R2': [
      'interface Gi0/0', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown',
      'interface Gi0/2', 'ip address 10.0.0.2 255.255.255.252',  'no shutdown',
      'ip route 192.168.1.0 255.255.255.0 10.0.0.1',
    ],
    // PC addressing (via setup or startingState, per repo convention):
    //   PC-A: 192.168.1.10/24, gateway 192.168.1.1
    //   PC-B: 192.168.2.10/24, gateway 192.168.2.1
  },

  objectives: [
    {
      id: 'noshut',
      text: 'Bring R1 Gi0/2 back up with no shutdown',
      // match the repo's real state path for admin state:
      check: (s) => s.R1.interfaces['Gi0/2'].adminUp === true,
    },
    {
      id: 'reach',
      text: 'From PC-A, ping PC-B successfully',
      // USE THE lastPing PREDICATE (target match + ok === true), NOT canReach(...).ok.
      // Copy the exact pattern from LAB_AUTHORING.md / an existing reachability lab.
      check: (s) => /* lastPing: PcSession('PC-A').lastPing matches PC-B's IP && ok === true */ false,
    },
  ],

  hints: [
    { afterSeconds: 60,  text: 'On R1, run `show ip interface brief` and check each interface’s status column.' },
    { afterSeconds: 180, text: 'An interface showing “administratively down” comes back with `no shutdown` in interface config mode.' },
  ],
};
```

## Failure sentence

Do **not** write a new one. The `egress-down` FailReason already has a verbatim, sharp sentence (names device + interface) in the contract. Confirm the seeded break triggers **that** reason for `PC-A → PC-B` and that it names `R1 Gi0/2`.

## Verification — §7 cold human run is the only sign-off

Real mouse + keyboard, full lab as a learner:

1. On load, `PC-A → PC-B` ping fails and the diagnostic shown is the **egress-down** sentence naming `R1 Gi0/2` (not `no-route` or anything generic).
2. (After A1.5) the two LEDs on the `R1–R2` link are **red**; the other four are green.
3. `enable` → `configure terminal` → `interface Gi0/2` → `no shutdown` flips those two LEDs green and ticks objective `noshut`.
4. **Objective `reach` does NOT tick on the fix alone** — it requires a learner-initiated successful ping (the `lastPing` lesson). Verify it stays incomplete until `PC-A` actually pings `PC-B` and succeeds.
5. Viewport matrix — wide desktop, ~520px embed iframe, mobile portrait — no panel overflow, all three panels legible.
6. `tsc -b` + Vitest green. Golden test: the seeded state yields `egress-down` for `PC-A → PC-B`, and flipping `Gi0/2` `adminUp` restores reachability.

## Commit

- One commit: `feat(labs): add egress-down troubleshooting lab`.
- Register in the catalog (depends on A1). Do not touch `LAB_AUTHORING.md` unless you discover a genuinely new pattern — you shouldn't, since `egress-down` is already on the FailReason menu.
