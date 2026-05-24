/**
 * TopologyPanel — React Flow canvas (3a-c5).
 *
 * Renders the lab topology as a React Flow canvas: one node per device,
 * one edge per link. The canvas consumes device-kind-agnostic
 * DeviceTopologyView objects ONLY — it does NOT import router/switch/pc
 * internals. Adding new device kinds (3b/3c) means adding their icon to
 * DeviceNode; nothing in this file changes.
 *
 * Read-only: nodes don't drag, no drag-to-connect. Clicking a node calls
 * onSelectDevice — the seam useLabSession uses to switch the active console.
 *
 * N=1 still works: a single node with no edges renders fine.
 */
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Handle,
  Position,
  ViewportPortal,
  useReactFlow,
} from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo, type MouseEvent, type PointerEvent, type ReactNode } from 'react';

// View types now live in the adapter contracts so adapters can implement them
// directly. Re-exported here so existing imports of these types from
// `@/components/TopologyPanel` continue to work.
import type {
  DeviceTopologyView,
  InterfaceTopologyView,
  InterfaceStatus,
} from '@/engine/adapters/types';
import type { Link } from '@/engine/types';
import { maskLength, networkAddress } from '@/engine/adapters/ios/routing';
export type { DeviceTopologyView, InterfaceTopologyView, InterfaceStatus };

interface TopologyPanelProps {
  readonly devices: readonly DeviceTopologyView[];
  readonly activeDeviceId: string;
  /** Prompt string for the active device, e.g. `R1(config-if)#`. */
  readonly activePrompt?: string;
  readonly onSelectDevice?: (id: string) => void;
  /** Links between device interfaces — drawn as edges in the canvas. */
  readonly links?: readonly Link[];
  /** Allow plain mouse-wheel to zoom the canvas. Default true for /try and
   *  pilot routes where the topology is the primary content. The /embed
   *  surface (later commit) will pass false so scrolling inside the iframe
   *  does NOT hijack the parent page's scroll; embed will layer on a
   *  Ctrl/Cmd-modifier handler of its own. Touchpad pinch + the on-canvas
   *  zoom buttons stay available regardless of this prop. */
  readonly zoomOnScroll?: boolean;
}

/** Zoom bounds — see `CanvasControls` and the React Flow setup below.
 *  - 0.5 floor: 200px nodes never shrink below 100px (the historical fitView
 *    crash settled around 0.3 ⇒ ~60px and made nodes unclickable).
 *  - 1.5 ceiling: 200px nodes never exceed ~300px; useful magnification for
 *    accessibility without making the topology dominate the band.
 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.5;

interface DeviceNodeData extends Record<string, unknown> {
  view: DeviceTopologyView;
  active: boolean;
  promptLabel?: string;
  onClick: () => void;
}

const NODE_WIDTH = 200;
const NODE_GAP = 80;

/** Horizontal row layout — adequate for 1-3 devices in the rail. Larger
 *  topologies (3b+) will switch to a directed-graph layout via dagre. */
const NODE_HEIGHT = 94;

/** Canvas height — fits one row of real-sized nodes (NODE_HEIGHT=94) with
 *  vertical breathing room, while leaving the rest of the rail to the
 *  objectives panel. Held in JS so the viewport y-inset (which centers the
 *  row) stays in sync with the container height. */
const CANVAS_HEIGHT = 160;
/** Left inset of the row from the canvas edge — gives nodes breathing room
 *  against the panel border at the default viewport. */
const ROW_INSET_X = 20;
/** Vertical inset to center the node row inside the canvas. */
const ROW_INSET_Y = Math.round((CANVAS_HEIGHT - NODE_HEIGHT) / 2);

