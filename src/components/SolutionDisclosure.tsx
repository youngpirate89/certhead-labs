import { useState } from 'react';
import type { SolutionStep } from '@/engine/types';

/**
 * Collapsible "See Solution" panel for the objectives sidebar.
 *
 * Renders the lab's worked solution as a sequence of device-scoped command
 * blocks. Closed by default — muted text and a right chevron so it doesn't
 * draw the eye away from hints. Click toggles open; commands render in a
 * terminal-styled block with the device hostname prefix above each group.
 *
 * No warning copy ("spoiler!" / "are you sure?"). Learners who open it have
 * already decided; respecting that keeps the affordance honest.
 */
interface Props {
  readonly steps: readonly SolutionStep[];
}

export function SolutionDisclosure({ steps }: Props) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;

  return (
    <div className="border-t border-panel-border px-2 py-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left font-sans text-[11px] font-semibold uppercase tracking-wider text-terminal-dim transition-colors hover:bg-panel-border/50 hover:text-terminal-fg focus:outline-none focus:ring-1 focus:ring-terminal-prompt"
      >
        <Chevron open={open} />
        <span>See Solution</span>
      </button>

      {open && (
        <div className="mt-2 space-y-3 px-2">
          {steps.map((step, i) => (
            <div key={i}>
              {step.note && (
                <p className="mb-1 font-sans text-[11px] leading-snug text-terminal-dim">
                  {step.note}
                </p>
              )}
              <div className="mb-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-terminal-dim">
                {step.device}
              </div>
              <div className="rounded bg-terminal-bg px-2 py-1.5 font-mono text-[11px] leading-relaxed text-terminal-prompt">
                {step.commands.map((cmd, j) => (
                  <div
                    key={j}
                    // Hanging indent: wrapped continuation lines start 2ch
                    // further right than the first line so the learner can
                    // see at a glance that a wrap isn't a new command.
                    // `whitespace-pre-wrap` preserves leading-space indents
                    // (e.g. ` deny icmp ...` inside an ACL stanza) AND wraps
                    // long lines on whitespace; `break-words` falls back to
                    // breaking inside a long token if no whitespace exists.
                    className="whitespace-pre-wrap break-words"
                    style={{ paddingLeft: '2ch', textIndent: '-2ch' }}
                  >
                    {cmd}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
