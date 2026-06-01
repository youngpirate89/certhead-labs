import { useCallback, useMemo, useRef, useState } from 'react';
import { useTerminal, type ExecResult, type OutputLine, type UseTerminal } from './useTerminal';
import { routerAdapter } from '@/engine/adapters/router';
import { pcAdapter } from '@/engine/adapters/pc';
import { switchAdapter } from '@/engine/adapters/switch';
import {
  initLabSession,
  applyToDevice,
  setActive,
  closeDevice,
  closeAllDevices,
  updatePcNetwork,
  promptFor,
  type PcNetworkConfig,
  type LabSession,
  type DeviceSession,
} from '@/engine/lab-session';
import { grade, type ObjectiveStatus } from '@/engine/grading';
import type { CommandOutput, DeviceTopologyView } from '@/engine/adapters/types';
import type { Lab, LabDevice } from '@/engine/types';

export interface UseLabSession extends UseTerminal {
  objectives: ObjectiveStatus[];
  allMet: boolean;
  /** Number of successfully executed commands so far (for engagement signals). */
  commandCount: number;
  /** Device-topology views — one per device, derived from live session state. */
  devices: DeviceTopologyView[];
  /** Id of the device the terminal currently targets. */
  activeDeviceId: string;
  /** Ordered list of devices the learner has opened — drives the floating
   *  panels (one panel per id). Always non-empty; the initial device is
   *  seeded. */
  openDeviceIds: readonly string[];
  /** Open/focus a device's CLI. Adds to openDeviceIds if not present and
   *  sets it active. */
  setActiveDevice: (id: string) => void;
  deviceKind: (id: string) => DeviceSession['kind'] | undefined;
  pcNetwork: (id: string) => PcNetworkConfig | undefined;
  updatePcNetwork: (id: string, config: PcNetworkConfig) => void;
  /** Close a single tab in the shared terminal panel. If closing the active
   *  id, the neighbor on the left becomes active. Closing the last open
   *  tab empties openDeviceIds and the panel hides until a topology click
   *  re-opens it. */
  closeDevice: (id: string) => void;
  /** Close every open tab — empties openDeviceIds and hides the panel. */
  closeAllDevices: () => void;
  /** Restart the lab from a fresh device state. */
  reset: () => void;
  /** Monotonic ID that changes on every reset. */
  resetToken: number;
}

/** Short, IOS-flavored boot output for routers. */
function routerBootBanner(platform: string): OutputLine[] {
  return [
    { kind: 'system', text: 'Cisco IOS XE Software, Version 16.12.04' },
    { kind: 'system', text: 'Copyright (c) 1986-2020 by Cisco Systems, Inc.' },
    { kind: 'system', text: '' },
    { kind: 'system', text: `${platform} (revision 1.0) with 4194304K bytes of memory.` },
    { kind: 'system', text: '' },
    { kind: 'system', text: 'Tab completes unique prefixes; ? shows context help.' },
    { kind: 'system', text: '' },
  ];
}

/** PCs get a one-line shell-style header — no IOS boot. */
function pcBootBanner(hostname: string): OutputLine[] {
  return [
    { kind: 'system', text: `${hostname} — workstation. Try \`ipconfig\` or \`ping <ip>\`.` },
    { kind: 'system', text: '' },
  ];
}

function bannerForDevice(d: LabDevice): OutputLine[] {
  switch (d.kind) {
    case 'router':
    case 'switch':
      return routerBootBanner(d.platform);
    case 'pc':
      return pcBootBanner(d.id);
  }
}

/** Map of every device id → its boot banner. */
function bannersForLab(lab: Lab): Record<string, OutputLine[]> {
  const banners: Record<string, OutputLine[]> = {};
  for (const d of lab.topology.devices) banners[d.id] = bannerForDevice(d);
  return banners;
}

/** Adapt the adapter's stream of {kind,text} into the terminal's OutputLine
 *  shape. The two types are structurally identical today (same `kind` union,
 *  same `text` field) but keep the conversion explicit so a future divergence
 *  surfaces here, not as a silent miscast. */
async function* mapStream(
  stream: AsyncIterable<CommandOutput>,
): AsyncIterable<OutputLine> {
  for await (const o of stream) {
    yield { kind: o.kind, text: o.text };
  }
}

/** Build the topology view for one device through its adapter. */
function viewFor(s: DeviceSession): DeviceTopologyView {
  switch (s.kind) {
    case 'router':
      return routerAdapter.toTopologyView(s);
    case 'pc':
      return pcAdapter.toTopologyView(s);
    case 'switch':
      return switchAdapter.toTopologyView(s);
  }
}

