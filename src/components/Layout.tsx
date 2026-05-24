import type { ReactNode } from 'react';

/**
 * Stacked three-region lab shell: full-width topology band across the top,
 * below it a row of terminal (wider, left) and objectives (right).
 *
 * Why stacked-on-top, not side-rail: a sidebar capped the topology to ~340px
 * and crushed multi-device labs (two routers + a cable barely fit). The
 * full-width band lets canvas geometry breathe — single-device labs center
 * inside it (see TopologyPanel's max-width wrapper), multi-device labs get
 * the room they actually need, and horizontal pan still handles widths past
 * the viewport.
 *
 * Responsive: at md+ the bottom row is terminal | objectives side-by-side
 * (terminal flex-1, objectives 340px). Below md (mobile portrait, the
 * ~520px embed iframe) the row stacks — terminal first (flex-1, fills
 * remaining height), objectives below at a fixed proportion. `min-w-0` /
 * `min-h-0` on flex children keeps wide `white-space: pre` terminal output
 * from overflowing into neighbours (the bug class A4 flagged).
 *
 * Generic chrome — identical across exams; only the panels passed in change.
 * Behaviorally a no-op vs. the prior layout: same props, same children,
 * same interaction surface; just rearranged.
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

      <main className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden bg-panel-border">
        {/* Full-width topology band. TopologyPanel self-sizes to its own
            CANVAS_HEIGHT and centers a max-width wrapper inside the band, so
            the band itself can be as wide as the viewport without a single
            device looking marooned. */}
        <div
          data-region="topology"
          className="shrink-0 overflow-hidden bg-panel-bg"
        >
          {topology}
        </div>

        {/* Terminal + objectives row. Stacks below md, side-by-side at md+.
            Terminal owns the flex-grow; objectives is fixed-width on desktop
            and fixed-proportion on mobile so the terminal stays usable. */}
        <div className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden bg-panel-border md:flex-row">
          <section
            data-region="terminal"
            className="min-h-0 min-w-0 flex-1 overflow-hidden bg-terminal-bg"
          >
            {terminal}
          </section>
          <aside
            data-region="objectives"
            className="h-[36vh] min-w-0 shrink-0 overflow-hidden bg-panel-bg md:h-full md:w-[340px]"
          >
            {objectives}
          </aside>
        </div>
      </main>
    </div>
  );
}
