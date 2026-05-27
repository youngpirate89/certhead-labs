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

/** Initial panel dimensions when first opened. Resize state lives in
 *  component-local useState, so a lab reload returns to these defaults
 *  (matches the position-not-persisted decision). */
const DEFAULT_PANEL_WIDTH = 600;
const DEFAULT_PANEL_HEIGHT = 420;
/** Floor sizes — below these the tab strip wraps and the terminal becomes
 *  illegible. Hardcoded rather than measured because a dynamic measurement
 *  loop here would re-fire mid-drag and feel sticky. */
const MIN_PANEL_WIDTH = 400;
const MIN_PANEL_HEIGHT = 300;
/** Title bar height (matches the minimized panel height). */
const TITLE_BAR_HEIGHT = 36;
/** Hit areas for the resize handles. Edge handles are deliberately thin
 *  (8px) so they don't visually overlap the terminal padding; the corner
 *  handle is generous (16x16) so the diagonal grab is easy to find. */
const RESIZE_EDGE_HIT = 8;
const RESIZE_CORNER_HIT = 16;
/** Width of the snap-bar shown while minimized. Narrower than the smallest
 *  open-panel width so the minimized state reads clearly as "shrunk", not
 *  "still full-size". */
const MINIMIZED_WIDTH = 320;
/** Minimum visible title-bar pixels when constrained to viewport edges. */
const MIN_VISIBLE_PX = 80;

function initialPosition(): { x: number; y: number } {
  return { x: 60, y: 80 };
}

