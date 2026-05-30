import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SolutionDisclosure } from './SolutionDisclosure';
import type { SolutionStep } from '@/engine/types';

/**
 * The solution panel must keep long command lines fully readable. The original
 * `w-max whitespace-pre` rendering pushed long commands behind a per-line
 * horizontal scrollbar, truncating the crux (`...md5 CISCO1` hiding the key,
 * `...GigabitEt` clipping the interface). These tests pin the wrapping fix:
 * commands wrap (`whitespace-pre-wrap`) instead of being forced to content
 * width (`w-max`) inside an `overflow-x-auto` rail.
 */

const STEPS: SolutionStep[] = [
  {
    device: 'R2',
    note: 'Fix the key:',
    commands: [
      'ip ospf message-digest-key 1 md5 CISCO123',
      'show running-config interface GigabitEthernet0/2',
      ' deny icmp host 192.168.1.10 any', // leading indent must survive
    ],
  },
];

function openPanel() {
  render(<SolutionDisclosure steps={STEPS} />);
  fireEvent.click(screen.getByRole('button', { name: /see solution/i }));
}

describe('SolutionDisclosure long-command rendering', () => {
  it('wraps long command lines instead of clipping them behind a scrollbar', () => {
    openPanel();
    const longCmd = screen.getByText('ip ospf message-digest-key 1 md5 CISCO123');
    expect(longCmd.className).toContain('whitespace-pre-wrap');
    // The old behavior — fixed-content width that forced horizontal scroll —
    // must be gone.
    expect(longCmd.className).not.toContain('w-max');
  });

  it('keeps each command as one full, selectable text node (no inserted newline)', () => {
    openPanel();
    // The full interface name is present in one node — not split/truncated.
    expect(
      screen.getByText('show running-config interface GigabitEthernet0/2'),
    ).toBeTruthy();
  });

  it('preserves leading-space indentation for mode-hierarchy lines', () => {
    openPanel();
    // whitespace-pre-wrap keeps the leading space; the node text is exact.
    const indented = screen.getByText(
      (_, el) => el?.textContent === ' deny icmp host 192.168.1.10 any',
    );
    expect(indented.className).toContain('whitespace-pre-wrap');
  });
});
