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
}

export default function TerminalThemePanel({ theme, onChange, onClose }: TerminalThemePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const panel = panelRef.current;
      if (!panel) return;
      if (e.target instanceof Node && !panel.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

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
        position: 'absolute',
        top: '8px',
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
      {/* Font size */}
      <div>
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