/** Dispatch context-help to a specific device's adapter. */
function helpFor(s: DeviceSession, partial: string): CommandOutput[] {
  switch (s.kind) {
    case 'router':
      return routerAdapter.contextHelp(s, partial);
    case 'pc':
      return pcAdapter.contextHelp(s, partial);
    case 'switch':
      return switchAdapter.contextHelp(s, partial);
  }
}

/** Dispatch tab-completion to a specific device's adapter. */
function completeFor(s: DeviceSession, partial: string): string | null {
  switch (s.kind) {
    case 'router':
      return routerAdapter.tabComplete(s, partial);
    case 'pc':
      return pcAdapter.tabComplete(s, partial);
    case 'switch':
      return switchAdapter.tabComplete(s, partial);
  }
}

/**
 * Runs a lab: owns the multi-device LabSession, drives the terminal against
 * each open device, and grades objectives live after every command.
 */
export function useLabSession(lab: Lab): UseLabSession {
  const [labSession, setLabSession] = useState<LabSession>(() => initLabSession(lab));

  const labRef = useRef(labSession);
  labRef.current = labSession;

  const execute = useCallback((deviceId: string, raw: string): ExecResult => {
    const { session: next, output, stream } = applyToDevice(labRef.current, deviceId, raw);
    setLabSession(next);
    return {
      lines: output.map((o) => ({ kind: o.kind, text: o.text })),
      stream: stream ? mapStream(stream) : undefined,
    };
  }, []);

  const help = useCallback((deviceId: string, partialLine: string): OutputLine[] => {
    const s = labRef.current.devices[deviceId];
    if (!s) return [];
    return helpFor(s, partialLine).map((o) => ({ kind: o.kind, text: o.text }));
  }, []);

  const complete = useCallback((deviceId: string, partialLine: string): string | null => {
    const s = labRef.current.devices[deviceId];
    if (!s) return null;
    return completeFor(s, partialLine);
  }, []);

  const bannersByDeviceId = useMemo(() => bannersForLab(lab), [lab]);

  // Per-device prompts — recomputed every session change so floating panels
  // pick up mode transitions (enable → priv, configure terminal → config, etc.)
  // independently of which device is "active" for the legacy single-CLI path.
  const promptsByDeviceId = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [id, s] of Object.entries(labSession.devices)) {
      out[id] = promptFor(s);
    }
    return out;
  }, [labSession]);

  const term = useTerminal({
    activeId: labSession.activeDeviceId,
    bannersByDeviceId,
    execute,
    help,
    complete,
    promptsByDeviceId,
  });

  const { objectives, allMet } = useMemo(() => grade(lab, labSession), [lab, labSession]);
  const devices = useMemo(
    () => Object.values(labSession.devices).map(viewFor),
    [labSession],
  );

  const setActiveDevice = useCallback((id: string) => {
    setLabSession((cur) => setActive(cur, id));
  }, []);

  const deviceKind = useCallback((id: string) => labRef.current.devices[id]?.kind, []);

  const pcNetwork = useCallback((id: string): PcNetworkConfig | undefined => {
    const s = labRef.current.devices[id];
    if (!s || s.kind !== 'pc') return undefined;
    return {
      mode: s.dhcpMode ? 'dhcp' : 'static',
      ip: s.ip,
      mask: s.mask,
      gateway: s.gateway,
      ipv6: s.ipv6,
      gateway6: s.gateway6,
    };
  }, []);

  const updatePcNetworkCallback = useCallback((id: string, config: PcNetworkConfig) => {
    setLabSession((cur) => updatePcNetwork(cur, id, config));
  }, []);

  const closeDeviceCallback = useCallback((id: string) => {
    setLabSession((cur) => closeDevice(cur, id));
  }, []);

  const closeAllDevicesCallback = useCallback(() => {
    setLabSession((cur) => closeAllDevices(cur));
  }, []);

  const [resetToken, setResetToken] = useState(0);
  const reset = useCallback(() => {
    setLabSession(initLabSession(lab));
    term.resetAll(bannersByDeviceId);
    setResetToken((t) => t + 1);
  }, [lab, bannersByDeviceId, term]);

  // Total commands run on any device — for engagement signals.
  const commandCount = useMemo(
    () =>
      Object.values(labSession.devices).reduce(
        (sum, s) => sum + s.history.length,
        0,
      ),
    [labSession],
  );

  return {
    ...term,
    objectives,
    allMet,
    commandCount,
    devices,
    activeDeviceId: labSession.activeDeviceId,
    openDeviceIds: labSession.openDeviceIds,
    setActiveDevice,
    deviceKind,
    pcNetwork,
    updatePcNetwork: updatePcNetworkCallback,
    closeDevice: closeDeviceCallback,
    closeAllDevices: closeAllDevicesCallback,
    reset,
    resetToken,
  };
}
