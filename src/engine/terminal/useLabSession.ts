import { useCallback, useMemo, useRef, useState } from 'react';
import { useTerminal, type ExecResult, type OutputLine, type UseTerminal } from './useTerminal';
import { applyCommand, contextHelp, tabComplete as iosTabComplete } from '@/engine/adapters/ios/interpret';
import {
  createSession,
  buildDevice,
  prompt,
  type DeviceState,
  type Session,
} from '@/engine/adapters/ios/state';
import { grade, type ObjectiveStatus } from '@/engine/grading';
import type { DeviceTopologyView } from '@/components/TopologyPanel';
import type { Lab } from '@/engine/types';

export interface UseLabSession extends UseTerminal {
  objectives: ObjectiveStatus[];
  allMet: boolean;
  /** Number of successfully executed commands so far (for engagement signals). */
  commandCount: number;
  /** Device-topology view derived from live session state — drives TopologyPanel. */
  devices: DeviceTopologyView[];
  /** Id of the device the terminal currently targets. Defaults to the lab's
   *  first device, set immediately on mount so the terminal is usable without
   *  any click (single-device labs = zero friction). */
  activeDeviceId: string;
  /** Switch the active console — used by multi-device labs. */
  setActiveDevice: (id: string) => void;
  /** Restart the lab from a fresh device state. Wipes terminal lines and
   *  re-prints the boot banner; objectives flip back to unmet as a result. */
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

/** Derive the exam-agnostic topology view from live IOS device state. */
function toTopologyView(d: DeviceState): DeviceTopologyView {
  return {
    id: d.id,
    hostname: d.hostname,
    platform: d.platform,
    interfaces: Object.values(d.interfaces).map((i) => ({
      id: i.id,
      name: i.name,
      status: !i.adminUp ? 'admin-down' : i.ip ? 'up' : 'no-ip',
    })),
  };
}

/**
 * Runs a single IOS lab: owns the device session, drives the terminal via the
 * engine interpreter, and grades objectives live after every command.
 */
export function useLabSession(lab: Lab): UseLabSession {
  const [session, setSession] = useState<Session>(() =>
    createSession(buildDevice(lab.topology.devices[0])),
  );

  // Executor reads the latest session via a ref to avoid stale closures.
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const execute = useCallback((raw: string): ExecResult => {
    const { session: next, output } = applyCommand(sessionRef.current, raw);
    setSession(next);
    return { lines: output.map((o) => ({ kind: o.kind, text: o.text })) };
  }, []);

  const help = useCallback(
    (partialLine: string): OutputLine[] =>
      contextHelp(sessionRef.current, partialLine).map((o) => ({ kind: o.kind, text: o.text })),
    [],
  );

  const complete = useCallback(
    (partialLine: string): string | null => iosTabComplete(sessionRef.current, partialLine),
    [],
  );

  const initialDevice = lab.topology.devices[0];
  const term = useTerminal({
    execute,
    help,
    complete,
    prompt: prompt(session),
    banner: bootBanner(initialDevice.platform),
  });

  const { objectives, allMet } = useMemo(() => grade(lab, session), [lab, session]);

  // The lab's first device is active from mount — terminal is usable
  // immediately without a click. setActiveDevice is wired for the multi-device
  // future even though the single-device path doesn't exercise it yet.
  const [activeDeviceId, setActiveDevice] = useState<string>(lab.topology.devices[0].id);
  const devices = useMemo(() => [toTopologyView(session.device)], [session.device]);

  const [resetToken, setResetToken] = useState(0);
  const reset = useCallback(() => {
    setSession(createSession(buildDevice(initialDevice)));
    setActiveDevice(initialDevice.id);
    term.clear();
    term.print(bootBanner(initialDevice.platform));
    setResetToken((t) => t + 1);
  }, [initialDevice, term]);

  return {
    ...term,
    objectives,
    allMet,
    commandCount: session.history.length,
    devices,
    activeDeviceId,
    setActiveDevice,
    reset,
    resetToken,
  };
}
