import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

/**
 * Stacked three-region lab shell: full-width topology band on top, then a
 * horizontal divider, then a row of terminal (wider, left) and objectives
 * (right). The divider lets the learner trade vertical real estate between
 * the topology and the terminal — useful for inspecting a wider topology
 * (drag down) or focusing on a long `show` output (drag up).
 *
 * Why stacked-on-top, not side-rail: a sidebar capped the topology to ~340px
 * and crushed multi-device labs. The full-width band lets canvas geometry
 * breathe — single-device labs center inside it (TopologyPanel's max-width
 * wrapper), multi-device labs get the room they actually need, and horizontal
 * pan still handles widths past the viewport.
 *
 * Responsive: at md+ the bottom row is terminal | objectives side-by-side
 * (terminal flex-1, objectives 340px). Below md (mobile portrait, ~520px
 * embed iframe) the row stacks — terminal first (flex-1, fills remaining
 * height), objectives below at a fixed proportion. `min-w-0` / `min-h-0` on
 * flex children keeps wide `white-space: pre` terminal output from
 * overflowing into neighbours.
 *
 * Generic chrome — identical across exams; only the panels passed in change.
 */
interface LayoutProps {
  topology: ReactNode;
  objectives: ReactNode;
  terminal: ReactNode;
  labTitle: string;
  examLabel: string;
}

/** Initial topology band height — matches the prior fixed-height layout so
 *  the first render is identical to pre-divider state for every lab. */
const INITIAL_TOPOLOGY_HEIGHT = 160;
/** Floor for the topology band. Below this the node row's icons + iface
 *  pips start crowding; 120px is the smallest height that keeps a single
 *  row of nodes legible even after re-fit clamps at MIN_ZOOM=0.5. */
const MIN_TOPOLOGY_HEIGHT = 120;
/** Floor for the terminal + objectives row. Smaller than this and the
 *  terminal can show fewer than ~6 lines plus a prompt — practically
 *  unusable, and the objectives panel header alone takes ~50px. */
const MIN_ROW_HEIGHT = 240;
/** Keyboard step for the separator (ArrowUp / ArrowDown). Small enough to
 *  feel responsive, large enough to move noticeably with each press. */
const RESIZE_KEY_STEP = 24;
/** PageUp / PageDown step — coarser jump for quickly reaching extremes. */
const RESIZE_PAGE_STEP = 96;

