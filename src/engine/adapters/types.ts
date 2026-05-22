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
}

/** Operational status of a device's interface, derived from its state. */
export type InterfaceStatus = 'up' | 'no-ip' | 'admin-down';

export interface InterfaceTopologyView {
  /** Short canonical id, e.g. `Gi0/0`. */
  readonly id: string;
  /** Full label for tooltip / edge label, e.g. `GigabitEthernet0/0`. */
  readonly name: string;
  readonly status: InterfaceStatus;
  /** Configured IPv4 address (dotted-quad), or null if unassigned. */
  readonly ip: string | null;
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
 * The DeviceAdapter interface. Implementations: router (3a), switch (3c), pc (3b).
 * For 3a only router exists; the LabSession refuses any device whose kind has
 * no registered adapter, so switch/pc can be added incrementally without
 * touching the loader.
 */
export interface DeviceAdapter<S extends DeviceSessionBase> {
  readonly kind: DeviceKind;
  /** Build a fresh session from a lab's device spec. */
  buildDevice(spec: LabDevice): S;
  /** Apply a raw command line — returns a NEW session (immutable) + output. */
  applyCommand(session: S, raw: string): ApplyResult<S>;
  /** Current prompt string (mode-aware, where the device has modes). */
  prompt(session: S): string;
  /** Active grammar tree at the session's current state — drives `?` + Tab. */
  grammarFor(session: S): CommandNode;
  /** Device-kind-agnostic topology view for the canvas. */
  toTopologyView(session: S): DeviceTopologyView;
}
