import { useCallback, useMemo, useRef, useState } from 'react';
import { useTerminal, type ExecResult, type OutputLine, type UseTerminal } from './useTerminal';
import { routerAdapter } from '@/engine/adapters/router';
import { pcAdapter } from '@/engine/adapters/pc';
import {
  initLabSession,
  applyToActive,
  setActive,
  activeSession,
  activePrompt,
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
  /** Switch the active console — multi-device labs use this; the canvas wires
   *  it up via TopologyPanel.onSelectDevice. */
  setActiveDevice: (id: string) => void;
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

/** Build the topology view for one device through its adapter. */
function viewFor(s: DeviceSession): DeviceTopologyView {
  switch (s.kind) {
    case 'router':
      return routerAdapter.toTopologyView(s);
    case 'pc':
      return pcAdapter.toTopologyView(s);
  }
}

/** Dispatch context-help to the active device's adapter. */
function helpFor(s: DeviceSession, partial: string): CommandOutput[] {
  switch (s.kind) {
    case 'router':
      return routerAdapter.contextHelp(s, partial);
    case 'pc':
      return pcAdapter.contextHelp(s, partial);
  }
}

/** Dispatch tab-completion to the active device's adapter. */
function completeFor(s: DeviceSession, partial: string): string | null {
  switch (s.kind) {
    case 'router':
      return routerAdapter.tabComplete(s, partial);
    case 'pc':
      return pcAdapter.tabComplete(s, partial);
  }
}

/**
 * Runs a lab: owns the multi-device LabSession, drives the terminal against
 * the active device, and grades objectives live after every command.
 */
export function useLabSession(lab: Lab): UseLabSession {
  const [labSession, setLabSession] = useState<LabSession>(() => initLabSession(lab));

  const labRef = useRef(labSession);
  labRef.current = labSession;

  const execute = useCallback((raw: string): ExecResult => {
    const { session: next, output } = applyToActive(labRef.current, raw);
    setLabSession(next);
    return { lines: output.map((o) => ({ kind: o.kind, text: o.text })) };
  }, []);

  const help = useCallback((partialLine: string): OutputLine[] => {
    return helpFor(activeSession(labRef.current), partialLine).map((o) => ({
      kind: o.kind,
      text: o.text,
    }));
  }, []);

  const complete = useCallback((partialLine: string): string | null => {
    return completeFor(activeSession(labRef.current), partialLine);
  }, []);

  const bannersByDeviceId = useMemo(() => bannersForLab(lab), [lab]);

  const term = useTerminal({
    activeId: labSession.activeDeviceId,
    bannersByDeviceId,
    execute,
    help,
    complete,
    prompt: activePrompt(labSession),
  });

  const { objectives, allMet } = useMemo(() => grade(lab, labSession), [lab, labSession]);
  const devices = useMemo(
    () => Object.values(labSession.devices).map(viewFor),
    [labSession],
  );

  const setActiveDevice = useCallback((id: string) => {
    setLabSession((cur) => setActive(cur, id));
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
    setActiveDevice,
    reset,
    resetToken,
  };
}
