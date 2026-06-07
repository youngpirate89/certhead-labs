import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('renders the topology and objectives regions', () => {
    renderSample();
    expect(screen.getByTestId('topology-content')).toBeInTheDocument();
    expect(screen.getByTestId('objectives-content')).toBeInTheDocument();
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
});
