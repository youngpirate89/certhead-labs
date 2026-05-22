/**
 * LabBrief — pre-terminal scenario screen.
 *
 * Replaces the terminal pane on first load: title, difficulty/duration metadata,
 * a real-world scenario paragraph, the objective list, and a "Start lab" CTA.
 * Skippable via the same CTA — once dismissed, the terminal takes over. The
 * topology rail stays visible the whole time so the learner sees the device
 * they're about to configure.
 *
 * Generic chrome — no Cisco-specific concepts. Works for bash/kubectl labs too.
 */
interface LabBriefProps {
  readonly title: string;
  readonly examLabel: string;
  readonly difficulty: number;
  readonly estimatedMinutes: number;
  readonly scenario: string;
  readonly objectives: readonly { id: string; text: string }[];
  readonly onStart: () => void;
}

export function LabBrief({
  title,
  examLabel,
  difficulty,
  estimatedMinutes,
  scenario,
  objectives,
  onStart,
}: LabBriefProps) {
  const paragraphs = scenario.split('\n\n');

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-terminal-bg px-6 py-10">
      <div className="w-full max-w-2xl rounded-lg border border-panel-border bg-panel-bg/80 p-8 shadow-2xl">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-mono text-xs uppercase tracking-[0.15em] text-terminal-prompt">
            {examLabel} · Lab Scenario
          </span>
          <span className="font-mono text-[11px] text-terminal-dim">
            {'●'.repeat(difficulty)}
            {'○'.repeat(Math.max(0, 5 - difficulty))} · ~{estimatedMinutes} min
          </span>
        </div>

        <h1 className="mt-3 font-sans text-2xl font-semibold leading-tight text-terminal-fg">
          {title}
        </h1>

        <div className="mt-5 space-y-3 font-sans text-[14px] leading-relaxed text-terminal-fg/85">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        <div className="mt-6">
          <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-terminal-dim">
            Your goals
          </h2>
          <ul className="mt-2 space-y-1.5">
            {objectives.map((o) => (
              <li
                key={o.id}
                className="flex gap-2 font-sans text-[13.5px] text-terminal-fg/85"
              >
                <span aria-hidden className="select-none text-terminal-prompt">
                  ▸
                </span>
                <span>{o.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-7 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onStart}
            className="rounded-md bg-terminal-prompt px-5 py-2 font-sans text-sm font-semibold text-[#06231d] transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-terminal-prompt focus:ring-offset-2 focus:ring-offset-terminal-bg"
          >
            Start lab →
          </button>
        </div>
      </div>
    </div>
  );
}
