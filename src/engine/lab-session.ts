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
import { switchAdapter } from './adapters/switch';
import type { CommandOutput, DeviceAdapter, DeviceKind } from './adapters/types';
import type {
  DhcpBinding,
  DhcpPool,
  NatTranslation,
  Session as RouterSession,
} from './adapters/ios/state';
import type { SwitchSession } from './adapters/ios/switch-state';
import { recomputeOspf } from './adapters/ios/ospf';
import {
  findPoolForIp,
  recomputeBindings,
  type DhcpClientRequest,
} from './adapters/ios/dhcp';
import { evaluateAcl } from './adapters/ios/acl';
import { ipInSubnet, networkAddress } from './adapters/ios/routing';
import type { Lab, LabDevice, Link } from './types';

/** Discriminated union of every adapter's session. router + pc + switch. */
export type DeviceSession = RouterSession | PcSession | SwitchSession;

export interface LabSession {
  /** Per-device sessions, keyed by lab device id. Independent state machines. */
  readonly devices: Readonly<Record<string, DeviceSession>>;
  /** Which device the terminal is currently bound to. Always a key in devices. */
  readonly activeDeviceId: string;
  /** Devices the learner has opened a console for, in tab order. Drives the
   *  shared FloatingTerminalPanel's tab strip. Seeded with the initial active
   *  device, appended on `setActive` when a new device is selected; may be
   *  emptied by closing every tab (the panel hides in that state and
   *  re-shows the next time the learner clicks a device in the topology). */
  readonly openDeviceIds: readonly string[];
  /** Cables between device interfaces — authored by the lab, not learners. */
  readonly links: readonly Link[];
}

/** Adapter lookup. Adding a new kind = add a case here; nothing else changes. */
export function adapterFor(
  kind: DeviceKind,
):
  | DeviceAdapter<RouterSession>
  | DeviceAdapter<PcSession>
  | DeviceAdapter<SwitchSession> {
  switch (kind) {
    case 'router':
      return routerAdapter;
    case 'pc':
      return pcAdapter;
    case 'switch':
      return switchAdapter;
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
    openDeviceIds: [lab.topology.devices[0].id],
    links: lab.topology.links,
  });
}

/** Run every "derived-from-state" pass in dependency order: protocolUp/nicUp
 *  first (interface link health), then OSPF adjacency (which depends on the
 *  fresh adminUp + the just-updated peer adminUp), then DHCP — bindings need
 *  the current router pool config + the freshly-evaluated PC nicUp / link
 *  topology — and finally NAT translations, which depend on the freshly-
 *  resolved PC IPs (DHCP can land a PC's ip after this pass, so NAT must
 *  run after DHCP). */
function refreshDerivedState(lab: LabSession): LabSession {
  const linkUp = refreshNicUp(lab);
  const ospf = refreshOspf(linkUp);
  const dhcp = refreshDhcp(ospf);
  return refreshNat(dhcp);
}

/** Apply a list of seed commands to one device with `record:false`. Router
 *  seeds are tailed with `end`/`disable` so the session lands at user mode
 *  — the learner should arrive at the `user>` prompt regardless of which
 *  config-mode command was last in the seed. PCs have no mode stack so the
 *  tail is a router-only concern. */
function applySeed(session: DeviceSession, lines: readonly string[]): DeviceSession {
  let cur = session;
  for (const raw of lines) cur = applySeedLine(cur, raw);
  if (cur.kind === 'router' || cur.kind === 'switch') {
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
    case 'switch':
      return switchAdapter.applyCommand(s, raw, undefined, { record: false }).session;
  }
}

/**
 * Apply a command to a specific device. Returns a new LabSession with that
 * device's session replaced — all other devices are untouched (no global
 * state). PC nicUp is refreshed afterward, since a router interface going
 * admin-up/down on this turn can flip a PC's link state.
 *
 * Adapters receive the full LabSession via the `ctx` arg so cross-device
 * commands (today: `ping` on the pc adapter, which calls canReach) can
 * read the topology without leaking concerns into per-device state.
 *
 * Floating panels (each bound to one device) call this directly with their
 * own deviceId. The single-active legacy path goes through `applyToActive`
 * which is now a thin wrapper.
 */
