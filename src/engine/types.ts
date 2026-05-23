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
import type { LabSession } from './lab-session';

/** Device-state map passed to objective checks. Keyed by device id. Only
 *  router state appears here — PC/switch state is accessed via the `session`
 *  argument so the shape stays predictable for router-centric checks. */
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

/** Per-device command-history map passed to objective checks. */
export type HistoryView = Readonly<Record<string, CommandHistory>>;

export interface LabObjective {
  readonly id: string;
  readonly text: string;
  /** True when this objective is satisfied by the current state / histories.
   *
   *  `state` exposes router device state (interfaces) only — most checks
   *  read this. `history` is keyed by device id and includes every kind.
   *  `session` is the full LabSession — reachability checks
   *  (`canReach(session, …)`) and PC-state checks live here. */
  readonly check: (
    state: LabState,
    history: HistoryView,
    session: LabSession,
  ) => boolean;
}

export interface LabHint {
  readonly afterSeconds: number;
  readonly text: string;
}

export interface LabDevice {
  readonly id: string;
  /** Device kind — selects the adapter (router/switch/pc). */
  readonly kind: DeviceKind;
  readonly platform: string;
  readonly interfaces: readonly string[];
  /** PC-only initial state. Routers/switches ignore this. */
  readonly pc?: {
    readonly ip?: string;
    readonly mask?: string;
    readonly gateway?: string;
  };
}

/** One end of a cable: a (deviceId, iface) pair. */
export interface LinkEndpoint {
  readonly deviceId: string;
  readonly iface: string;
}

/** A cable between two device interfaces. Authored by labs, not learners.
 *  Reachability checks (3b+) traverse these — for 3a they're metadata + edges. */
export interface Link {
  readonly a: LinkEndpoint;
  readonly b: LinkEndpoint;
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
  readonly topology: { devices: readonly LabDevice[]; links: readonly Link[] };
  /** Per-device IOS commands run through applyCommand at session init,
   *  BEFORE the learner gets control. Used to pre-configure a starting
   *  state (e.g. troubleshooting labs that start partly broken).
   *  Seed commands must NOT be recorded in command history — otherwise a
   *  verification objective could be satisfied by setup, not by the learner. */
  readonly setup?: Readonly<Record<string, readonly string[]>>;
  readonly objectives: readonly LabObjective[];
  readonly hints: readonly LabHint[];
}
