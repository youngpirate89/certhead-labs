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
import {
  useEffect,
  useMemo,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

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
import DeviceIcon from './topology/icons/DeviceIcon';
export type { DeviceTopologyView, InterfaceTopologyView, InterfaceStatus };

interface TopologyPanelProps {
  readonly devices: readonly DeviceTopologyView[];
  readonly activeDeviceId: string;
  readonly onSelectDevice?: (id: string) => void;
  /** Links between device interfaces — drawn as edges in the canvas. */
  readonly links?: readonly Link[];
  /** Optional per-device topology positions. When ALL devices in `devices`
   *  have a position entry here, the renderer uses these coordinates verbatim
   *  instead of the default left-to-right row layout — required for non-linear
   *  topologies like the Lab 09 router-on-a-stick T-shape. If any device is
   *  missing a position, the linear default is used for all devices (mixing
   *  the two layouts would be confusing). */
  readonly positions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
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
  onClick: () => void;
  /** Per-interface edge placement for in-card LEDs. Set by `layoutNodes` from
   *  the lab's links; interfaces with no entry render in the card's bottom
   *  row (the free-lab and unconnected-port path). */
  portEdges: Map<string, 'left' | 'right' | 'top' | 'bottom'>;
}

const NODE_WIDTH = 200;
const NODE_GAP = 120;

/** Uniform card height across router / switch / workstation. Sized to fit the
 *  tallest current card content (PC: icon + hostname + centered IP + bottom
 *  port row) without overflow. */
const NODE_HEIGHT = 120;

/** Initial canvas height assumed by `defaultViewport`. The panel itself is
 *  `h-full` and grows/shrinks with its parent (Layout owns the live height
 *  via the resizable divider). This constant only feeds the row-inset that
 *  vertically centers the node row at first paint — on resize the
 *  CanvasAutoFit observer calls fitView to re-center against the new size. */
const INITIAL_CANVAS_HEIGHT = 160;
/** Left inset of the row from the canvas edge — gives nodes breathing room
 *  against the panel border at the default viewport. */
const ROW_INSET_X = 20;
/** Vertical inset to center the node row inside the canvas at first paint. */
const ROW_INSET_Y = Math.round((INITIAL_CANVAS_HEIGHT - NODE_HEIGHT) / 2);

type PortEdge = 'left' | 'right' | 'top' | 'bottom';

/** Compute the canvas-space position for every device. If `overrides` covers
 *  ALL devices, use those verbatim — that's the per-lab T-shape / hub-spoke
 *  path. If any device is missing an override, fall back to the linear
 *  left-to-right row at y=0 for ALL devices (mixing the two layouts would
 *  produce a confusing canvas). */
function computePositions(
  devices: readonly { id: string }[],
  overrides: ReadonlyMap<string, { x: number; y: number }> | undefined,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const allOverridden =
    overrides !== undefined && devices.every((d) => overrides.has(d.id));
  if (allOverridden) {
    for (const d of devices) positions.set(d.id, overrides!.get(d.id)!);
    return positions;
  }
  for (let i = 0; i < devices.length; i++) {
    positions.set(devices[i].id, { x: i * (NODE_WIDTH + NODE_GAP), y: 0 });
  }
  return positions;
}

/** Per-link, per-endpoint port-edge selection. Compares device centers:
 *  - if |dy| dominates (neighbor is significantly above/below), use top/bottom
 *  - otherwise use left/right based on dx sign
 *
 *  The vertical threshold is half NODE_HEIGHT: anything closer in y is treated
 *  as effectively-horizontal so the existing linear-row labs (Lab 08 PC↔SW↔SW
 *  ↔PC, all y=0) keep their familiar left/right rendering. */
function portEdgesFor(
  posA: { x: number; y: number },
  posB: { x: number; y: number },
): { a: PortEdge | null; b: PortEdge | null } {
  const dx = posB.x - posA.x;
  const dy = posB.y - posA.y;
  const verticalDominant = Math.abs(dy) >= NODE_HEIGHT / 2;
  if (verticalDominant) {
    if (dy > 0) return { a: 'bottom', b: 'top' };
    if (dy < 0) return { a: 'top', b: 'bottom' };
  }
  if (dx > 0) return { a: 'right', b: 'left' };
  if (dx < 0) return { a: 'left', b: 'right' };
  // Same coordinates (degenerate) — leave both off the map so they fall to
  // the bottom row, matching the previous behavior.
  return { a: null, b: null };
}

function layoutNodes(
  devices: readonly DeviceTopologyView[],
  links: readonly Link[],
  positions: Map<string, { x: number; y: number }>,
  activeId: string,
  onSelect: (id: string) => void,
): Node<DeviceNodeData>[] {
  const portEdgesByDevice = new Map<string, Map<string, PortEdge>>();
  for (const d of devices) portEdgesByDevice.set(d.id, new Map());
  for (const link of links) {
    const posA = positions.get(link.a.deviceId);
    const posB = positions.get(link.b.deviceId);
    if (!posA || !posB) continue;
    const { a, b } = portEdgesFor(posA, posB);
    if (a) portEdgesByDevice.get(link.a.deviceId)!.set(link.a.iface, a);
    if (b) portEdgesByDevice.get(link.b.deviceId)!.set(link.b.iface, b);
  }
  return devices.map((d) => {
    const pos = positions.get(d.id) ?? { x: 0, y: 0 };
    return {
      id: d.id,
      type: 'device',
      position: pos,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: false,
      selectable: false,
      // Explicit dimensions so React Flow can position edges without waiting
      // for ResizeObserver — `isNodeInitialized` accepts `initialWidth` as a
      // signal the node's size is already known.
      initialWidth: NODE_WIDTH,
      initialHeight: NODE_HEIGHT,
      data: {
        view: d,
        active: d.id === activeId,
        onClick: () => onSelect(d.id),
        portEdges: portEdgesByDevice.get(d.id) ?? new Map(),
      },
    };
  });
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
/** Perpendicular pixel offset for the iface name label (ABOVE the cable).
 *  Applied along the perpendicular to the cable direction so diagonal cables
 *  (e.g. Lab 09 SW1↔PC-A, SW1↔PC-B) keep the label clear of the line rather
 *  than rendering on top of it. For a purely horizontal cable this reduces
 *  to a pure vertical offset (same direction the original code used). */
const IFACE_LABEL_OFFSET = 18;
/** Fraction along the cable to pull each iface name label toward the center.
 *  The label still associates with its own LED + port edge, but sits ~22% in
 *  from the endpoint so it clears the device card it would otherwise overlap.
 *  The mirror label uses (1 - this) — symmetric three-label layout
 *  (iface @ 0.22, CIDR @ 0.5, iface @ 0.78). */
const IFACE_LABEL_T = 0.22;
/** Perpendicular pixel offset for the network CIDR label (BELOW the cable).
 *  Same perpendicular logic as IFACE_LABEL_OFFSET but on the opposite side. */
const NETWORK_LABEL_OFFSET = 18;

interface RenderEndpoint {
  readonly deviceId: string;
  readonly ifaceId: string;
  /** Pixel coords in flow space — LED center sits exactly here. */
  readonly x: number;
  readonly y: number;
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

/** Where to place an LED for one endpoint, given the device's top-left
 *  corner, the edge of the card the cable comes out of, and the port's
 *  slot index on that edge (out of `totalOnEdge`). The slot index
 *  distributes multi-port edges evenly along the edge — e.g. SW1's bottom
 *  edge with 2 spokes in Lab 09 puts the two LEDs at 1/3 and 2/3 of the
 *  edge instead of stacking them both at the midpoint.
 *
 *  Label positioning (iface name + CIDR) is computed downstream from the
 *  cable's direction vector, not from `edge` — that way diagonal cables
 *  get a perpendicular offset that floats the label cleanly off the line. */
function endpointFor(
  dev: { x: number; y: number },
  deviceId: string,
  ifaceId: string,
  edge: PortEdge | null,
  slot: number,
  totalOnEdge: number,
): RenderEndpoint {
  // Fractional position along the edge — first port at 1/(N+1), last at
  // N/(N+1), so even spacing with margin from the corners.
  const frac = totalOnEdge > 0 ? (slot + 1) / (totalOnEdge + 1) : 0.5;
  switch (edge) {
    case 'left':
      return { deviceId, ifaceId, x: dev.x, y: dev.y + NODE_HEIGHT * frac };
    case 'right':
      return {
        deviceId,
        ifaceId,
        x: dev.x + NODE_WIDTH,
        y: dev.y + NODE_HEIGHT * frac,
      };
    case 'top':
      return { deviceId, ifaceId, x: dev.x + NODE_WIDTH * frac, y: dev.y };
    case 'bottom':
      return {
        deviceId,
        ifaceId,
        x: dev.x + NODE_WIDTH * frac,
        y: dev.y + NODE_HEIGHT,
      };
    default:
      // No edge mapping — fall back to the right edge midpoint so the cable
      // still draws somewhere reasonable (degenerate topology case).
      return {
        deviceId,
        ifaceId,
        x: dev.x + NODE_WIDTH,
        y: dev.y + NODE_HEIGHT / 2,
      };
  }
}

/** Perpendicular unit vector to the cable AB, pointing to the "below" side
 *  (positive y in SVG coordinates). For a purely horizontal cable this is
 *  (0, 1) — labels offset along this vector sit BELOW the cable; labels
 *  offset along its negation sit ABOVE. For diagonal cables (e.g. Lab 09
 *  SW1↔PC-A, SW1↔PC-B) the vector rotates with the cable so a label's
 *  fixed perpendicular offset always clears the line.
 *
 *  The perpendicular has two candidate directions (±90° from the cable);
 *  we canonicalise to the one with a non-negative y component so the
 *  "above"/"below" placement is consistent as cables rotate.
 *
 *  Degenerate case (coincident endpoints): falls back to (0, 1) — pure
 *  vertical, same direction the previous always-vertical code used. */
function perpUnitBelow(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { nx: number; ny: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { nx: 0, ny: 1 };
  let nx = -dy / len;
  let ny = dx / len;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { nx, ny };
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

  // Pre-pass: for each (device, edge), collect the list of (iface, link-index)
  // pairs in link declaration order. Used so multi-port edges (Lab 09 SW1
  // bottom = Gi0/1 + Gi0/2) get distributed slots instead of overlapping LEDs.
  type SlotKey = string; // `${deviceId}|${edge}`
  const edgeIfaceLists = new Map<SlotKey, string[]>();
  const linkEdges: ({ a: PortEdge | null; b: PortEdge | null } | null)[] = [];
  for (const link of links) {
    const aDev = byId.get(link.a.deviceId);
    const bDev = byId.get(link.b.deviceId);
    if (!aDev || !bDev) {
      linkEdges.push(null);
      continue;
    }
    const edges = portEdgesFor(aDev, bDev);
    linkEdges.push(edges);
    if (edges.a) {
      const k = `${link.a.deviceId}|${edges.a}`;
      const list = edgeIfaceLists.get(k) ?? [];
      if (!list.includes(link.a.iface)) list.push(link.a.iface);
      edgeIfaceLists.set(k, list);
    }
    if (edges.b) {
      const k = `${link.b.deviceId}|${edges.b}`;
      const list = edgeIfaceLists.get(k) ?? [];
      if (!list.includes(link.b.iface)) list.push(link.b.iface);
      edgeIfaceLists.set(k, list);
    }
  }
  const slotIndex = (deviceId: string, edge: PortEdge | null, iface: string) => {
    if (!edge) return { slot: 0, total: 1 };
    const list = edgeIfaceLists.get(`${deviceId}|${edge}`) ?? [];
    const slot = list.indexOf(iface);
    return { slot: slot < 0 ? 0 : slot, total: Math.max(1, list.length) };
  };

  const renderLinks: RenderLink[] = [];
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const aDev = byId.get(link.a.deviceId);
    const bDev = byId.get(link.b.deviceId);
    const edges = linkEdges[i];
    if (!aDev || !bDev || !edges) continue;
    const aView = viewById.get(link.a.deviceId);
    const bView = viewById.get(link.b.deviceId);
    if (!aView || !bView) continue;
    const aIface = aView.interfaces.find((iv) => iv.id === link.a.iface);
    const bIface = bView.interfaces.find((iv) => iv.id === link.b.iface);
    if (!aIface || !bIface) continue;

    // Position each LED on its device's edge using the precomputed slot info.
    // For multi-port edges (Lab 09 SW1 bottom: Gi0/1 + Gi0/2) this spreads
    // them along the edge instead of stacking them on the midpoint.
    const aSlot = slotIndex(link.a.deviceId, edges.a, link.a.iface);
    const bSlot = slotIndex(link.b.deviceId, edges.b, link.b.iface);
    const aEndpoint = endpointFor(
      aDev,
      link.a.deviceId,
      link.a.iface,
      edges.a,
      aSlot.slot,
      aSlot.total,
    );
    const bEndpoint = endpointFor(
      bDev,
      link.b.deviceId,
      link.b.iface,
      edges.b,
      bSlot.slot,
      bSlot.total,
    );
    // Order endpoints by x so the "left" / "right" naming in RenderLink still
    // means smaller-x / larger-x. For vertical cables (dx === 0) either
    // assignment is fine; defer to the original "a is left" tie-break.
    const aIsLeft = aDev.x <= bDev.x;
    const left = aIsLeft ? aEndpoint : bEndpoint;
    const right = aIsLeft ? bEndpoint : aEndpoint;
    // Cable LED is the L1/L2 signal — green iff BOTH ends are adminUp AND
    // protocolUp. IP-less ports (status='no-ip') still light green so a learner
    // who runs `no shutdown` BEFORE assigning an IP sees the link come up.
    // The "either-end-down ⇒ both red" PT rule still reduces to one bool.
    const linkUp =
      aIface.adminUp && aIface.protocolUp && bIface.adminUp && bIface.protocolUp;
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

  // Bounding box of all rendered geometry — cable + LEDs + the iface label
  // (perpendicular ABOVE the cable, at each endpoint) + the CIDR label
  // (perpendicular BELOW the cable, at midpoint). The labels rotate with the
  // cable direction so the SVG must accommodate label extent in any direction
  // around the endpoints; padding is uniform on all sides for that reason.
  //   - perp offset + font cap (`LABEL_FONT_SIZE`) covers a label whose
  //     perpendicular projection points straight up/down/left/right.
  //   - text-anchor on the iface labels is 'middle' so each label extends
  //     ~half its rendered width on each side of its anchor point; allow a
  //     fixed extra for typical iface ids like `GigabitEthernet0/0`.
  // The outer `overflow:visible` on the SVG element is the final safety net
  // if any label edges past these allowances — nothing actually clips.
  const xs = renderLinks.flatMap((l) => [l.left.x, l.right.x]);
  const ys = renderLinks.flatMap((l) => [l.left.y, l.right.y]);
  const labelOffset = Math.max(IFACE_LABEL_OFFSET, NETWORK_LABEL_OFFSET);
  const TEXT_HALF_WIDTH = 36; // half width of a long iface label, slack inclusive
  const padY = labelOffset + LABEL_FONT_SIZE + 4;
  const padX = labelOffset + TEXT_HALF_WIDTH + LED_OUTER_R;
  const minX = Math.min(...xs) - padX;
  const maxX = Math.max(...xs) + padX;
  const minY = Math.min(...ys) - padY;
  const maxY = Math.max(...ys) + padY;
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
          const midY = (l.left.y + l.right.y) / 2;
          // Single perpendicular unit vector per cable drives both labels.
          // CIDR label takes the perpendicular "below" side; iface labels
          // take its negation ("above" side). For horizontal cables the
          // unit vector is (0, 1), reducing to a pure vertical offset that
          // matches the previous behavior. For diagonals (Lab 09 SW1↔PC-A,
          // SW1↔PC-B) the offsets rotate with the cable so neither label
          // renders on top of the line.
          const perp = perpUnitBelow(l.left, l.right);
          const perpDx = -perp.nx * IFACE_LABEL_OFFSET;
          const perpDy = -perp.ny * IFACE_LABEL_OFFSET;
          const cidrDx = perp.nx * NETWORK_LABEL_OFFSET;
          const cidrDy = perp.ny * NETWORK_LABEL_OFFSET;
          // Iface labels render at IFACE_LABEL_T along the cable toward the
          // far end (with the mirror end at 1 - t). This pulls each name
          // inward from its LED so the text clears the device card it would
          // otherwise overlap — three-label layout reads iface @ 0.22, CIDR
          // @ 0.5, iface @ 0.78. The LED itself stays at the endpoint.
          const leftLabel = {
            x: l.left.x + (l.right.x - l.left.x) * IFACE_LABEL_T + perpDx,
            y: l.left.y + (l.right.y - l.left.y) * IFACE_LABEL_T + perpDy,
          };
          const rightLabel = {
            x: l.right.x + (l.left.x - l.right.x) * IFACE_LABEL_T + perpDx,
            y: l.right.y + (l.left.y - l.right.y) * IFACE_LABEL_T + perpDy,
          };
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
              <PortLed
                endpoint={l.left}
                linkUp={l.linkUp}
                fill={fill}
                ox={minX}
                oy={minY}
                labelX={leftLabel.x - minX}
                labelY={leftLabel.y - minY}
              />
              <PortLed
                endpoint={l.right}
                linkUp={l.linkUp}
                fill={fill}
                ox={minX}
                oy={minY}
                labelX={rightLabel.x - minX}
                labelY={rightLabel.y - minY}
              />
              {l.network ? (
                <text
                  x={midX - minX + cidrDx}
                  y={midY - minY + cidrDy}
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
 *  derived from the link's overall state by the caller. The label is rendered
 *  at the explicit (`labelX`, `labelY`) anchor (already offset along the
 *  cable + perpendicular by the caller). Text anchor is 'middle' so the
 *  iface name reads consistently across every cable angle. */
function PortLed({
  endpoint,
  linkUp,
  fill,
  ox,
  oy,
  labelX,
  labelY,
}: {
  readonly endpoint: RenderEndpoint;
  readonly linkUp: boolean;
  readonly fill: string;
  readonly ox: number;
  readonly oy: number;
  readonly labelX: number;
  readonly labelY: number;
}) {
  const cx = endpoint.x - ox;
  const cy = endpoint.y - oy;
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
        textAnchor="middle"
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
        onClick={() => fitView({ maxZoom: 1, duration: 200, padding: 0.16 })}
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

/**
 * Initial-fit + auto-refit on canvas resize. Mounted alongside ReactFlow so
 * it can use useReactFlow(); observes the SHARED canvas container and sets
 * the viewport on first measurement AND whenever its size changes (Layout's
 * divider drag, window resize, etc.).
 *
 * Custom-fit (not React Flow's built-in fitView) for one reason: when the
 * canvas is narrower than the content at MIN_ZOOM (e.g. the ~520px embed
 * iframe with the 4-device tshoot lab), fitView clamps zoom AND centers,
 * which clips equal amounts off the LEFT and RIGHT — the cold-student
 * audit caught PC-A's left half disappearing into the panel border with
 * no scroll-affordance. The custom fit biases the LEFTMOST node into view
 * in that overflow case (panOnDrag rescues the right overflow). When the
 * canvas IS wide enough to fit everything, the row is centered with a
 * comfortable padding — same visual result as fitView at desktop widths.
 *
 * Bounded zoom — clamped to [MIN_ZOOM, 1] — so we can never reproduce the
 * historical multi-node crush.
 */
function CanvasAutoFit({
  containerRef,
  contentWidth,
  contentHeight,
}: {
  readonly containerRef: React.RefObject<HTMLDivElement>;
  readonly contentWidth: number;
  readonly contentHeight: number;
}) {
  const { setViewport } = useReactFlow();
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function fit() {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cw = rect.width;
      const ch = rect.height;
      if (!cw || !ch) return;

      // 8% padding on each side keeps the leftmost/rightmost end nodes (and
      // their labels) clear of the canvas edges with visible margin, while
      // still letting the 4-node row use most of a desktop band. (Was 5% — too
      // tight, left end nodes hugging the edge at laptop widths.)
      const padX = Math.max(ROW_INSET_X, cw * 0.08);
      const padY = Math.max(8, ch * 0.08);
      const availW = Math.max(1, cw - 2 * padX);
      const availH = Math.max(1, ch - 2 * padY);

      const zX = availW / contentWidth;
      const zY = availH / contentHeight;
      const zoom = Math.min(1, Math.max(MIN_ZOOM, Math.min(zX, zY)));

      const scaledW = contentWidth * zoom;
      const scaledH = contentHeight * zoom;
      // If content fits, center it. If it overflows (canvas too narrow even
      // at MIN_ZOOM), anchor the leftmost node at the padding inset and let
      // panOnDrag handle the right overflow — PC-A clipped on the left is
      // jarring and breaks the diagnostic mental model.
      const fitsHorizontally = scaledW <= cw - 2 * padX;
      const x = fitsHorizontally ? (cw - scaledW) / 2 : padX;
      const y = (ch - scaledH) / 2;

      setViewport({ x, y, zoom });
    }

    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, contentWidth, contentHeight, setViewport]);
  return null;
}

export function TopologyPanel({
  devices,
  activeDeviceId,
  onSelectDevice,
  links,
  positions,
  zoomOnScroll = true,
}: TopologyPanelProps) {
  const handleSelect = useMemo(
    () => (id: string) => onSelectDevice?.(id),
    [onSelectDevice],
  );

  // Single source of truth for per-device canvas-space positions. layoutNodes
  // and EdgeOverlay both read these — keeps the cable geometry and the node
  // placement in lockstep.
  const positionMap = useMemo(
    () => computePositions(devices, positions),
    [devices, positions],
  );

  const nodes = useMemo(
    () => layoutNodes(devices, links ?? [], positionMap, activeDeviceId, handleSelect),
    [devices, links, positionMap, activeDeviceId, handleSelect],
  );

  // Edges are drawn as an overlay SVG (see EdgeOverlay) inside the React Flow
  // viewport — straight lines between authored device endpoints. React Flow's
  // built-in edge system in v12 requires handle measurement that depends on
  // node-internals state we don't drive; overlay SVG sidesteps that without
  // sacrificing the visible link.
  const positionedDevices = useMemo(
    () =>
      devices.map((d) => {
        const p = positionMap.get(d.id) ?? { x: 0, y: 0 };
        return { id: d.id, x: p.x, y: p.y };
      }),
    [devices, positionMap],
  );

  // Bounding box of the layout — for CanvasAutoFit's zoom-to-fit calculation.
  // For the default linear row this collapses to the original (rowWidth,
  // NODE_HEIGHT); for T-shapes / hub-spokes (Lab 09) it captures both axes.
  const { contentWidth, contentHeight } = useMemo(() => {
    if (devices.length === 0) {
      return { contentWidth: NODE_WIDTH, contentHeight: NODE_HEIGHT };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const d of devices) {
      const p = positionMap.get(d.id) ?? { x: 0, y: 0 };
      if (p.x < minX) minX = p.x;
      if (p.x + NODE_WIDTH > maxX) maxX = p.x + NODE_WIDTH;
      if (p.y < minY) minY = p.y;
      if (p.y + NODE_HEIGHT > maxY) maxY = p.y + NODE_HEIGHT;
    }
    return {
      contentWidth: Math.max(1, maxX - minX),
      contentHeight: Math.max(1, maxY - minY),
    };
  }, [devices, positionMap]);

  // Ref handed to CanvasAutoFit — observing this element catches both
  // viewport resizes AND the Layout divider drag (which changes the parent
  // band's height, which changes our h-full container).
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  return (
    <ReactFlowProvider>
      {/* Outer band is h-full so Layout's state-driven topologyHeight is
          the source of truth (was a fixed CANVAS_HEIGHT pre-A1.8).
          `overflow-visible` is explicit so this wrapper never clips the
          ReactFlow surface — React Flow manages its own viewport clipping
          via the inner `.react-flow` element, and any outer overflow:hidden
          would crop content (e.g. edge-anchored port LEDs that hang half
          outside the card frame) when zoomed in. */}
      <div className="h-full w-full overflow-visible bg-panel-bg">
        {/* The wrapper has `relative` so CanvasControls absolute-positions
            against the canvas edge. `w-full` lets it fill the full topology
            band — the node row is centered by CanvasAutoFit's viewport
            translate rather than by capping the wrapper width.
            `overflow-visible` mirrors the outer band's rule — see comment
            there. React Flow's own viewport is the only thing that clips. */}
        <div
          ref={canvasWrapperRef}
          className="relative h-full w-full overflow-visible"
        >
          <ReactFlow
            nodes={nodes}
            edges={[]}
            nodeTypes={NODE_TYPES}
            // Initial viewport is set by CanvasAutoFit (below) on first paint
            // — that controller measures the actual canvas and computes a
            // zoom + translate that keeps every node within the visible area.
            // We pass a sane fallback here so React Flow renders something
            // sensible before the effect runs (one frame).
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
          <CanvasAutoFit
            containerRef={canvasWrapperRef}
            contentWidth={contentWidth}
            contentHeight={contentHeight}
          />
        </div>
      </div>
    </ReactFlowProvider>
  );
}

const NODE_TYPES = { device: DeviceNode };

function DeviceNode({ data }: NodeProps<Node<DeviceNodeData>>) {
  const { view, active, onClick, portEdges } = data;
  // A PC's IP is part of its identity in the topology — students shouldn't
  // need to run `ipconfig` just to see what address their own machine has,
  // any more than they should `show ip int brief` to learn a router LAN
  // address that's already drawn on a link label. Single NIC by contract
  // (pcAdapter.toTopologyView only emits one interface).
  const pcIp = view.kind === 'pc' ? view.interfaces[0]?.ip ?? null : null;
  const leftPorts = view.interfaces.filter((i) => portEdges.get(i.id) === 'left');
  const rightPorts = view.interfaces.filter((i) => portEdges.get(i.id) === 'right');
  const topPorts = view.interfaces.filter((i) => portEdges.get(i.id) === 'top');
  const bottomEdgePorts = view.interfaces.filter((i) => portEdges.get(i.id) === 'bottom');
  // No portEdges entry → port is unconnected; rendered as a stacked
  // PortIndicator in the card's bottom row (the free-lab fallback).
  const unconnectedPorts = view.interfaces.filter((i) => !portEdges.has(i.id));
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
        style={{ background: 'transparent', border: 'none', opacity: 0, pointerEvents: 'none' }}
      />
      <Handle
        id="left-t"
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={{ background: 'transparent', border: 'none', opacity: 0, pointerEvents: 'none' }}
      />
      <Handle
        id="right"
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ background: 'transparent', border: 'none', opacity: 0, pointerEvents: 'none' }}
      />
      <Handle
        id="right-t"
        type="target"
        position={Position.Right}
        isConnectable={false}
        style={{ background: 'transparent', border: 'none', opacity: 0, pointerEvents: 'none' }}
      />
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={`Console for ${view.hostname}`}
        style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
        className={`group relative flex flex-col justify-between gap-2 rounded-md border bg-gradient-to-b from-[#1b2531] to-[#0e141b] px-3 py-2.5 text-left transition-colors ${
          active
            ? 'border-terminal-prompt shadow-[0_0_0_1px_rgba(94,234,212,0.25),inset_0_1px_0_rgba(255,255,255,0.06)]'
            : 'border-panel-border hover:border-terminal-dim/70'
        }`}
      >
        <div className="flex flex-col items-center gap-0.5">
          <DeviceIcon type={view.deviceClass ?? view.platform} size={40} color={active ? '#e2e8f0' : '#94a3b8'} />
          <span className="font-sans text-sm font-semibold tracking-tight text-terminal-fg">
            {view.hostname}
          </span>
          {pcIp ? (
            <span
              className="font-mono text-[10px] leading-none text-terminal-fg/80"
              data-pc-ip={pcIp}
            >
              {pcIp}
            </span>
          ) : null}
        </div>
        <span className="pointer-events-none absolute right-2 top-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[#9ca3af]">
          {view.platform}
        </span>

        {unconnectedPorts.length > 0 ? (
          <div className="flex items-end justify-center gap-1.5">
            {unconnectedPorts.map((i) => (
              <PortIndicator key={i.id} deviceId={view.id} iface={i} />
            ))}
          </div>
        ) : null}

        {leftPorts.length > 0 ? (
          <div
            className="pointer-events-none absolute left-0 top-1/2 flex -translate-y-1/2 flex-col gap-2"
            data-port-edge="left"
          >
            {leftPorts.map((i) => (
              <EdgePortDot key={i.id} deviceId={view.id} iface={i} position="left" />
            ))}
          </div>
        ) : null}
        {rightPorts.length > 0 ? (
          <div
            className="pointer-events-none absolute right-0 top-1/2 flex -translate-y-1/2 flex-col items-end gap-2"
            data-port-edge="right"
          >
            {rightPorts.map((i) => (
              <EdgePortDot key={i.id} deviceId={view.id} iface={i} position="right" />
            ))}
          </div>
        ) : null}
        {topPorts.length > 0 ? (
          <div
            className="pointer-events-none absolute top-0 left-1/2 flex -translate-x-1/2 flex-row gap-2"
            data-port-edge="top"
          >
            {topPorts.map((i) => (
              <EdgePortDot key={i.id} deviceId={view.id} iface={i} position="top" />
            ))}
          </div>
        ) : null}
        {bottomEdgePorts.length > 0 ? (
          <div
            className="pointer-events-none absolute bottom-0 left-1/2 flex -translate-x-1/2 flex-row gap-2"
            data-port-edge="bottom"
          >
            {bottomEdgePorts.map((i) => (
              <EdgePortDot key={i.id} deviceId={view.id} iface={i} position="bottom" />
            ))}
          </div>
        ) : null}
      </button>
    </div>
  );
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
  // Same red as admin-down so the LED check `status === 'up'` (link cable
  // color) naturally renders red on a peer-down end too — line protocol
  // being down is functionally as dead as the interface being shut.
  'protocol-down': {
    dot: 'bg-terminal-error/80 shadow-[0_0_5px_rgba(248,113,113,0.55)]',
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
  'protocol-down': 'line protocol down (peer is administratively down)',
  'admin-down': 'administratively down',
};

function PortIndicator({
  deviceId,
  iface,
}: {
  deviceId: string;
  iface: InterfaceTopologyView;
}) {
  const style = STATUS_STYLE[iface.status];
  return (
    <div
      className="flex flex-col items-center gap-1"
      title={`${iface.name} — ${STATUS_LABEL[iface.status]}`}
      data-port-key={`${deviceId}:${iface.id}`}
      data-port-position="bottom"
    >
      <span className={`block h-2.5 w-2.5 rounded-sm ${style.dot}`} aria-hidden />
      <span className={`font-mono text-[9px] leading-none ${style.label}`}>{iface.id}</span>
    </div>
  );
}

/** Structural anchor for a linked port on the card's left/right edge. The
 *  iface name lives on the cable in EdgeOverlay — repeating it on the card
 *  edge collides with the platform badge at the top-right and adds visual
 *  noise. The span remains so positioning tests (data-port-key /
 *  data-port-position) and any future edge-anchored affordance still have a
 *  hook, but it intentionally renders no visible content. */
function EdgePortDot({
  deviceId,
  iface,
  position,
}: {
  deviceId: string;
  iface: InterfaceTopologyView;
  position: 'left' | 'right' | 'top' | 'bottom';
}) {
  return (
    <span
      className="block h-0 w-0"
      title={`${iface.name} — ${STATUS_LABEL[iface.status]}`}
      data-port-key={`${deviceId}:${iface.id}`}
      data-port-position={position}
      aria-hidden
    />
  );
}
