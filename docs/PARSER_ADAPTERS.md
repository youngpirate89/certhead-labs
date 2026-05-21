# PARSER_ADAPTERS.md — Adding a Syntax Adapter

The engine is a CLI-simulation framework, not a Cisco simulator. A new
technology stack (bash, kubectl, PowerShell, SQL...) is added as a **syntax
adapter** that reuses the parser primitive, terminal UI, grading framework, and
lab format. Only two things are stack-specific: the **grammar** and the
**interpreter**. The Cisco IOS adapter in `src/engine/adapters/ios/` is the
reference implementation; copy its shape.

## The shared primitive (do not reimplement)

`src/engine/parser/` provides:

- `tokenize(line)` → whitespace tokens.
- `resolve(tokens, node)` → walks a `CommandNode` tree with prefix abbreviation,
  returning `complete | incomplete | ambiguous | invalid | empty`.

`CommandNode` describes structure only: `children` (keyword branches),
`argument` (capture the next token under a name), `terminal: true` (this node is
a runnable command), `help`.

## Adapter anatomy (mirror the IOS files)

```
src/engine/adapters/<stack>/
  state.ts        # device/session data model + helpers (validation, prompt)
  grammar.ts      # CommandNode tree(s); structure only, no execution
  interpret.ts    # applyCommand(session, raw) -> { session, output }
  index.ts        # barrel
  interpret.test.ts
```

### 1. `state.ts` — the data model

Plain serialisable data so grading can query it and sessions can be cloned.
Include a `prompt(session)` and a `createSession()` / builder. For IOS this is
the mode stack + interface map; for bash it would be cwd, filesystem tree,
env vars, and running services.

### 2. `grammar.ts` — structure only

Export the command tree(s). If the stack is modal (IOS has user/priv/config/
config-if), expose `grammarFor(mode)`. If it is flat (bash), a single tree.
Mark runnable nodes `terminal: true`; mark argument positions with `argument`.
Chain `argument` for multi-arg commands (see `ip address <ip> <mask>`).

### 3. `interpret.ts` — execution

`applyCommand(session, raw)`:

1. `tokenize` → `resolve(tokens, grammarFor(session.mode))`.
2. Map non-`complete` results to stack-appropriate error strings.
3. On `complete`, **clone** the session (never mutate input — determinism,
   CLAUDE.md #8), push the raw line to `history`, switch on the resolved
   `command` path, mutate the clone, return `{ session, output }`.

Output lines carry a `kind` (`output | error | system`).

## Wiring a lab to a new adapter

Grading is declarative and adapter-agnostic in shape: a lab objective is
`check(state, history) => boolean`. Today `LabState` in `src/engine/types.ts` is
typed to the IOS device map because IOS is the only adapter. When the second
adapter lands, generalise `LabState` to a union (or generic) keyed by adapter —
that is the one type change required; `grade()` itself stays.

## The pilot rule (CLAUDE.md)

Build ONE minimal lab end-to-end on the new adapter before authoring more. The
lab is the adapter's proof. See `src/labs/ccna/lab-01-interface-ip.test.ts`:
it runs the full solution (canonical and abbreviated) and asserts the lab grades
complete. Replicate that test for the first lab on any new adapter.

## Order of stacks (follows question-bank revenue, not engine fit)

Per CLAUDE.md: labs follow question banks. The next adapter after IOS is **bash**
(Linux+/RHCSA), and only once that question bank exists in CertHead and is
generating revenue.
