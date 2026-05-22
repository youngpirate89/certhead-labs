/**
 * LabSession — the multi-device session state.
 *
 * Per docs/MULTI_DEVICE_TOPOLOGY.md (Model section):
 *   LabSession = { devices: Record<id, DeviceSession>, activeDeviceId, links }
 *
 * Each DeviceSession is independent — N independent state machines, no global
 * device state. A command targets the active device only; switching the
 * active device leaves every other device's state untouched. For an N=1 lab
 * (the free lab today) this collapses to one entry and the original
 * single-device behavior is preserved exactly.
 *
 * Reachability / canReach is explicitly OUT of 3a — see the spec build order.
 */
import { routerAdapter } from './adapters/router';
import type { CommandOutput, DeviceAdapter, DeviceKind } from './adapters/types';
import type { Session as RouterSession } from './adapters/ios/state';
import type { Lab, LabDevice, Link } from './types';

/** Discriminated union of every adapter's session. 3a: router only. */
export type DeviceSession = RouterSession;

export interface LabSession {
  /** Per-device sessions, keyed by lab device id. Independent state machines. */
  readonly devices: Readonly<Record<string, DeviceSession>>;
  /** Which device the terminal is currently bound to. Always a key in devices. */
  readonly activeDeviceId: string;
  /** Cables between device interfaces — authored by the lab, not learners. */
  readonly links: readonly Link[];
}

/** Adapter lookup. Adding a new kind = add a case here; nothing else changes. */
export function adapterFor(kind: DeviceKind): DeviceAdapter<DeviceSession> {
  switch (kind) {
    case 'router':
      return routerAdapter;
    case 'switch':
    case 'pc':
      throw new Error(`Device kind '${kind}' is not yet supported (3b/3c).`);
  }
}

/** Build a fresh LabSession for a lab. The first authored device is active. */
export function initLabSession(lab: Lab): LabSession {
  if (lab.topology.devices.length === 0) {
    throw new Error(`Lab '${lab.id}' has no devices`);
  }
  const devices: Record<string, DeviceSession> = {};
  for (const spec of lab.topology.devices) {
    devices[spec.id] = adapterFor(spec.kind).buildDevice(spec);
  }
  return {
    devices,
    activeDeviceId: lab.topology.devices[0].id,
    links: lab.topology.links,
  };
}

/**
 * Apply a command to the ACTIVE device. Returns a new LabSession with that
 * device's session replaced — all other devices are untouched (no global
 * state). Output is whatever the adapter produced.
 */
export function applyToActive(
  lab: LabSession,
  raw: string,
): { session: LabSession; output: CommandOutput[] } {
  const id = lab.activeDeviceId;
  const cur = lab.devices[id];
  const result = dispatchByKind(cur, raw);
  return {
    session: { ...lab, devices: { ...lab.devices, [id]: result.session } },
    output: result.output,
  };
}

/** Kind-dispatch helper so TS narrows on the discriminator. */
function dispatchByKind(
  s: DeviceSession,
  raw: string,
): { session: DeviceSession; output: CommandOutput[] } {
  switch (s.kind) {
    case 'router': {
      const r = routerAdapter.applyCommand(s, raw);
      return { session: r.session, output: r.output };
    }
  }
}

/** Switch which device the terminal is bound to. Throws on unknown id. */
export function setActive(lab: LabSession, id: string): LabSession {
  if (!(id in lab.devices)) {
    throw new Error(`setActive: unknown device id '${id}'`);
  }
  if (id === lab.activeDeviceId) return lab;
  return { ...lab, activeDeviceId: id };
}

/** Replace one device's session — used by reset() in the terminal layer. */
export function replaceDevice(lab: LabSession, id: string, next: DeviceSession): LabSession {
  if (!(id in lab.devices)) {
    throw new Error(`replaceDevice: unknown device id '${id}'`);
  }
  return { ...lab, devices: { ...lab.devices, [id]: next } };
}

/** Build a fresh session for one device from its spec — used by reset(). */
export function freshDevice(spec: LabDevice): DeviceSession {
  return adapterFor(spec.kind).buildDevice(spec);
}

/** Convenience: the currently-active device's session. */
export function activeSession(lab: LabSession): DeviceSession {
  return lab.devices[lab.activeDeviceId];
}

/** Convenience: the prompt string for the active device. */
export function activePrompt(lab: LabSession): string {
  const s = activeSession(lab);
  switch (s.kind) {
    case 'router':
      return routerAdapter.prompt(s);
  }
}
