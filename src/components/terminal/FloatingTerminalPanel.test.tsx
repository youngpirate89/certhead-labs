import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FloatingTerminalPanel } from './FloatingTerminalPanel';
import type { TerminalView } from '@/engine/terminal/useTerminal';

/** A no-op terminal view — enough to mount the embedded Terminal without
 *  pulling in the lab session machinery. */
function stubTerm(prompt = 'R1>'): TerminalView {
  return {
    lines: [],
    input: '',
    prompt,
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

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof FloatingTerminalPanel>> = {},
) {
  const onSelectDevice = vi.fn();
  const onCloseDevice = vi.fn();
  const onCloseAll = vi.fn();
  const props: React.ComponentProps<typeof FloatingTerminalPanel> = {
    openDeviceIds: ['R1'],
    activeDeviceId: 'R1',
    forDevice: () => stubTerm(),
    platformLabel: (id) => (id === 'R1' ? 'ISR4321' : undefined),
    onSelectDevice,
    onCloseDevice,
    onCloseAll,
    ...overrides,
  };
  const result = render(<FloatingTerminalPanel {...props} />);
  return { ...result, onSelectDevice, onCloseDevice, onCloseAll };
}

describe('FloatingTerminalPanel', () => {
  it('renders the Terminal label in the header and an embedded Terminal body', () => {
    renderPanel();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
  });

  it('renders one tab per open device id with its platform label', () => {
    renderPanel({
      openDeviceIds: ['R1', 'PC-A'],
      activeDeviceId: 'R1',
      platformLabel: (id) => (id === 'R1' ? 'ISR4321' : 'Workstation'),
    });
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('PC-A')).toBeInTheDocument();
    expect(screen.getByText('ISR4321')).toBeInTheDocument();
    expect(screen.getByText('Workstation')).toBeInTheDocument();
  });

  it('marks the active tab as selected and the others as not selected', () => {
    const { container } = renderPanel({
      openDeviceIds: ['R1', 'PC-A'],
      activeDeviceId: 'PC-A',
    });
    const r1 = container.querySelector('[data-tab-device="R1"]') as HTMLElement;
    const pcA = container.querySelector('[data-tab-device="PC-A"]') as HTMLElement;
    expect(r1.getAttribute('data-tab-active')).toBe('false');
    expect(pcA.getAttribute('data-tab-active')).toBe('true');
  });

  it('clicking a non-active tab calls onSelectDevice with that id', () => {
    const { onSelectDevice } = renderPanel({
      openDeviceIds: ['R1', 'PC-A'],
      activeDeviceId: 'R1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to PC-A' }));
    expect(onSelectDevice).toHaveBeenCalledWith('PC-A');
  });

  it('clicking a tab × calls onCloseDevice for that id, not onCloseAll', () => {
    const { onCloseDevice, onCloseAll } = renderPanel({
      openDeviceIds: ['R1', 'PC-A'],
      activeDeviceId: 'R1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close PC-A tab' }));
    expect(onCloseDevice).toHaveBeenCalledWith('PC-A');
    expect(onCloseAll).not.toHaveBeenCalled();
  });

  it('header close-all button calls onCloseAll', () => {
    const { onCloseAll } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Close all terminals' }));
    expect(onCloseAll).toHaveBeenCalledTimes(1);
  });

  it('minimize collapses the body — the terminal input disappears', () => {
    renderPanel();
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    expect(screen.queryByLabelText('Terminal input')).toBeNull();
  });

  it('restore (after minimize) brings the body back', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore terminal' }));
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
  });

  it('un-minimizes when the parent changes activeDeviceId (topology re-click)', () => {
    const { rerender } = renderPanel({
      openDeviceIds: ['R1', 'PC-A'],
      activeDeviceId: 'R1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    expect(screen.queryByLabelText('Terminal input')).toBeNull();
    rerender(
      <FloatingTerminalPanel
        openDeviceIds={['R1', 'PC-A']}
        activeDeviceId="PC-A"
        forDevice={() => stubTerm('PC-A$')}
        onSelectDevice={vi.fn()}
        onCloseDevice={vi.fn()}
        onCloseAll={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
  });

  it('hides entirely when openDeviceIds is empty (no dialog rendered)', () => {
    const { container } = renderPanel({ openDeviceIds: [] });
    expect(container.querySelector('[data-floating-terminal-panel]')).toBeNull();
  });

  it('persists local state across hide/show — un-minimizes when re-opened', () => {
    const { rerender, container } = renderPanel({
      openDeviceIds: ['R1'],
      activeDeviceId: 'R1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    expect(screen.queryByLabelText('Terminal input')).toBeNull();
    // Close-all path: parent empties openDeviceIds — panel hides.
    rerender(
      <FloatingTerminalPanel
        openDeviceIds={[]}
        activeDeviceId="R1"
        forDevice={() => stubTerm()}
        onSelectDevice={vi.fn()}
        onCloseDevice={vi.fn()}
        onCloseAll={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-floating-terminal-panel]')).toBeNull();
    // Topology re-click — openDeviceIds repopulates. Panel returns un-minimized
    // because the activeDeviceId-change effect fires on the re-open.
    rerender(
      <FloatingTerminalPanel
        openDeviceIds={['R1']}
        activeDeviceId="R1"
        forDevice={() => stubTerm()}
        onSelectDevice={vi.fn()}
        onCloseDevice={vi.fn()}
        onCloseAll={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
  });

  it('renders all three resize handles when not minimized', () => {
    const { container } = renderPanel();
    expect(
      container.querySelector('[data-floating-terminal-resize="right"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-floating-terminal-resize="bottom"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-floating-terminal-resize="corner"]'),
    ).not.toBeNull();
  });

  it('hides resize handles when minimized (no body, nothing to resize against)', () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    expect(
      container.querySelector('[data-floating-terminal-resize="right"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-floating-terminal-resize="bottom"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-floating-terminal-resize="corner"]'),
    ).toBeNull();
  });

  it('opens at the default size (600 wide, 420 tall)', () => {
    const { container } = renderPanel();
    const panel = container.querySelector(
      '[data-floating-terminal-panel]',
    ) as HTMLElement;
    expect(panel.style.width).toBe('600px');
    expect(panel.style.height).toBe('420px');
  });

  it('minimized snap-bar uses 320px width and docks bottom-center via CSS transform', () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    const panel = container.querySelector(
      '[data-floating-terminal-panel]',
    ) as HTMLElement;
    expect(panel.getAttribute('data-floating-terminal-minimized')).toBe('true');
    expect(panel.style.width).toBe('320px');
    expect(panel.style.left).toBe('50%');
    expect(panel.style.transform).toContain('translateX(-50%)');
    expect(panel.style.bottom).toBe('0px');
  });

  it('minimized snap-bar shows "Terminal — N devices" with the open tab count', () => {
    renderPanel({ openDeviceIds: ['R1', 'PC-A', 'PC-B'], activeDeviceId: 'R1' });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    expect(screen.getByText('Terminal — 3 devices')).toBeInTheDocument();
  });

  it('minimized snap-bar uses singular "device" when only one tab is open', () => {
    renderPanel({ openDeviceIds: ['R1'], activeDeviceId: 'R1' });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    expect(screen.getByText('Terminal — 1 device')).toBeInTheDocument();
  });

  it('clicking anywhere on the minimized snap-bar restores the panel', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    expect(screen.queryByLabelText('Terminal input')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore terminal panel' }));
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
  });

  it('clicking close-all on the minimized snap-bar does NOT restore the panel', () => {
    const { onCloseAll } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close all terminals' }));
    // The click should bubble to onCloseAll only — the snap-bar's restore
    // handler must not fire when an inner button is the click target.
    expect(onCloseAll).toHaveBeenCalledTimes(1);
    // Panel is still in minimized state in our test (the parent would now
    // empty openDeviceIds and hide it; here we assert local state).
    const minimizeBtn = screen.queryByRole('button', { name: 'Minimize terminal' });
    expect(minimizeBtn).toBeNull();
    expect(screen.getByRole('button', { name: 'Restore terminal' })).toBeInTheDocument();
  });

  it('restore returns the panel to its prior position and size (state preserved)', () => {
    const { container } = renderPanel();
    const panel = container.querySelector(
      '[data-floating-terminal-panel]',
    ) as HTMLElement;
    const beforeLeft = panel.style.left;
    const beforeTop = panel.style.top;
    const beforeWidth = panel.style.width;
    const beforeHeight = panel.style.height;

    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore terminal' }));

    expect(panel.style.left).toBe(beforeLeft);
    expect(panel.style.top).toBe(beforeTop);
    expect(panel.style.width).toBe(beforeWidth);
    expect(panel.style.height).toBe(beforeHeight);
  });

  it('renders the Terminal for whichever device is activeDeviceId', () => {
    const forDevice = vi.fn((id: string) =>
      id === 'R1' ? stubTerm('R1>') : stubTerm('PC-A$'),
    );
    renderPanel({
      openDeviceIds: ['R1', 'PC-A'],
      activeDeviceId: 'PC-A',
      forDevice,
    });
    // forDevice gets called with the active id at render time.
    expect(forDevice).toHaveBeenCalledWith('PC-A');
  });
});
