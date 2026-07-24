# CertHead Labs Active Workspace Visual Refresh Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make the active CertHead lab workspace feel like a polished learning product while preserving existing lab behavior, topology semantics, terminal behavior, scoring, hints, and reset flows.

**Architecture:** Keep the current desktop topology/objectives/terminal layout and mobile tab workspace. Improve hierarchy through reusable presentation tokens and focused component markup changes in `Layout` and `ObjectivesPanel`; limit terminal changes to chrome/presentation. Do not redesign network device artwork or alter engine state in this scope.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, Testing Library, Playwright/browser smoke, React Flow.

---

### Task 1: Add visual-contract regression tests

**Objective:** Lock the intended workspace hierarchy before changing presentation.

**Files:**
- Modify: `src/components/Layout.test.tsx`
- Modify: `src/components/ObjectivesPanel.test.tsx`

**Step 1: Write failing Layout tests**

Assert that desktop workspace markup exposes:
- a branded product header region
- a concise lab-context group containing exam label and lab title
- a topology workspace region with an accessible label
- a visually distinct objectives rail
- the existing mobile workspace tabs/actions unchanged

**Step 2: Write failing ObjectivesPanel tests**

Assert that the panel exposes:
- an accessible progress summary such as `0 of 3 objectives complete`
- a progress bar with `aria-valuemin`, `aria-valuemax`, and `aria-valuenow`
- numbered objective rows
- clear pending/completed state labels without changing objective text
- existing reset, hint, solution, and completion behavior

**Step 3: Verify RED**

Run from Windows PowerShell in `C:/dev/certhead-labs`:

```powershell
npm test -- --run src/components/Layout.test.tsx src/components/ObjectivesPanel.test.tsx
```

Expected: new visual-contract assertions fail while existing behavior tests continue to pass.

---

### Task 2: Improve workspace header and canvas hierarchy

**Objective:** Turn the thin utility bar into a professional product header and give the topology/terminal/objectives regions clearer visual structure.

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/index.css`
- Test: `src/components/Layout.test.tsx`

**Step 1: Implement the header hierarchy**

- Keep `CertHead Labs` as the brand anchor.
- Render the exam label as a compact credential badge instead of faint mono text.
- Render the lab title as the primary workspace context, with truncation at narrow desktop widths.
- Keep the theme control, but give it an icon and clearer active-state styling without adding a new dependency.
- Preserve all current labels and button behavior.

**Step 2: Improve region surfaces**

- Add a subtle inset/shadow boundary around the active workspace rather than relying only on one-pixel separators.
- Keep topology dimensions and behavior unchanged.
- Give the objectives rail a slightly wider, calmer surface at desktop widths if tests and 1024px smoke show no topology crowding.
- Improve the docked terminal divider/title hierarchy without changing terminal sizing, command behavior, tabs, or settings.

**Step 3: Verify GREEN**

Run:

```powershell
npm test -- --run src/components/Layout.test.tsx
```

Expected: all Layout tests pass.

---

### Task 3: Redesign the objectives rail as a guided task panel

**Objective:** Make progress, the next required actions, hints, and reset controls scannable at a glance.

**Files:**
- Modify: `src/components/ObjectivesPanel.tsx`
- Modify: `src/components/ObjectivesPanel.test.tsx`
- Modify only if needed for consistent disclosure styling: `src/components/SolutionDisclosure.tsx`

**Step 1: Add progress hierarchy**

- Replace the tiny `0/3` counter with a visible progress summary and slim progress bar.
- Keep `Lab Complete` behavior and current completion animation.
- Expose progress semantics to assistive technology.

**Step 2: Improve objective rows**

- Render each objective as a compact card/step rather than an unbounded text row.
- Add visible step numbers.
- Use a stronger pending-state marker and an unambiguous completed check state.
- Preserve exact learner-facing objective wording and `met` logic.
- Keep the just-completed animation subtle and non-layout-shifting.

**Step 3: Clarify support actions**

- Group hints under a visually distinct `Need help?` section while retaining countdown/reveal behavior and analytics callback semantics.
- Keep solution disclosure below hints and closed by default.
- Give Reset a labeled control or tooltip-backed text treatment that is discoverable without dominating the panel.

**Step 4: Verify focused behavior**

Run:

```powershell
npm test -- --run src/components/ObjectivesPanel.test.tsx src/components/SolutionDisclosure.test.tsx
```

Expected: progress, objective state, hints, reset, solution, and completion tests pass.

---

### Task 4: Preserve mobile workspace and both themes

**Objective:** Ensure the refresh improves desktop without regressing the existing phone-specific tab workspace or light mode.

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/index.css`
- Modify: `src/components/Layout.test.tsx`
- Modify: `src/components/ObjectivesPanel.test.tsx`

**Step 1: Mobile treatment**

- Keep Scenario/Topology/Terminal/Objectives/Hints tabs.
- Keep sticky Verify/Reset/Hint actions.
- Ensure the refreshed objectives cards fit without horizontal scrolling.
- Preserve conditional mounting of hidden heavy panels.

**Step 2: Theme treatment**

- Add explicit light-theme colors for all new surfaces, progress states, borders, and text.
- Avoid relying on opacity-only contrast for critical labels.
- Preserve terminal theme independence.

**Step 3: Run focused tests**

```powershell
npm test -- --run src/components/Layout.test.tsx src/components/ObjectivesPanel.test.tsx
```

Expected: all focused tests pass.

---

### Task 5: Full verification and visual QA

**Objective:** Prove the refresh works as a learner-facing product, not only as component markup.

**Files:**
- Add QA artifacts under: `qa-runs/workspace-visual-refresh/`
- Add/update a concise handoff note under: `/home/guilty_spark/CertHead/notes/`

**Step 1: Run repository gates**

```powershell
npm test -- --run
npm run build
npm run lint
```

If the normal lint launcher cannot find ESLint, use the installed config-package ESLint binary documented in the CertHead skill and report the launcher issue separately.

Also run:

```powershell
git diff --check
git status --short
```

**Step 2: Browser-smoke the real flow**

Exercise `Starter 1: Configure an Interface IP` through:
- pre-lab screen
- Start lab
- topology/device selection
- terminal command entry
- objective transition from pending to complete
- hint countdown/reveal
- reset
- light mode

Inspect at:
- desktop approximately 1440x900
- compact desktop approximately 1024x768
- iPhone-sized portrait viewport

Required visual checks:
- no clipping or overlap
- topology remains readable
- terminal does not cover objectives/topology
- objective text remains fully readable
- progress state is obvious
- light-mode contrast is acceptable
- no browser console errors

**Step 3: Scoped commit and handoff**

Commit only files changed for this visual refresh. Record branch, commit, clean/dirty state, test/build/lint results, and QA artifact paths in the CertHead handoff note.

---

## Explicit non-goals

- No network-device illustration redesign in this scope.
- No topology engine or command parser changes.
- No objective/scoring logic changes.
- No new persistence, analytics events, lab content, or deployment behavior.
- No production deployment until local tests and browser QA pass and Moises explicitly authorizes deployment.
