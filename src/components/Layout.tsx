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
  onMobileTopologyOpen?: () => void;
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
  onMobileTopologyOpen,
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

  function selectMobileTab(tab: MobileTab) {
    setActiveMobileTab(tab);
    if (tab === 'topology') {
      onMobileTopologyOpen?.();
    }
  }

  return (
    <div
      data-lab-theme={theme}
      className={`flex h-dvh flex-col transition-colors ${isLight ? 'lab-theme-light' : 'lab-theme-dark'} ${
        isLight ? 'bg-[#f3f6fb] text-[#172033]' : 'bg-[#070a0e] text-terminal-fg'
      }`}
    >
      <header
        aria-label="CertHead Labs workspace"
        data-region="product-header"
        className={`product-header flex shrink-0 items-center gap-3 border-b px-4 py-3 transition-colors md:px-5 ${
          isLight ? 'border-[#cbd5e1] bg-white' : 'border-panel-border bg-panel-header'
        }`}
      >
        <div className="flex shrink-0 items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-md border border-terminal-prompt/40 bg-terminal-prompt/10 font-sans text-xs font-extrabold text-terminal-prompt"
          >
            CH
          </span>
          <span className={`hidden font-sans text-sm font-bold tracking-tight sm:inline ${isLight ? 'text-[#172033]' : 'text-terminal-fg'}`}>
            CertHead<span className="text-terminal-prompt"> Labs</span>
          </span>
        </div>
        <div
          role="group"
          aria-label="Current lab"
          className={`flex min-w-0 flex-1 items-center gap-2.5 border-l pl-3 md:pl-4 ${
            isLight ? 'border-[#dbe3ee]' : 'border-panel-border'
          }`}
        >
          <span className="exam-badge shrink-0 rounded border border-terminal-prompt/40 bg-terminal-prompt/10 px-2 py-1 font-sans text-[10px] font-bold uppercase tracking-[0.08em] text-terminal-prompt">
            {examLabel}
          </span>
          <span
            data-lab-title
            className={`min-w-0 truncate font-sans text-sm font-semibold ${
              isLight ? 'text-[#1e293b]' : 'text-terminal-fg'
            }`}
            title={labTitle}
          >
            {labTitle}
          </span>
        </div>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
            onClick={() => setTheme((cur) => (cur === 'dark' ? 'light' : 'dark'))}
            className={`theme-control flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-sans text-xs font-semibold transition ${
              isLight
                ? 'border-[#cbd5e1] bg-[#f8fafc] text-[#334155] hover:bg-[#e2e8f0]'
                : 'border-panel-border bg-[#0d1117] text-terminal-fg hover:bg-panel-border'
            }`}
          >
            {isLight ? (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
              </svg>
            )}
            <span className="hidden sm:inline">{isLight ? 'Dark' : 'Light'} mode</span>
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
                onClick={() => selectMobileTab(tab)}
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
            className={`relative min-h-0 flex-1 overflow-hidden ${isLight ? 'bg-[#eef3f8]' : 'bg-panel-bg'}`}
          >
            {activeMobileTab === 'topology' ? (
              <>
                <div
                  data-mobile-topology-guidance
                  className={`pointer-events-none absolute left-3 right-3 top-3 z-20 rounded-lg border px-3 py-2 font-sans text-xs leading-5 shadow-lg ${
                    isLight
                      ? 'border-[#cbd5e1] bg-white/90 text-[#334155]'
                      : 'border-panel-border bg-panel-header/90 text-terminal-dim'
                  }`}
                >
                  Pinch or drag to inspect the topology. Use Fit if anything looks off-screen.
                </div>
                {topology}
              </>
            ) : null}
          </section>
          <section
            id="mobile-panel-terminal"
            role="tabpanel"
            data-mobile-panel="terminal"
            hidden={activeMobileTab !== 'terminal'}
            data-terminal-theme-isolation
            className="terminal-theme-isolation min-h-0 flex-1 overflow-hidden bg-[#0d1117]"
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

        <div data-region="workspace-row" className="workspace-surface hidden min-h-0 flex-1 overflow-hidden md:flex">
          {/* Topology canvas — fills remaining viewport width. `min-w-0` is
              mandatory: without it, the inner React Flow container can refuse
              to shrink below its content's natural size and push the sidebar
              off-screen on narrow viewports. */}
          <section
            data-region="topology"
            aria-label="Network topology workspace"
            className={`topology-surface min-h-0 min-w-0 flex-1 overflow-hidden ${isLight ? 'bg-[#eef3f8]' : 'bg-panel-bg'}`}
          >
            {topology}
          </section>
          {/* Fixed-width objectives sidebar — full main height, internal scroll
              via ObjectivesPanel itself. The `border-l` is the only visual
              separator between the canvas and the sidebar. */}
          <aside
            data-region="objectives"
            aria-label="Lab objectives"
            className={`objectives-rail h-full min-w-0 shrink-0 overflow-hidden border-l ${
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
            data-terminal-theme-isolation
            aria-label="Terminal workspace"
            className={`terminal-dock-surface terminal-theme-isolation hidden shrink-0 overflow-hidden border-t md:block ${
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
