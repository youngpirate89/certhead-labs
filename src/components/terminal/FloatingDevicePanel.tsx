import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Terminal } from '@/components/Terminal';
import type { TerminalView } from '@/engine/terminal/useTerminal';

/**
 * FloatingDevicePanel — draggable, minimizable, closeable CLI panel for a
 * single device.
 *
 * Multiple panels can be open at once, each bound to its own device through
 * `term` (sourced from `useLabSession().forDevice(deviceId)`). The panel
 * owns its own position + minimized + z-index state in component-local
 * `useState`: position is intentionally NOT persisted, so a lab reset (or
 * a fresh load) starts every panel at its canonical staggered offset.
 *
 * Drag handle: the title bar. Constrained so at least 80px of the title bar
 * remains visible against any viewport edge — drag-off-screen is an easy
 * footgun on small viewports and there's no recovery affordance.
 *
 * Minimize collapses the panel to its title bar only (~40px tall) so the
 * terminal contents are hidden but the device label stays available.
 * Clicking the title bar in minimized state restores. Close calls
 * `onClose(deviceId)` which the mode wires to `session.closeDevice`.
 */
export interface FloatingDevicePanelProps {
  readonly deviceId: string;
  /** Optional platform/kind badge (e.g. `router`, `pc`, `switch`). */
  readonly platformLabel?: string;
  /** Per-device terminal view from `useLabSession.forDevice(deviceId)`. */
  readonly term: TerminalView;
  /** Stagger index — panel `i` opens offset by `i * STAGGER_PX` from center
   *  so two panels opened simultaneously don't fully overlap. */
  readonly index: number;
  /** Z-index baseline for this panel. The shared bring-to-front counter
   *  bumps any focused panel above its peers. */
  readonly initialZ: number;
  /** Called on close (X). Mode wires this to `session.closeDevice(id)`. */
  readonly onClose: (deviceId: string) => void;
  /** Called whenever the user interacts with the panel — drag, minimize,
   *  click anywhere. Used by the parent to assign a fresh higher z-index. */
  readonly onFocus: (deviceId: string) => void;
}

/** Default panel dimensions — terminal-friendly. ~80 cols x ~22 rows at the
 *  default font size. Resize handles are deferred to a future pass. */
const PANEL_WIDTH = 600;
const PANEL_HEIGHT = 420;
/** Title bar height (matches the minimized panel height). */
const TITLE_BAR_HEIGHT = 36;
/** Per-index drag offset so panel N opens offset (N*STAGGER_PX, N*STAGGER_PX)
 *  from the first panel. Chosen to be visible but not so wide that 4 panels
 *  stair-step off the canvas at typical viewport widths. */
const STAGGER_PX = 30;
/** Minimum visible title-bar height when constrained to viewport edges —
 *  guarantees the panel can always be grabbed again. */
const MIN_VISIBLE_PX = 80;

/** Initial top-left position for a panel, staggered by `index`. Anchored at
 *  the top-left of the topology canvas rather than the viewport center so
 *  panels open above their corresponding device cluster rather than over
 *  the objectives sidebar. */
function initialPosition(index: number): { x: number; y: number } {
  return {
    x: 60 + index * STAGGER_PX,
    y: 80 + index * STAGGER_PX,
  };
}

/** Clamp position so at least MIN_VISIBLE_PX of the title bar stays on
 *  screen. Without this, a vigorous drag can park the panel entirely off
 *  the viewport with no way back. */
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

export function FloatingDevicePanel({
  deviceId,
  platformLabel,
  term,
  index,
  initialZ,
  onClose,
  onFocus,
}: FloatingDevicePanelProps) {
  const [pos, setPos] = useState(() => initialPosition(index));
  const [minimized, setMinimized] = useState(false);

  // Drag state — held in a ref to avoid re-renders on every pointermove. We
  // capture the pointer ON THE TITLE BAR so the move handler keeps firing
  // even if the cursor leaves the bar's bounding rect during the drag.
  const dragRef = useRef<{
    baseX: number;
    baseY: number;
    pointerX: number;
    pointerY: number;
    pointerId: number;
  } | null>(null);

  // Restore from minimized whenever the parent bumps `initialZ` (focus
  // event — topology re-click on an already-open panel, title bar click,
  // etc). Prevents the "clicked the device again but my CLI is still
  // hidden" footgun.
  const prevZRef = useRef(initialZ);
  useEffect(() => {
    if (initialZ > prevZRef.current) {
      setMinimized(false);
    }
    prevZRef.current = initialZ;
  }, [initialZ]);

  const onTitlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    onFocus(deviceId);
    // Title bar click on a minimized panel restores; drag still works after
    // restore via the same pointerdown sequence (move sets dragRef state).
    if (minimized) setMinimized(false);
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

  // Re-clamp when the viewport shrinks — keeps panels reachable if the
  // browser is resized to be smaller than current panel coordinates.
  useEffect(() => {
    function onResize() {
      setPos((p) => clampPosition(p.x, p.y));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const focusPanel = useCallback(() => onFocus(deviceId), [onFocus, deviceId]);

  return (
    <div
      role="dialog"
      aria-label={`${deviceId} console`}
      data-floating-panel={deviceId}
      onMouseDown={focusPanel}
      className="fixed flex flex-col rounded-md border border-panel-border bg-[#0d1117] shadow-2xl"
      style={{
        left: pos.x,
        top: pos.y,
        width: PANEL_WIDTH,
        height: minimized ? TITLE_BAR_HEIGHT : PANEL_HEIGHT,
        zIndex: initialZ,
      }}
    >
      {/* Title bar — drag handle + minimize + close. Pointer events also
          escalate the panel to the top of the z-stack. */}
      <div
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex h-[36px] shrink-0 cursor-move select-none items-center justify-between border-b border-panel-border bg-panel-header px-3"
        data-floating-panel-title={deviceId}
      >
        <div className="flex items-baseline gap-2">
          <span className="font-sans text-sm font-semibold text-terminal-fg">
            {deviceId}
          </span>
          {platformLabel && (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-terminal-dim">
              {platformLabel}
            </span>
          )}
        </div>
        <div
          className="flex items-center gap-1"
          // Buttons shouldn't start a drag — stop the pointerdown from
          // reaching the title bar's drag handler.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <PanelIconButton
            label={minimized ? `Restore ${deviceId} console` : `Minimize ${deviceId} console`}
            onClick={() => {
              onFocus(deviceId);
              setMinimized((m) => !m);
            }}
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
          <PanelIconButton
            label={`Close ${deviceId} console`}
            onClick={() => onClose(deviceId)}
          >
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

      {/* Terminal body — hidden when minimized so screen readers don't trip
          on stale offscreen content. `min-h-0` lets the inner terminal
          scroller fill the remaining height. */}
      {!minimized && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Terminal term={term} />
        </div>
      )}
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
