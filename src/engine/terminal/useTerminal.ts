import { useCallback, useEffect, useReducer, useRef } from 'react';

/**
 * Multi-device terminal primitive (presentation layer).
 *
 * Holds one terminal slice per device — scrollback, input buffer, and command
 * history are all per-device. The hook exposes the slice of whichever device
 * is currently active; switching the active id swaps the visible buffer +
 * prompt without losing any device's scrollback or history. For an N=1 lab
 * (the free lab) this collapses to a single slice and behaves exactly like
 * the previous single-device hook.
 *
 * It is intentionally decoupled from the parser: the caller supplies an
 * {@link Executor} that turns a raw line into output. The terminal does not
 * know about IOS, bash, or grading.
 */

export type LineKind = 'input' | 'output' | 'error' | 'system';

export interface TerminalLine {
  readonly id: number;
  readonly kind: LineKind;
  readonly text: string;
  /** The prompt shown before an input line (e.g. `R1#`). Input lines only. */
  readonly prompt?: string;
}

export interface OutputLine {
  readonly kind: Exclude<LineKind, 'input'>;
  readonly text: string;
}

export interface ExecResult {
  /** Lines to print in response to the command. */
  readonly lines: OutputLine[];
  /** When true, the screen is cleared instead of printing `lines`. */
  readonly clear?: boolean;
  /** Optional async tail — lines arrive one at a time after `lines`. While
   *  draining, the slice is marked busy and Terminal.tsx disables input.
   *  See pcAdapter.handleTracert for the only current producer. */
  readonly stream?: AsyncIterable<OutputLine>;
}

export type Executor = (raw: string) => ExecResult;

/** One device's terminal state. */
interface DeviceTerminalState {
  lines: TerminalLine[];
  input: string;
  /** Submitted commands, newest last. Drives up/down recall. */
  commandHistory: string[];
  /** Cursor into commandHistory; null means "editing a fresh line". */
  historyIndex: number | null;
  nextId: number;
  /** True while a streamed command is still emitting lines. The input is
   *  disabled, Enter/Tab/? are swallowed. Flips back to false on stream end. */
  busy: boolean;
}

/** State is keyed by device id — one slice per device. */
type State = Readonly<Record<string, DeviceTerminalState>>;

type Action =
  | { type: 'setInput'; id: string; value: string }
  | { type: 'submit'; id: string; prompt: string; result: ExecResult }
  | { type: 'recallPrev'; id: string }
  | { type: 'recallNext'; id: string }
  | { type: 'print'; id: string; lines: OutputLine[] }
  | { type: 'inlineHelp'; id: string; prompt: string; raw: string; lines: OutputLine[] }
  | { type: 'clear'; id: string }
  | { type: 'setBusy'; id: string; busy: boolean }
  /** Bulk-reset every device's slice — used on lab reset. */
  | { type: 'resetAll'; bannersByDeviceId: Record<string, OutputLine[]> };

function initSlice(banner: OutputLine[]): DeviceTerminalState {
  return {
    lines: banner.map((l, i) => ({ id: i, kind: l.kind, text: l.text })),
    input: '',
    commandHistory: [],
    historyIndex: null,
    nextId: banner.length,
    busy: false,
  };
}

