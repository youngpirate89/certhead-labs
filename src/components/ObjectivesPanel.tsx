import { useEffect, useRef, useState } from 'react';

/**
 * ObjectivesPanel — live status of the lab's objectives + on-demand hints.
 *
 * When an objective transitions from unmet → met, the row briefly flashes a
 * teal highlight and the check icon pops in. Pure visual reaction — no
 * configuration; the panel diffs incoming statuses against the previous render
 * to decide what to animate. Generic chrome, exam-agnostic.
 *
 * Hints render below the objectives as a click-to-reveal list. The timer
 * gates AVAILABILITY (when the button becomes clickable) — it does NOT
 * auto-display content. Each hint is independent: revealing hint 1 does not
 * reveal hint 2. Reset clears every revealed state (driven by resetToken).
 */
export interface ObjectiveView {
  id: string;
  text: string;
  met: boolean;
}

export interface HintView {
  /** Order this hint appears in the lab definition; used as React key + UI
   *  label ("Hint 1", "Hint 2", …). */
  index: number;
  text: string;
  /** Wall-clock seconds after the lab started before this hint unlocks. */
  afterSeconds: number;
}

interface ObjectivesPanelProps {
  title: string;
  objectives: ObjectiveView[];
  /** Optional reset handler. When provided, a small reset button appears in
   *  the header. Generic — no lab-specific assumptions. */
  onReset?: () => void;
  /** Hint set for the current lab. When omitted or empty the hints section
   *  doesn't render — keeps panels for hint-less labs visually unchanged. */
  hints?: readonly HintView[];
  /** Lab start timestamp (Date.now() at the moment the brief was dismissed).
   *  Null while the brief is still showing. The hint timers anchor to this. */
  labStartedAt?: number | null;
  /** Monotonic counter that increments on reset. The hints' revealed state
   *  is cleared each time this changes — same contract the rest of the app
   *  uses for "lab was reset, drop derived UI state". */
  resetToken?: number;
  /** Fired ONCE when the learner reveals a previously-locked hint. Used by
   *  TryMode for funnel analytics; pilot mode leaves it undefined. */
  onRevealHint?: (index: number) => void;
}

/** Detect objectives that just flipped to met; clears after the flash plays. */
function useJustMet(objectives: ObjectiveView[]): Set<string> {
  const prevMet = useRef<Set<string>>(new Set());
  const [justMet, setJustMet] = useState<Set<string>>(new Set());

  useEffect(() => {
    const nowMet = new Set(objectives.filter((o) => o.met).map((o) => o.id));
    const flipped = new Set<string>();
    for (const id of nowMet) {
      if (!prevMet.current.has(id)) flipped.add(id);
    }
    prevMet.current = nowMet;
    if (flipped.size > 0) {
      setJustMet(flipped);
      const t = setTimeout(() => setJustMet(new Set()), 1500);
      return () => clearTimeout(t);
    }
  }, [objectives]);

  return justMet;
}

