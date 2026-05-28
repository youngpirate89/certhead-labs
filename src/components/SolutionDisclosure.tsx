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
              <div className="overflow-x-auto rounded bg-terminal-bg px-2 py-1.5 font-mono text-[11px] leading-relaxed text-terminal-prompt">
                {step.commands.map((cmd, j) => (
                  <div
                    key={j}
                    // One command renders as exactly one visual line — always.
                    // `whitespace-pre` preserves leading-space indents (mode
                    // hierarchy, e.g. ` deny icmp ...` inside an ACL stanza)
                    // and never wraps, so a long command's trailing argument
                    // (a next-hop or /30 mask) can't drop to a second line and
                    // masquerade as its own command. `w-max` sizes the line to
                    // its content, letting the block scroll horizontally (the
                    // `overflow-x-auto` above) when a command is wider than the
                    // rail rather than wrapping. Selecting a line still copies
                    // it as one correct command.
                    className="w-max whitespace-pre"
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
