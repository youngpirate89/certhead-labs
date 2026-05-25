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
import { recomputeOspf } from './adapters/ios/ospf';
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
 *  Runs the nicUp pass once so pc views reflect cable state from the start.
 *
 *  If `lab.setup` is set, each device's seed commands are run through the
 *  real `applyCommand` pipeline (so mode transitions, validators, and
 *  side effects behave identically to typed commands) with `record:false`
 *  — the seeded commands do NOT appear in history, so verification-style
 *  objectives can't be pre-satisfied by setup. Router seed runs are tailed
 *  with `end`/`disable` so the learner lands at the `user>` prompt. */
export function initLabSession(lab: Lab): LabSession {
  if (lab.topology.devices.length === 0) {
    throw new Error(`Lab '${lab.id}' has no devices`);
  }
  const devices: Record<string, DeviceSession> = {};
  for (const spec of lab.topology.devices) {
    const adapter = adapterFor(spec.kind);
    devices[spec.id] = adapter.buildDevice(spec) as DeviceSession;
  }

  if (lab.setup) {
    for (const [deviceId, lines] of Object.entries(lab.setup)) {
      if (!(deviceId in devices)) {
        throw new Error(
          `Lab '${lab.id}' setup references unknown device '${deviceId}'`,
        );
      }
      devices[deviceId] = applySeed(devices[deviceId], lines);
    }
  }

  return refreshDerivedState({
    devices,
    activeDeviceId: lab.topology.devices[0].id,
    links: lab.topology.links,
  });
}

/** Run every "derived-from-state" pass in dependency order: protocolUp/nicUp
 *  first (interface link health), then OSPF adjacency (which depends on the
 *  fresh adminUp + the just-updated peer adminUp), then a second nicUp pass
 *  is unnecessary because OSPF doesn't change interface state. */
function refreshDerivedState(lab: LabSession): LabSession {
  const linkUp = refreshNicUp(lab);
  return refreshOspf(linkUp);
}

/** Apply a list of seed commands to one device with `record:false`. Router
 *  seeds are tailed with `end`/`disable` so the session lands at user mode
 *  — the learner should arrive at the `user>` prompt regardless of which
 *  config-mode command was last in the seed. PCs have no mode stack so the
 *  tail is a router-only concern. */
function applySeed(session: DeviceSession, lines: readonly string[]): DeviceSession {
  let cur = session;
  for (const raw of lines) cur = applySeedLine(cur, raw);
  if (cur.kind === 'router') {
    cur = applySeedLine(cur, 'end');
    cur = applySeedLine(cur, 'disable');
  }
  return cur;
}

function applySeedLine(s: DeviceSession, raw: string): DeviceSession {
  switch (s.kind) {
    case 'router':
      return routerAdapter.applyCommand(s, raw, undefined, { record: false }).session;
    case 'pc':
      return pcAdapter.applyCommand(s, raw, undefined, { record: false }).session;
  }
}

/**
 * Apply a command to the ACTIVE device. Returns a new LabSession with that
 * device's session replaced — all other devices are untouched (no global
 * state). PC nicUp is refreshed afterward, since a router interface going
 * admin-up/down on this turn can flip a PC's link state.
 *
 * Adapters receive the full LabSession via the `ctx` arg so cross-device
 * commands (today: `ping` on the pc adapter, which calls canReach) can
 * read the topology without leaking concerns into per-device state.
 */
export function applyToActive(
  lab: LabSession,
  raw: string,
): { session: LabSession; output: CommandOutput[] } {
  const id = lab.activeDeviceId;
  const cur = lab.devices[id];
  const result = dispatchByKind(cur, raw, lab);
  const next: LabSession = {
    ...lab,
    devices: { ...lab.devices, [id]: result.session },
  };
  return { session: refreshDerivedState(next), output: result.output };
}

