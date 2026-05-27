import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TerminalView, TerminalLine } from '@/engine/terminal/useTerminal';
import { loadTheme, saveTheme, type TerminalTheme } from '@/engine/terminal/terminalTheme';
import TerminalThemePanel from './terminal/TerminalThemePanel';

// Output + input lines pick up the user-configurable terminal foreground via
// the `--term-fg` CSS var set on the container; error + system lines keep
// their semantic Tailwind colors regardless of theme.
const lineColor: Record<TerminalLine['kind'], string> = {
  input: '',
  output: '',
  error: 'text-terminal-error',
  system: 'text-terminal-dim',
};

const themedKinds = new Set<TerminalLine['kind']>(['input', 'output']);

interface TerminalProps {
  /** Per-device terminal view — either the active-device shortcuts from
   *  useLabSession (single-CLI legacy path) or a `forDevice(id)` view
   *  scoped to one floating panel. */
  term: TerminalView;
}

export function Terminal({ term }: TerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState<TerminalTheme>(() => loadTheme());
  const [showThemePanel, setShowThemePanel] = useState(false);

  function handleThemeChange(next: TerminalTheme) {
    setTheme(next);
    saveTheme(next);
  }

  // Keep the newest line in view as output streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [term.lines]);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // While a streamed command is still emitting (e.g., tracert), the input
    // is disabled and these handlers are dead — the `disabled` prop blocks
    // the keypress entirely, but we mirror the guard here so a programmatic
    // dispatch can't sneak past.
    if (term.busy) {
      e.preventDefault();
      return;
    }
    // Intercept `?` BEFORE it lands in the input buffer: real IOS treats `?`
    // as an interactive help trigger, not a literal character.
    if (e.key === '?') {
      e.preventDefault();
      term.requestHelp();
      return;
    }
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        term.submit();
        break;
      case 'Tab':
        // IOS Tab: complete unique prefix, do NOTHING on ambiguous (that's `?`).
        e.preventDefault();
        term.tabComplete();
        break;
      case 'ArrowUp':
        e.preventDefault();
        term.recallPrev();
        break;
      case 'ArrowDown':
        e.preventDefault();
        term.recallNext();
        break;
    }
  }

  return (
    <div
      className="relative flex h-full cursor-text flex-col font-mono leading-relaxed"
      style={{
        backgroundColor: theme.bgColor,
        color: theme.textColor,
        fontSize: theme.fontSize + 'px',
        ['--term-fg' as string]: theme.textColor,
      }}
      onClick={() => {
        if (!term.busy) inputRef.current?.focus();
      }}
    >
      <div
        className="flex shrink-0 items-center justify-end px-2 py-1"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Terminal theme settings"
          aria-expanded={showThemePanel}
          onClick={() => setShowThemePanel((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '12px',
            lineHeight: 1,
            padding: '4px 10px',
            borderRadius: '6px',
            border: '0.5px solid rgba(148,163,184,0.25)',
            background: showThemePanel ? 'rgba(148,163,184,0.12)' : 'transparent',
            color: '#94a3b8',
            cursor: 'pointer',
            letterSpacing: '0.04em',
            fontFamily: 'inherit',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(148,163,184,0.10)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(148,163,184,0.45)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = showThemePanel ? 'rgba(148,163,184,0.12)' : 'transparent';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(148,163,184,0.25)';
          }}
        >
          <span aria-hidden="true" style={{ fontSize: '13px' }}>⚙</span>
          <span>Settings</span>
        </button>
      </div>
      {showThemePanel && (
        <TerminalThemePanel
          theme={theme}
          onChange={handleThemeChange}
          onClose={() => setShowThemePanel(false)}
        />
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {term.lines.map((line) => (
          <div
            key={line.id}
            className={`whitespace-pre-wrap break-words ${lineColor[line.kind]}`}
            style={themedKinds.has(line.kind) ? { color: 'var(--term-fg)' } : undefined}
          >
            {line.kind === 'input' && line.prompt && (
              <span className="text-terminal-prompt" style={{ color: '#ffffff' }}>{line.prompt} </span>
            )}
            {line.text}
          </div>
        ))}

        {/* Active input line */}
        <div className="flex items-baseline">
          <span className="shrink-0 text-terminal-prompt" style={{ color: '#ffffff' }}>{term.prompt}&nbsp;</span>
          <input
            ref={inputRef}
            value={term.input}
            onChange={(e) => term.setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={term.busy}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Terminal input"
            aria-busy={term.busy}
            className="flex-1 bg-transparent caret-terminal-accent outline-none disabled:cursor-progress disabled:opacity-50"
            style={{ color: 'var(--term-fg)' }}
          />
        </div>
      </div>
    </div>
  );
}