function reduceSlice(slice: DeviceTerminalState, action: Action): DeviceTerminalState {
  switch (action.type) {
    case 'setInput':
      return { ...slice, input: action.value, historyIndex: null };

    case 'submit': {
      const submitted = slice.input.trim();
      const echo: TerminalLine = {
        id: slice.nextId,
        kind: 'input',
        text: slice.input,
        prompt: action.prompt,
      };

      if (action.result.clear) {
        return {
          ...slice,
          lines: [],
          input: '',
          historyIndex: null,
          commandHistory: submitted
            ? [...slice.commandHistory, submitted]
            : slice.commandHistory,
          nextId: slice.nextId + 1,
        };
      }

      const output = action.result.lines.map((l, i) => ({
        id: slice.nextId + 1 + i,
        kind: l.kind,
        text: l.text,
      }));
      return {
        ...slice,
        lines: [...slice.lines, echo, ...output],
        input: '',
        historyIndex: null,
        commandHistory: submitted
          ? [...slice.commandHistory, submitted]
          : slice.commandHistory,
        nextId: slice.nextId + 1 + output.length,
      };
    }

    case 'recallPrev': {
      if (slice.commandHistory.length === 0) return slice;
      const idx =
        slice.historyIndex === null
          ? slice.commandHistory.length - 1
          : Math.max(0, slice.historyIndex - 1);
      return { ...slice, historyIndex: idx, input: slice.commandHistory[idx] };
    }

    case 'recallNext': {
      if (slice.historyIndex === null) return slice;
      const next = slice.historyIndex + 1;
      if (next >= slice.commandHistory.length) {
        return { ...slice, historyIndex: null, input: '' };
      }
      return { ...slice, historyIndex: next, input: slice.commandHistory[next] };
    }

    case 'print': {
      const output = action.lines.map((l, i) => ({
        id: slice.nextId + i,
        kind: l.kind,
        text: l.text,
      }));
      return {
        ...slice,
        lines: [...slice.lines, ...output],
        nextId: slice.nextId + output.length,
      };
    }

    case 'inlineHelp': {
      // Echo the in-progress line with the `?` appended, print help below it,
      // and PRESERVE the input buffer. Matches IOS: `?` is interactive
      // feedback, not a submitted command.
      const echo: TerminalLine = {
        id: slice.nextId,
        kind: 'input',
        text: `${action.raw}?`,
        prompt: action.prompt,
      };
      const output = action.lines.map((l, i) => ({
        id: slice.nextId + 1 + i,
        kind: l.kind,
        text: l.text,
      }));
      return {
        ...slice,
        lines: [...slice.lines, echo, ...output],
        nextId: slice.nextId + 1 + output.length,
      };
    }

    case 'clear':
      return { ...slice, lines: [] };

    case 'setBusy':
      return slice.busy === action.busy ? slice : { ...slice, busy: action.busy };

    case 'resetAll':
      // Handled at the top level, not per-slice.
      return slice;
  }
}

function reducer(state: State, action: Action): State {
  if (action.type === 'resetAll') {
    const next: Record<string, DeviceTerminalState> = {};
    for (const [id, banner] of Object.entries(action.bannersByDeviceId)) {
      next[id] = initSlice(banner);
    }
    return next;
  }
  const cur = state[action.id];
  if (!cur) return state;
  const updated = reduceSlice(cur, action);
  return { ...state, [action.id]: updated };
}

/** Returns the help lines to print for an in-progress (pre-Enter) line. */
export type HelpProvider = (partialLine: string) => OutputLine[];

/** Returns the completed line on a unique match, or null to leave input alone.
 *  Mirrors real IOS: ambiguous prefix → null (do NOTHING; `?` is for listing). */
export type CompletionProvider = (partialLine: string) => string | null;

export interface UseTerminalOptions {
  /** The device whose slice is exposed by the hook. */
  activeId: string;
  /** Initial scrollback per device — built once on mount. */
  bannersByDeviceId: Record<string, OutputLine[]>;
  /** Resolves a raw command line into output (targets the active device). */
  execute: Executor;
  /** The current prompt string for the active device, e.g. `R1#`. */
  prompt: string;
  /** Returns context-help lines for the current input. Drives IOS-style `?`. */
  help?: HelpProvider;
  /** Tab-complete the current input. Returns null to leave it alone. */
  complete?: CompletionProvider;
}

export interface UseTerminal {
  lines: TerminalLine[];
  input: string;
  prompt: string;
  /** True while the active device is draining a streamed command's tail.
   *  Terminal.tsx disables the input element and ignores Enter/Tab/? while
   *  this is set; submit() is a no-op. */
  busy: boolean;
  setInput: (value: string) => void;
  submit: () => void;
  recallPrev: () => void;
  recallNext: () => void;
  print: (lines: OutputLine[]) => void;
  clear: () => void;
  /** Trigger inline context help for the current input (e.g. `?` keypress). */
  requestHelp: () => void;
  /** Tab-complete the current input. No-op on ambiguous / no-partial cases. */
  tabComplete: () => void;
  /** Reset every device's terminal slice — used by lab reset. */
  resetAll: (bannersByDeviceId: Record<string, OutputLine[]>) => void;
}

