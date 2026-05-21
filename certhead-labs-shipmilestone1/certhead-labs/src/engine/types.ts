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

/** Device-state map keyed by device id, passed to objective checks. */
export type LabState = Record<string, DeviceState>;

export interface LabObjective {
  readonly id: string;
  readonly text: string;
  /** True when this objective is satisfied by the current state / history. */
  readonly check: (state: LabState, history: readonly string[]) => boolean;
}

export interface LabHint {
  readonly afterSeconds: number;
  readonly text: string;
}

export interface LabDevice {
  readonly id: string;
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
  readonly topology: { devices: readonly LabDevice[]; links: readonly never[] };
  readonly objectives: readonly LabObjective[];
  readonly hints: readonly LabHint[];
}
