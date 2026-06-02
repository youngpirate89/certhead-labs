import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Terminal } from '@/components/Terminal';
import type { TerminalView } from '@/engine/terminal/useTerminal';
import type { DeviceKind } from '@/engine/adapters/types';
import type { PcNetworkConfig } from '@/engine/lab-session';

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
  readonly deviceKind?: (id: string) => DeviceKind | undefined;
  readonly pcNetwork?: (id: string) => PcNetworkConfig | undefined;
  readonly onPcNetworkApply?: (id: string, config: PcNetworkConfig) => void;
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
 *  (matches the position-not-persisted decision).
 *
 *  Width is sized to hold 80-column IOS output without wrapping at the
 *  default terminal font (14px, see terminalTheme FONT_SIZES.default). Fixed
 *  IOS tables (`show ip interface brief`, `show ip dhcp binding`) are written
 *  at ~80 cols; the terminal body wraps (`whitespace-pre-wrap`) so a too-narrow
 *  panel folds the Protocol column / trailing values onto new lines. Budget:
 *    text   = 82ch × 8.4px  ≈ 689px   (8.4px = ~0.6em advance, the widest glyph
 *                                       in the font-mono stack at 14px; 82ch =
 *                                       80 cols + a 2-col margin)
 *    + 32px  Terminal body padding (px-4 → 16px each side)
 *    + 16px  vertical scrollbar gutter (overflow-y-auto)
 *    +  2px  panel border (1px each side)
 *    ≈ 739px → 740px
 *  The user can still resize narrower (MIN_PANEL_WIDTH unchanged); this only
 *  moves the *default* so tabular show output reads cleanly on first open. */
const DEFAULT_PANEL_WIDTH = 740;
const DEFAULT_PANEL_HEIGHT = 520;
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
  deviceKind,
  pcNetwork,
  onPcNetworkApply,
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
  const visibleDeviceIsPc = deviceKind?.(visibleDeviceId) === 'pc';
  const visiblePcNetwork = visibleDeviceIsPc ? pcNetwork?.(visibleDeviceId) : undefined;

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
            {visibleDeviceIsPc && visiblePcNetwork && onPcNetworkApply ? (
              <PcWorkbench
                deviceId={visibleDeviceId}
                term={term}
                network={visiblePcNetwork}
                platformLabel={platformLabel?.(visibleDeviceId)}
                onApplyNetwork={onPcNetworkApply}
              />
            ) : (
              <Terminal term={term} />
            )}
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

type PcWorkbenchTab = 'overview' | 'adapter' | 'terminal' | 'ssh';
type PcAdapterSection = 'ipv4' | 'ipv6';

