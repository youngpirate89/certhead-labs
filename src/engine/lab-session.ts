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
 * 3b adds the pc kind (endpoint, single NIC, default gateway) and a nicUp
 * refresh pass that runs after every applyToActive — a PC's NIC is up iff its
 * lone cable lands on an admin-up neighbor interface. canReach (3b-c5) reads
 * nicUp directly; ping (3b-c6) sits on canReach.
 */
import { routerAdapter } from './adapters/router';
import { pcAdapter, type PcSession } from './adapters/pc';
import type { CommandOutput, DeviceAdapter, DeviceKind } from './adapters/types';
import type { Session as RouterSession } from './adapters/ios/state';
import type { Lab, LabDevice, Link } from './types';

/** Discriminated union of every adapter's session. 3b: router + pc. */
export type DeviceSession = RouterSession | PcSession;

export interface LabSession {
  /** Per-device sessions, keyed by lab device id. Independent state machines. */
  readonly devices: Readonly<Record<string, DeviceSession>>;
  /** Which device the terminal is currently bound to. Always a key in devices. */
  readonly activeDeviceId: string;
  /** Cables between device interfaces — authored by the lab, not learners. */
  readonly links: readonly Link[];
}

/** Adapter lookup. Adding a new kind = add a case here; nothing else changes. */
export function adapterFor(
  kind: DeviceKind,
): DeviceAdapter<RouterSession> | DeviceAdapter<PcSession> {
  switch (kind) {
    case 'router':
      return routerAdapter;
    case 'pc':
      return pcAdapter;
    case 'switch':
      throw new Error(`Device kind '${kind}' is not yet supported (3c).`);
  }
}

/** Build a fresh LabSession for a lab. The first authored device is active.
 *  Runs the nicUp pass once so pc views reflect cable state from the start. */
export function initLabSession(lab: Lab): LabSession {
  if (lab.topology.devices.length === 0) {
    throw new Error(`Lab '${lab.id}' has no devices`);
  }
  const devices: Record<string, DeviceSession> = {};
  for (const spec of lab.topology.devices) {
    const adapter = adapterFor(spec.kind);
    devices[spec.id] = adapter.buildDevice(spec) as DeviceSession;
  }
  return refreshNicUp({
    devices,
    activeDeviceId: lab.topology.devices[0].id,
    links: lab.topology.links,
  });
}

/**
 * Apply a command to the ACTIVE device. Returns a new LabSession with that
 * device's session replaced — all other devices are untouched (no global
 * state). PC nicUp is refreshed afterward, since a router interface going
 * admin-up/down on this turn can flip a PC's link state.
 */
export function applyToActive(
  lab: LabSession,
  raw: string,
): { session: LabSession; output: CommandOutput[] } {
  const id = lab.activeDeviceId;
  const cur = lab.devices[id];
  const result = dispatchByKind(cur, raw);
  const next: LabSession = {
    ...lab,
    devices: { ...lab.devices, [id]: result.session },
  };
  return { session: refreshNicUp(next), output: result.output };
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
    case 'pc': {
      const r = pcAdapter.applyCommand(s, raw);
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
  return adapterFor(spec.kind).buildDevice(spec) as DeviceSession;
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
    case 'pc':
      return pcAdapter.prompt(s);
  }
}

/**
 * Refresh `nicUp` on every PC in the LabSession.
 *
 * A PC has a single NIC. Its NIC is up iff a link in the topology cables that
 * NIC to a router interface that is currently admin-up. This is read by
 * canReach (3b-c5) to short-circuit source-side delivery checks.
 *
 * Pure: returns a new LabSession; mutates nothing.
 */
function refreshNicUp(lab: LabSession): LabSession {
  let mutated = false;
  const devices: Record<string, DeviceSession> = { ...lab.devices };
  for (const [id, s] of Object.entries(lab.devices)) {
    if (s.kind !== 'pc') continue;
    const up = pcNicIsUp(lab, id, s.nic);
    if (s.nicUp !== up) {
      devices[id] = { ...s, nicUp: up };
      mutated = true;
    }
  }
  return mutated ? { ...lab, devices } : lab;
}

/** Resolve the neighbor of a PC's NIC and report whether the neighbor's
 *  interface is admin-up. Returns false if the PC is uncabled. */
function pcNicIsUp(lab: LabSession, pcId: string, nic: string): boolean {
  for (const link of lab.links) {
    const peer = matchEndpoint(link, pcId, nic);
    if (!peer) continue;
    const neighbor = lab.devices[peer.deviceId];
    if (!neighbor || neighbor.kind !== 'router') return false;
    const iface = neighbor.device.interfaces[peer.iface];
    return iface ? iface.adminUp : false;
  }
  return false;
}

function matchEndpoint(
  link: Link,
  deviceId: string,
  iface: string,
): { deviceId: string; iface: string } | null {
  if (link.a.deviceId === deviceId && link.a.iface === iface) return link.b;
  if (link.b.deviceId === deviceId && link.b.iface === iface) return link.a;
  return null;
}
