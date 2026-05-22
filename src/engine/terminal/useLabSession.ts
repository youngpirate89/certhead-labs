import { useCallback, useMemo, useRef, useState } from 'react';
import { useTerminal, type ExecResult, type OutputLine, type UseTerminal } from './useTerminal';
import { applyCommand, contextHelp } from '@/engine/adapters/ios/interpret';
import { createSession, buildDevice, prompt, type Session } from '@/engine/adapters/ios/state';
import { grade, type ObjectiveStatus } from '@/engine/grading';
import type { Lab } from '@/engine/types';

export interface UseLabSession extends UseTerminal {
  objectives: ObjectiveStatus[];
  allMet: boolean;
  /** Number of successfully executed commands so far (for engagement signals). */
  commandCount: number;
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

  const term = useTerminal({
    execute,
    help,
    prompt: prompt(session),
    banner: [
      { kind: 'system', text: `${lab.title} — ${lab.exam}` },
      { kind: 'system', text: 'Type commands as you would on a real router. Abbreviations work. Press ? for help.' },
      { kind: 'system', text: '' },
    ],
  });

  const { objectives, allMet } = useMemo(() => grade(lab, session), [lab, session]);

  return { ...term, objectives, allMet, commandCount: session.history.length };
}