export function useTerminal({
  activeId,
  bannersByDeviceId,
  execute,
  prompt,
  help,
  complete,
}: UseTerminalOptions): UseTerminal {
  const [state, dispatch] = useReducer(reducer, bannersByDeviceId, (banners): State => {
    const initial: Record<string, DeviceTerminalState> = {};
    for (const [id, banner] of Object.entries(banners)) {
      initial[id] = initSlice(banner);
    }
    return initial;
  });

  // Defensive fallback — should never happen for a well-formed LabSession.
  const slice = state[activeId] ?? initSlice(bannersByDeviceId[activeId] ?? []);

  // Track mount state so a slow stream (e.g., tracert) finishing after the
  // component unmounts doesn't dispatch into a torn-down reducer. dispatch
  // itself is no-op-safe in React 18, but the warning noise is avoidable.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Per-submit cancel tokens. Each in-flight stream registers an entry; the
  // consumer checks it between yields. resetAll flips every live token and
  // clears the set so the orphan consumers stop dispatching `print` into a
  // freshly-blank slice (the cold-audit Reset-mid-tracert bug). The token
  // set is also drained on unmount via mountedRef — but the explicit cancel
  // path is what makes Reset feel instantaneous.
  const cancelTokensRef = useRef<Set<{ cancelled: boolean }>>(new Set());

  const setInput = useCallback(
    (value: string) => {
      if (slice.busy) return;
      dispatch({ type: 'setInput', id: activeId, value });
    },
    [activeId, slice.busy],
  );

  const submit = useCallback(() => {
    if (slice.busy) return;
    const result = execute(slice.input);
    dispatch({ type: 'submit', id: activeId, prompt, result });

    // Optional async tail: keep the device busy (input disabled) until the
    // stream is exhausted, then flip back. The closure captures activeId so
    // hop lines from a tracert started on PC-A land on PC-A's slice even if
    // the learner clicks over to a router mid-trace. The `token` is the
    // cancellation signal — resetAll flips its `cancelled` flag to abort the
    // loop without waiting for the next sleep to resolve.
    if (result.stream) {
      const id = activeId;
      const token = { cancelled: false };
      cancelTokensRef.current.add(token);
      dispatch({ type: 'setBusy', id, busy: true });
      void (async () => {
        try {
          for await (const line of result.stream!) {
            if (!mountedRef.current || token.cancelled) return;
            dispatch({ type: 'print', id, lines: [line] });
          }
        } finally {
          cancelTokensRef.current.delete(token);
          // Only clear busy if THIS stream wasn't cancelled — when resetAll
          // fires, it rebuilds the slice (busy already false in the fresh
          // slice) and dispatching setBusy here would be a no-op write into
          // the new slice. Harmless either way; guarding keeps it tidy.
          if (mountedRef.current && !token.cancelled) {
            dispatch({ type: 'setBusy', id, busy: false });
          }
        }
      })();
    }
  }, [execute, prompt, slice.input, slice.busy, activeId]);

  const recallPrev = useCallback(
    () => dispatch({ type: 'recallPrev', id: activeId }),
    [activeId],
  );
  const recallNext = useCallback(
    () => dispatch({ type: 'recallNext', id: activeId }),
    [activeId],
  );
  const print = useCallback(
    (lines: OutputLine[]) => dispatch({ type: 'print', id: activeId, lines }),
    [activeId],
  );
  const clear = useCallback(
    () => dispatch({ type: 'clear', id: activeId }),
    [activeId],
  );

  const requestHelp = useCallback(() => {
    if (!help) return;
    const lines = help(slice.input);
    dispatch({ type: 'inlineHelp', id: activeId, prompt, raw: slice.input, lines });
  }, [help, prompt, slice.input, activeId]);

  const tabComplete = useCallback(() => {
    if (!complete) return;
    const next = complete(slice.input);
    if (next !== null) dispatch({ type: 'setInput', id: activeId, value: next });
  }, [complete, slice.input, activeId]);

  const resetAll = useCallback(
    (banners: Record<string, OutputLine[]>) => {
      // Cancel any in-flight stream BEFORE rebuilding slices. Without this,
      // an orphan tracert consumer keeps dispatching `print` actions into
      // the new (blank) slice — Reset-mid-tracert visibly leaks hop rows
      // into the reset terminal (cold-audit Fix 1).
      for (const token of cancelTokensRef.current) token.cancelled = true;
      cancelTokensRef.current.clear();
      dispatch({ type: 'resetAll', bannersByDeviceId: banners });
    },
    [],
  );

  return {
    lines: slice.lines,
    input: slice.input,
    prompt,
    busy: slice.busy,
    setInput,
    submit,
    recallPrev,
    recallNext,
    print,
    clear,
    requestHelp,
    tabComplete,
    resetAll,
  };
}
