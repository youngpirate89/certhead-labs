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
