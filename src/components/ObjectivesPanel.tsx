import { useEffect, useRef, useState } from 'react';
import type { LabSolution } from '@/engine/types';
import { SolutionDisclosure } from './SolutionDisclosure';

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
  /** Optional worked solution. When provided AND non-empty, a collapsible
   *  "See Solution" disclosure renders below the hints. Closed by default;
   *  the panel keeps its own open/closed state independently of reset. */
  solution?: LabSolution;
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
  solution,
}: ObjectivesPanelProps) {
  const justMet = useJustMet(objectives);
  const metCount = objectives.filter((o) => o.met).length;
  const allMet = metCount === objectives.length && objectives.length > 0;

  return (
    <div className="objectives-panel flex h-full min-w-0 flex-col overflow-x-hidden bg-panel-bg">
      <div className="objectives-header border-b border-panel-border px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-terminal-dim">
              Lab checklist
            </p>
            <h2
              data-objective-complete={allMet ? 'true' : 'false'}
              className={`objective-heading mt-0.5 flex items-center gap-2 font-sans text-base font-semibold transition-colors duration-300 ${
                allMet ? 'text-terminal-prompt' : 'text-terminal-fg'
              }`}
            >
              {allMet && <CheckIcon className="h-4 w-4" />}
              {allMet ? 'Lab Complete' : title}
            </h2>
          </div>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              title="Reset lab"
              aria-label="Reset lab"
              className="reset-control flex shrink-0 items-center gap-1.5 rounded-md border border-panel-border px-2 py-1.5 font-sans text-xs font-semibold text-terminal-dim transition-colors hover:bg-panel-border/60 hover:text-terminal-fg focus:outline-none focus:ring-2 focus:ring-terminal-prompt"
            >
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
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
              Reset
            </button>
          )}
        </div>
        <div className="objective-progress mt-3">
          <div className="flex items-center justify-between gap-3">
            <span
              className={`objective-progress-summary font-sans text-xs font-semibold tabular-nums ${
                allMet ? 'text-terminal-prompt' : 'text-terminal-fg'
              }`}
              aria-live="polite"
            >
              {metCount} of {objectives.length} objectives complete
            </span>
            <span aria-hidden className="font-mono text-[10px] tabular-nums text-terminal-dim">
              {objectives.length > 0 ? Math.round((metCount / objectives.length) * 100) : 0}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Objective progress"
            aria-valuemin={0}
            aria-valuemax={objectives.length}
            aria-valuenow={metCount}
            aria-valuetext={`${metCount} of ${objectives.length} objectives complete`}
            className="objective-progress-track mt-2 h-1.5 overflow-hidden rounded-full bg-panel-border"
          >
            <div
              className="objective-progress-fill h-full rounded-full bg-terminal-prompt transition-[width] duration-500"
              style={{ width: `${objectives.length > 0 ? (metCount / objectives.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <ul className="objective-list space-y-2 p-3">
          {objectives.map((o, index) => {
            const flashing = justMet.has(o.id);
            return (
              <li
                key={o.id}
                data-objective-state={o.met ? 'completed' : 'pending'}
                className={`objective-card flex min-w-0 items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                  o.met
                    ? 'border-terminal-prompt/30 bg-terminal-prompt/5'
                    : 'border-panel-border bg-panel-header/40'
                } ${flashing ? 'animate-objective-flash' : ''}`}
              >
                <span
                  className={`objective-number mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border font-mono text-[10px] font-bold tabular-nums ${
                    o.met
                      ? 'border-terminal-prompt/50 bg-terminal-prompt/10 text-terminal-prompt'
                      : 'border-terminal-dim/60 bg-panel-bg text-terminal-fg'
                  }`}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <span
                    className={`objective-text block break-words font-sans text-xs leading-5 transition-colors duration-300 ${
                      o.met ? 'text-terminal-dim' : 'text-terminal-fg'
                    }`}
                  >
                    {o.text}
                  </span>
                  <span
                    className={`objective-state-label mt-1 block font-sans text-[10px] font-bold uppercase tracking-[0.1em] ${
                      o.met ? 'text-terminal-prompt' : 'text-terminal-dim'
                    }`}
                  >
                    {o.met ? 'Completed' : 'Pending'}
                  </span>
                </div>
                <span
                  aria-hidden
                  className={`objective-status-icon mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                    o.met
                      ? 'border-terminal-prompt/60 bg-terminal-prompt/15 text-terminal-prompt'
                      : 'border-terminal-dim/50 text-terminal-dim'
                  }`}
                >
                  {o.met ? (
                    <CheckIcon className={flashing ? 'h-3 w-3 animate-check-pop' : 'h-3 w-3'} />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  )}
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
        {solution && solution.steps.length > 0 && (
          <SolutionDisclosure steps={solution.steps} />
        )}
      </div>
      {allMet && (
        <div className="completion-banner animate-slide-up border-t border-terminal-prompt/40 bg-terminal-prompt/5 p-4">
          <div className="flex items-start gap-3">
            <div
              aria-hidden
              className="completion-status-icon grid h-8 w-8 shrink-0 place-items-center rounded-full border border-terminal-prompt/70 bg-terminal-prompt/20 text-terminal-prompt"
            >
              <CheckIcon className="h-4 w-4 animate-check-pop" />
            </div>
            <div className="flex-1">
              <p className="completion-title font-sans text-sm font-semibold text-terminal-prompt">
                Lab complete
              </p>
              <p className="mt-0.5 font-sans text-xs leading-relaxed text-terminal-fg/80">
                Every objective met. You configured and verified this scenario
                end to end - the same workflow you'll use on the exam and on the
                job.
              </p>
            </div>
          </div>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="mt-3 w-full rounded-md border border-terminal-prompt/60 bg-terminal-prompt/10 px-3 py-2 font-sans text-sm font-semibold text-terminal-prompt transition hover:bg-terminal-prompt/20 focus:outline-none focus:ring-2 focus:ring-terminal-prompt focus:ring-offset-2 focus:ring-offset-panel-bg"
            >
              Reset lab
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="m4.5 10.5 3.25 3.25 7.75-8" />
    </svg>
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
    <section className="help-section mx-3 mb-3 rounded-lg border border-panel-border bg-panel-header/40 p-3" aria-label="Need help">
      <div className="mb-2">
        <h3 className="font-sans text-sm font-semibold text-terminal-fg">
          Need help?
        </h3>
        <p className="mt-0.5 font-sans text-[11px] leading-4 text-terminal-dim">
          Reveal a hint when its timer is ready.
        </p>
      </div>
      <h4 className="pb-1 font-sans text-[10px] font-bold uppercase tracking-[0.12em] text-terminal-dim">
        Hints
      </h4>
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
    </section>
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
