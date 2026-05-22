import type { ReactNode } from 'react';

/**
 * Three-panel lab shell: a fixed-width left rail (topology card + objectives
 * below) and a dominant terminal that fills the rest of the viewport.
 *
 * Desktop (md+): rail is 340px wide, terminal expands to all remaining width
 * and full viewport height — no dead regions. Narrow viewports: rail stacks
 * above the terminal, terminal still takes whatever height remains.
 *
 * Generic chrome — the shell is identical across exams; only the panels
 * passed in change.
 */
interface LayoutProps {
  topology: ReactNode;
  objectives: ReactNode;
  terminal: ReactNode;
  labTitle: string;
  examLabel: string;
}

export function Layout({ topology, objectives, terminal, labTitle, examLabel }: LayoutProps) {
  return (
    <div className="flex h-dvh flex-col bg-[#070a0e] text-terminal-fg">
      <header className="flex shrink-0 items-center justify-between border-b border-panel-border bg-panel-header px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-sans text-sm font-bold tracking-tight text-terminal-fg">
            CertHead<span className="text-terminal-prompt"> Labs</span>
          </span>
          <span className="font-mono text-xs text-terminal-dim">{examLabel}</span>
        </div>
        <span className="font-sans text-sm text-terminal-fg/80">{labTitle}</span>
      </header>

      <main className="flex flex-1 flex-col gap-px overflow-hidden bg-panel-border md:flex-row">
        <aside className="flex shrink-0 flex-col gap-px overflow-hidden bg-panel-border md:h-full md:w-[340px]">
          <div className="shrink-0 bg-panel-bg">{topology}</div>
          <div className="min-h-0 flex-1 overflow-hidden">{objectives}</div>
        </aside>
        <section className="min-h-0 min-w-0 flex-1 overflow-hidden">{terminal}</section>
      </main>
    </div>
  );
}
