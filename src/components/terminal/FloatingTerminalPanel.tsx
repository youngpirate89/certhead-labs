import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Terminal } from '@/components/Terminal';
import type { TerminalView } from '@/engine/terminal/useTerminal';

/**
 * FloatingTerminalPanel — a single draggable + minimizable terminal window
 * with a per-device tab strip. Replaces the per-device FloatingDevicePanel
 * model: instead of N stacked panels (one per open device), the learner gets
 * one window that hosts every open device as a tab — the same UX a desktop
 * terminal emulator (PuTTY-tabs, Windows Terminal, iTerm) provides.
 *
 * State the panel owns locally (NOT in LabSession):
 *   - position  — drag offset within the viewport
 *   - minimized — title-bar-only collapsed state
 *
 * State the panel reads from the session (LabSession source of truth):
 *   - openDeviceIds  — drives which tabs render and their order
 *   - activeDeviceId — drives which tab is highlighted + which Terminal mounts
 *
 * Lifecycle:
 *   - Hidden when `openDeviceIds.length === 0` (panel returns null). Local
 *     state persists across hide/show because the component stays mounted
 *     in the tree; only its render output is null.
 *   - Topology click → `onSelectDevice(id)` → adds id to openDeviceIds and
 *     sets it active. The panel un-minimizes on any incoming activeDeviceId
 *     change so a re-click of a minimized device feels like "bring my window
 *     back up", not "you already had it open, dummy".
 *   - Per-tab `×` closes that tab via `onCloseDevice(id)`; when the last tab
 *     is closed, openDeviceIds empties and the panel hides on the next render.
 *   - Header `×` (close-all) calls `onCloseAll()` and hides the panel.
 *
 * Drag: title bar is the handle (constrained so MIN_VISIBLE_PX of it always
 * stays inside the viewport). Buttons stop their pointerdown from reaching
 * the drag handler so clicks don't smear into a drag.
 */
export interface FloatingTerminalPanelProps {
  /** Tabs to render — drives both the tab strip and the visible terminal. */
  readonly openDeviceIds: readonly string[];
  /** Highlighted tab + the device whose Terminal mounts in the body. */
  readonly activeDeviceId: string;
  /** Per-device Terminal view, sourced from `useLabSession.forDevice(id)`. */
  readonly forDevice: (id: string) => TerminalView;
  /** Optional platform label per device (e.g. `router`, `pc`). */
  readonly platformLabel?: (id: string) => string | undefined;
  /** Topology click / tab click. Adds the id to openDeviceIds if absent and
   *  marks it active. */
  readonly onSelectDevice: (id: string) => void;
  /** Per-tab close (`×` on a tab). */
  readonly onCloseDevice: (id: string) => void;
  /** Header close-all (`×` on the title bar) — closes every tab at once. */
  readonly onCloseAll: () => void;
}

/** Default panel dimensions. Will become resizable in a follow-up. */
const PANEL_WIDTH = 600;
const PANEL_HEIGHT = 420;
/** Title bar height (matches the minimized panel height). */
const TITLE_BAR_HEIGHT = 36;
/** Minimum visible title-bar pixels when constrained to viewport edges. */
const MIN_VISIBLE_PX = 80;

function initialPosition(): { x: number; y: number } {
  return { x: 60, y: 80 };
}

function clampPosition(x: number, y: number): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y };
  const minX = MIN_VISIBLE_PX - PANEL_WIDTH;
  const minY = 0;
  const maxX = window.innerWidth - MIN_VISIBLE_PX;
  const maxY = window.innerHeight - TITLE_BAR_HEIGHT;
  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
  };
}

