import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLabSession } from './useLabSession';
import type { Lab } from '@/engine/types';

/** A two-router fixture lab — local to this test, never deployed. */
function twoRouterLab(): Lab {
  return {
    id: 'test-2r-terminal',
    title: '2-router terminal-binding fixture',
    exam: 'TEST',
    difficulty: 1,
    estimatedMinutes: 1,
    isFree: false,
    scenario: 'fixture',
    topology: {
      devices: [
        { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0'] },
        { id: 'R2', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0'] },
      ],
      links: [
        { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
      ],
    },
    objectives: [],
    hints: [],
  };
}

/** Run a command end-to-end through the active device. */
function send(result: ReturnType<typeof renderHook<ReturnType<typeof useLabSession>, { lab: Lab }>>, raw: string) {
  act(() => result.result.current.setInput(raw));
  act(() => result.result.current.submit());
}

describe('useLabSession — per-device terminal binding', () => {
  it('mounts with the first device active and its banner in the terminal', () => {
    const { result } = renderHook(({ lab }) => useLabSession(lab), {
      initialProps: { lab: twoRouterLab() },
    });
    expect(result.current.activeDeviceId).toBe('R1');
    expect(result.current.prompt).toBe('R1>');
    // Banner is 7 lines; no commands yet.
    const banner = result.current.lines.map((l) => l.text).join('\n');
    expect(banner).toMatch(/Cisco IOS XE Software/);
    expect(banner).toMatch(/ISR4321/);
  });

  it('swaps the visible buffer + prompt when activeDeviceId changes', () => {
    const hookResult = renderHook(({ lab }) => useLabSession(lab), {
      initialProps: { lab: twoRouterLab() },
    });
    send(hookResult, 'enable');
    expect(hookResult.result.current.prompt).toBe('R1#');
    const r1LineCount = hookResult.result.current.lines.length;
    expect(r1LineCount).toBeGreaterThan(7); // banner + echo

    act(() => hookResult.result.current.setActiveDevice('R2'));

    // R2's buffer is its own banner only — nothing about `enable` on R1.
    expect(hookResult.result.current.activeDeviceId).toBe('R2');
    expect(hookResult.result.current.prompt).toBe('R2>');
    expect(hookResult.result.current.lines.length).toBe(7); // banner only
    const r2text = hookResult.result.current.lines.map((l) => l.text).join('\n');
    expect(r2text).not.toMatch(/enable/);
  });

  it('preserves each device scrollback + mode across active switches', () => {
    const hookResult = renderHook(({ lab }) => useLabSession(lab), {
      initialProps: { lab: twoRouterLab() },
    });

    // R1: enable + configure terminal.
    send(hookResult, 'enable');
    send(hookResult, 'configure terminal');
    expect(hookResult.result.current.prompt).toBe('R1(config)#');

    // Switch to R2 and put it in priv only.
    act(() => hookResult.result.current.setActiveDevice('R2'));
    send(hookResult, 'enable');
    expect(hookResult.result.current.prompt).toBe('R2#');

    // Back to R1: should be in config, scrollback shows the prior commands.
    act(() => hookResult.result.current.setActiveDevice('R1'));
    expect(hookResult.result.current.prompt).toBe('R1(config)#');
    const r1text = hookResult.result.current.lines.map((l) => l.text).join('\n');
    expect(r1text).toMatch(/enable/);
    expect(r1text).toMatch(/configure terminal/);
    // R1's buffer doesn't contain R2's `enable`.
    const r1Echoes = hookResult.result.current.lines.filter((l) => l.kind === 'input').length;
    expect(r1Echoes).toBe(2); // just R1's two commands

    // And once more to R2: still in priv.
    act(() => hookResult.result.current.setActiveDevice('R2'));
    expect(hookResult.result.current.prompt).toBe('R2#');
  });

  it('command-history recall is per-device (up arrow on R2 sees R2 commands only)', () => {
    const hookResult = renderHook(({ lab }) => useLabSession(lab), {
      initialProps: { lab: twoRouterLab() },
    });

    send(hookResult, 'enable');
    send(hookResult, 'show version');
    act(() => hookResult.result.current.setActiveDevice('R2'));
    send(hookResult, 'enable');

    // Recall on R2: should land on `enable` (its only history entry).
    act(() => hookResult.result.current.recallPrev());
    expect(hookResult.result.current.input).toBe('enable');

    // Switch back to R1; recall should land on `show version` (its newest).
    act(() => hookResult.result.current.setActiveDevice('R1'));
    act(() => hookResult.result.current.recallPrev());
    expect(hookResult.result.current.input).toBe('show version');
  });
});