export function applyToDevice(
  lab: LabSession,
  deviceId: string,
  raw: string,
): {
  session: LabSession;
  output: CommandOutput[];
  stream?: AsyncIterable<CommandOutput>;
} {
  const cur = lab.devices[deviceId];
  if (!cur) {
    throw new Error(`applyToDevice: unknown device id '${deviceId}'`);
  }
  const result = dispatchByKind(cur, raw, lab);
  const next: LabSession = {
    ...lab,
    devices: { ...lab.devices, [deviceId]: result.session },
  };
  return {
    session: refreshDerivedState(next),
    output: result.output,
    stream: result.stream,
  };
}

/** Back-compat shortcut: apply a command to whichever device is currently
 *  active. Floating panels carry their own deviceId so they call
 *  `applyToDevice` directly. */
export function applyToActive(
  lab: LabSession,
  raw: string,
): {
  session: LabSession;
  output: CommandOutput[];
  stream?: AsyncIterable<CommandOutput>;
} {
  return applyToDevice(lab, lab.activeDeviceId, raw);
}

/** Kind-dispatch helper so TS narrows on the discriminator. */
function dispatchByKind(
  s: DeviceSession,
  raw: string,
  lab: LabSession,
): {
  session: DeviceSession;
  output: CommandOutput[];
  stream?: AsyncIterable<CommandOutput>;
} {
  switch (s.kind) {
    case 'router': {
      const r = routerAdapter.applyCommand(s, raw, { lab });
      return { session: r.session, output: r.output, stream: r.stream };
    }
    case 'pc': {
      const r = pcAdapter.applyCommand(s, raw, { lab });
      return { session: r.session, output: r.output, stream: r.stream };
    }
    case 'switch': {
      const r = switchAdapter.applyCommand(s, raw, { lab });
      return { session: r.session, output: r.output, stream: r.stream };
    }
  }
}

/** Switch which device the terminal is bound to. Throws on unknown id.
 *  Appends `id` to openDeviceIds if it isn't already a tab — the topology
 *  click path is the only way new tabs appear, so this is the chokepoint. */
export function setActive(lab: LabSession, id: string): LabSession {
  if (!(id in lab.devices)) {
    throw new Error(`setActive: unknown device id '${id}'`);
  }
  const openDeviceIds = lab.openDeviceIds.includes(id)
    ? lab.openDeviceIds
    : [...lab.openDeviceIds, id];
  if (id === lab.activeDeviceId && openDeviceIds === lab.openDeviceIds) return lab;
  return { ...lab, activeDeviceId: id, openDeviceIds };
}

/** Close one device tab. Removes `id` from openDeviceIds and — if it was the
 *  active tab — moves activeDeviceId to the neighbor on the LEFT (or the new
 *  first tab if the closed one was leftmost). Closing the last open tab
 *  leaves openDeviceIds empty and activeDeviceId pointing at the just-closed
 *  device id: the panel hides while empty, and a subsequent `setActive` (from
 *  a topology click) re-opens that device's tab. Unknown id throws so
 *  miswired callers fail loud rather than silently no-op. */
export function closeDevice(lab: LabSession, id: string): LabSession {
  const idx = lab.openDeviceIds.indexOf(id);
  if (idx === -1) {
    throw new Error(`closeDevice: '${id}' is not an open tab`);
  }
  const openDeviceIds = [
    ...lab.openDeviceIds.slice(0, idx),
    ...lab.openDeviceIds.slice(idx + 1),
  ];
  const activeDeviceId =
    id === lab.activeDeviceId && openDeviceIds.length > 0
      ? openDeviceIds[Math.max(0, idx - 1)]
      : lab.activeDeviceId;
  return { ...lab, openDeviceIds, activeDeviceId };
}

/** Close every open device tab. Empties openDeviceIds and leaves
 *  activeDeviceId on its current value — still a valid device id in
 *  `devices`, so banner/prompt lookups stay safe; the panel hides while
 *  the list is empty and re-opens via the topology click → setActive path. */
export function closeAllDevices(lab: LabSession): LabSession {
  if (lab.openDeviceIds.length === 0) return lab;
  return { ...lab, openDeviceIds: [] };
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
  return promptFor(activeSession(lab));
}

/** Render the prompt for any device session. Used by useTerminal to surface
 *  per-device prompts (floating panels show their own device's prompt, not
 *  the activeDeviceId's). */
