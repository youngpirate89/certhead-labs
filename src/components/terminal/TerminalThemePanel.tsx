import { useEffect, useRef } from 'react';
import {
  BG_OPTIONS,
  FONT_SIZES,
  TEXT_OPTIONS,
  type TerminalTheme,
} from '@/engine/terminal/terminalTheme';

interface TerminalThemePanelProps {
  theme: TerminalTheme;
  onChange: (theme: TerminalTheme) => void;
  onClose: () => void;
  /** The gear/Settings toggle that opens this panel. Clicks on it are excluded
   *  from the outside-click close so the toggle can own its own open/close — if
   *  this handler also fired on the toggle, the panel would close-then-reopen
   *  and never dismiss. */
  toggleRef?: React.RefObject<HTMLElement | null>;
}

export default function TerminalThemePanel({
  theme,
  onChange,
  onClose,
  toggleRef,
}: TerminalThemePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Capture phase: the topology canvas (React Flow) stops propagation on its
    // own pointer handlers, so a bubble-phase document listener never sees a
    // click that lands on the canvas. Listening in the capture phase guarantees
    // the outside-click reaches us first, wherever the click lands.
    function handlePointerDown(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (toggleRef?.current?.contains(target)) return;
      onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, toggleRef]);

  const baseTextStyle: React.CSSProperties = {
    color: '#94a3b8',
    fontFamily: 'monospace',
    fontSize: '12px',
  };

  const sectionStyle: React.CSSProperties = {
    paddingTop: '12px',
    marginTop: '12px',
    borderTop: '0.5px solid rgba(148,163,184,0.1)',
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Terminal theme settings"
      style={{
        // Sits BELOW the Settings pill (which lives in the ~30px header row),
        // not over it — overlapping the toggle was the original trap: the panel
        // covered its own gear, so a re-click landed on the panel, not the
        // button, and there was no way to dismiss.
        position: 'absolute',
        top: '40px',
        right: '8px',
        zIndex: 50,
        width: '220px',
        background: '#161b27',
        border: '0.5px solid rgba(148,163,184,0.15)',
        borderRadius: '8px',
        padding: '16px',
        ...baseTextStyle,
      }}
    >
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '20px',
          height: '20px',
          padding: 0,
          border: 'none',
          borderRadius: '4px',
          background: 'transparent',
          color: '#94a3b8',
          cursor: 'pointer',
          lineHeight: 1,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(148,163,184,0.12)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M1 1l8 8M9 1l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {/* Font size — top margin clears the close (×) button's strip so the
          font-size value can't slide under it. */}
      <div style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <label htmlFor="cl-term-font-size">Font size</label>
          <span>{theme.fontSize}px</span>
        </div>
        <input
          id="cl-term-font-size"
          type="range"
          min={FONT_SIZES.min}
          max={FONT_SIZES.max}
          step={1}
          value={theme.fontSize}
          onChange={(e) => onChange({ ...theme, fontSize: Number(e.target.value) })}
          style={{ width: '100%', marginTop: '8px' }}
        />
      </div>

      {/* Background */}
      <div style={sectionStyle}>
        <div>Background</div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: '8px' }}>
          {BG_OPTIONS.map((option) => {
            const active = theme.bgColor === option.value;
            return (
              <button
                key={option.label}
                type="button"
                aria-label={option.label}
                aria-pressed={active}
                onClick={() => onChange({ ...theme, bgColor: option.value })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '6px 8px',
                  border: 'none',
                  borderLeft: active ? '2px solid #e2e8f0' : '2px solid transparent',
                  background: active ? 'rgba(148,163,184,0.08)' : 'transparent',
                  color: '#94a3b8',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '3px',
                    background: option.value,
                    border: '0.5px solid rgba(255,255,255,0.12)',
                  }}
                />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Text color */}
      <div style={sectionStyle}>
        <div>Text color</div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: '8px' }}>
          {TEXT_OPTIONS.map((option) => {
            const active = theme.textColor === option.value;
            return (
              <button
                key={option.label}
                type="button"
                aria-label={option.label}
                aria-pressed={active}
                onClick={() => onChange({ ...theme, textColor: option.value })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '6px 8px',
                  border: 'none',
                  borderLeft: active ? '2px solid #e2e8f0' : '2px solid transparent',
                  background: active ? 'rgba(148,163,184,0.08)' : 'transparent',
                  color: '#94a3b8',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '3px',
                    background: option.value,
                    border: '0.5px solid rgba(255,255,255,0.12)',
                  }}
                />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