function PcWorkbench({
  deviceId,
  term,
  network,
  platformLabel,
  onApplyNetwork,
}: {
  readonly deviceId: string;
  readonly term: TerminalView;
  readonly network: PcNetworkConfig;
  readonly platformLabel?: string;
  readonly onApplyNetwork: (id: string, config: PcNetworkConfig) => void;
}) {
  const workbenchTitle = `${deviceId} ${platformLabel ?? 'Workstation'}`;
  const isWirelessController = platformLabel?.toLowerCase() === 'wireless lan controller';
  const [activeTab, setActiveTab] = useState<PcWorkbenchTab>('overview');
  const [activeAdapterSection, setActiveAdapterSection] = useState<PcAdapterSection>('ipv4');
  const [draft, setDraft] = useState<PcNetworkConfig>(network);
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);
  const [sshHost, setSshHost] = useState(network.gateway ?? '');
  const [sshPort, setSshPort] = useState('22');
  const [sshUsername, setSshUsername] = useState('admin');
  const [pendingSshCommand, setPendingSshCommand] = useState<string | null>(null);

  useEffect(() => {
    setDraft(network);
  }, [network]);

  useEffect(() => {
    if (network.gateway && !sshHost) setSshHost(network.gateway);
  }, [network.gateway, sshHost]);

  useEffect(() => {
    if (!pendingSshCommand) return;
    if (activeTab !== 'terminal') return;
    if (term.input !== pendingSshCommand) return;
    term.submit();
    setPendingSshCommand(null);
  }, [activeTab, pendingSshCommand, term]);

  const setField = (field: keyof PcNetworkConfig, value: string | null) => {
    setDraft((cur) => ({ ...cur, [field]: value }));
    setAppliedNotice(null);
  };

  const setIpv4Octet = (field: 'ip' | 'mask' | 'gateway', index: number, value: string) => {
    const octets = splitIpv4(draft[field]);
    octets[index] = value.replace(/\D/g, '').slice(0, 3);
    setField(field, joinIpv4(octets));
  };

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[#111827] via-[#0d1117] to-[#070a0f] font-sans text-terminal-fg">
      <div
        role="tablist"
        aria-label={`${deviceId} workbench`}
        className="flex shrink-0 gap-1 border-b border-panel-border bg-panel-header/70 px-3 py-2 shadow-[inset_0_-1px_0_rgba(255,255,255,0.03)]"
      >
        <WorkbenchTab label="Desktop" active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} />
        <WorkbenchTab
          label="Network Adapter"
          active={activeTab === 'adapter'}
          onClick={() => {
            setActiveAdapterSection('ipv4');
            setActiveTab('adapter');
          }}
        />
        <WorkbenchTab label="Terminal" active={activeTab === 'terminal'} onClick={() => setActiveTab('terminal')} />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'overview' && (
          <div className="h-full overflow-y-auto p-4 text-sm">
            <div className="grid min-h-full place-items-center rounded-xl border border-panel-border bg-black/20 p-5 shadow-inner">
              <div className="w-full max-w-2xl">
                <div className="mb-5 text-center">
                  <h2 className="text-2xl font-semibold text-terminal-fg">{workbenchTitle}</h2>
                  <p className="mt-2 text-sm text-terminal-fg/65">Select a desktop tool</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {isWirelessController ? null : (
                    <>
                      <DesktopToolTile
                        label="IP Configuration"
                        icon="IPv4"
                        detail="Addressing"
                        onClick={() => {
                          setActiveAdapterSection('ipv4');
                          setActiveTab('adapter');
                        }}
                      />
                      <DesktopToolTile
                        label="IPv6 Configuration"
                        icon="IPv6"
                        detail="Addressing"
                        onClick={() => {
                          setActiveAdapterSection('ipv6');
                          setActiveTab('adapter');
                        }}
                      />
                    </>
                  )}
                  <DesktopToolTile
                    label={isWirelessController ? 'Controller CLI' : 'Command Prompt'}
                    icon=">_"
                    detail={isWirelessController ? 'WLC commands' : 'CLI'}
                    onClick={() => setActiveTab('terminal')}
                  />
                  {isWirelessController ? null : (
                    <DesktopToolTile
                      label="SSH Client"
                      icon="SSH"
                      detail="Remote access"
                      onClick={() => setActiveTab('ssh')}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'adapter' && (
          <form
            className="h-full overflow-y-auto p-4 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              onApplyNetwork(deviceId, normalizePcNetworkDraft(draft));
              setAppliedNotice(`Settings applied to ${deviceId}`);
            }}
          >
            <div className="space-y-4 rounded-xl border border-panel-border bg-black/20 p-4 shadow-inner">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terminal-prompt/80">
                    Network Adapter
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-terminal-fg">TCP/IP Properties</h2>
                  <p className="mt-1 text-xs leading-5 text-terminal-fg/65">
                    Choose DHCP or static addressing for this workstation NIC. GUI changes update session state without adding fake CLI history.
                  </p>
                </div>
                {appliedNotice ? (
                  <p role="status" className="rounded-full border border-terminal-prompt/30 bg-terminal-prompt/10 px-3 py-1 text-xs font-semibold text-terminal-prompt">
                    {appliedNotice}
                  </p>
                ) : null}
              </div>

              <fieldset className="grid gap-3 md:grid-cols-2">
                <legend className="sr-only">Addressing mode</legend>
                <ModeOption
                  title="Use DHCP"
                  detail="Request IPv4 settings automatically from the lab network."
                  checked={draft.mode === 'dhcp'}
                  name={`${deviceId}-pc-mode`}
                  onChange={() => {
                    setAppliedNotice(null);
                    setDraft((cur) => ({ ...cur, mode: 'dhcp' }));
                  }}
                />
                <ModeOption
                  title="Use static addressing"
                  detail="Manually enter IP, mask, and gateway values."
                  checked={draft.mode === 'static'}
                  name={`${deviceId}-pc-mode`}
                  ariaLabel="Use static addressing"
                  onChange={() => {
                    setAppliedNotice(null);
                    setDraft((cur) => ({ ...cur, mode: 'static' }));
                  }}
                />
              </fieldset>

              <p className={`rounded border px-3 py-2 text-xs ${
                draft.mode === 'dhcp'
                  ? 'border-amber-300/20 bg-amber-300/10 text-amber-100/90'
                  : 'border-terminal-prompt/20 bg-terminal-prompt/10 text-terminal-fg/75'
              }`}
              >
                {draft.mode === 'dhcp'
                  ? 'DHCP is selected. Static fields are preserved in the form but ignored until static mode is applied.'
                  : 'Static addressing is selected. Enter values exactly as the lab instructions require.'}
              </p>

              <div className="grid gap-4 xl:grid-cols-1">
                {activeAdapterSection === 'ipv4' ? (
                  <section className="rounded-lg border border-panel-border bg-[#08111f]/75 p-3">
                    <h3 className="text-sm font-semibold text-terminal-fg">IPv4 Configuration</h3>
                    <p className="mt-1 text-xs text-terminal-fg/55">Address, subnet mask, and default gateway for IPv4 labs.</p>
                    <div className="mt-3 grid gap-3">
                      <Ipv4OctetField label="IPv4 address" value={draft.ip} disabled={draft.mode === 'dhcp'} onChange={(index, value) => setIpv4Octet('ip', index, value)} />
                      <Ipv4OctetField label="Subnet mask" value={draft.mask} disabled={draft.mode === 'dhcp'} onChange={(index, value) => setIpv4Octet('mask', index, value)} />
                      <Ipv4OctetField label="Default gateway" value={draft.gateway} disabled={draft.mode === 'dhcp'} onChange={(index, value) => setIpv4Octet('gateway', index, value)} />
                    </div>
                  </section>
                ) : (
                  <section className="rounded-lg border border-terminal-prompt/35 bg-terminal-prompt/10 p-3">
                    <h3 className="text-sm font-semibold text-terminal-fg">IPv6 Configuration</h3>
                    <p className="mt-1 text-xs text-terminal-fg/60">Global IPv6 address/prefix and IPv6 default gateway.</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <TextField label="IPv6 address / prefix" value={draft.ipv6 ?? ''} disabled={draft.mode === 'dhcp'} onChange={(v) => setField('ipv6', v)} />
                      <TextField label="IPv6 default gateway" value={draft.gateway6 ?? ''} disabled={draft.mode === 'dhcp'} onChange={(v) => setField('gateway6', v)} />
                    </div>
                  </section>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-panel-border pt-4">
                <p className="text-xs text-terminal-fg/55">Apply saves these workstation adapter settings for the active lab attempt.</p>
                <button
                  type="submit"
                  aria-label="Apply network adapter settings"
                  className="rounded-md bg-terminal-prompt px-4 py-2 font-semibold text-[#06231d] shadow-lg shadow-terminal-prompt/10 transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-terminal-prompt/70"
                >
                  Apply
                </button>
              </div>
            </div>
          </form>
        )}


        {activeTab === 'ssh' && (
          <form
            className="h-full overflow-y-auto p-4 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const host = sshHost.trim();
              const user = sshUsername.trim();
              const port = sshPort.trim() || '22';
              if (!host || !user) return;
              const command = port === '22' ? `ssh ${user}@${host}` : `ssh ${user}@${host} -p ${port}`;
              term.setInput(command);
              setPendingSshCommand(command);
              setActiveTab('terminal');
            }}
          >
            <div className="mx-auto max-w-xl overflow-hidden rounded-xl border border-[#7aa2ff]/35 bg-[#d7d7d7] text-[#101010] shadow-2xl">
              <div className="flex items-center justify-between bg-[#f1f1f1] px-3 py-2 text-xs font-semibold text-[#202020]">
                <span>SSH Client</span>
                <span className="text-[10px] font-normal text-[#606060]">Remote SSH access</span>
              </div>
              <div className="space-y-4 p-4">
                <div>
                  <h2 className="text-base font-semibold text-[#101010]">Session</h2>
                  <p className="mt-1 text-xs leading-5 text-[#444]">
                    Start a scoped SSH connection from this workstation. This prepares a real OpenSSH command in the Command Prompt and runs it against the lab engine.
                  </p>
                </div>

                <div className="rounded border border-[#b8b8b8] bg-[#eeeeee] p-3">
                  <p className="mb-3 text-xs font-semibold text-[#303030]">Specify the destination you want to connect to</p>
                  <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_104px]">
                    <label className="grid min-w-0 gap-1 text-xs font-semibold text-[#303030]">
                      <span>Host Name or IP address</span>
                      <input
                        aria-label="Host Name or IP address"
                        value={sshHost}
                        onChange={(e) => setSshHost(e.target.value)}
                        className="h-9 w-full rounded border border-[#999] bg-white px-2 py-1.5 font-mono text-sm text-black outline-none focus:border-[#2454c6]"
                      />
                    </label>
                    <label className="grid min-w-0 gap-1 text-xs font-semibold text-[#303030]">
                      <span>Port</span>
                      <input
                        aria-label="Port"
                        value={sshPort}
                        onChange={(e) => setSshPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
                        className="h-9 w-full rounded border border-[#999] bg-white px-2 py-1.5 font-mono text-sm text-black outline-none focus:border-[#2454c6]"
                      />
                    </label>
                  </div>
                  <label className="mt-3 grid gap-1 text-xs font-semibold text-[#303030]">
                    <span>Username</span>
                    <input
                      aria-label="Username"
                      value={sshUsername}
                      onChange={(e) => setSshUsername(e.target.value)}
                      className="rounded border border-[#999] bg-white px-2 py-1.5 font-mono text-sm text-black outline-none focus:border-[#2454c6]"
                    />
                  </label>
                </div>

                <fieldset className="rounded border border-[#b8b8b8] bg-[#eeeeee] p-3">
                  <legend className="px-1 text-xs font-semibold text-[#303030]">Connection type</legend>
                  <label className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-[#303030]">
                    <input type="radio" checked readOnly className="accent-[#2454c6]" />
                    SSH
                  </label>
                </fieldset>

                <div className="flex justify-end gap-2 border-t border-[#b8b8b8] pt-3">
                  <button
                    type="button"
                    className="rounded border border-[#8c8c8c] bg-[#f6f6f6] px-4 py-1.5 text-xs font-semibold text-[#222] hover:bg-white"
                    onClick={() => setActiveTab('overview')}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    aria-label="Open SSH session"
                    className="rounded border border-[#1f4fbf] bg-[#2454c6] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#2f63dc]"
                  >
                    Open
                  </button>
                </div>
              </div>
            </div>
          </form>
        )}

        {activeTab === 'terminal' && (
          <div className="h-full border-t border-panel-border/60 bg-[#05070a]">
            <Terminal term={term} />
          </div>
        )}
      </div>
    </div>
  );
}

