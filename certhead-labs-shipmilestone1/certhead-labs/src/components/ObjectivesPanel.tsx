/**
 * ObjectivesPanel — renders lab objectives with met/unmet state.
 *
 * Foundation version accepts a static list. The grading engine (Weekend 3-4+)
 * will drive `met` from declarative checks against device state.
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

export function ObjectivesPanel({ title, objectives }: ObjectivesPanelProps) {
  const metCount = objectives.filter((o) => o.met).length;

  return (
    <div className="flex h-full flex-col bg-panel-bg">
      <div className="flex items-center justify-between border-b border-panel-border px-4 py-3">
        <h2 className="font-sans text-sm font-semibold text-terminal-fg">{title}</h2>
        <span className="font-mono text-xs text-terminal-dim">
          {metCount}/{objectives.length}
        </span>
      </div>
      <ul className="flex-1 space-y-2 overflow-y-auto p-4">
        {objectives.map((o) => (
          <li key={o.id} className="flex items-start gap-3 text-sm">
            <span
              className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${
                o.met
                  ? 'border-terminal-prompt bg-terminal-prompt/15 text-terminal-prompt'
                  : 'border-panel-border text-transparent'
              }`}
              aria-hidden
            >
              ✓
            </span>
            <span className={o.met ? 'text-terminal-dim line-through' : 'text-terminal-fg'}>
              {o.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
