/**
 * TopologyPanel — equipment-style device renderer.
 *
 * Multi-device-ready by construction (CLAUDE.md, item 4 of the feel pass):
 * the API is `devices[] + activeDeviceId + onSelectDevice`, identical whether
 * there is 1 device or N. Single-device labs auto-select the lone device so
 * the terminal is usable immediately — no click required (this is a funnel
 * lab; no friction). Clicking switches the active console for future
 * multi-device labs.
 *
 * Generic chrome: knows "device with hostname, platform, and a list of
 * interfaces with a status" — no Cisco-specific concepts. Bash, kubectl,
 * and other adapters will derive the same view shape from their own state.
 */

// View types now live in the adapter contracts so adapters can implement them
// directly. Re-exported here so existing imports of these types from
// `@/components/TopologyPanel` continue to work.
import type {
  DeviceTopologyView,
  InterfaceTopologyView,
  InterfaceStatus,
} from '@/engine/adapters/types';
export type { DeviceTopologyView, InterfaceTopologyView, InterfaceStatus };

interface TopologyPanelProps {
  readonly devices: readonly DeviceTopologyView[];
  readonly activeDeviceId: string;
  /** Prompt string for the active device, e.g. `R1(config-if)#`. */
  readonly activePrompt?: string;
  readonly onSelectDevice?: (id: string) => void;
}

export function TopologyPanel({
  devices,
  activeDeviceId,
  activePrompt,
  onSelectDevice,
}: TopologyPanelProps) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto bg-panel-bg p-3">
      <div className="flex flex-wrap items-stretch gap-3">
        {devices.map((d) => (
          <DeviceChassis
            key={d.id}
            device={d}
            active={d.id === activeDeviceId}
            promptLabel={d.id === activeDeviceId ? activePrompt : undefined}
            onClick={() => onSelectDevice?.(d.id)}
            // Multi-device labs will eventually pass link state here too;
            // single-device labs have none, so we don't render the link area.
          />
        ))}
      </div>
    </div>
  );
}

interface DeviceChassisProps {
  readonly device: DeviceTopologyView;
  readonly active: boolean;
  readonly promptLabel?: string;
  readonly onClick: () => void;
}

function DeviceChassis({ device, active, promptLabel, onClick }: DeviceChassisProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`Console for ${device.hostname}`}
      className={`group flex min-w-[180px] flex-col gap-2 rounded-md border bg-gradient-to-b from-[#1b2531] to-[#0e141b] px-3 py-2.5 text-left transition-colors ${
        active
          ? 'border-terminal-prompt shadow-[0_0_0_1px_rgba(94,234,212,0.25),inset_0_1px_0_rgba(255,255,255,0.06)]'
          : 'border-panel-border hover:border-terminal-dim/70'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-sans text-sm font-semibold tracking-tight text-terminal-fg">
          {device.hostname}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-terminal-dim">
          {device.platform}
        </span>
      </div>

      <div className="flex items-end gap-1.5">
        {device.interfaces.map((i) => (
          <PortIndicator key={i.id} iface={i} />
        ))}
      </div>

      {promptLabel ? (
        <div className="truncate font-mono text-[11px] leading-none text-terminal-prompt">
          {promptLabel}
        </div>
      ) : (
        // Reserve the row so cards don't jitter as the active prompt updates.
        <div className="h-[11px]" aria-hidden />
      )}
    </button>
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
