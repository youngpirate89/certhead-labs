import { useState, type ReactNode } from 'react';

/**
 * Topology-first lab shell: a full-height topology canvas on the left and a
 * fixed objectives sidebar on the right, with an optional docked terminal
 * region below both. The dock avoids covering objectives/topology content while
 * preserving the topology-first orientation.
 *
 * Sidebar contract (Section 3 wiring):
 *  - Fixed `SIDEBAR_WIDTH` px wide, never shrinks (shrink-0)
 *  - Full main height (no fixed pixel height — grows with the viewport)
 *  - `overflow-hidden` on the aside so a long hint list cannot trigger a
 *    full-page scroll; ObjectivesPanel handles its own internal scroll via
 *    the body's `overflow-y-auto`
 *
 * Predecessor was a stacked three-region layout (topology band on top, then
 * a draggable divider, then terminal | objectives). That model couldn't grow
 * past two devices comfortably — the terminal had to share vertical room with
 * the topology, and only one device's CLI could ever be visible. The
 * topology-first variant inverts that: topology fills the viewport, terminals
 * float on top, multiple at once.
 */
interface LayoutProps {
  topology: ReactNode;
  objectives: ReactNode;
  terminal?: ReactNode;
  labTitle: string;
  examLabel: string;
}

/** Width of the right-side objectives sidebar. Matches the previous side-rail
 *  width target — wide enough to keep the longest objective text on two lines
 *  (~36 chars per line), narrow enough to leave the topology the bulk of the
 *  viewport on a 1280px display. */
const SIDEBAR_WIDTH = 300;

export function Layout({ topology, objectives, terminal, labTitle, examLabel }: LayoutProps) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const isLight = theme === 'light';

  return (
    <div
      data-lab-theme={theme}
      className={`flex h-dvh flex-col transition-colors ${isLight ? 'lab-theme-light' : 'lab-theme-dark'} ${
        isLight ? 'bg-[#f3f6fb] text-[#172033]' : 'bg-[#070a0e] text-terminal-fg'
      }`}
    >
      <header
        className={`flex shrink-0 items-center justify-between border-b px-5 py-3 transition-colors ${
          isLight ? 'border-[#cbd5e1] bg-white' : 'border-panel-border bg-panel-header'
        }`}
      >
        <div className="flex items-baseline gap-3">
          <span className={`font-sans text-sm font-bold tracking-tight ${isLight ? 'text-[#172033]' : 'text-terminal-fg'}`}>
            CertHead<span className="text-terminal-prompt"> Labs</span>
          </span>
          <span className={`font-mono text-xs ${isLight ? 'text-[#64748b]' : 'text-terminal-dim'}`}>{examLabel}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`font-sans text-sm ${isLight ? 'text-[#334155]' : 'text-terminal-fg/80'}`}>{labTitle}</span>
          <button
            type="button"
            aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
            onClick={() => setTheme((cur) => (cur === 'dark' ? 'light' : 'dark'))}
            className={`rounded-full border px-3 py-1 font-sans text-xs font-semibold transition ${
              isLight
                ? 'border-[#cbd5e1] bg-[#f8fafc] text-[#334155] hover:bg-[#e2e8f0]'
                : 'border-panel-border bg-[#0d1117] text-terminal-fg hover:bg-panel-border'
            }`}
          >
            {isLight ? 'Dark' : 'Light'} mode
          </button>
        </div>
      </header>

      <main className={`flex min-h-0 flex-1 flex-col overflow-hidden ${isLight ? 'bg-[#cbd5e1]' : 'bg-panel-border'}`}>
        <div data-region="workspace-row" className="flex min-h-0 flex-1 overflow-hidden">
          {/* Topology canvas — fills remaining viewport width. `min-w-0` is
              mandatory: without it, the inner React Flow container can refuse
              to shrink below its content's natural size and push the sidebar
              off-screen on narrow viewports. */}
          <section
            data-region="topology"
            className={`min-h-0 min-w-0 flex-1 overflow-hidden ${isLight ? 'bg-[#eef3f8]' : 'bg-panel-bg'}`}
          >
            {topology}
          </section>
          {/* Fixed-width objectives sidebar — full main height, internal scroll
              via ObjectivesPanel itself. The `border-l` is the only visual
              separator between the canvas and the sidebar. */}
          <aside
            data-region="objectives"
            className={`h-full min-w-0 shrink-0 overflow-hidden border-l ${
              isLight ? 'border-[#cbd5e1] bg-white' : 'border-panel-border bg-panel-bg'
            }`}
            style={{ width: SIDEBAR_WIDTH }}
          >
            {objectives}
          </aside>
        </div>
        {terminal && (
          <section
            data-region="terminal-dock"
            className={`shrink-0 overflow-hidden border-t ${
              isLight ? 'border-[#cbd5e1] bg-[#0d1117]' : 'border-panel-border bg-[#0d1117]'
            }`}
            style={{ height: '34%' }}
          >
            {terminal}
          </section>
        )}
      </main>
    </div>
  );
}
