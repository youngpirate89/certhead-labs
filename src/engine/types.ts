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

/** One block of the worked solution shown by the "See Solution" disclosure.
 *  Each step targets a single device and lists the commands in order; an
 *  optional `note` annotates what this block does (rendered above the block
 *  as a one-line caption). Step grouping matches the way a learner would
 *  type them — switching devices means starting a new step. */
export interface SolutionStep {
  readonly device: string;
  readonly commands: readonly string[];
  readonly note?: string;
}

/** Worked solution displayed by the "See Solution" disclosure in the
 *  objectives sidebar. Every catalog lab ships one — kept optional on the
 *  Lab type so pilot/throwaway labs don't need to author one, but the
 *  catalog convention is to always provide it. */
export interface LabSolution {
  readonly steps: readonly SolutionStep[];
}

export type TopologyDecorationKind = 'wan-cloud';
export type TopologyDecorationVariant = 'wan' | 'isp' | 'internet' | 'provider';

/** Visual-only topology object. Decorations are passive diagram affordances:
 *  no adapter, no session, no console, no command surface, and no grading role. */
export interface TopologyDecoration {
  readonly id: string;
  readonly kind: TopologyDecorationKind;
  readonly label: string;
  readonly variant?: TopologyDecorationVariant;
  readonly position: { readonly x: number; readonly y: number };
}

export interface LabDevice {
  readonly id: string;
  /** Device kind — selects the adapter (router/switch/pc). */
  readonly kind: DeviceKind;
  readonly platform: string;
  /** Optional visual classification — drives the topology canvas's icon
   *  pick. When unset, the icon dispatcher falls back to the `platform`
   *  string. Today only the PC-shaped variants ('workstation', 'server')
   *  are surfaced; routers/switches always render their kind's icon. Use
   *  this when a lab needs a PC-shaped node to render as a rack-unit
   *  server (e.g., Lab 12's BLOCK-ICMP target). */
  readonly deviceClass?: 'workstation' | 'server' | 'access-point' | 'wireless-client';
  readonly interfaces: readonly string[];
  /** PC-only initial state. Routers/switches ignore this. */
  readonly pc?: {
    readonly ip?: string;
    readonly mask?: string;
    readonly gateway?: string;
    /** Optional workstation DNS config for scoped name-resolution labs. */
    readonly dnsServers?: readonly string[];
    readonly dnsRecords?: Readonly<Record<string, string>>;
    /** Lab 10: this PC starts with no static IP and pulls its addressing
     *  from the connected router's DHCP server. `ip`/`mask`/`gateway`
     *  are ignored when `dhcp` is true — the values come from the matching
     *  binding instead. */
    readonly dhcp?: boolean;
  };
  /** Optional per-device topology position. When ALL devices in a lab carry
   *  this, the renderer uses these coordinates verbatim instead of the
   *  default left-to-right row layout — required for non-linear topologies
   *  like the Lab 09 router-on-a-stick T-shape (SW1 as a center hub with
   *  three spokes). x/y are in flow-canvas pixel space, matching NODE_WIDTH
   *  + NODE_GAP from TopologyPanel. */
  readonly position?: { readonly x: number; readonly y: number };
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
  /** Free labs are public starter experiences. Pro labs remain JWT-gated. */
  readonly isFree: boolean;
  /** Real-world framing shown on the lab brief screen before the terminal —
   *  one or two short paragraphs that explain WHY a tech would do this. */
  readonly scenario: string;
  readonly topology: {
    readonly devices: readonly LabDevice[];
    readonly links: readonly Link[];
    readonly decorations?: readonly TopologyDecoration[];
  };
  /** Per-device IOS commands run through applyCommand at session init,
   *  BEFORE the learner gets control. Used to pre-configure a starting
   *  state (e.g. troubleshooting labs that start partly broken).
   *  Seed commands must NOT be recorded in command history — otherwise a
   *  verification objective could be satisfied by setup, not by the learner. */
  readonly setup?: Readonly<Record<string, readonly string[]>>;
  readonly objectives: readonly LabObjective[];
  readonly hints: readonly LabHint[];
  /** Worked solution shown by the sidebar's "See Solution" disclosure.
   *  Closed by default in the UI. Optional on the type so pilots/throwaway
   *  labs can omit it, but every catalog lab MUST provide one — see
   *  CLAUDE.md "solution field standard". */
  readonly solution?: LabSolution;
}