export function promptFor(s: DeviceSession): string {
  switch (s.kind) {
    case 'router':
      return routerAdapter.prompt(s);
    case 'pc':
      return pcAdapter.prompt(s);
    case 'switch':
      return switchAdapter.prompt(s);
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
    } else if (s.kind === 'switch') {
      const next = refreshSwitchProtocolUp(lab, s);
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

/**
 * Recompute DHCP bindings across every router AND propagate the resulting
 * ip/mask/gateway into the DHCP-client PCs. Same shape as refreshOspf:
 * pure, returns the same LabSession when nothing changed.
 *
 * Client discovery — for each PC with `dhcpMode: true`, walk the link from
 * the PC's NIC to find the cabled router AND the router's interface IP+mask
 * that sits on the PC's link. Pick the router's pool whose network covers
 * that interface IP. Result: a `DhcpClientRequest` for the matching
 * (router, pool) pair. PCs cabled to switches walk through the L2 broadcast
 * domain (Lab 09 router-on-a-stick pattern) to find the matching router
 * subinterface — same `findRouterGatewayThroughSwitch` approach used by
 * reachability would be overkill here; Lab 10 keeps it simple with a direct
 * PC↔Router cable, and the BFS path is left for when a future lab needs it.
 */
function refreshDhcp(lab: LabSession): LabSession {
  // Group DHCP-client PCs by the router they should request from. PCs with
  // dhcpMode but no resolvable router stay unbound (their ip/mask/gateway
  // remain null — ipconfig shows "DHCP request pending").
  const requestsByRouter = new Map<string, DhcpClientRequest[]>();
  const pcResolution = new Map<
    string,
    { routerId: string; poolName: string } | null
  >();

  for (const [id, s] of Object.entries(lab.devices)) {
    if (s.kind !== 'pc' || !s.dhcpMode) continue;
    const resolved = resolveDhcpClientPool(lab, s);
    pcResolution.set(id, resolved);
    if (!resolved) continue;
    const list = requestsByRouter.get(resolved.routerId) ?? [];
    list.push({ clientId: id, poolName: resolved.poolName });
    requestsByRouter.set(resolved.routerId, list);
  }

  // Recompute bindings on each affected router. Routers with no DHCP
  // clients in this lab still need their existing bindings cleared (e.g.
  // a PC just removed from the topology).
  let mutated = false;
  const devices: Record<string, DeviceSession> = { ...lab.devices };

  const bindingsByRouter = new Map<string, Map<string, DhcpBinding>>();
  for (const [id, s] of Object.entries(lab.devices)) {
    if (s.kind !== 'router') continue;
    const requests = requestsByRouter.get(id) ?? [];
    const newBindings = recomputeBindings(
      s.device.dhcpPools,
      s.device.dhcpExcluded,
      requests,
    );
    bindingsByRouter.set(id, newBindings);
    if (!bindingsEqual(s.device.dhcpBindings, newBindings)) {
      devices[id] = {
        ...s,
        device: { ...s.device, dhcpBindings: newBindings },
      };
      mutated = true;
    }
  }

  // Propagate bindings into the PC sessions: ip/mask/gateway take the
  // matching pool's values. PCs without a resolved binding (no pool ready,
  // pool exhausted, unreachable router) get cleared back to null so
  // ipconfig reads "DHCP request pending".
  for (const [id, s] of Object.entries(lab.devices)) {
    if (s.kind !== 'pc' || !s.dhcpMode) continue;
    const resolution = pcResolution.get(id) ?? null;
    let nextIp: string | null = null;
    let nextMask: string | null = null;
    let nextGateway: string | null = null;
    if (resolution) {
      const router = lab.devices[resolution.routerId];
      const binding = bindingsByRouter.get(resolution.routerId)?.get(id);
      if (router?.kind === 'router' && binding) {
        const pool = router.device.dhcpPools.get(binding.poolName);
        nextIp = binding.ip;
        nextMask = pool?.mask ?? null;
        nextGateway = pool?.defaultRouter ?? null;
      }
    }
    if (s.ip !== nextIp || s.mask !== nextMask || s.gateway !== nextGateway) {
      devices[id] = { ...s, ip: nextIp, mask: nextMask, gateway: nextGateway };
      mutated = true;
    }
  }

  return mutated ? { ...lab, devices } : lab;
}

/** True if two binding maps describe the same set (same clientIds → same
 *  ip/poolName). Used to skip a no-op router-state replace. */
function bindingsEqual(
  a: ReadonlyMap<string, DhcpBinding>,
  b: ReadonlyMap<string, DhcpBinding>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) return false;
    if (vb.ip !== va.ip || vb.poolName !== va.poolName) return false;
  }
  return true;
}

/** Recompute every router's NAT translation table from current state. Mirrors
 *  refreshDhcp / refreshOspf: walk routers, build the new translation map,
 *  skip the replace when nothing changed. Pure: returns the same LabSession
 *  when no router's table moved. (Lab 11.) */