function layoutNodes(
  devices: readonly DeviceTopologyView[],
  activeId: string,
  activePrompt: string | undefined,
  onSelect: (id: string) => void,
): Node<DeviceNodeData>[] {
  return devices.map((d, i) => ({
    id: d.id,
    type: 'device',
    position: { x: i * (NODE_WIDTH + NODE_GAP), y: 0 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    draggable: false,
    selectable: false,
    // Explicit dimensions so React Flow can position edges without waiting for
    // ResizeObserver — `isNodeInitialized` accepts `initialWidth` as a signal
    // the node's size is already known.
    initialWidth: NODE_WIDTH,
    initialHeight: NODE_HEIGHT,
    data: {
      view: d,
      active: d.id === activeId,
      promptLabel: d.id === activeId ? activePrompt : undefined,
      onClick: () => onSelect(d.id),
    },
  }));
}

// Cable + LED palette. LED colors mirror PortIndicator's "up" (terminal-prompt
// cyan) and a clear "down" red — the link LEDs are the canvas's primary
// diagnostic signal so the contrast has to be unmistakable.
const CABLE_STROKE = '#5a6675';
const LED_GREEN = '#5eead4';
const LED_RED = '#ef4444';
const LED_RING = '#3a4655';
const LABEL_COLOR = '#7c8a9c';

const LED_OUTER_R = 5;
const LED_INNER_R = 3;
const LABEL_FONT_SIZE = 9;
/** Vertical baseline offset for the iface name — ABOVE the cable. The LED
 *  sits ON the cable, so the offset has to clear the LED's outer ring plus the
 *  font's full ascent (LABEL_FONT_SIZE) for a visible gap. */
const IFACE_LABEL_OFFSET = 12;
/** Vertical baseline offset for the network CIDR — BELOW the cable. Offset is
 *  intentionally larger than IFACE_LABEL_OFFSET because BELOW the cable the
 *  baseline measures to the TOP of the glyph: we need LED_OUTER_R + ascent
 *  clearance for the digits to clear the LED. The label sitting BELOW (rather
 *  than ABOVE, alongside the iface labels) is the A1.6 fix — see commit. */
const NETWORK_LABEL_OFFSET = 16;

interface RenderEndpoint {
  readonly deviceId: string;
  readonly ifaceId: string;
  /** Pixel coords in flow space — LED center sits exactly here. */
  readonly x: number;
  readonly y: number;
  /** Where the iface label anchors relative to the LED. */
  readonly labelAnchor: 'start' | 'end';
}

interface RenderLink {
  readonly key: string;
  readonly left: RenderEndpoint;
  readonly right: RenderEndpoint;
  /** True iff BOTH endpoint interfaces have status 'up'. Drives LED color on
   *  both ends — the "either-down ⇒ both red" rule reduces to a single bool. */
  readonly linkUp: boolean;
  /** CIDR network (e.g. `192.168.12.0/30`) derived from whichever endpoint has
   *  an IP+mask, or null if neither does. Descriptive only — LED carries the
   *  correctness signal. */
  readonly network: string | null;
}

/** Derive the CIDR network from the first endpoint that has an IP+mask pair.
 *  Returns null when neither endpoint is configured enough to compute one. */
function deriveNetwork(
  a: InterfaceTopologyView,
  b: InterfaceTopologyView,
): string | null {
  const src = a.ip && a.mask ? a : b.ip && b.mask ? b : null;
  if (!src || !src.ip || !src.mask) return null;
  return `${networkAddress(src.ip, src.mask)}/${maskLength(src.mask)}`;
}

/**
 * EdgeOverlay — draws cables + port LEDs + labels for every authored link as
 * an SVG rendered inside ReactFlow's viewport portal. The portal inherits the
 * viewport transform, so geometry tracks node positions across pan / zoom.
 *
 * Each link is rendered as: a horizontal cable between the two device edges,
 * a ringed LED at each end (anchored at the named interface's side of its
 * device), the iface name above each LED, and the network CIDR (derived from
 * endpoint state) centered above the cable. LED color is a pure function of
 * endpoint interface status — never stored, always derived. The Packet-Tracer
 * "either-end-down ⇒ both red" rule reduces to `aStatus === 'up' && bStatus === 'up'`.
 *
 * Avoids React Flow v12's edge-rendering choreography (handle-bound
 * measurement) which is sensitive to externally-controlled node arrays —
 * a later pass can promote this to React Flow's edge system once nodes
 * are in a useNodesState/applyNodeChanges-managed store.
 */
function EdgeOverlay({
  devices,
  deviceViews,
  links,
}: {
  devices: readonly { id: string; x: number; y: number }[];
  deviceViews: readonly DeviceTopologyView[];
  links: readonly Link[];
}) {
  if (links.length === 0) return null;
  const byId = new Map(devices.map((d) => [d.id, d]));
  const viewById = new Map(deviceViews.map((v) => [v.id, v]));

  const renderLinks: RenderLink[] = [];
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const aDev = byId.get(link.a.deviceId);
    const bDev = byId.get(link.b.deviceId);
    if (!aDev || !bDev) continue;
    const aView = viewById.get(link.a.deviceId);
    const bView = viewById.get(link.b.deviceId);
    if (!aView || !bView) continue;
    const aIface = aView.interfaces.find((iv) => iv.id === link.a.iface);
    const bIface = bView.interfaces.find((iv) => iv.id === link.b.iface);
    if (!aIface || !bIface) continue;

    // Order endpoints by x so "left" is always the smaller-x device. Each LED
    // anchors at its OWN device's facing edge: right edge of the left device,
    // left edge of the right device.
    const aIsLeft = aDev.x <= bDev.x;
    const leftDev = aIsLeft ? aDev : bDev;
    const rightDev = aIsLeft ? bDev : aDev;
    const leftLink = aIsLeft ? link.a : link.b;
    const rightLink = aIsLeft ? link.b : link.a;
    const yMid = leftDev.y + NODE_HEIGHT / 2;
    const left: RenderEndpoint = {
      deviceId: leftLink.deviceId,
      ifaceId: leftLink.iface,
      x: leftDev.x + NODE_WIDTH,
      y: yMid,
      labelAnchor: 'start',
    };
    const right: RenderEndpoint = {
      deviceId: rightLink.deviceId,
      ifaceId: rightLink.iface,
      x: rightDev.x,
      y: yMid,
      labelAnchor: 'end',
    };
    const linkUp = aIface.status === 'up' && bIface.status === 'up';
    const network = deriveNetwork(aIface, bIface);
    renderLinks.push({
      key: `${left.deviceId}:${left.ifaceId}-${right.deviceId}:${right.ifaceId}-${i}`,
      left,
      right,
      linkUp,
      network,
    });
  }
  if (renderLinks.length === 0) return null;

  // Bounding box of all rendered geometry — cable + LEDs + the iface labels
  // ABOVE the cable + the CIDR label BELOW the cable. Allowances:
  //   padTop    = iface label baseline above the cable + font ascent + slack
  //   padBottom = CIDR label baseline below the cable + descender slack
  //   padX      = LED + iface label runs inward but a CIDR centered on a short
  //               link can extend a few px past the LEDs; allow for that here.
  const xs = renderLinks.flatMap((l) => [l.left.x, l.right.x]);
  const ys = renderLinks.flatMap((l) => [l.left.y, l.right.y]);
  const padTop = IFACE_LABEL_OFFSET + LABEL_FONT_SIZE + 4;
  const padBottom = NETWORK_LABEL_OFFSET + 4;
  const padX = LED_OUTER_R + 24;
  const minX = Math.min(...xs) - padX;
  const maxX = Math.max(...xs) + padX;
  const minY = Math.min(...ys) - padTop;
  const maxY = Math.max(...ys) + padBottom;
  const w = maxX - minX;
  const h = maxY - minY;

  return (
    <ViewportPortal>
      <svg
        style={{
          position: 'absolute',
          left: minX,
          top: minY,
          width: w,
          height: h,
          pointerEvents: 'none',
          overflow: 'visible',
        }}
        aria-hidden
      >
        {renderLinks.map((l) => {
          const fill = l.linkUp ? LED_GREEN : LED_RED;
          const midX = (l.left.x + l.right.x) / 2;
          return (
            <g key={l.key} data-link-key={l.key}>
              <line
                x1={l.left.x - minX}
                y1={l.left.y - minY}
                x2={l.right.x - minX}
                y2={l.right.y - minY}
                stroke={CABLE_STROKE}
                strokeWidth={1.5}
              />
              <PortLed endpoint={l.left} linkUp={l.linkUp} fill={fill} ox={minX} oy={minY} />
              <PortLed endpoint={l.right} linkUp={l.linkUp} fill={fill} ox={minX} oy={minY} />
              {l.network ? (
                <text
                  x={midX - minX}
                  y={l.left.y - minY + NETWORK_LABEL_OFFSET}
                  textAnchor="middle"
                  fontSize={LABEL_FONT_SIZE}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fill={LABEL_COLOR}
                  data-link-network={l.network}
                >
                  {l.network}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </ViewportPortal>
  );
}

/** A single port LED + its iface name label. Pure presentational — color is
 *  derived from the link's overall state by the caller. */
function PortLed({
  endpoint,
  linkUp,
  fill,
  ox,
  oy,
}: {
  readonly endpoint: RenderEndpoint;
  readonly linkUp: boolean;
  readonly fill: string;
  readonly ox: number;
  readonly oy: number;
}) {
  const cx = endpoint.x - ox;
  const cy = endpoint.y - oy;
  // Iface label sits ABOVE the cable (the CIDR sits BELOW — the two never
  // share a vertical slot, the A1.6 collision fix). Horizontal anchor grows
  // INWARD from the LED so the text stays inside the link span; for a 4-5
  // char iface name and the 80px node-gap, this leaves a ~10px gap between
  // the two iface labels at the smallest link width.
  const labelX =
    endpoint.labelAnchor === 'start' ? cx + LED_OUTER_R + 3 : cx - LED_OUTER_R - 3;
  const labelY = cy - IFACE_LABEL_OFFSET;
  return (
    <g
      data-led-endpoint={`${endpoint.deviceId}:${endpoint.ifaceId}`}
      data-led-up={linkUp ? 'true' : 'false'}
    >
      <circle cx={cx} cy={cy} r={LED_OUTER_R} fill="none" stroke={LED_RING} strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={LED_INNER_R} fill={fill} />
      <text
        x={labelX}
        y={labelY}
        textAnchor={endpoint.labelAnchor}
        fontSize={LABEL_FONT_SIZE}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fill={LABEL_COLOR}
        data-iface-label={`${endpoint.deviceId}:${endpoint.ifaceId}`}
      >
        {endpoint.ifaceId}
      </text>
    </g>
  );
}

/**
 * Canvas zoom controls — three small icon buttons (in / out / fit) rendered
 * inside the topology band, top-right. Wheel-zoom isn't discoverable and
 * fails on plain mice; the buttons are the always-available path.
 *
 * Fit uses `fitView({ maxZoom: 1 })` so it can never inflate a small
 * topology past 1.0 and can never push the global zoom past MIN_ZOOM — this
 * is the explicit safeguard against the historical fitView crush where an
 * unclamped fit on a multi-device lab settled at ~0.3 and produced
 * unclickable ~60px-wide nodes.
 *
 * `pointer-events:auto` + a stopPropagation guard on pointerdown/mousedown
 * keeps a quick mouse-down on a button from also starting a canvas pan.
 * Lives in screen space (outside ViewportPortal) so it doesn't pan/zoom
 * with the canvas — controls stay anchored to the band's corner.
 */
function CanvasControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  // Stop the event from bubbling to React Flow's pan handler — without this,
  // a slow click on a button would also start dragging the canvas.
  const stop = (e: MouseEvent | PointerEvent) => e.stopPropagation();
  return (
    <div
      className="pointer-events-auto absolute right-3 top-3 z-10 flex flex-col gap-1"
      onPointerDown={stop}
      onMouseDown={stop}
    >
      <CanvasButton onClick={() => zoomIn({ duration: 150 })} label="Zoom in">
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
          <path d="M5 12h14M12 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </CanvasButton>
      <CanvasButton onClick={() => zoomOut({ duration: 150 })} label="Zoom out">
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
          <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </CanvasButton>
      <CanvasButton
        onClick={() => fitView({ maxZoom: 1, duration: 200, padding: 0.1 })}
        label="Fit topology to view"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="none">
          <path
            d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </CanvasButton>
    </div>
  );
}

function CanvasButton({
  onClick,
  label,
  children,
}: {
  readonly onClick: () => void;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-7 w-7 place-items-center rounded border border-panel-border bg-panel-header/90 text-terminal-dim transition-colors hover:border-terminal-dim/70 hover:text-terminal-fg focus:outline-none focus:ring-1 focus:ring-terminal-prompt"
    >
      {children}
    </button>
  );
}

export function TopologyPanel({
  devices,
  activeDeviceId,
  activePrompt,
  onSelectDevice,
  links,
  zoomOnScroll = true,
}: TopologyPanelProps) {
  const handleSelect = useMemo(
    () => (id: string) => onSelectDevice?.(id),
    [onSelectDevice],
  );

  const nodes = useMemo(
    () => layoutNodes(devices, activeDeviceId, activePrompt, handleSelect),
    [devices, activeDeviceId, activePrompt, handleSelect],
  );

  // Edges are drawn as an overlay SVG (see EdgeOverlay) inside the React Flow
  // viewport — straight lines between authored device endpoints. React Flow's
  // built-in edge system in v12 requires handle measurement that depends on
  // node-internals state we don't drive; overlay SVG sidesteps that without
  // sacrificing the visible link.
  const positionedDevices = useMemo(
    () =>
      devices.map((d, i) => ({
        id: d.id,
        x: i * (NODE_WIDTH + NODE_GAP),
        y: 0,
      })),
    [devices],
  );

  // Center the canvas inside the (now full-width) topology band. The wrapper's
  // max-width tracks the row's natural footprint: row width + ROW_INSET_X on
  // each side. For a single-device free lab that's ~240px — too narrow to feel
  // intentional in a wide band — so floor at 340px (the prior sidebar's width)
  // so the node sits in a familiar-sized centered card. Multi-device labs grow
  // past that automatically; when the band itself is narrower than the inner
  // max-width (mobile portrait, ~520px embed iframe with 4 devices) the wrapper
  // collapses to the band width and React Flow's panOnDrag handles the
  // overflow exactly as it did pre-A1.6.
  const rowWidth =
    devices.length * NODE_WIDTH + Math.max(0, devices.length - 1) * NODE_GAP;
  const canvasMaxWidth = Math.max(rowWidth + 2 * ROW_INSET_X, 340);

  return (
    <ReactFlowProvider>
      <div className="w-full bg-panel-bg" style={{ height: CANVAS_HEIGHT }}>
        {/* The centered wrapper has `relative` so CanvasControls absolute-
            positions against the VISIBLE canvas edge, not the full-band edge.
            (Before A1.7.1 the controls were a sibling of this wrapper — they
            rendered hundreds of px to the right of the centered canvas and
            were effectively invisible to a user looking at the topology.) */}
        <div
          className="relative mx-auto h-full"
          style={{ maxWidth: canvasMaxWidth }}
        >
          <ReactFlow
            nodes={nodes}
            edges={[]}
            nodeTypes={NODE_TYPES}
            // Initial view: identity at zoom=1 with the row inset. Reset is
            // explicit (the Fit button) — we deliberately don't auto-fit on
            // mount because that's what produced the historical multi-node
            // crush; user-initiated fitView in CanvasControls is bounded by
            // `maxZoom: 1` and the global MIN_ZOOM so it can't reproduce it.
            defaultViewport={{ x: ROW_INSET_X, y: ROW_INSET_Y, zoom: 1 }}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            // Stays false — enabling React Flow's selection caused its internal
            // click handler to stopPropagation on node clicks, killing both our
            // inner button onClick AND onNodeClick. With selectable=false the
            // inner <button onClick> path works cleanly once the inline
            // pointer-events:none on `.react-flow__node` is overridden in
            // `src/index.css` (load-bearing — see the comment there).
            elementsSelectable={false}
            // Wheel-zoom behind a prop so embed mode (later) can turn it off
            // without losing the on-canvas zoom buttons or pinch. Touchpad
            // pinch + double-click stay independent of this prop.
            zoomOnScroll={zoomOnScroll}
            zoomOnPinch={true}
            zoomOnDoubleClick={false}
            // Always-on pan: even N=1 can be zoomed past the canvas and need
            // panning. The Fit button rescues a panned-off topology.
            panOnDrag={true}
            panOnScroll={false}
            // LOAD-BEARING: must be coupled to zoomOnScroll. In
            // @xyflow/system v12 the wheel handler computes
            //   preventZoom = !preventScrolling && isWheel && !event.ctrlKey
            // and bails out when preventZoom is true. So preventScrolling:false
            // silently disables plain (non-ctrl) wheel-zoom while pinch — which
            // synthesises ctrlKey — still works. A1.7's commit shipped that
            // exact bug: zoomOnScroll was flipped to true but preventScrolling
            // stayed hardcoded false, leaving wheel-zoom dead. Tying them
            // together encodes the invariant in code.
            preventScrolling={zoomOnScroll}
          >
            <Background gap={20} size={1} color="#1e2733" />
            <EdgeOverlay
              devices={positionedDevices}
              deviceViews={devices}
              links={links ?? []}
            />
          </ReactFlow>
          <CanvasControls />
        </div>
      </div>
    </ReactFlowProvider>
  );
}

const NODE_TYPES = { device: DeviceNode };

function DeviceNode({ data }: NodeProps<Node<DeviceNodeData>>) {
  const { view, active, promptLabel, onClick } = data;
  return (
    <div className="relative">
      {/* Handles for edges — visually hidden but still measurable for edge
          routing. Each side gets BOTH a source and target so any pair of
          devices can be cabled left-or-right without authoring concerns. */}
      <Handle
        id="left"
        type="source"
        position={Position.Left}
        isConnectable={false}
        style={{ background: 'transparent', border: 'none', opacity: 0 }}
      />
      <Handle
        id="left-t"
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={{ background: 'transparent', border: 'none', opacity: 0 }}
      />
      <Handle
        id="right"
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ background: 'transparent', border: 'none', opacity: 0 }}
      />
      <Handle
        id="right-t"
        type="target"
        position={Position.Right}
        isConnectable={false}
        style={{ background: 'transparent', border: 'none', opacity: 0 }}
      />
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={`Console for ${view.hostname}`}
        style={{ width: NODE_WIDTH }}
        className={`group flex flex-col gap-2 rounded-md border bg-gradient-to-b from-[#1b2531] to-[#0e141b] px-3 py-2.5 text-left transition-colors ${
          active
            ? 'border-terminal-prompt shadow-[0_0_0_1px_rgba(94,234,212,0.25),inset_0_1px_0_rgba(255,255,255,0.06)]'
            : 'border-panel-border hover:border-terminal-dim/70'
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1.5 font-sans text-sm font-semibold tracking-tight text-terminal-fg">
            <DeviceIcon kind={view.kind} />
            {view.hostname}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-terminal-dim">
            {view.platform}
          </span>
        </div>

        <div className="flex items-end gap-1.5">
          {view.interfaces.map((i) => (
            <PortIndicator key={i.id} iface={i} />
          ))}
        </div>

        {promptLabel ? (
          <div className="truncate font-mono text-[11px] leading-none text-terminal-prompt">
            {promptLabel}
          </div>
        ) : (
          <div className="h-[11px]" aria-hidden />
        )}
      </button>
    </div>
  );
}

/** Inline-SVG device icons, sized to match the hostname's font line. */
function DeviceIcon({ kind }: { kind: DeviceTopologyView['kind'] }) {
  switch (kind) {
    case 'router':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden className="text-terminal-dim">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'switch':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden className="text-terminal-dim">
          <rect x="3" y="9" width="18" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'pc':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden className="text-terminal-dim">
          <rect x="4" y="5" width="16" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 19h6M12 16v3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
  }
}

const STATUS_STYLE: Record<InterfaceStatus, { dot: string; label: string }> = {
  up: {
    dot: 'bg-terminal-prompt shadow-[0_0_6px_rgba(94,234,212,0.75)]',
    label: 'text-terminal-fg/80',
  },
  'no-ip': {
    dot: 'bg-amber-400/80 shadow-[0_0_5px_rgba(251,191,36,0.55)]',
    label: 'text-terminal-fg/60',
  },
  'admin-down': {
    dot: 'bg-terminal-dim/50',
    label: 'text-terminal-dim',
  },
};

const STATUS_LABEL: Record<InterfaceStatus, string> = {
  up: 'up',
  'no-ip': 'admin up, no IP',
  'admin-down': 'administratively down',
};

function PortIndicator({ iface }: { iface: InterfaceTopologyView }) {
  const style = STATUS_STYLE[iface.status];
  return (
    <div
      className="flex flex-col items-center gap-1"
      title={`${iface.name} — ${STATUS_LABEL[iface.status]}`}
    >
      <span className={`block h-2.5 w-2.5 rounded-sm ${style.dot}`} aria-hidden />
      <span className={`font-mono text-[9px] leading-none ${style.label}`}>{iface.id}</span>
    </div>
  );
}
