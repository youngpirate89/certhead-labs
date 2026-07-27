import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Layout } from './Layout';

/**
 * Layout structural tests — guards the topology-first shape:
 *   header → main { topology canvas | objectives sidebar }
 *
 * Per-device terminals are NOT owned by Layout (they're floating panels the
 * mode mounts at the document root) so this file says nothing about them.
 * Behavior of the contained panels is tested separately
 * (TopologyPanel.test.tsx, ObjectivesPanel.test.tsx, FloatingDevicePanel
 * tests, etc.).
 */
describe('Layout', () => {
  function renderSample() {
    return render(
      <Layout
        examLabel="CCNA 200-301"
        labTitle="Sample lab"
        topology={<div data-testid="topology-content">topology here</div>}
        objectives={<div data-testid="objectives-content">objectives here</div>}
        terminal={<div data-testid="terminal-content">terminal here</div>}
      />,
    );
  }

  it('renders the header with examLabel and labTitle', () => {
    renderSample();
    expect(screen.getByText('CCNA 200-301')).toBeInTheDocument();
    expect(screen.getByText('Sample lab')).toBeInTheDocument();
  });

  it('exposes a branded product header and concise lab context', () => {
    renderSample();

    expect(screen.getByRole('banner', { name: /certhead labs workspace/i })).toHaveAttribute(
      'data-region',
      'product-header',
    );
    const context = screen.getByRole('group', { name: /current lab/i });
    expect(within(context).getByText('CCNA 200-301')).toBeInTheDocument();
    expect(within(context).getByText('Sample lab')).toBeInTheDocument();
  });

  it('keeps long lab titles truncation-safe inside the header context', () => {
    renderSample();

    const title = screen.getByText('Sample lab');
    expect(title).toHaveAttribute('data-lab-title');
    expect(title).toHaveClass('min-w-0', 'truncate');
    expect(title).toHaveAttribute('title', 'Sample lab');
  });

  it('renders the topology and objectives regions', () => {
    renderSample();
    expect(screen.getByTestId('topology-content')).toBeInTheDocument();
    expect(screen.getByTestId('objectives-content')).toBeInTheDocument();
  });

  it('labels the topology workspace and presents objectives as a distinct rail', () => {
    const { container } = renderSample();

    expect(screen.getByRole('region', { name: /network topology workspace/i })).toHaveAttribute(
      'data-region',
      'topology',
    );
    const objectives = screen.getByRole('complementary', { name: /lab objectives/i });
    expect(objectives).toHaveAttribute('data-region', 'objectives');
    expect(container.querySelector('[data-region="workspace-row"]')).toHaveClass('workspace-surface');
    expect(objectives).toHaveClass('objectives-rail');
  });

  it('places the topology region to the LEFT of the objectives sidebar', () => {
    const { container } = renderSample();
    const topology = container.querySelector('[data-region="topology"]');
    const objectives = container.querySelector('[data-region="objectives"]');
    expect(topology).not.toBeNull();
    expect(objectives).not.toBeNull();
    // DOM order = visual order in a flex-row. Topology comes first.
    expect(
      topology!.compareDocumentPosition(objectives!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('topology and objectives are siblings inside the same main container', () => {
    const { container } = renderSample();
    const topology = container.querySelector('[data-region="topology"]');
    const objectives = container.querySelector('[data-region="objectives"]');
    expect(topology).not.toBeNull();
    expect(objectives).not.toBeNull();
    expect(topology!.parentElement).toBe(objectives!.parentElement);
  });

  it('applies min-w-0 to the topology region (overflow-safety for wide canvases)', () => {
    const { container } = renderSample();
    const topology = container.querySelector('[data-region="topology"]');
    expect(topology?.className).toContain('min-w-0');
  });

  it('objectives sidebar has a fixed width (300px target)', () => {
    const { container } = renderSample();
    const objectives = container.querySelector('[data-region="objectives"]') as HTMLElement;
    expect(objectives.style.width).toBe('300px');
  });

  it('objectives sidebar has shrink-0 so the topology never pushes it off-screen', () => {
    const { container } = renderSample();
    const objectives = container.querySelector('[data-region="objectives"]');
    expect(objectives?.className).toContain('shrink-0');
  });

  it('objectives sidebar is overflow-hidden so a long hint list does NOT trigger page scroll', () => {
    // ObjectivesPanel handles its own internal scroll; the aside must clip
    // any overflow so the document body stays unscrollable.
    const { container } = renderSample();
    const objectives = container.querySelector('[data-region="objectives"]');
    expect(objectives?.className).toContain('overflow-hidden');
  });

  it('objectives sidebar fills the full main height (h-full)', () => {
    const { container } = renderSample();
    const objectives = container.querySelector('[data-region="objectives"]');
    expect(objectives?.className).toContain('h-full');
  });

  it('main content uses a vertical split: workspace row above docked terminal', () => {
    const { container } = renderSample();
    const main = container.querySelector('main');
    const workspaceRow = container.querySelector('[data-region="workspace-row"]');
    expect(main?.className).toContain('flex');
    expect(main?.className).toContain('flex-col');
    expect(workspaceRow?.className).toContain('flex');
  });

  it('reserves a docked terminal region below the topology/objectives row instead of overlaying them', () => {
    const { container } = renderSample();
    const terminal = container.querySelector('[data-region="terminal-dock"]') as HTMLElement;

    expect(terminal).not.toBeNull();
    expect(screen.getByTestId('terminal-content')).toBeInTheDocument();
    expect(terminal.className).toContain('shrink-0');
    expect(terminal.style.height).toBe('34%');
  });

  it('exposes a dedicated terminal-theme isolation hook on the entire dock', () => {
    const { container } = renderSample();
    const terminal = container.querySelector('[data-region="terminal-dock"]');

    expect(terminal).toHaveAttribute('data-terminal-theme-isolation');
    expect(terminal).toHaveClass('terminal-theme-isolation');
    expect(within(terminal as HTMLElement).getByTestId('terminal-content')).toBeInTheDocument();
  });

  it('defaults to dark mode and exposes a learner-facing light theme toggle', () => {
    const { container } = renderSample();
    const shell = container.querySelector('[data-lab-theme]');
    expect(shell?.getAttribute('data-lab-theme')).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: /switch to light theme/i }));

    expect(shell?.getAttribute('data-lab-theme')).toBe('light');
    expect(screen.getByRole('button', { name: /switch to dark theme/i })).toBeInTheDocument();
    expect(shell?.className).toContain('lab-theme-light');
  });

  it('provides a mobile tab workspace for scenario, topology, terminal, objectives, and hints', () => {
    const { container } = render(
      <Layout
        examLabel="CCNA 200-301"
        labTitle="Sample lab"
        scenario={<p>Read the ticket and inspect the devices.</p>}
        topology={<div data-testid="topology-content">topology here</div>}
        objectives={<div data-testid="objectives-content">objectives here</div>}
        terminal={<div data-testid="terminal-content">terminal here</div>}
        hasHints
      />,
    );

    const mobileWorkspace = container.querySelector('[data-region="mobile-workspace"]');
    expect(mobileWorkspace?.className).toContain('md:hidden');

    for (const name of ['Scenario', 'Topology', 'Terminal', 'Objectives', 'Hints']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }

    expect(container.querySelector('[data-mobile-panel="scenario"]')).not.toBeNull();
    expect(container.querySelector('[data-mobile-panel="topology"]')).not.toBeNull();
    expect(container.querySelector('[data-mobile-panel="terminal"]')).not.toBeNull();
    expect(container.querySelector('[data-mobile-panel="objectives"]')).not.toBeNull();
    expect(container.querySelector('[data-mobile-panel="hints"]')).not.toBeNull();
  });

  it('conditionally mounts each non-scenario mobile panel only while that panel is active', () => {
    const { container } = render(
      <Layout
        examLabel="CCNA 200-301"
        labTitle="Sample lab"
        scenario={<div data-testid="mobile-scenario-content">scenario here</div>}
        topology={<div data-testid="mobile-topology-content">topology here</div>}
        objectives={<div data-testid="mobile-objectives-content">objectives here</div>}
        terminal={<div data-testid="mobile-terminal-content">terminal here</div>}
        hints={<div data-testid="mobile-hints-content">hints here</div>}
        hasHints
      />,
    );

    const panel = (name: string) =>
      container.querySelector(`[data-mobile-panel="${name}"]`) as HTMLElement;

    expect(within(panel('scenario')).getByTestId('mobile-scenario-content')).toBeInTheDocument();
    for (const name of ['topology', 'terminal', 'objectives', 'hints']) {
      expect(within(panel(name)).queryByTestId(`mobile-${name}-content`)).toBeNull();
    }

    for (const name of ['Topology', 'Terminal', 'Objectives', 'Hints']) {
      fireEvent.click(screen.getByRole('tab', { name }));
      const key = name.toLowerCase();
      expect(within(panel(key)).getByTestId(`mobile-${key}-content`)).toBeInTheDocument();
      for (const other of ['topology', 'terminal', 'objectives', 'hints']) {
        if (other !== key) {
          expect(within(panel(other)).queryByTestId(`mobile-${other}-content`)).toBeNull();
        }
      }
    }
  });

  it('keeps mobile verify, reset, and hint actions sticky and wired to the mobile panels', () => {
    const onReset = vi.fn();
    const { container } = render(
      <Layout
        examLabel="CCNA 200-301"
        labTitle="Sample lab"
        scenario={<p>Read the ticket and inspect the devices.</p>}
        topology={<div data-testid="topology-content">topology here</div>}
        objectives={<div data-testid="objectives-content">objectives here</div>}
        terminal={<div data-testid="terminal-content">terminal here</div>}
        hints={<div data-testid="hints-content">hint guidance only</div>}
        hasHints
        onMobileReset={onReset}
      />,
    );

    const actionBar = container.querySelector('[data-region="mobile-actions"]');
    expect(actionBar?.className).toContain('sticky');
    expect(actionBar?.className).toContain('bottom-0');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(screen.getByRole('tab', { name: 'Objectives' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
    expect(screen.getByRole('tab', { name: 'Hints' })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders focused mobile hint content without duplicating the objectives panel', () => {
    render(
      <Layout
        examLabel="CCNA 200-301"
        labTitle="Sample lab"
        scenario={<p>Read the ticket and inspect the devices.</p>}
        topology={<div data-testid="topology-content">topology here</div>}
        objectives={<div data-testid="objectives-content">objectives here</div>}
        terminal={<div data-testid="terminal-content">terminal here</div>}
        hints={<div data-testid="hints-content">Use interface configuration mode.</div>}
        hasHints
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hint' }));

    const hintPanel = document.querySelector('[data-mobile-panel="hints"]') as HTMLElement;
    expect(screen.getByTestId('hints-content')).toBeInTheDocument();
    expect(hintPanel.querySelector('[data-testid="objectives-content"]')).toBeNull();
  });

  it('switches the mobile workspace to terminal after a device is selected from topology', () => {
    const { rerender } = render(
      <Layout
        examLabel="CCNA 200-301"
        labTitle="Sample lab"
        scenario={<p>Read the ticket and inspect the devices.</p>}
        topology={<div data-testid="topology-content">topology here</div>}
        objectives={<div data-testid="objectives-content">objectives here</div>}
        terminal={<div data-testid="terminal-content">terminal here</div>}
        mobileTerminalSignal={0}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Scenario' })).toHaveAttribute('aria-selected', 'true');

    rerender(
      <Layout
        examLabel="CCNA 200-301"
        labTitle="Sample lab"
        scenario={<p>Read the ticket and inspect the devices.</p>}
        topology={<div data-testid="topology-content">topology here</div>}
        objectives={<div data-testid="objectives-content">objectives here</div>}
        terminal={<div data-testid="terminal-content">terminal here</div>}
        mobileTerminalSignal={1}
      />,
    );

    const terminalPanel = document.querySelector('[data-mobile-panel="terminal"]') as HTMLElement;
    expect(screen.getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true');
    expect(terminalPanel.querySelector('[data-testid="terminal-content"]')).not.toBeNull();
  });

  it('shows mobile topology touch guidance and triggers fit-to-view when the topology tab opens', () => {
    const onMobileTopologyOpen = vi.fn();
    const { container } = render(
      <Layout
        examLabel="CCNA 200-301"
        labTitle="Sample lab"
        scenario={<p>Read the ticket and inspect the devices.</p>}
        topology={<div data-testid="topology-content">topology here</div>}
        objectives={<div data-testid="objectives-content">objectives here</div>}
        terminal={<div data-testid="terminal-content">terminal here</div>}
        onMobileTopologyOpen={onMobileTopologyOpen}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Topology' }));

    const guidance = container.querySelector('[data-mobile-topology-guidance]');
    expect(guidance).not.toBeNull();
    expect(guidance?.textContent).toMatch(/pinch or drag/i);
    expect(guidance?.textContent).toMatch(/fit/i);
    expect(onMobileTopologyOpen).toHaveBeenCalledTimes(1);
  });
});
