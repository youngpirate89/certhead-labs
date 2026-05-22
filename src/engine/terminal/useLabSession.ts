import { useCallback, useMemo, useRef, useState } from 'react';
import { useTerminal, type ExecResult, type OutputLine, type UseTerminal } from './useTerminal';
import { contextHelp, tabComplete as iosTabComplete } from '@/engine/adapters/ios/interpret';
import { routerAdapter } from '@/engine/adapters/router';
import {
  initLabSession,
  applyToActive,
  setActive,
  activeSession,
  activePrompt,
  type LabSession,
} from '@/engine/lab-session';
import { grade, type ObjectiveStatus } from '@/engine/grading';
import type { DeviceTopologyView } from '@/engine/adapters/types';
import type { Lab } from '@/engine/types';

export interface UseLabSession extends UseTerminal {
  objectives: ObjectiveStatus[];
  allMet: boolean;
  /** Number of successfully executed commands so far (for engagement signals). */
  commandCount: number;
  /** Device-topology views — one per device, derived from live session state. */
  devices: DeviceTopologyView[];
  /** Id of the device the terminal currently targets. Defaults to the lab's
   *  first device, set immediately on mount so the terminal is usable without
   *  any click (single-device labs = zero friction). */
  activeDeviceId: string;
  /** Switch the active console — multi-device labs use this; the canvas wires
   *  it up via TopologyPanel.onSelectDevice. */
  setActiveDevice: (id: string) => void;
  /** Restart the lab from a fresh device state. Wipes every device's scrollback
   *  and re-prints each banner; objectives flip back to unmet as a result. */
  reset: () => void;
  /** Monotonic ID that changes on every reset — consumers (e.g. hint timers,
   *  completion latches) reset their own state when it changes. */
  resetToken: number;
}

/** Short, IOS-flavored boot output printed before the first prompt. Kept
 *  recognizable (IOS XE banner + copyright + chassis line) without simulating
 *  the full multi-page boot — and not gated on "Press RETURN" since the
 *  prompt is immediately interactive. */
function bootBanner(platform: string): OutputLine[] {
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

/** Map of every device id → its boot banner. Stable across renders given the
 *  same lab. */
function bannersForLab(lab: Lab): Record<string, OutputLine[]> {
  const banners: Record<string, OutputLine[]> = {};
  for (const d of lab.topology.devices) banners[d.id] = bootBanner(d.platform);
  return banners;
}

/** Compute the topology views for every device in the LabSession. */
function topologyViewsFor(lab: LabSession): DeviceTopologyView[] {
  return Object.values(lab.devices).map((s) => {
    switch (s.kind) {
      case 'router':
        return routerAdapter.toTopologyView(s);
    }
  });
}

/**
 * Runs a lab: owns the multi-device LabSession, drives the terminal against
 * the active device, and grades objectives live after every command.
 *
 * For an N=1 lab (the free lab) behavior collapses to the original single-
 * device flow. Each device's scrollback, command history, mode stack, and
 * prompt are all per-device — switching the active console swaps the visible
 * buffer + prompt and preserves every other device's state.
 */
export function useLabSession(lab: Lab): UseLabSession {
  const [labSession, setLabSession] = useState<LabSession>(() => initLabSession(lab));

  // Executor reads the latest session via a ref to avoid stale closures.
  const labRef = useRef(labSession);
  labRef.current = labSession;

  const execute = useCallback((raw: string): ExecResult => {
    const { session: next, output } = applyToActive(labRef.current, raw);
    setLabSession(next);
    return { lines: output.map((o) => ({ kind: o.kind, text: o.text })) };
  }, []);

  const help = useCallback((partialLine: string): OutputLine[] => {
    const s = activeSession(labRef.current);
    return contextHelp(s, partialLine).map((o) => ({ kind: o.kind, text: o.text }));
  }, []);

  const complete = useCallback((partialLine: string): string | null => {
    const s = activeSession(labRef.current);
    return iosTabComplete(s, partialLine);
  }, []);

  // Banners are stable for the life of this hook instance (lab doesn't change).
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
  const devices = useMemo(() => topologyViewsFor(labSession), [labSession]);

  const setActiveDevice = useCallback((id: string) => {
    setLabSession((cur) => setActive(cur, id));
  }, []);

  const [resetToken, setResetToken] = useState(0);
  const reset = useCallback(() => {
    setLabSession(initLabSession(lab));
    term.resetAll(bannersByDeviceId);
    setResetToken((t) => t + 1);
  }, [lab, bannersByDeviceId, term]);

  // commandCount = total commands across all devices (for engagement signals).
  const commandCount = useMemo(
    () =>
      Object.values(labSession.devices).reduce((sum, s) => {
        if (s.kind === 'router') return sum + s.history.length;
        return sum;
      }, 0),
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
