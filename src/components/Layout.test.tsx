import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

  // ---- A1.8: resizable divider between topology and terminal/objectives row

  it('renders a horizontal separator between the topology and terminal regions', () => {
    const { container } = renderSample();
    const sep = container.querySelector('[data-region="divider"]');
    expect(sep).not.toBeNull();
    expect(sep).toHaveAttribute('role', 'separator');
    expect(sep).toHaveAttribute('aria-orientation', 'horizontal');
    // Focusable so keyboard users can resize.
    expect(sep).toHaveAttribute('tabIndex', '0');
  });

  it('separator is between the topology and the terminal/objectives row in DOM order', () => {
    const { container } = renderSample();
    const topology = container.querySelector('[data-region="topology"]')!;
    const sep = container.querySelector('[data-region="divider"]')!;
    const terminal = container.querySelector('[data-region="terminal"]')!;
    // topology -> divider -> terminal+objectives row
    expect(
      topology.compareDocumentPosition(sep) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      sep.compareDocumentPosition(terminal) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('ArrowDown grows the topology region; ArrowUp shrinks it', () => {
    const { container } = renderSample();
    const topology = container.querySelector('[data-region="topology"]') as HTMLElement;
    const sep = container.querySelector('[data-region="divider"]') as HTMLElement;

    const heightOf = () => Number(topology.style.height.replace('px', ''));
    const initial = heightOf();
    expect(initial).toBe(160); // initial topology height

    fireEvent.keyDown(sep, { key: 'ArrowDown' });
    const afterDown = heightOf();
    expect(afterDown).toBeGreaterThan(initial);

    fireEvent.keyDown(sep, { key: 'ArrowUp' });
    const afterUp = heightOf();
    expect(afterUp).toBe(initial);
  });

  it('clamps at the topology floor — many ArrowUp presses cannot drop below MIN', () => {
    const { container } = renderSample();
    const topology = container.querySelector('[data-region="topology"]') as HTMLElement;
    const sep = container.querySelector('[data-region="divider"]') as HTMLElement;
    // Shove it way past the floor.
    for (let i = 0; i < 50; i++) fireEvent.keyDown(sep, { key: 'ArrowUp' });
    const h = Number(topology.style.height.replace('px', ''));
    // Floor is 120 (MIN_TOPOLOGY_HEIGHT). Whatever the exact constant, it
    // must be > 0 and far below the initial 160 — i.e. clamped.
    expect(h).toBe(120);
  });

  it('Home key snaps topology to its floor; ArrowDown step matches a sane increment', () => {
    const { container } = renderSample();
    const topology = container.querySelector('[data-region="topology"]') as HTMLElement;
    const sep = container.querySelector('[data-region="divider"]') as HTMLElement;

    fireEvent.keyDown(sep, { key: 'Home' });
    expect(Number(topology.style.height.replace('px', ''))).toBe(120);

    // One ArrowDown from the floor — the constant is held inside Layout so
    // we only assert the change direction + a plausible step (>= 8px). We
    // don't pin the exact pixel because Layout owns the keyboard step.
    fireEvent.keyDown(sep, { key: 'ArrowDown' });
    const afterStep = Number(topology.style.height.replace('px', ''));
    expect(afterStep).toBeGreaterThan(120);
    expect(afterStep - 120).toBeGreaterThanOrEqual(8);
  });

  it('aria-valuenow tracks the current topology height; min/max are surfaced too', () => {
    const { container } = renderSample();
    const sep = container.querySelector('[data-region="divider"]') as HTMLElement;
    expect(sep.getAttribute('aria-valuenow')).toBe('160');
    expect(sep.getAttribute('aria-valuemin')).toBe('120');
    // aria-valuemax depends on main's measured height; jsdom reports 0 so
    // it's clamped to MIN_TOPOLOGY_HEIGHT (max(MIN, 0 - MIN_ROW)). The
    // contract is that it's a number — exact value is layout-dependent.
    expect(sep.getAttribute('aria-valuemax')).toMatch(/^\d+$/);
  });
});