export function ObjectivesPanel({
  title,
  objectives,
  onReset,
  hints,
  labStartedAt,
  resetToken,
  onRevealHint,
}: ObjectivesPanelProps) {
  const justMet = useJustMet(objectives);
  const metCount = objectives.filter((o) => o.met).length;
  const allMet = metCount === objectives.length && objectives.length > 0;

  return (
    <div className="flex h-full flex-col bg-panel-bg">
      <div className="flex items-center justify-between gap-3 border-b border-panel-border px-4 py-3">
        <h2
          className={`flex items-center gap-2 font-sans text-sm font-semibold transition-colors duration-300 ${
            allMet ? 'text-terminal-prompt' : 'text-terminal-fg'
          }`}
        >
          {allMet && (
            <span
              aria-hidden
              className="grid h-4 w-4 place-items-center rounded-full border border-terminal-prompt bg-terminal-prompt/15 text-[10px] font-bold text-terminal-prompt"
            >
              ✓
            </span>
          )}
          {allMet ? 'Lab Complete' : title}
        </h2>
        <div className="flex items-center gap-3">
          <span
            className={`font-mono text-xs tabular-nums transition-colors duration-300 ${
              allMet ? 'text-terminal-prompt' : 'text-terminal-dim'
            }`}
            aria-live="polite"
          >
            {metCount}/{objectives.length}
          </span>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              title="Reset lab"
              aria-label="Reset lab"
              className="grid h-6 w-6 place-items-center rounded text-terminal-dim transition-colors hover:bg-panel-border hover:text-terminal-fg focus:outline-none focus:ring-1 focus:ring-terminal-prompt"
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4v5h5" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <ul className="space-y-1 p-2">
          {objectives.map((o) => {
            const flashing = justMet.has(o.id);
            return (
              <li
                key={o.id}
                className={`flex items-start gap-3 rounded-md px-2 py-2 text-sm transition-colors ${
                  flashing ? 'animate-objective-flash' : ''
                }`}
              >
                <span
                  className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[10px] font-bold transition-colors duration-300 ${
                    o.met
                      ? 'border-terminal-prompt bg-terminal-prompt/15 text-terminal-prompt'
                      : 'border-panel-border text-transparent'
                  }`}
                  aria-hidden
                >
                  <span className={flashing ? 'animate-check-pop' : ''}>
                    {o.met ? '✓' : ''}
                  </span>
                </span>
                <span
                  className={`transition-colors duration-300 ${
                    o.met ? 'text-terminal-dim line-through' : 'text-terminal-fg'
                  }`}
                >
                  {o.text}
                </span>
              </li>
            );
          })}
        </ul>
        {hints && hints.length > 0 && (
          <HintsList
            hints={hints}
            labStartedAt={labStartedAt ?? null}
            resetToken={resetToken ?? 0}
            onRevealHint={onRevealHint}
          />
        )}
      </div>
      {allMet && onReset && (
        <div className="border-t border-panel-border p-3">
          <button
            type="button"
            onClick={onReset}
            className="w-full rounded-md border border-terminal-prompt/60 bg-terminal-prompt/10 px-3 py-2 font-sans text-sm font-semibold text-terminal-prompt transition hover:bg-terminal-prompt/20 focus:outline-none focus:ring-2 focus:ring-terminal-prompt focus:ring-offset-2 focus:ring-offset-panel-bg"
          >
            Reset lab
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HintsList — on-demand reveal with countdown gating
// ---------------------------------------------------------------------------

interface HintsListProps {
  hints: readonly HintView[];
  labStartedAt: number | null;
  resetToken: number;
  onRevealHint?: (index: number) => void;
}

/** Locked hints countdown every second; once every hint is either available
 *  or revealed the ticker pauses (nothing to render). Revealed state lives
 *  here and is cleared on resetToken bumps — matches the rest of the UI's
 *  "reset = drop derived state" contract. */
function HintsList({ hints, labStartedAt, resetToken, onRevealHint }: HintsListProps) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [now, setNow] = useState<number>(() => Date.now());

  // Reset: drop revealed state so the hints flip back to their locked/
  // countdown form. The mode owns labStartedAt; we just reset our own
  // revealed-tracker.
  useEffect(() => {
    setRevealed(new Set());
  }, [resetToken]);

  // Re-anchor the countdown clock when the lab start time changes (reset,
  // brief dismissed, etc). Without this, `now` lags labStartedAt until the
  // 1Hz ticker fires — visible as a one-second flicker that the post-reset
  // test catches deterministically.
  useEffect(() => {
    if (labStartedAt) setNow(Date.now());
  }, [labStartedAt, resetToken]);

  // 1Hz ticker — only runs while at least one hint is still locked AND
  // unrevealed. Once every hint is either available (countdown elapsed)
  // OR revealed, there's nothing more for the ticker to update.
  useEffect(() => {
    if (!labStartedAt) return;
    const allElapsedOrShown = hints.every((h, i) => {
      if (revealed.has(i)) return true;
      const elapsed = (Date.now() - labStartedAt) / 1000;
      return elapsed >= h.afterSeconds;
    });
    if (allElapsedOrShown) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [labStartedAt, hints, revealed]);

  function reveal(i: number) {
    // Guard outside the setter so React's strict-mode double-invocation of
    // the updater never fires the callback twice. The button is also
    // disabled once `revealed[i]` is true, so a second click can't reach
    // here in practice.
    if (revealed.has(i)) return;
    setRevealed((prev) => {
      if (prev.has(i)) return prev;
      const next = new Set(prev);
      next.add(i);
      return next;
    });
    onRevealHint?.(i);
  }

  return (
    <div className="border-t border-panel-border px-2 py-2">
      <h3 className="px-2 pb-1 font-sans text-[11px] font-semibold uppercase tracking-wider text-terminal-dim">
        Hints
      </h3>
      <ul className="space-y-1">
        {hints.map((h, i) => (
          <HintRow
            key={i}
            label={`Hint ${i + 1}`}
            text={h.text}
            afterSeconds={h.afterSeconds}
            labStartedAt={labStartedAt}
            now={now}
            revealed={revealed.has(i)}
            onReveal={() => reveal(i)}
          />
        ))}
      </ul>
    </div>
  );
}

interface HintRowProps {
  label: string;
  text: string;
  afterSeconds: number;
  labStartedAt: number | null;
  now: number;
  revealed: boolean;
  onReveal: () => void;
}

function HintRow({
  label,
  text,
  afterSeconds,
  labStartedAt,
  now,
  revealed,
  onReveal,
}: HintRowProps) {
  if (revealed) {
    return (
      <li className="rounded px-2 py-1.5">
        <div className="font-sans text-[11px] uppercase tracking-wider text-terminal-dim">
          {label} — shown
        </div>
        <div className="mt-1 font-sans text-xs leading-relaxed text-terminal-fg/80">
          {text}
        </div>
      </li>
    );
  }

  // Pre-start (labStartedAt null): treat as fully locked at the configured
  // delay. Once labStartedAt is set the countdown ticks down to zero.
  const elapsed = labStartedAt ? (now - labStartedAt) / 1000 : 0;
  const remaining = Math.max(0, Math.ceil(afterSeconds - elapsed));
  const available = remaining <= 0 && labStartedAt !== null;

  return (
    <li>
      <button
        type="button"
        disabled={!available}
        onClick={onReveal}
        aria-label={available ? `${label} — click to reveal` : `${label} — locked, ${remaining} seconds remaining`}
        className={`w-full rounded px-2 py-1.5 text-left font-sans text-xs transition-colors ${
          available
            ? 'cursor-pointer text-terminal-dim hover:bg-panel-border/50 hover:text-terminal-fg focus:outline-none focus:ring-1 focus:ring-terminal-prompt'
            : 'cursor-not-allowed text-[#9ca3af]'
        }`}
      >
        <span className="font-semibold uppercase tracking-wider">{label}</span>
        <span className="mx-1.5">—</span>
        <span>{available ? 'click to reveal' : `available in ${formatCountdown(remaining)}`}</span>
      </button>
    </li>
  );
}

/** Render `M:SS` for any non-negative second count (0 → "0:00"). */
function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
