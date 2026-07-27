import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ObjectivesPanel, type HintView, type ObjectiveView } from './ObjectivesPanel';

/**
 * ObjectivesPanel hint tests.
 *
 * Covers the on-demand reveal contract: timer gates AVAILABILITY (not visibility),
 * each hint is independent, revealed text stays for the rest of the session,
 * and resetToken bumps clear revealed state. Uses fake timers so the 1Hz
 * countdown ticker can be advanced deterministically.
 */

const OBJECTIVES: ObjectiveView[] = [
  { id: 'o1', text: 'Do the thing', met: false },
];

const HINTS: HintView[] = [
  { index: 0, text: 'First hint body', afterSeconds: 30 },
  { index: 1, text: 'Second hint body', afterSeconds: 120 },
];

const PROGRESS_OBJECTIVES: ObjectiveView[] = [
  { id: 'o1', text: 'Inspect the current configuration', met: true },
  { id: 'o2', text: 'Configure the required interface', met: false },
  { id: 'o3', text: 'Verify end-to-end connectivity', met: false },
];

describe('ObjectivesPanel — guided objective status', () => {
  it('announces progress and exposes a semantic progressbar', () => {
    render(<ObjectivesPanel title="Objectives" objectives={PROGRESS_OBJECTIVES} />);

    expect(screen.getByText('1 of 3 objectives complete')).toHaveAttribute('aria-live', 'polite');
    const progress = screen.getByRole('progressbar', { name: /objective progress/i });
    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuemax', '3');
    expect(progress).toHaveAttribute('aria-valuenow', '1');
  });

  it('renders numbered objective rows with explicit completed and pending labels', () => {
    render(<ObjectivesPanel title="Objectives" objectives={PROGRESS_OBJECTIVES} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('1')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Completed')).toBeInTheDocument();
    expect(within(rows[1]).getByText('2')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Pending')).toBeInTheDocument();
    expect(within(rows[2]).getByText('3')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Pending')).toBeInTheDocument();
    for (const objective of PROGRESS_OBJECTIVES) {
      expect(screen.getByText(objective.text)).toBeInTheDocument();
    }
  });

  it('exposes semantic hooks for accessible light-theme progress and completed states', () => {
    render(<ObjectivesPanel title="Objectives" objectives={PROGRESS_OBJECTIVES} />);

    expect(screen.getByText('1 of 3 objectives complete')).toHaveClass('objective-progress-summary');
    const completedRow = screen.getAllByRole('listitem')[0];
    expect(within(completedRow).getByText('Inspect the current configuration')).toHaveClass(
      'objective-text',
    );
    expect(within(completedRow).getByText('Completed')).toHaveClass('objective-state-label');
    expect(completedRow.querySelector('.objective-status-icon')).not.toBeNull();
  });

  it('exposes semantic hooks for accessible light-theme completion feedback', () => {
    render(
      <ObjectivesPanel
        title="Objectives"
        objectives={PROGRESS_OBJECTIVES.map((objective) => ({ ...objective, met: true }))}
      />,
    );

    const banner = screen.getByText('Lab complete').closest('.completion-banner');
    expect(banner).not.toBeNull();
    expect(within(banner as HTMLElement).getByText('Lab complete')).toHaveClass('completion-title');
    expect(banner?.querySelector('.completion-status-icon')).not.toBeNull();
  });

  it('keeps reset, solution disclosure, and completion behavior intact', () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <ObjectivesPanel
        title="Objectives"
        objectives={PROGRESS_OBJECTIVES}
        onReset={onReset}
        solution={{ steps: [{ device: 'R1', commands: ['show running-config'] }] }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset lab' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    const solution = screen.getByRole('button', { name: /see solution/i });
    expect(solution).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(solution);
    expect(screen.getByText('show running-config')).toBeInTheDocument();

    rerender(
      <ObjectivesPanel
        title="Objectives"
        objectives={PROGRESS_OBJECTIVES.map((objective) => ({ ...objective, met: true }))}
        onReset={onReset}
      />,
    );
    expect(screen.getByText('Lab Complete')).toBeInTheDocument();
    expect(screen.getByText('Lab complete')).toBeInTheDocument();
  });
});

describe('ObjectivesPanel — hints surface', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render the Hints section when hints prop is empty', () => {
    render(
      <ObjectivesPanel
        title="Objectives"
        objectives={OBJECTIVES}
        hints={[]}
        labStartedAt={Date.now()}
        resetToken={0}
      />,
    );
    expect(screen.queryByText('Hints')).not.toBeInTheDocument();
  });

  it('renders all hints as locked buttons with M:SS countdown at lab start', () => {
    render(
      <ObjectivesPanel
        title="Objectives"
        objectives={OBJECTIVES}
        hints={HINTS}
        labStartedAt={Date.now()}
        resetToken={0}
      />,
    );
    expect(screen.getByText('Hints')).toBeInTheDocument();
    expect(screen.getByText('Need help?')).toBeInTheDocument();
    // Hint 1 countdown 30s → '0:30'
    expect(screen.getByRole('button', { name: /Hint 1.*30 seconds remaining/i })).toBeDisabled();
    expect(screen.getByText(/available in 0:30/)).toBeInTheDocument();
    // Hint 2 countdown 120s → '2:00'
    expect(screen.getByText(/available in 2:00/)).toBeInTheDocument();
  });

  it('countdown ticks down once per second', () => {
    render(
      <ObjectivesPanel
        title="Objectives"
        objectives={OBJECTIVES}
        hints={HINTS}
        labStartedAt={Date.now()}
        resetToken={0}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText(/available in 0:20/)).toBeInTheDocument();
    expect(screen.getByText(/available in 1:50/)).toBeInTheDocument();
  });

  it('flips a hint to "click to reveal" once its timer elapses', () => {
    render(
      <ObjectivesPanel
        title="Objectives"
        objectives={OBJECTIVES}
        hints={HINTS}
        labStartedAt={Date.now()}
        resetToken={0}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    // Hint 1 should now be enabled with "click to reveal".
    const hint1 = screen.getByRole('button', { name: /Hint 1 — click to reveal/i });
    expect(hint1).toBeEnabled();
    // Hint 2 still locked.
    expect(screen.getByText(/available in 1:29/)).toBeInTheDocument();
  });

  it('clicking an available hint expands its text inline and switches the label to "shown"', () => {
    render(
      <ObjectivesPanel
        title="Objectives"
        objectives={OBJECTIVES}
        hints={HINTS}
        labStartedAt={Date.now()}
        resetToken={0}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    fireEvent.click(screen.getByRole('button', { name: /Hint 1 — click to reveal/i }));
    // Body text now visible; label flipped to 'Hint 1 — shown'.
    expect(screen.getByText('First hint body')).toBeInTheDocument();
    expect(screen.getByText(/Hint 1 — shown/i)).toBeInTheDocument();
    // Hint 2 still locked — revealing 1 does not reveal 2.
    expect(screen.queryByText('Second hint body')).not.toBeInTheDocument();
  });

  it('revealing fires onRevealHint exactly once per hint', () => {
    const onReveal = vi.fn();
    render(
      <ObjectivesPanel
        title="Objectives"
        objectives={OBJECTIVES}
        hints={HINTS}
        labStartedAt={Date.now()}
        resetToken={0}
        onRevealHint={onReveal}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    fireEvent.click(screen.getByRole('button', { name: /Hint 1 — click to reveal/i }));
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenCalledWith(0);
  });

  it('resetToken bump clears revealed state (hint goes back to locked + countdown)', () => {
    const { rerender } = render(
      <ObjectivesPanel
        title="Objectives"
        objectives={OBJECTIVES}
        hints={HINTS}
        labStartedAt={Date.now()}
        resetToken={0}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    fireEvent.click(screen.getByRole('button', { name: /Hint 1 — click to reveal/i }));
    expect(screen.getByText('First hint body')).toBeInTheDocument();

    // Reset: bump resetToken AND re-anchor labStartedAt so the countdown
    // restarts from 30s (mirrors what TryMode/PilotMode do on reset).
    act(() => {
      vi.setSystemTime(new Date('2026-05-26T13:00:00Z'));
    });
    rerender(
      <ObjectivesPanel
        title="Objectives"
        objectives={OBJECTIVES}
        hints={HINTS}
        labStartedAt={Date.now()}
        resetToken={1}
      />,
    );
    expect(screen.queryByText('First hint body')).not.toBeInTheDocument();
    expect(screen.getByText(/available in 0:30/)).toBeInTheDocument();
  });

  it('locked hint button is disabled and a click is a no-op', () => {
    const onReveal = vi.fn();
    render(
      <ObjectivesPanel
        title="Objectives"
        objectives={OBJECTIVES}
        hints={HINTS}
        labStartedAt={Date.now()}
        resetToken={0}
        onRevealHint={onReveal}
      />,
    );
    const lockedButtons = within(screen.getByText('Hints').parentElement!).getAllByRole('button');
    fireEvent.click(lockedButtons[0]);
    expect(onReveal).not.toHaveBeenCalled();
    expect(screen.queryByText('First hint body')).not.toBeInTheDocument();
  });
});
