import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { UseTerminal, TerminalLine } from '@/engine/terminal/useTerminal';

const lineColor: Record<TerminalLine['kind'], string> = {
  input: 'text-terminal-fg',
  output: 'text-terminal-fg',
  error: 'text-terminal-error',
  system: 'text-terminal-dim',
};

interface TerminalProps {
  term: UseTerminal;
}

export function Terminal({ term }: TerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the newest line in view as output streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [term.lines]);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        term.submit();
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
      className="flex h-full cursor-text flex-col bg-terminal-bg font-mono text-[13px] leading-relaxed"
      onClick={() => inputRef.current?.focus()}
    >
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {term.lines.map((line) => (
          <div key={line.id} className={`whitespace-pre-wrap break-words ${lineColor[line.kind]}`}>
            {line.kind === 'input' && line.prompt && (
              <span className="text-terminal-prompt">{line.prompt} </span>
            )}
            {line.text}
          </div>
        ))}

        {/* Active input line */}
        <div className="flex items-baseline">
          <span className="shrink-0 text-terminal-prompt">{term.prompt}&nbsp;</span>
          <input
            ref={inputRef}
            value={term.input}
            onChange={(e) => term.setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Terminal input"
            className="flex-1 bg-transparent text-terminal-fg caret-terminal-accent outline-none"
          />
        </div>
      </div>
    </div>
  );
}
