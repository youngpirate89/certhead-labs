import { describe, it, expect } from 'vitest';
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

  it('main row uses flex so topology and sidebar are side-by-side, not stacked', () => {
    const { container } = renderSample();
    const main = container.querySelector('main');
    expect(main?.className).toContain('flex');
    // No `flex-col` — siblings flow horizontally in the row.
    expect(main?.className).not.toContain('flex-col');
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
});
