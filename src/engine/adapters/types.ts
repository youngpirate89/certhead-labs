/**
 * Shared adapter contracts.
 *
 * A DeviceAdapter is the seam between the engine and a particular device kind
 * (router / switch / pc). Each adapter exposes the same five operations, so the
 * lab session, terminal binding, and topology canvas can drive any device kind
 * uniformly — see docs/MULTI_DEVICE_TOPOLOGY.md (Model section).
 *
 * View shapes are device-kind-agnostic: the canvas renders DeviceTopologyView
 * objects without knowing whether they were produced by router/switch/pc.
 */
import type { CommandNode } from '@/engine/parser';
import type { LabDevice } from '@/engine/types';
// LabSession import deferred to type position only — avoids a runtime cycle
// (lab-session.ts already pulls in adapters/types.ts for the DeviceAdapter
// interface). The `AdapterContext` type below references it through `import`
// in TypeScript's type-only position.
import type { LabSession } from '@/engine/lab-session';

/** Device kinds supported by the engine. Switch + pc land in 3b/3c (spec). */
export type DeviceKind = 'router' | 'switch' | 'pc';

/** Every DeviceSession carries its kind so consumers can dispatch generically. */
export interface DeviceSessionBase {
  readonly kind: DeviceKind;
}

/** A line of terminal output produced by executing a command. */
export interface CommandOutput {
  readonly kind: 'output' | 'error' | 'system';
  readonly text: string;
}

export interface ApplyResult<S extends DeviceSessionBase> {
  readonly session: S;
  readonly output: CommandOutput[];
  /** Optional async tail: lines emitted after `output`, one at a time. The
   *  terminal disables input while draining the stream so a long-running
   *  command (today: streamed `tracert`) reads as a single user action even
   *  though its output arrives over time. Session state is decided
   *  synchronously up-front — the stream is presentation only. */
  readonly stream?: AsyncIterable<CommandOutput>;
}

/** Optional cross-device context passed to `applyCommand`. Today only the pc
 *  adapter consumes it — `ping` needs the full LabSession so canReach can
 *  walk the topology. Per-device adapter tests that don't exercise such
 *  commands pass `undefined`. */
export interface AdapterContext {
  readonly lab: LabSession;
}

/** Per-call apply options.
 *
 *  `record` — when `false`, the command runs through the full pipeline (resolver,
 *  mode transitions, side effects on device state) but is NOT pushed onto
 *  the device's `history` / `resolvedHistory`. Used by `Lab.setup` seeding so
 *  pre-configured starting state doesn't pre-satisfy verification objectives
 *  that match on command history. Defaults to `true` (record). */
export interface ApplyOptions {
  readonly record?: boolean;
}

/** Operational status of a device's interface, derived from its state.
 *  - `up`             : admin-up, line protocol up, IP assigned.
 *  - `no-ip`          : admin-up, no IP yet (won't route, but link works).
 *  - `protocol-down`  : admin-up locally, but the cabled peer is admin-down
 *                       (line protocol is down). LED renders red.
 *  - `admin-down`     : `shutdown` was applied locally.
 */
export type InterfaceStatus = 'up' | 'no-ip' | 'protocol-down' | 'admin-down';

export interface InterfaceTopologyView {
  /** Short canonical id, e.g. `Gi0/0`. */
  readonly id: string;
  /** Full label for tooltip / edge label, e.g. `GigabitEthernet0/0`. */
  readonly name: string;
  readonly status: InterfaceStatus;
  /** Configured IPv4 address (dotted-quad), or null if unassigned. */
  readonly ip: string | null;
  /** Dotted-quad subnet mask, or null if unassigned. Exposed so the topology
   *  canvas can derive the network label (CIDR) for a link without importing
   *  adapter internals. Derived from existing state — no engine-state change. */
  readonly mask: string | null;
  /** Local admin state — `no shutdown` applied locally. Cable LED color is
   *  `adminUp && protocolUp` on both ends; the IP state belongs to `status`
   *  and is intentionally NOT part of the L1/L2 link signal. */
  readonly adminUp: boolean;
  /** Line-protocol state — admin-up locally AND the cabled peer is admin-up
   *  (PCs are always "protocol up" for this purpose). False on an uncabled
   *  or peer-down link. */
  readonly protocolUp: boolean;
}

export interface DeviceTopologyView {
  readonly id: string;
  readonly kind: DeviceKind;
  readonly hostname: string;
  /** Short platform/model label (badge), e.g. `ISR4321`. */
  readonly platform: string;
  readonly interfaces: readonly InterfaceTopologyView[];
}

/**
 * The DeviceAdapter interface. Implementations: router (3a), pc (3b),
 * switch (3c). For 3b router + pc exist; the LabSession refuses any device
 * whose kind has no registered adapter, so switch can be added in 3c without
 * touching the loader.
 */
export interface DeviceAdapter<S extends DeviceSessionBase> {
  readonly kind: DeviceKind;
  /** Build a fresh session from a lab's device spec. */
  buildDevice(spec: LabDevice): S;
  /** Apply a raw command line — returns a NEW session (immutable) + output.
   *  `ctx.lab` exposes the full LabSession for commands that read across
   *  devices (today: `ping`). Stays optional; adapter-level unit tests can
   *  omit it for commands that don't need it.
   *  `opts.record === false` suppresses history pushes — see {@link ApplyOptions}
   *  and the `Lab.setup` seeding path in lab-session.ts. */
  applyCommand(
    session: S,
    raw: string,
    ctx?: AdapterContext,
    opts?: ApplyOptions,
  ): ApplyResult<S>;
  /** Current prompt string (mode-aware, where the device has modes). */
  prompt(session: S): string;
  /** Active grammar tree at the session's current state — drives `?` + Tab. */
  grammarFor(session: S): CommandNode;
  /** IOS-style `?` context help for an in-progress line (sans the `?`). */
  contextHelp(session: S, partialLine: string): CommandOutput[];
  /** Tab-complete the current input. Returns null to leave it untouched
   *  (ambiguous prefix, no partial, argument position). */
  tabComplete(session: S, partialLine: string): string | null;
  /** Device-kind-agnostic topology view for the canvas. */
  toTopologyView(session: S): DeviceTopologyView;
}