export function Layout({
  topology,
  objectives,
  terminal,
  labTitle,
  examLabel,
}: LayoutProps) {
  // In-memory only: per prototype-phase rule, lab state stays ephemeral —
  // divider position resets on reload. NOT persisted to localStorage.
  const [topologyHeight, setTopologyHeight] = useState(INITIAL_TOPOLOGY_HEIGHT);
  const [mainHeight, setMainHeight] = useState<number>(0);
  const mainRef = useRef<HTMLElement>(null);

  /** Upper bound for topology height — `mainHeight - MIN_ROW_HEIGHT` once we
   *  have a measured main, otherwise unconstrained. Without the "measured"
   *  gate, the first render uses `mainHeight === 0` and clamps every value
   *  to MIN_TOPOLOGY_HEIGHT, which would prevent ANY ArrowDown from working
   *  until the ResizeObserver fires (and also misreports in jsdom where
   *  clientHeight stays 0 forever). MAX_SAFE_INTEGER is just "no ceiling
   *  yet" — the real ceiling kicks in as soon as we measure. */
  const maxTopologyHeight =
    mainHeight > 0
      ? Math.max(MIN_TOPOLOGY_HEIGHT, mainHeight - MIN_ROW_HEIGHT)
      : Number.MAX_SAFE_INTEGER;

  const clamp = useCallback(
    (next: number) => {
      if (next < MIN_TOPOLOGY_HEIGHT) return MIN_TOPOLOGY_HEIGHT;
      if (next > maxTopologyHeight) return maxTopologyHeight;
      return next;
    },
    [maxTopologyHeight],
  );

  // --- Pointer drag handling ---------------------------------------------
  // Tracks the (height-at-pointerdown, y-at-pointerdown) baseline so each
  // pointermove sets next-height = base + (currentY - baseY). Stored in a
  // ref so the move handler doesn't need to re-bind on every render.
  const dragBaseRef = useRef<{ baseHeight: number; baseY: number } | null>(null);

  function onSeparatorPointerDown(e: PointerEvent<HTMLDivElement>) {
    // Only left button / primary pointer — right-click + middle-click are
    // legitimate (context menu, etc.) and shouldn't kick off a drag.
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragBaseRef.current = { baseHeight: topologyHeight, baseY: e.clientY };
  }

  function onSeparatorPointerMove(e: PointerEvent<HTMLDivElement>) {
    const base = dragBaseRef.current;
    if (!base) return;
    setTopologyHeight(clamp(base.baseHeight + (e.clientY - base.baseY)));
  }

  function onSeparatorPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (dragBaseRef.current === null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragBaseRef.current = null;
  }

  // --- Keyboard handling -------------------------------------------------
  // role="separator" + aria-orientation="horizontal" means ArrowUp / ArrowDown
  // resize. Home / End snap to extremes; PageUp / PageDown make a larger jump.
  function onSeparatorKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowDown': next = topologyHeight + RESIZE_KEY_STEP; break;
      case 'ArrowUp':   next = topologyHeight - RESIZE_KEY_STEP; break;
      case 'PageDown':  next = topologyHeight + RESIZE_PAGE_STEP; break;
      case 'PageUp':    next = topologyHeight - RESIZE_PAGE_STEP; break;
      case 'Home':      next = MIN_TOPOLOGY_HEIGHT; break;
      case 'End':       next = maxTopologyHeight; break;
      default: return;
    }
    e.preventDefault();
    setTopologyHeight(clamp(next));
  }

  // Track main's measured height + re-clamp if the viewport shrinks below
  // our current topology+row floor. ResizeObserver is stubbed (no-op) in
  // jsdom so this is a no-op in tests; that's fine — the clamp logic above
  // treats unmeasured (`mainHeight === 0`) as "no upper bound."
  useEffect(() => {
    const main = mainRef.current;
    if (!main || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? main.clientHeight;
      setMainHeight(h);
      setTopologyHeight((current) => {
        // Use the just-observed height to clamp; can't rely on the state
        // update above being in effect yet.
        const upper = Math.max(MIN_TOPOLOGY_HEIGHT, h - MIN_ROW_HEIGHT);
        if (current > upper) return upper;
        if (current < MIN_TOPOLOGY_HEIGHT) return MIN_TOPOLOGY_HEIGHT;
        return current;
      });
    });
    ro.observe(main);
    return () => ro.disconnect();
  }, []);

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

      <main
        ref={mainRef}
        className="flex min-h-0 flex-1 flex-col overflow-hidden bg-panel-border"
      >
        {/* Full-width topology band. Height is state-driven so the divider
            below can grow/shrink it. TopologyPanel's outer div is h-full so
            it fills whatever we allocate; its ResizeObserver re-fits the
            React Flow viewport on every resize. */}
        <div
          data-region="topology"
          className="shrink-0 overflow-visible bg-panel-bg"
          style={{ height: topologyHeight }}
        >
          {topology}
        </div>

        <RegionSeparator
          topologyHeight={topologyHeight}
          min={MIN_TOPOLOGY_HEIGHT}
          max={maxTopologyHeight}
          onPointerDown={onSeparatorPointerDown}
          onPointerMove={onSeparatorPointerMove}
          onPointerUp={onSeparatorPointerUp}
          onPointerCancel={onSeparatorPointerUp}
          onKeyDown={onSeparatorKeyDown}
        />

        {/* Terminal + objectives row. Stacks below md, side-by-side at md+. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-panel-border md:flex-row">
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

/**
 * Horizontal divider between the topology band and the terminal/objectives
 * row. Pointer drag + keyboard arrow-resize. Marked as a separator with
 * aria-valuenow/min/max so assistive tech can announce the current ratio.
 *
 * The visible bar is the full row's height; the larger invisible hit area
 * around it (8px tall) makes the divider easy to grab without making the
 * visible chrome bigger.
 */
function RegionSeparator({
  topologyHeight,
  min,
  max,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
}: {
  readonly topologyHeight: number;
  readonly min: number;
  readonly max: number;
  readonly onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  readonly onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
  readonly onPointerCancel: (e: PointerEvent<HTMLDivElement>) => void;
  readonly onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize topology and terminal regions"
      aria-valuenow={Math.round(topologyHeight)}
      aria-valuemin={min}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      data-region="divider"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      className="group relative h-2 shrink-0 cursor-row-resize touch-none select-none bg-panel-border outline-none focus-visible:bg-terminal-prompt/40"
    >
      {/* Invisible widened hit target — keeps the visible bar slim while
          giving the cursor a generous 8px capture zone. */}
      <div aria-hidden className="absolute inset-x-0 -top-1 h-4" />
      {/* Center grip — visible on hover/focus so users know it's draggable. */}
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 h-0.5 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-terminal-dim/40 transition-colors group-hover:bg-terminal-dim/80 group-focus-visible:bg-terminal-prompt"
      />
    </div>
  );
}