function clampPosition(
  x: number,
  y: number,
  panelWidth: number,
): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y };
  const minX = MIN_VISIBLE_PX - panelWidth;
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
  const [size, setSize] = useState({
    w: DEFAULT_PANEL_WIDTH,
    h: DEFAULT_PANEL_HEIGHT,
  });
  const [minimized, setMinimized] = useState(false);

  // Topology re-click on any device — even one already open — should pop the
  // panel back up if it's minimized. activeDeviceId is the change signal: tab
  // clicks fire it too, but minimized is already false there so the effect
  // is a no-op for that path.
  useEffect(() => {
    setMinimized(false);
  }, [activeDeviceId, openDeviceIds.length]);

  // Re-clamp position when the viewport shrinks so a drag-pinned panel doesn't
  // disappear behind a smaller window. Resize doesn't auto-shrink the panel
  // itself — the learner picked their size.
  useEffect(() => {
    function onResize() {
      setPos((p) => clampPosition(p.x, p.y, size.w));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [size.w]);

  // Re-clamp position whenever the panel's width changes — shrinking via the
  // corner handle can push the right edge past MIN_VISIBLE_PX if the panel
  // was previously dragged far left.
  useEffect(() => {
    setPos((p) => clampPosition(p.x, p.y, size.w));
  }, [size.w]);

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
    setPos(clampPosition(nextX, nextY, size.w));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture(dragRef.current.pointerId);
    dragRef.current = null;
  };

  // Resize state — held in a ref so pointermove doesn't re-render until the
  // size actually changes. `axes` controls whether width, height, or both
  // grow with the cursor (right edge = width only, bottom = height only,
  // corner = both).
  type ResizeAxes = 'width' | 'height' | 'both';
  const resizeRef = useRef<{
    baseW: number;
    baseH: number;
    pointerX: number;
    pointerY: number;
    pointerId: number;
    axes: ResizeAxes;
  } | null>(null);

  const onResizePointerDown =
    (axes: ResizeAxes) => (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // Don't let the handler that started a resize also kick off a parent
      // pointermove handler (e.g., the title bar's drag — though we're not
      // inside it here, defensive in case the markup shifts).
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeRef.current = {
        baseW: size.w,
        baseH: size.h,
        pointerX: e.clientX,
        pointerY: e.clientY,
        pointerId: e.pointerId,
        axes,
      };
    };

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || e.pointerId !== resize.pointerId) return;
    const dx = e.clientX - resize.pointerX;
    const dy = e.clientY - resize.pointerY;
    const nextW =
      resize.axes === 'height'
        ? resize.baseW
        : Math.max(MIN_PANEL_WIDTH, resize.baseW + dx);
    const nextH =
      resize.axes === 'width'
        ? resize.baseH
        : Math.max(MIN_PANEL_HEIGHT, resize.baseH + dy);
    setSize((cur) => (cur.w === nextW && cur.h === nextH ? cur : { w: nextW, h: nextH }));
  };

  const endResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    e.currentTarget.releasePointerCapture(resizeRef.current.pointerId);
    resizeRef.current = null;
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

  // Minimized snap-bar: docked bottom-center of the viewport, fixed width,
  // unaffected by pos/size. The full-panel pos/size remain in state so the
  // restore returns the window to exactly where the learner left it.
  const panelStyle: React.CSSProperties = minimized
    ? {
        left: '50%',
        bottom: 0,
        transform: 'translateX(-50%)',
        width: MINIMIZED_WIDTH,
        height: TITLE_BAR_HEIGHT,
      }
    : {
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
      };

  const tabCount = openDeviceIds.length;
  const minimizedLabel = `Terminal — ${tabCount} ${tabCount === 1 ? 'device' : 'devices'}`;

  return (
    <div
      role="dialog"
      aria-label="Terminal"
      data-floating-terminal-panel
      data-floating-terminal-minimized={minimized ? 'true' : 'false'}
      className="fixed z-30 flex flex-col rounded-md border border-panel-border bg-[#0d1117] shadow-2xl"
      style={panelStyle}
    >
      <div
        // Drag handler only attaches when NOT minimized — the snap-bar is
        // pinned to bottom-center and clicking it must restore, not drag.
        onPointerDown={minimized ? undefined : onTitlePointerDown}
        onPointerMove={minimized ? undefined : onTitlePointerMove}
        onPointerUp={minimized ? undefined : endDrag}
        onPointerCancel={minimized ? undefined : endDrag}
        onClick={minimized ? () => setMinimized(false) : undefined}
        role={minimized ? 'button' : undefined}
        aria-label={minimized ? 'Restore terminal panel' : undefined}
        tabIndex={minimized ? 0 : undefined}
        onKeyDown={
          minimized
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setMinimized(false);
                }
              }
            : undefined
        }
        className={`flex h-[36px] shrink-0 select-none items-center justify-between border-b border-panel-border bg-panel-header px-3 ${
          minimized ? 'cursor-pointer' : 'cursor-move'
        }`}
        data-floating-terminal-title
      >
        <span className="truncate font-sans text-sm font-semibold text-terminal-fg">
          {minimized ? minimizedLabel : 'Terminal'}
        </span>
        <div
          className="flex items-center gap-1"
          // Buttons must not start a drag AND must not bubble a click up to
          // the snap-bar's restore handler — both pointerdown and click are
          // stopped here so the icon hits don't restore-by-accident.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
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

          {/* Right edge handle — width-only resize. cursor:ew-resize tells the
              learner this is a draggable edge before they grab it. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel width"
            data-floating-terminal-resize="right"
            onPointerDown={onResizePointerDown('width')}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className="absolute right-0 top-0 h-full cursor-ew-resize"
            style={{ width: RESIZE_EDGE_HIT }}
          />
          {/* Bottom edge — height-only resize. */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize panel height"
            data-floating-terminal-resize="bottom"
            onPointerDown={onResizePointerDown('height')}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className="absolute bottom-0 left-0 w-full cursor-ns-resize"
            style={{ height: RESIZE_EDGE_HIT }}
          />
          {/* Bottom-right corner — both axes. Drawn over the edge handles so
              its diagonal grab wins. Visual chevron lines hint that the
              corner is grabbable. */}
          <div
            role="separator"
            aria-label="Resize panel"
            data-floating-terminal-resize="corner"
            onPointerDown={onResizePointerDown('both')}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className="absolute bottom-0 right-0 cursor-nwse-resize"
            style={{ width: RESIZE_CORNER_HIT, height: RESIZE_CORNER_HIT }}
          >
            <svg
              width={RESIZE_CORNER_HIT}
              height={RESIZE_CORNER_HIT}
              viewBox="0 0 16 16"
              aria-hidden
              className="pointer-events-none text-terminal-dim/70"
            >
              <path
                d="M5 14l9-9M9 14l5-5M13 14l1-1"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
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
