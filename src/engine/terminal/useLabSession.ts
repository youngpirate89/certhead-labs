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

  const term = useTerminal({
    execute,
    help,
    complete,
    prompt: prompt(session),
    banner: [
      { kind: 'system', text: `${lab.title} — ${lab.exam}` },
      { kind: 'system', text: 'Type commands as you would on a real router. Abbreviations work. Press ? for help.' },
      { kind: 'system', text: '' },
    ],
  });

  const { objectives, allMet } = useMemo(() => grade(lab, session), [lab, session]);

  // The lab's first device is active from mount — terminal is usable
  // immediately without a click. setActiveDevice is wired for the multi-device
  // future even though the single-device path doesn't exercise it yet.
  const [activeDeviceId, setActiveDevice] = useState<string>(lab.topology.devices[0].id);
  const devices = useMemo(() => [toTopologyView(session.device)], [session.device]);

  return {
    ...term,
    objectives,
    allMet,
    commandCount: session.history.length,
    devices,
    activeDeviceId,
    setActiveDevice,
  };
}
