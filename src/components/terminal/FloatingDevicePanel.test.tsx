import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FloatingDevicePanel } from './FloatingDevicePanel';
import type { TerminalView } from '@/engine/terminal/useTerminal';

/** A no-op terminal view — enough to mount the embedded Terminal without
 *  pulling in the lab session machinery. */
function stubTerm(): TerminalView {
  return {
    lines: [],
    input: '',
    prompt: 'R1>',
    busy: false,
    setInput: vi.fn(),
    submit: vi.fn(),
    recallPrev: vi.fn(),
    recallNext: vi.fn(),
    print: vi.fn(),
    clear: vi.fn(),
    requestHelp: vi.fn(),
    tabComplete: vi.fn(),
  };
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof FloatingDevicePanel>> = {}) {
  const onClose = vi.fn();
  const onFocus = vi.fn();
  const props = {
    deviceId: 'R1',
    platformLabel: 'ISR4321',
    term: stubTerm(),
    index: 0,
    initialZ: 20,
    onClose,
    onFocus,
    ...overrides,
  };
  const result = render(<FloatingDevicePanel {...props} />);
  return { ...result, onClose, onFocus };
}

describe('FloatingDevicePanel', () => {
  it('renders the device id and platform label in the title bar', () => {
    renderPanel();
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('ISR4321')).toBeInTheDocument();
  });

  it('renders the embedded Terminal so the device CLI is interactive', () => {
    renderPanel();
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
  });

  it('close button calls onClose with the panel deviceId', () => {
    const { onClose } = renderPanel({ deviceId: 'PC-A' });
    fireEvent.click(screen.getByRole('button', { name: 'Close PC-A console' }));
    expect(onClose).toHaveBeenCalledWith('PC-A');
  });

  it('minimize button collapses the body — terminal input disappears', () => {
    renderPanel();
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize R1 console' }));
    expect(screen.queryByLabelText('Terminal input')).toBeNull();
  });

  it('restore button (after minimize) brings the terminal body back', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize R1 console' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore R1 console' }));
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
  });

  it('focus signal (incoming initialZ bump) restores a minimized panel', () => {
    const { rerender } = render(
      <FloatingDevicePanel
        deviceId="R1"
        term={stubTerm()}
        index={0}
        initialZ={20}
        onClose={vi.fn()}
        onFocus={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Minimize R1 console' }));
    expect(screen.queryByLabelText('Terminal input')).toBeNull();

    // Parent bumps z-index in response to a topology re-click → panel
    // should pop back up.
    rerender(
      <FloatingDevicePanel
        deviceId="R1"
        term={stubTerm()}
        index={0}
        initialZ={21}
        onClose={vi.fn()}
        onFocus={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
  });

  it('renders at the staggered position derived from index (top-left changes)', () => {
    const { container } = renderPanel({ index: 0 });
    const panel0 = container.querySelector('[data-floating-panel="R1"]') as HTMLElement;
    const top0 = parseInt(panel0.style.top, 10);
    const left0 = parseInt(panel0.style.left, 10);

    const { container: c2 } = renderPanel({ index: 2 });
    const panel2 = c2.querySelector('[data-floating-panel="R1"]') as HTMLElement;
    const top2 = parseInt(panel2.style.top, 10);
    const left2 = parseInt(panel2.style.left, 10);

    expect(top2).toBeGreaterThan(top0);
    expect(left2).toBeGreaterThan(left0);
  });

  it('initialZ propagates to the panel z-index style', () => {
    const { container } = renderPanel({ initialZ: 42 });
    const panel = container.querySelector('[data-floating-panel="R1"]') as HTMLElement;
    expect(panel.style.zIndex).toBe('42');
  });

  it('clicking the panel body calls onFocus to bring it to the front', () => {
    const { onFocus, container } = renderPanel();
    const panel = container.querySelector('[data-floating-panel="R1"]') as HTMLElement;
    fireEvent.mouseDown(panel);
    expect(onFocus).toHaveBeenCalledWith('R1');
  });
});
