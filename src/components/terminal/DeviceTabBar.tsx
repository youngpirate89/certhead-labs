import type { MouseEvent } from 'react';

interface DeviceTabBarProps {
  readonly openDeviceIds: readonly string[];
  readonly activeDeviceId: string;
  readonly onSelect: (id: string) => void;
  readonly onClose: (id: string) => void;
}

/**
 * Per-device tab bar that sits directly above the terminal. Each tab
 * corresponds to one entry in LabSession.openDeviceIds; clicking a tab swaps
 * the active console (terminal scrollback + prompt swap because useTerminal
 * is keyed by activeDeviceId). The × on a tab fires onClose for that tab.
 *
 * The × is hidden on the LAST remaining tab: closeDevice in lab-session.ts
 * refuses to remove the final tab (openDeviceIds is invariant non-empty), so
 * surfacing a no-op close affordance would lie about what's possible.
 */
export function DeviceTabBar({
  openDeviceIds,
  activeDeviceId,
  onSelect,
  onClose,
}: DeviceTabBarProps) {
  const onlyOne = openDeviceIds.length === 1;
  return (
    <div
      role="tablist"
      aria-label="Open device consoles"
      className="flex h-8 shrink-0 items-stretch border-b border-panel-border bg-[#0d1117]"
    >
      {openDeviceIds.map((id) => {
        const active = id === activeDeviceId;
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(id)}
            data-device-tab={id}
            data-active={active}
            className={`group flex cursor-pointer items-center gap-2 px-3 font-mono text-[12px] transition-colors ${
              active
                ? 'border-b-[1.5px] border-[#94a3b8] text-[#e2e8f0]'
                : 'text-[#4b5563] hover:text-[#94a3b8]'
            }`}
          >
            <span>{id}</span>
            {onlyOne ? null : (
              <button
                type="button"
                aria-label={`Close ${id} console`}
                onClick={(e: MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  onClose(id);
                }}
                className="grid h-[14px] w-[14px] place-items-center rounded text-[14px] leading-none text-current opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100 focus:opacity-100"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default DeviceTabBar;
