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
