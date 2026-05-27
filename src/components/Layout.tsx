import type { ReactNode } from 'react';

/**
 * Topology-first lab shell: a full-height topology canvas on the left and a
 * fixed objectives sidebar on the right. Per-device terminals are NOT owned
 * by Layout — modes mount them as draggable floating panels
 * (FloatingDevicePanel) that overlay this shell at the document root, so the
 * canvas underneath stays free to pan and zoom regardless of how many panels
 * are open.
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
  labTitle: string;
  examLabel: string;
}

/** Width of the right-side objectives sidebar. Matches the previous side-rail
 *  width target — wide enough to keep the longest objective text on two lines
 *  (~36 chars per line), narrow enough to leave the topology the bulk of the
 *  viewport on a 1280px display. */
const SIDEBAR_WIDTH = 300;

export function Layout({ topology, objectives, labTitle, examLabel }: LayoutProps) {
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

      <main className="flex min-h-0 flex-1 overflow-hidden bg-panel-border">
        {/* Topology canvas — fills remaining viewport width. `min-w-0` is
            mandatory: without it, the inner React Flow container can refuse
            to shrink below its content's natural size and push the sidebar
            off-screen on narrow viewports. */}
        <section
          data-region="topology"
          className="min-h-0 min-w-0 flex-1 overflow-hidden bg-panel-bg"
        >
          {topology}
        </section>
        {/* Fixed-width objectives sidebar — full main height, internal scroll
            via ObjectivesPanel itself. The `border-l` is the only visual
            separator between the canvas and the sidebar. */}
        <aside
          data-region="objectives"
          className="h-full min-w-0 shrink-0 overflow-hidden border-l border-panel-border bg-panel-bg"
          style={{ width: SIDEBAR_WIDTH }}
        >
          {objectives}
        </aside>
      </main>
    </div>
  );
}