function DesktopToolTile({
  label,
  icon,
  detail,
  onClick,
}: {
  readonly label: string;
  readonly icon: string;
  readonly detail: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="group flex min-h-[108px] flex-col items-center justify-between rounded-lg border border-cyan-300/25 bg-cyan-300/10 p-3 text-center transition hover:-translate-y-0.5 hover:border-terminal-prompt/60 hover:bg-terminal-prompt/15 focus:outline-none focus:ring-2 focus:ring-terminal-prompt/70"
    >
      <span className="grid h-12 w-14 place-items-center rounded-md border border-white/15 bg-gradient-to-br from-[#5ecae2]/35 to-[#10233a] font-mono text-sm font-bold text-terminal-fg shadow-inner">
        {icon}
      </span>
      <span className="mt-2 text-xs font-semibold leading-tight text-terminal-fg">{label}</span>
      <span className="text-[10px] uppercase tracking-[0.12em] text-terminal-fg/45 group-hover:text-terminal-fg/65">
        {detail}
      </span>
    </button>
  );
}

function ModeOption({
  title,
  detail,
  checked,
  name,
  ariaLabel,
  onChange,
}: {
  readonly title: string;
  readonly detail: string;
  readonly checked: boolean;
  readonly name: string;
  readonly ariaLabel?: string;
  readonly onChange: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${
        checked
          ? 'border-terminal-prompt/45 bg-terminal-prompt/10'
          : 'border-panel-border bg-black/20 hover:bg-white/5'
      }`}
    >
      <input
        type="radio"
        name={name}
        aria-label={ariaLabel}
        checked={checked}
        onChange={onChange}
        className="mt-1 accent-terminal-prompt"
      />
      <span>
        <span className="block text-sm font-semibold text-terminal-fg">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-terminal-fg/60">{detail}</span>
      </span>
    </label>
  );
}

function normalizePcNetworkDraft(draft: PcNetworkConfig): PcNetworkConfig {
  if (draft.mode === 'dhcp') return { mode: 'dhcp' };
  return {
    mode: 'static',
    ip: draft.ip?.trim() || null,
    mask: draft.mask?.trim() || null,
    gateway: draft.gateway?.trim() || null,
    ipv6: draft.ipv6?.trim() || null,
    gateway6: draft.gateway6?.trim() || null,
  };
}

function WorkbenchTab({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-xs font-semibold ${
        active ? 'bg-terminal-prompt text-[#06231d]' : 'bg-white/5 text-terminal-fg/75 hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );
}

function splitIpv4(value: string | null | undefined): string[] {
  const parts = (value ?? '').split('.');
  return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? '', parts[3] ?? ''];
}

function joinIpv4(octets: readonly string[]): string | null {
  return octets.some((octet) => octet !== '') ? octets.join('.') : null;
}

function Ipv4OctetField({
  label,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string | null | undefined;
  readonly disabled?: boolean;
  readonly onChange: (index: number, value: string) => void;
}) {
  const octets = splitIpv4(value);
  return (
    <fieldset className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-terminal-dim">
      <legend>{label}</legend>
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-1">
        {octets.map((octet, index) => (
          <Fragment key={`${label}-${index}`}>
            <input
              aria-label={`${label} octet ${index + 1}`}
              value={octet}
              disabled={disabled}
              inputMode="numeric"
              maxLength={3}
              placeholder="000"
              onChange={(e) => onChange(index, e.target.value)}
              className="min-w-0 rounded border border-panel-border bg-black/30 px-2 py-2 text-center font-mono text-sm normal-case tracking-normal text-terminal-fg outline-none focus:border-terminal-prompt disabled:opacity-50"
            />
            {index < 3 ? <span className="text-center font-mono text-terminal-fg/55">.</span> : null}
          </Fragment>
        ))}
      </div>
    </fieldset>
  );
}

function TextField({
  label,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-terminal-dim">
      <span>{label}</span>
      <input
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-panel-border bg-black/30 px-3 py-2 font-mono text-sm normal-case tracking-normal text-terminal-fg outline-none focus:border-terminal-prompt disabled:opacity-50"
      />
    </label>
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
