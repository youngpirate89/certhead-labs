/**
 * TopologyPanel — single-device SVG render for now.
 *
 * Per CLAUDE.md: SVG for single-device topologies; React Flow / Konva gets
 * introduced only when the first multi-device lab (OSPF, Weekend 9-10) is
 * built. This is the foundation placeholder showing a single device node.
 */
interface TopologyPanelProps {
  deviceLabel: string;
}

export function TopologyPanel({ deviceLabel }: TopologyPanelProps) {
  return (
    <div className="flex h-full items-center justify-center bg-panel-bg p-6">
      <svg viewBox="0 0 200 160" className="h-full max-h-48 w-auto" role="img" aria-label={`Topology: ${deviceLabel}`}>
        <defs>
          <linearGradient id="device" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1b2531" />
            <stop offset="100%" stopColor="#11171f" />
          </linearGradient>
        </defs>
        <rect x="40" y="50" width="120" height="60" rx="8" fill="url(#device)" stroke="#2b3a4a" strokeWidth="1.5" />
        <circle cx="64" cy="80" r="4" fill="#5eead4" />
        <circle cx="84" cy="80" r="4" fill="#38bdf8" />
        <circle cx="104" cy="80" r="4" fill="#5a6675" />
        <text x="100" y="132" textAnchor="middle" fill="#d7dee8" fontSize="14" fontFamily="'Space Grotesk', sans-serif" fontWeight="600">
          {deviceLabel}
        </text>
      </svg>
    </div>
  );
}
