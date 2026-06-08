import { useEffect, useMemo, useState, type ReactNode } from 'react';

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
  scenario?: ReactNode;
  hints?: ReactNode;
  hasHints?: boolean;
  onMobileReset?: () => void;
  mobileTerminalSignal?: number;
  labTitle: string;
  examLabel: string;
}

type MobileTab = 'scenario' | 'topology' | 'terminal' | 'objectives' | 'hints';

const MOBILE_TAB_LABELS: Record<MobileTab, string> = {
  scenario: 'Scenario',
  topology: 'Topology',
  terminal: 'Terminal',
  objectives: 'Objectives',
  hints: 'Hints',
};

/** Width of the right-side objectives sidebar. Matches the previous side-rail
 *  width target — wide enough to keep the longest objective text on two lines
 *  (~36 chars per line), narrow enough to leave the topology the bulk of the
 *  viewport on a 1280px display. */
const SIDEBAR_WIDTH = 300;

export function Layout({
  topology,
  objectives,
  terminal,
  scenario,
  hints,
  hasHints = false,
  onMobileReset,
  mobileTerminalSignal = 0,
  labTitle,
  examLabel,
}: LayoutProps) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTab>('scenario');
  const isLight = theme === 'light';
  const mobileTabs = useMemo<MobileTab[]>(
    () => ['scenario', 'topology', 'terminal', 'objectives', ...(hasHints ? (['hints'] as const) : [])],
    [hasHints],
  );

  useEffect(() => {
    if (mobileTerminalSignal > 0) {
      setActiveMobileTab('terminal');
    }
  }, [mobileTerminalSignal]);

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
        <div data-region="mobile-workspace" className="flex min-h-0 flex-1 flex-col md:hidden">
          <div
            role="tablist"
            aria-label="Mobile lab workspace sections"
            className={`flex shrink-0 gap-2 overflow-x-auto border-b px-3 py-2 ${
              isLight ? 'border-[#cbd5e1] bg-white' : 'border-panel-border bg-panel-header'
            }`}
          >
            {mobileTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeMobileTab === tab}
                aria-controls={`mobile-panel-${tab}`}
                onClick={() => setActiveMobileTab(tab)}
                className={`shrink-0 rounded-full border px-3 py-1.5 font-sans text-xs font-semibold transition ${
                  activeMobileTab === tab
                    ? 'border-terminal-prompt bg-terminal-prompt text-[#06231d]'
                    : isLight
                      ? 'border-[#cbd5e1] bg-[#f8fafc] text-[#334155]'
                      : 'border-panel-border bg-[#0d1117] text-terminal-fg'
                }`}
              >
                {MOBILE_TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          <section
            id="mobile-panel-scenario"
            role="tabpanel"
            data-mobile-panel="scenario"
            hidden={activeMobileTab !== 'scenario'}
            className={`min-h-0 flex-1 overflow-y-auto p-4 font-sans text-sm leading-6 ${
              isLight ? 'bg-[#f8fafc] text-[#172033]' : 'bg-panel-bg text-terminal-fg'
            }`}
          >
            {scenario ?? <p>Select Topology or Terminal to begin the lab.</p>}
          </section>
          <section
            id="mobile-panel-topology"
            role="tabpanel"
            data-mobile-panel="topology"
            hidden={activeMobileTab !== 'topology'}
            className={`min-h-0 flex-1 overflow-hidden ${isLight ? 'bg-[#eef3f8]' : 'bg-panel-bg'}`}
          >
            {activeMobileTab === 'topology' ? topology : null}
          </section>
          <section
            id="mobile-panel-terminal"
            role="tabpanel"
            data-mobile-panel="terminal"
            hidden={activeMobileTab !== 'terminal'}
            className="min-h-0 flex-1 overflow-hidden bg-[#0d1117]"
          >
            {activeMobileTab === 'terminal' ? (
              terminal ?? (
                <div className="p-4 font-sans text-sm text-terminal-dim">
                  Start the lab, then open a device from Topology to use the terminal.
                </div>
              )
            ) : null}
          </section>
          <section
            id="mobile-panel-objectives"
            role="tabpanel"
            data-mobile-panel="objectives"
            hidden={activeMobileTab !== 'objectives'}
            className={`min-h-0 flex-1 overflow-hidden ${isLight ? 'bg-white' : 'bg-panel-bg'}`}
          >
            {activeMobileTab === 'objectives' ? objectives : null}
          </section>
          {hasHints && (
            <section
              id="mobile-panel-hints"
              role="tabpanel"
              data-mobile-panel="hints"
              hidden={activeMobileTab !== 'hints'}
              className={`min-h-0 flex-1 overflow-hidden ${isLight ? 'bg-white' : 'bg-panel-bg'}`}
            >
              {activeMobileTab === 'hints' ? hints : null}
            </section>
          )}

          <div
            data-region="mobile-actions"
            className={`sticky bottom-0 z-20 flex shrink-0 gap-2 border-t p-3 md:hidden ${
              isLight ? 'border-[#cbd5e1] bg-white' : 'border-panel-border bg-panel-header'
            }`}
          >
            <button
              type="button"
              onClick={() => setActiveMobileTab('objectives')}
              className="flex-1 rounded-md bg-terminal-prompt px-3 py-2 font-sans text-sm font-semibold text-[#06231d]"
            >
              Verify
            </button>
            <button
              type="button"
              onClick={onMobileReset}
              disabled={!onMobileReset}
              className={`flex-1 rounded-md border px-3 py-2 font-sans text-sm font-semibold ${
                isLight
                  ? 'border-[#cbd5e1] text-[#334155] disabled:text-[#94a3b8]'
                  : 'border-panel-border text-terminal-fg disabled:text-terminal-dim'
              }`}
            >
              Reset
            </button>
            {hasHints && (
              <button
                type="button"
                onClick={() => setActiveMobileTab('hints')}
                className={`flex-1 rounded-md border px-3 py-2 font-sans text-sm font-semibold ${
                  isLight ? 'border-[#cbd5e1] text-[#334155]' : 'border-panel-border text-terminal-fg'
                }`}
              >
                Hint
              </button>
            )}
          </div>
        </div>

        <div data-region="workspace-row" className="hidden min-h-0 flex-1 overflow-hidden md:flex">
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
            className={`hidden shrink-0 overflow-hidden border-t md:block ${
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
