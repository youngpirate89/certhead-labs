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
} from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';

// View types now live in the adapter contracts so adapters can implement them
// directly. Re-exported here so existing imports of these types from
// `@/components/TopologyPanel` continue to work.
import type {
  DeviceTopologyView,
  InterfaceTopologyView,
  InterfaceStatus,
} from '@/engine/adapters/types';
import type { Link } from '@/engine/types';
export type { DeviceTopologyView, InterfaceTopologyView, InterfaceStatus };

interface TopologyPanelProps {
  readonly devices: readonly DeviceTopologyView[];
  readonly activeDeviceId: string;
  /** Prompt string for the active device, e.g. `R1(config-if)#`. */
  readonly activePrompt?: string;
  readonly onSelectDevice?: (id: string) => void;
  /** Links between device interfaces — drawn as edges in the canvas. */
  readonly links?: readonly Link[];
}

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

/**
 * EdgeOverlay — draws straight lines between authored device endpoints as an
 * SVG rendered inside ReactFlow's viewport portal. The portal inherits the
 * viewport transform, so the lines track node positions across fitView / pan /
 * zoom. Avoids React Flow v12's edge-rendering choreography (handle-bound
 * measurement) which is sensitive to externally-controlled node arrays —
 * 3b can promote this to React Flow's edge system once we've moved nodes
 * into a useNodesState/applyNodeChanges-managed store.
 */
function EdgeOverlay({
  devices,
  links,
}: {
  devices: readonly { id: string; x: number; y: number }[];
  links: readonly Link[];
}) {
  if (links.length === 0) return null;
  const byId = new Map(devices.map((d) => [d.id, d]));

  // Compute the bounding box of all endpoints so we can absolutely-position the
  // SVG inside the viewport portal at the right offset. ViewportPortal places
  // children at flow-space coordinates already; we just need the SVG itself.
  const lines = links
    .map((l) => {
      const a = byId.get(l.a.deviceId);
      const b = byId.get(l.b.deviceId);
      if (!a || !b) return null;
      const yMid = a.y + NODE_HEIGHT / 2;
      return { x1: a.x + NODE_WIDTH, y1: yMid, x2: b.x, y2: yMid };
    })
    .filter((v): v is { x1: number; y1: number; x2: number; y2: number } => v !== null);
  if (lines.length === 0) return null;

  const minX = Math.min(...lines.flatMap((l) => [l.x1, l.x2]));
  const maxX = Math.max(...lines.flatMap((l) => [l.x1, l.x2]));
  const minY = Math.min(...lines.flatMap((l) => [l.y1, l.y2])) - 1;
  const maxY = Math.max(...lines.flatMap((l) => [l.y1, l.y2])) + 1;
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
        {lines.map((l, i) => (
          <line
            key={i}
            x1={l.x1 - minX}
            y1={l.y1 - minY}
            x2={l.x2 - minX}
            y2={l.y2 - minY}
            stroke="#5a6675"
            strokeWidth={1.5}
          />
        ))}
      </svg>
    </ViewportPortal>
  );
}

export function TopologyPanel({
  devices,
  activeDeviceId,
  activePrompt,
  onSelectDevice,
  links,
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

  return (
    <div className="h-full min-h-[180px] w-full bg-panel-bg">
      <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={NODE_TYPES}
        fitView
        // Allow generous zoom-out: a 4-device row (PC + 2 routers + PC) needs
        // ~1040px in flow space; at 340px rail width that's a ~0.3 fit.
        fitViewOptions={{ padding: 0.15, minZoom: 0.3, maxZoom: 1.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        panOnDrag={devices.length > 1}
        panOnScroll={false}
        preventScrolling={false}
      >
        <Background gap={20} size={1} color="#1e2733" />
        <EdgeOverlay devices={positionedDevices} links={links ?? []} />
      </ReactFlow>
      </ReactFlowProvider>
    </div>
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
