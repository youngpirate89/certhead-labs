import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import TerminalThemePanel from './TerminalThemePanel';
import { DEFAULT_THEME } from '@/engine/terminal/terminalTheme';

/**
 * Dismissal contract for the terminal Settings popover.
 *
 * The popover was previously a trap-state: it overlapped its own gear toggle,
 * Escape did nothing, and the canvas swallowed outside-clicks. These tests pin
 * the three programmatic dismissal paths (Escape, outside-click, the × button)
 * plus the toggle-exclusion that keeps a gear re-click from close-then-reopening.
 */

function renderPanel(overrides: Partial<React.ComponentProps<typeof TerminalThemePanel>> = {}) {
  const onClose = vi.fn();
  const onChange = vi.fn();
  render(
    <TerminalThemePanel
      theme={DEFAULT_THEME}
      onChange={onChange}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onClose, onChange };
}

describe('TerminalThemePanel dismissal', () => {
  it('closes on Escape', () => {
    const { onClose } = renderPanel();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the × close button is clicked', () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /close settings/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on an outside mousedown', () => {
    const { onClose } = renderPanel();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when the click lands inside the panel', () => {
    const { onClose } = renderPanel();
    fireEvent.mouseDown(screen.getByRole('dialog', { name: /terminal theme settings/i }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does NOT treat a click on the toggle as an outside-click (toggle owns its own open/close)', () => {
    const toggle = document.createElement('button');
    document.body.appendChild(toggle);
    const toggleRef = createRef<HTMLElement>();
    // @ts-expect-error createRef gives a readonly ref; we seed current for the test.
    toggleRef.current = toggle;
    const { onClose } = renderPanel({ toggleRef });
    fireEvent.mouseDown(toggle);
    expect(onClose).not.toHaveBeenCalled();
    document.body.removeChild(toggle);
  });
});
