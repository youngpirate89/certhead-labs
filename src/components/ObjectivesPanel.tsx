import { useEffect, useRef, useState } from 'react';

/**
 * ObjectivesPanel — live status of the lab's objectives.
 *
 * When an objective transitions from unmet → met, the row briefly flashes a
 * teal highlight and the check icon pops in. Pure visual reaction — no
 * configuration; the panel diffs incoming statuses against the previous render
 * to decide what to animate. Generic chrome, exam-agnostic.
 */
export interface ObjectiveView {
  id: string;
  text: string;
  met: boolean;
}

interface ObjectivesPanelProps {
  title: string;
  objectives: ObjectiveView[];
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

export function ObjectivesPanel({ title, objectives }: ObjectivesPanelProps) {
  const justMet = useJustMet(objectives);
  const metCount = objectives.filter((o) => o.met).length;
  const allMet = metCount === objectives.length && objectives.length > 0;

  return (
    <div className="flex h-full flex-col bg-panel-bg">
      <div className="flex items-center justify-between border-b border-panel-border px-4 py-3">
        <h2 className="font-sans text-sm font-semibold text-terminal-fg">{title}</h2>
        <span
          className={`font-mono text-xs tabular-nums transition-colors duration-300 ${
            allMet ? 'text-terminal-prompt' : 'text-terminal-dim'
          }`}
          aria-live="polite"
        >
          {metCount}/{objectives.length}
        </span>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto p-2">
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
    </div>
  );
}