function refreshNat(lab: LabSession): LabSession {
  let mutated = false;
  const devices: Record<string, DeviceSession> = { ...lab.devices };
  for (const [id, s] of Object.entries(lab.devices)) {
    if (s.kind !== 'router') continue;
    const next = computeNatTranslations(lab, s);
    if (!translationsEqual(s.device.natTranslations, next)) {
      devices[id] = { ...s, device: { ...s.device, natTranslations: next } };
      mutated = true;
    }
  }
  return mutated ? { ...lab, devices } : lab;
}

/** Build the NAT translation table for one router. An entry exists per
 *  (PC, statement) pair where:
 *   - the statement's outsideInterface has natRole 'outside' and an IP
 *   - the router has at least one inside-marked interface with an IP that
 *     equals the PC's default gateway (i.e. the PC is in this router's
 *     LAN-side broadcast domain via the inside interface)
 *   - the ACL referenced by the statement exists and permits the PC's IP
 *  Keyed by insideLocal IP so a PC appears at most once even when multiple
 *  statements would match. */
function computeNatTranslations(
  lab: LabSession,
  router: RouterSession,
): Map<string, NatTranslation> {
  const out = new Map<string, NatTranslation>();
  if (router.device.natStatements.length === 0) return out;

  const insideIfaceIps = new Set<string>();
  for (const i of Object.values(router.device.interfaces)) {
    if (i.natRole === 'inside' && i.ip) insideIfaceIps.add(i.ip);
  }
  if (insideIfaceIps.size === 0) return out;

  for (const stmt of router.device.natStatements) {
    const outsideIface = router.device.interfaces[stmt.outsideInterface];
    if (!outsideIface || outsideIface.natRole !== 'outside' || !outsideIface.ip) {
      continue;
    }
    const acl = router.device.acls.get(stmt.aclId);
    if (!acl) continue;
    for (const peer of Object.values(lab.devices)) {
      if (peer.kind !== 'pc') continue;
      if (!peer.ip || !peer.gateway) continue;
      if (!insideIfaceIps.has(peer.gateway)) continue;
      if (evaluateAcl(acl, peer.ip) !== 'permit') continue;
      out.set(peer.ip, { insideLocal: peer.ip, insideGlobal: outsideIface.ip });
    }
  }
  return out;
}

/** True if two NAT-translation maps describe the same set. Used to skip a
 *  no-op router-state replace. */
function translationsEqual(
  a: ReadonlyMap<string, NatTranslation>,
  b: ReadonlyMap<string, NatTranslation>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) return false;
    if (vb.insideLocal !== va.insideLocal || vb.insideGlobal !== va.insideGlobal) {
      return false;
    }
  }
  return true;
}

/** For a DHCP-client PC, find the (router, pool) it should request from.
 *  Walks the PC's cable to the neighbor router (Lab 10 has direct cabling;
 *  switch-fronted DHCP isn't in scope yet), reads the cabled router
 *  interface's IP+mask, and picks the router pool whose network covers it.
 *  Returns null when the cable doesn't land on a router or no pool matches —
 *  the PC stays unbound in that case. */
function resolveDhcpClientPool(
  lab: LabSession,
  pc: PcSession,
): { routerId: string; poolName: string } | null {
  for (const link of lab.links) {
    let myIface: string | null = null;
    let peer: { deviceId: string; iface: string } | null = null;
    if (link.a.deviceId === pc.id && link.a.iface === pc.nic) {
      myIface = link.a.iface;
      peer = link.b;
    } else if (link.b.deviceId === pc.id && link.b.iface === pc.nic) {
      myIface = link.b.iface;
      peer = link.a;
    }
    if (!myIface || !peer) continue;
    const neighbor = lab.devices[peer.deviceId];
    if (!neighbor || neighbor.kind !== 'router') return null;
    const iface = neighbor.device.interfaces[peer.iface];
    if (!iface || !iface.ip || !iface.mask) return null;
    const pool = pickPoolForIfaceSubnet(neighbor.device.dhcpPools, iface.ip, iface.mask);
    if (!pool) return null;
    return { routerId: neighbor.device.id, poolName: pool.name };
  }
  return null;
}

/** Pick the pool whose network exactly matches the cabled router interface's
 *  subnet. The router-interface IP must sit inside the pool's network AND
 *  the pool's mask must match the interface's mask — otherwise a /24 pool
 *  could accidentally serve a /30 P2P link. */