export function FloatingTerminalPanel({
  openDeviceIds,
  activeDeviceId,
  forDevice,
  platformLabel,
  onSelectDevice,
  onCloseDevice,
  onCloseAll,
}: FloatingTerminalPanelProps) {
  const [pos, setPos] = useState(initialPosition);
  const [minimized, setMinimized] = useState(false);

  // Topology re-click on any device — even one already open — should pop the
  // panel back up if it's minimized. activeDeviceId is the change signal: tab
  // clicks fire it too, but minimized is already false there so the effect
  // is a no-op for that path.
  useEffect(() => {
    setMinimized(false);
  }, [activeDeviceId, openDeviceIds.length]);

  // Re-clamp position when the viewport shrinks so a drag-pinned panel doesn't
  // disappear behind a smaller window.
  useEffect(() => {
    function onResize() {
      setPos((p) => clampPosition(p.x, p.y));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Drag state — held in a ref to avoid re-renders on every pointermove.
  const dragRef = useRef<{
    baseX: number;
    baseY: number;
    pointerX: number;
    pointerY: number;
    pointerId: number;
  } | null>(null);

  const onTitlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      baseX: pos.x,
      baseY: pos.y,
      pointerX: e.clientX,
      pointerY: e.clientY,
      pointerId: e.pointerId,
    };
  };

  const onTitlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const nextX = drag.baseX + (e.clientX - drag.pointerX);
    const nextY = drag.baseY + (e.clientY - drag.pointerY);
    setPos(clampPosition(nextX, nextY));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture(dragRef.current.pointerId);
    dragRef.current = null;
  };

  // No tabs → panel hides. State above (pos, minimized) persists because the
  // component itself is still mounted by the parent; only its output is null.
  if (openDeviceIds.length === 0) return null;

  // Defensive: if the session's activeDeviceId somehow isn't in openDeviceIds
  // (race during a close), fall back to the first open tab so the body still
  // renders something the user can interact with.
  const visibleDeviceId = openDeviceIds.includes(activeDeviceId)
    ? activeDeviceId
    : openDeviceIds[0];
  const term = forDevice(visibleDeviceId);

  return (
    <div
      role="dialog"
      aria-label="Terminal"
      data-floating-terminal-panel
      className="fixed z-30 flex flex-col rounded-md border border-panel-border bg-[#0d1117] shadow-2xl"
      style={{
        left: pos.x,
        top: pos.y,
        width: PANEL_WIDTH,
        height: minimized ? TITLE_BAR_HEIGHT : PANEL_HEIGHT,
      }}
    >
      <div
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex h-[36px] shrink-0 cursor-move select-none items-center justify-between border-b border-panel-border bg-panel-header px-3"
        data-floating-terminal-title
      >
        <span className="font-sans text-sm font-semibold text-terminal-fg">
          Terminal
        </span>
        <div
          className="flex items-center gap-1"
          // Buttons must not start a drag — stop the pointerdown before it
          // reaches the title bar's handler.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <PanelIconButton
            label={minimized ? 'Restore terminal' : 'Minimize terminal'}
            onClick={() => setMinimized((m) => !m)}
          >
            {minimized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path
                  d="M1 5h8M5 1v8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path d="M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </PanelIconButton>
          <PanelIconButton label="Close all terminals" onClick={onCloseAll}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path
                d="M1 1l8 8M9 1l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </PanelIconButton>
        </div>
      </div>

      {!minimized && (
        <>
          <DeviceTabBar
            openDeviceIds={openDeviceIds}
            activeDeviceId={visibleDeviceId}
            platformLabel={platformLabel}
            onSelectDevice={onSelectDevice}
            onCloseDevice={onCloseDevice}
          />
          <div className="min-h-0 flex-1 overflow-hidden">
            <Terminal term={term} />
          </div>
        </>
      )}
    </div>
  );
}

/** Tab strip rendered between the title bar and the terminal body. Each tab
 *  is a button that selects the device; an inner `×` closes that tab without
 *  selecting it. */
function DeviceTabBar({
  openDeviceIds,
  activeDeviceId,
  platformLabel,
  onSelectDevice,
  onCloseDevice,
}: {
  readonly openDeviceIds: readonly string[];
  readonly activeDeviceId: string;
  readonly platformLabel?: (id: string) => string | undefined;
  readonly onSelectDevice: (id: string) => void;
  readonly onCloseDevice: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Open terminals"
      className="flex shrink-0 items-stretch gap-px overflow-x-auto border-b border-panel-border bg-panel-header/60"
      data-floating-terminal-tabs
    >
      {openDeviceIds.map((id) => {
        const active = id === activeDeviceId;
        const platform = platformLabel?.(id);
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            data-tab-device={id}
            data-tab-active={active ? 'true' : 'false'}
            className={`group flex shrink-0 items-center gap-2 border-r border-panel-border px-3 ${
              active
                ? 'bg-[#0d1117] text-terminal-fg'
                : 'bg-panel-header/40 text-terminal-fg/70 hover:bg-panel-header/80'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectDevice(id)}
              aria-label={`Switch to ${id}`}
              className="flex items-baseline gap-2 py-1.5 text-left focus:outline-none"
            >
              <span className="font-sans text-xs font-semibold tracking-tight">
                {id}
              </span>
              {platform ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-terminal-dim">
                  {platform}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => onCloseDevice(id)}
              aria-label={`Close ${id} tab`}
              title={`Close ${id} tab`}
              className="grid h-4 w-4 place-items-center rounded text-terminal-dim transition-colors hover:bg-white/10 hover:text-terminal-fg focus:outline-none focus:ring-1 focus:ring-terminal-prompt"
            >
              <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden>
                <path
                  d="M1 1l8 8M9 1l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function PanelIconButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-5 w-5 place-items-center rounded text-terminal-dim transition-colors hover:bg-white/10 hover:text-terminal-fg focus:outline-none focus:ring-1 focus:ring-terminal-prompt"
    >
      {children}
    </button>
  );
}
