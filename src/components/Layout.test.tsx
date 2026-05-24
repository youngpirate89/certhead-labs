import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Layout } from './Layout';

/**
 * Layout structural tests — guards the stacked three-region shape:
 *   header → topology band (full-width, top) → terminal | objectives row.
 *
 * Behavior comes from the panels the layout composes, not Layout itself. These
 * tests only verify the arrangement; rendering of each panel is tested
 * separately (TopologyPanel.test.tsx, etc.).
 */
describe('Layout', () => {
  function renderSample() {
    return render(
      <Layout
        examLabel="CCNA 200-301"
        labTitle="Sample lab"
        topology={<div data-testid="topology-content">topology here</div>}
        terminal={<div data-testid="terminal-content">terminal here</div>}
        objectives={<div data-testid="objectives-content">objectives here</div>}
      />,
    );
  }

  it('renders the header with examLabel and labTitle', () => {
    renderSample();
    expect(screen.getByText('CCNA 200-301')).toBeInTheDocument();
    expect(screen.getByText('Sample lab')).toBeInTheDocument();
  });

  it('renders all three regions', () => {
    renderSample();
    expect(screen.getByTestId('topology-content')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-content')).toBeInTheDocument();
    expect(screen.getByTestId('objectives-content')).toBeInTheDocument();
  });

  it('places the topology region ABOVE the terminal+objectives row (stacked, not side-rail)', () => {
    const { container } = renderSample();
    const topology = container.querySelector('[data-region="topology"]');
    const terminal = container.querySelector('[data-region="terminal"]');
    expect(topology).not.toBeNull();
    expect(terminal).not.toBeNull();
    // DOM order = visual order in a flex-col. Topology comes first.
    expect(
      topology!.compareDocumentPosition(terminal!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('terminal and objectives are siblings inside the same row container', () => {
    const { container } = renderSample();
    const terminal = container.querySelector('[data-region="terminal"]');
    const objectives = container.querySelector('[data-region="objectives"]');
    expect(terminal).not.toBeNull();
    expect(objectives).not.toBeNull();
    expect(terminal!.parentElement).toBe(objectives!.parentElement);
  });

  it('applies min-w-0 to the terminal region (overflow-safety for wide `show` output)', () => {
    const { container } = renderSample();
    const terminal = container.querySelector('[data-region="terminal"]');
    expect(terminal?.className).toContain('min-w-0');
  });
});