function pickPoolForIfaceSubnet(
  pools: ReadonlyMap<string, DhcpPool>,
  ifaceIp: string,
  ifaceMask: string,
): DhcpPool | null {
  for (const pool of pools.values()) {
    if (!pool.network || !pool.mask) continue;
    if (pool.mask !== ifaceMask) continue;
    if (ipInSubnet(ifaceIp, networkAddress(pool.network, pool.mask), pool.mask)) {
      return pool;
    }
  }
  // Fall back to "any pool whose network covers the iface IP" so a
  // mask-mismatched but otherwise covering pool still matches. Same loop
  // shape, looser predicate — favors the strict match above.
  return findPoolForIp(pools, ifaceIp);
}

/** Recompute `protocolUp` for every physical interface AND subinterface on one
 *  router. Returns the same session if nothing changed (lets the outer refresh
 *  skip a clone). Subif protocolUp resolves to `adminUp && parent.protocolUp`
 *  — so this MUST run after the physical pass so each subif sees the fresh
 *  parent state. */
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
  const subInterfaces: Record<string, RouterSession['device']['subInterfaces'][string]> = {
    ...s.device.subInterfaces,
  };
  for (const [subId, sub] of Object.entries(s.device.subInterfaces)) {
    const parent = interfaces[sub.parentId];
    const parentUp = parent ? parent.adminUp && parent.protocolUp : false;
    const up = sub.adminUp && parentUp;
    if (sub.protocolUp !== up) {
      subInterfaces[subId] = { ...sub, protocolUp: up };
      mutated = true;
    }
  }
  if (!mutated) return s;
  return { ...s, device: { ...s.device, interfaces, subInterfaces } };
}

/** Recompute `protocolUp` for every switchport on one switch. Same shape as
 *  the router refresh — a port whose cabled peer is admin-down reports line
 *  protocol down. */
function refreshSwitchProtocolUp(lab: LabSession, s: SwitchSession): SwitchSession {
  let mutated = false;
  const switchports: Record<string, SwitchSession['device']['switchports'][string]> = {
    ...s.device.switchports,
  };
  for (const [portId, port] of Object.entries(s.device.switchports)) {
    const up = peerLinkIsUp(lab, s.device.id, portId, port.adminUp);
    if (port.protocolUp !== up) {
      switchports[portId] = { ...port, protocolUp: up };
      mutated = true;
    }
  }
  if (!mutated) return s;
  return { ...s, device: { ...s.device, switchports } };
}

/** True when the router interface's line protocol is up — admin-up locally,
 *  cabled, and the peer's interface is admin-up (or the peer is a PC). */
function ifaceProtocolUp(
  lab: LabSession,
  deviceId: string,
  iface: string,
  adminUp: boolean,
): boolean {
  return peerLinkIsUp(lab, deviceId, iface, adminUp);
}

/** Shared link-state predicate for router AND switch interfaces. True iff the
 *  local end is admin-up AND the cable runs to an admin-up neighbor end. PCs
 *  are treated as always-up (we don't model NIC admin-down on PCs). Uncabled
 *  interfaces return false. */
function peerLinkIsUp(
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
    if (neighbor.kind === 'router') {
      const peerIface = neighbor.device.interfaces[peer.iface];
      return peerIface ? peerIface.adminUp : false;
    }
    if (neighbor.kind === 'switch') {
      const peerPort = neighbor.device.switchports[peer.iface];
      return peerPort ? peerPort.adminUp : false;
    }
    return false;
  }
  return false; // uncabled
}

/** Resolve the neighbor of a PC's NIC and report whether the neighbor's
 *  interface is admin-up. Returns false if the PC is uncabled. Switch and
 *  router peers both count — Session 1 of the switch build adds switch peers
 *  to the recognised neighbor set so a PC cabled to a switch reports nicUp. */
function pcNicIsUp(lab: LabSession, pcId: string, nic: string): boolean {
  for (const link of lab.links) {
    const peer = matchEndpoint(link, pcId, nic);
    if (!peer) continue;
    const neighbor = lab.devices[peer.deviceId];
    if (!neighbor) return false;
    if (neighbor.kind === 'router') {
      const iface = neighbor.device.interfaces[peer.iface];
      return iface ? iface.adminUp : false;
    }
    if (neighbor.kind === 'switch') {
      const port = neighbor.device.switchports[peer.iface];
      return port ? port.adminUp : false;
    }
    return false;
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
