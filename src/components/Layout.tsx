import type { ReactNode } from 'react';

/**
 * Three-panel lab layout: topology + objectives stacked on the left rail,
 * terminal taking the dominant right column. Collapses to a single column on
 * narrow viewports. This is the shell every lab renders into.
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
      <header className="flex items-center justify-between border-b border-panel-border bg-panel-header px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-sans text-sm font-bold tracking-tight text-terminal-fg">
            CertHead<span className="text-terminal-prompt"> Labs</span>
          </span>
          <span className="font-mono text-xs text-terminal-dim">{examLabel}</span>
        </div>
        <span className="font-sans text-sm text-terminal-fg/80">{labTitle}</span>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-px overflow-hidden bg-panel-border lg:grid-cols-[320px_1fr]">
        <aside className="grid grid-rows-[auto_1fr] gap-px bg-panel-border max-lg:hidden">
          <div className="h-44">{topology}</div>
          <div className="overflow-hidden">{objectives}</div>
        </aside>
        <section className="overflow-hidden">{terminal}</section>
      </main>
    </div>
  );
}
