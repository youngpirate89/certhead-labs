import { useCallback, useReducer } from 'react';

/**
 * Terminal primitive (presentation layer).
 *
 * Owns terminal state — printed lines, the current input buffer, and command
 * history navigation — via a reducer (CLAUDE.md architecture: React state +
 * reducers, no Redux/Zustand until complexity demands).
 *
 * It is intentionally decoupled from the parser: the caller supplies an
 * {@link Executor} that turns a raw line into output. The terminal does not
 * know about IOS, bash, or grading. That keeps the engine layers separable.
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
}

export type Executor = (raw: string) => ExecResult;

interface State {
  lines: TerminalLine[];
  input: string;
  /** Submitted commands, newest last. Drives up/down recall. */
  commandHistory: string[];
  /** Cursor into commandHistory; null means "editing a fresh line". */
  historyIndex: number | null;
  nextId: number;
}

type Action =
  | { type: 'setInput'; value: string }
  | { type: 'submit'; prompt: string; result: ExecResult }
  | { type: 'recallPrev' }
  | { type: 'recallNext' }
  | { type: 'print'; lines: OutputLine[] }
  | { type: 'clear' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setInput':
      return { ...state, input: action.value, historyIndex: null };

    case 'submit': {
      const submitted = state.input.trim();
      const echo: TerminalLine = {
        id: state.nextId,
        kind: 'input',
        text: state.input,
        prompt: action.prompt,
      };

      if (action.result.clear) {
        return {
          ...state,
          lines: [],
          input: '',
          historyIndex: null,
          commandHistory: submitted
            ? [...state.commandHistory, submitted]
            : state.commandHistory,
          nextId: state.nextId + 1,
        };
      }

      const output = action.result.lines.map((l, i) => ({
        id: state.nextId + 1 + i,
        kind: l.kind,
        text: l.text,
      }));

      return {
        ...state,
        lines: [...state.lines, echo, ...output],
        input: '',
        historyIndex: null,
        commandHistory: submitted
          ? [...state.commandHistory, submitted]
          : state.commandHistory,
        nextId: state.nextId + 1 + output.length,
      };
    }

    case 'recallPrev': {
      if (state.commandHistory.length === 0) return state;
      const idx =
        state.historyIndex === null
          ? state.commandHistory.length - 1
          : Math.max(0, state.historyIndex - 1);
      return { ...state, historyIndex: idx, input: state.commandHistory[idx] };
    }

    case 'recallNext': {
      if (state.historyIndex === null) return state;
      const next = state.historyIndex + 1;
      if (next >= state.commandHistory.length) {
        return { ...state, historyIndex: null, input: '' };
      }
      return { ...state, historyIndex: next, input: state.commandHistory[next] };
    }

    case 'print': {
      const output = action.lines.map((l, i) => ({
        id: state.nextId + i,
        kind: l.kind,
        text: l.text,
      }));
      return {
        ...state,
        lines: [...state.lines, ...output],
        nextId: state.nextId + output.length,
      };
    }

    case 'clear':
      return { ...state, lines: [] };
  }
}

export interface UseTerminalOptions {
  /** Resolves a raw command line into output. */
  execute: Executor;
  /** The current prompt string, e.g. `R1#`. May change with mode later. */
  prompt: string;
  /** Optional banner lines printed on first render. */
  banner?: OutputLine[];
}

export interface UseTerminal {
  lines: TerminalLine[];
  input: string;
  prompt: string;
  setInput: (value: string) => void;
  submit: () => void;
  recallPrev: () => void;
  recallNext: () => void;
  print: (lines: OutputLine[]) => void;
  clear: () => void;
}

export function useTerminal({ execute, prompt, banner }: UseTerminalOptions): UseTerminal {
  const [state, dispatch] = useReducer(
    reducer,
    banner,
    (b): State => ({
      lines: (b ?? []).map((l, i) => ({ id: i, kind: l.kind, text: l.text })),
      input: '',
      commandHistory: [],
      historyIndex: null,
      nextId: (b ?? []).length,
    }),
  );

  const setInput = useCallback((value: string) => dispatch({ type: 'setInput', value }), []);

  const submit = useCallback(() => {
    const result = execute(state.input);
    dispatch({ type: 'submit', prompt, result });
  }, [execute, prompt, state.input]);

  const recallPrev = useCallback(() => dispatch({ type: 'recallPrev' }), []);
  const recallNext = useCallback(() => dispatch({ type: 'recallNext' }), []);
  const print = useCallback((lines: OutputLine[]) => dispatch({ type: 'print', lines }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  return {
    lines: state.lines,
    input: state.input,
    prompt,
    setInput,
    submit,
    recallPrev,
    recallNext,
    print,
    clear,
  };
}