/** Kind-dispatch helper so TS narrows on the discriminator. */
function dispatchByKind(
  s: DeviceSession,
  raw: string,
  lab: LabSession,
): { session: DeviceSession; output: CommandOutput[] } {
  switch (s.kind) {
    case 'router': {
      const r = routerAdapter.applyCommand(s, raw, { lab });
      return { session: r.session, output: r.output };
    }
    case 'pc': {
      const r = pcAdapter.applyCommand(s, raw, { lab });
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
 * Refresh `nicUp` on every PC AND `protocolUp` on every router interface.
 *
 * A PC's NIC is up iff a link cables it to a router interface that is
 * currently admin-up — canReach (§4) reads this to short-circuit source-side
 * delivery.
 *
 * A router interface's `protocolUp` is the IOS "line protocol" state:
 *   - admin-down → already false in practice; we set it explicitly anyway so
 *                  show ip int brief reads the same field for both columns
 *   - cabled to a router peer whose interface is admin-down → false
 *     (this is the cold-audit Fix 4: real IOS shows up/down in that case)
 *   - cabled to a PC → true (PCs don't admin-down their NICs in our model)
 *   - uncabled → false (no carrier)
 *
 * Pure: returns a new LabSession; mutates nothing. Single pass per refresh.
 */
function refreshNicUp(lab: LabSession): LabSession {
  let mutated = false;
  const devices: Record<string, DeviceSession> = { ...lab.devices };
  for (const [id, s] of Object.entries(lab.devices)) {
    if (s.kind === 'pc') {
      const up = pcNicIsUp(lab, id, s.nic);
      if (s.nicUp !== up) {
        devices[id] = { ...s, nicUp: up };
        mutated = true;
      }
    } else if (s.kind === 'router') {
      const next = refreshRouterProtocolUp(lab, s);
      if (next !== s) {
        devices[id] = next;
        mutated = true;
      }
    }
  }
  return mutated ? { ...lab, devices } : lab;
}

/** Recompute OSPF neighbors + injected routes across every router in the
 *  topology, in one synchronous pass. Pure: returns the same LabSession if
 *  nothing changed. Always runs AFTER the protocolUp/nicUp pass — adjacency
 *  formation depends on the freshly-evaluated adminUp/peer state.
 *
 *  Failure mode: a topology with zero routers (PCs only) skips the recompute
 *  early. The hot path for the common 1- or 2-router lab is two map walks. */
function refreshOspf(lab: LabSession): LabSession {
  const routers = new Map<string, RouterSession>();
  for (const [id, s] of Object.entries(lab.devices)) {
    if (s.kind === 'router') routers.set(id, s);
  }
  if (routers.size === 0) return lab;
  const updated = recomputeOspf(routers, lab.links);
  let mutated = false;
  const devices: Record<string, DeviceSession> = { ...lab.devices };
  for (const [id, prev] of routers) {
    const next = updated.get(id);
    if (next && next !== prev) {
      devices[id] = next;
      mutated = true;
    }
  }
  return mutated ? { ...lab, devices } : lab;
}

/** Recompute `protocolUp` for every interface on one router. Returns the
 *  same session if nothing changed (lets the outer refresh skip a clone). */
function refreshRouterProtocolUp(lab: LabSession, s: RouterSession): RouterSession {
  let mutated = false;
  const interfaces: Record<string, RouterSession['device']['interfaces'][string]> = {
    ...s.device.interfaces,
  };
  for (const [ifaceId, iface] of Object.entries(s.device.interfaces)) {
    const up = ifaceProtocolUp(lab, s.device.id, ifaceId, iface.adminUp);
    if (iface.protocolUp !== up) {
      interfaces[ifaceId] = { ...iface, protocolUp: up };
      mutated = true;
    }
  }
  if (!mutated) return s;
  return { ...s, device: { ...s.device, interfaces } };
}

/** True when the router interface's line protocol is up — admin-up locally,
 *  cabled, and the peer's interface is admin-up (or the peer is a PC). */
function ifaceProtocolUp(
  lab: LabSession,
  deviceId: string,
  iface: string,
  adminUp: boolean,
): boolean {
  if (!adminUp) return false;
  for (const link of lab.links) {
    const peer = matchEndpoint(link, deviceId, iface);
    if (!peer) continue;
    const neighbor = lab.devices[peer.deviceId];
    if (!neighbor) return false;
    if (neighbor.kind === 'pc') return true;
    const peerIface = neighbor.device.interfaces[peer.iface];
    return peerIface ? peerIface.adminUp : false;
  }
  return false; // uncabled
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
