/**
 * Lab content contract.
 *
 * A lab is a pure data artifact: topology, objectives, and hints. Objective
 * `check`s are declarative queries against device state (CLAUDE.md grading
 * model). For the pilot there is a single syntax adapter (Cisco IOS), so
 * LabState is the IOS device-state map; this generalises when a second adapter
 * lands (see docs/PARSER_ADAPTERS.md, created at that time).
 */
import type { DeviceState } from './adapters/ios/state';
import type { DeviceKind } from './adapters/types';

/** Device-state map keyed by device id, passed to objective checks. */
export type LabState = Record<string, DeviceState>;

/** Command history passed to objective checks.
 *
 *  `raw`      — exactly as the user typed each command (abbreviated, etc.).
 *  `resolved` — the canonical command the resolver produced (full keywords).
 *
 *  Verification-style objectives ("did the user run `show ip interface brief`?")
 *  should match against `resolved` so any valid abbreviation counts without
 *  the lab having to enumerate them in a regex.
 */
export interface CommandHistory {
  readonly raw: readonly string[];
  readonly resolved: readonly string[];
}

export interface LabObjective {
  readonly id: string;
  readonly text: string;
  /** True when this objective is satisfied by the current state / history. */
  readonly check: (state: LabState, history: CommandHistory) => boolean;
}

export interface LabHint {
  readonly afterSeconds: number;
  readonly text: string;
}

export interface LabDevice {
  readonly id: string;
  /** Device kind — selects the adapter (router/switch/pc). 3a: router only. */
  readonly kind: DeviceKind;
  readonly platform: string;
  readonly interfaces: readonly string[];
}

export interface Lab {
  readonly id: string;
  readonly title: string;
  readonly exam: string;
  /** 1 (intro) .. 5 (expert). */
  readonly difficulty: 1 | 2 | 3 | 4 | 5;
  readonly estimatedMinutes: number;
  /** Exactly one lab in the catalog has this set: the public free lab. */
  readonly isFree: boolean;
  /** Real-world framing shown on the lab brief screen before the terminal —
   *  one or two short paragraphs that explain WHY a tech would do this. */
  readonly scenario: string;
  readonly topology: { devices: readonly LabDevice[]; links: readonly never[] };
  readonly objectives: readonly LabObjective[];
  readonly hints: readonly LabHint[];
}
