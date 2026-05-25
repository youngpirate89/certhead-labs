/**
 * OSPF neighbor formation + route injection — synchronous, scenario-scoped.
 *
 * Per CLAUDE.md guardrail #8 the engine is deterministic; OSPF here is NOT a
 * timer-based protocol implementation. Hellos, dead intervals, DR/BDR
 * elections, and LSAs are intentionally omitted. Adjacency is evaluated
 * SYNCHRONOUSLY after any change to interface admin state or to the per-
 * router OSPF config (process / networks). For the curated scenarios we
 * ship — two routers exchanging routes across a /30 link — this captures
 * the misconfigurations CCNA learners need to recognize (missing network
 * statement, mismatched area) without simulating control-plane traffic.
 *
 * The single entry point is {@link recomputeOspf}: pass the per-device
 * router sessions + link list, get back new sessions with neighbor maps +
 * ospfRoutes updated. Pure — no mutation; returns the same session
 * identities for routers whose state did not change, so the LabSession
 * refresh layer can skip a no-op replacement.
 */
import type { Session, OspfNetwork, OspfNeighborState } from './state';
import type { Link } from '@/engine/types';
import { ipInSubnet, networkAddress, type Route } from './routing';

interface IfaceView {
  readonly deviceId: string;
  readonly ifaceId: string;
  readonly ip: string;
  readonly mask: string;
  readonly adminUp: boolean;
}

/**
 * Recompute neighbors + ospfRoutes across every router in the topology.
 * Returns a Map<deviceId, Session>; unchanged routers reuse their prior
 * session by reference.
 */
export function recomputeOspf(
  routers: ReadonlyMap<string, Session>,
  links: readonly Link[],
): Map<string, Session> {
  const neighborsByDevice = new Map<string, Map<string, OspfNeighborState>>();
  const ospfRoutesByDevice = new Map<string, Route[]>();
  for (const id of routers.keys()) {
    neighborsByDevice.set(id, new Map());
    ospfRoutesByDevice.set(id, []);
  }

  for (const link of links) {
    const a = resolveEnd(routers, link.a.deviceId, link.a.iface);
    const b = resolveEnd(routers, link.b.deviceId, link.b.iface);
    if (!a || !b) continue;
    if (!a.adminUp || !b.adminUp) continue;

    // Both ends must agree on the link's subnet — derived from each end's
    // local mask. Covers /30 P2P links and same-subnet LANs alike.
    const aNet = networkAddress(a.ip, a.mask);
    const bNet = networkAddress(b.ip, b.mask);
    if (aNet !== bNet) continue;
    if (!ipInSubnet(b.ip, aNet, a.mask)) continue;
    if (!ipInSubnet(a.ip, bNet, b.mask)) continue;

    const aSession = routers.get(a.deviceId)!;
    const bSession = routers.get(b.deviceId)!;
    if (aSession.device.ospf.process === null) continue;
    if (bSession.device.ospf.process === null) continue;

    const aMatch = matchingNetwork(aSession.device.ospf.networks, a.ip);
    const bMatch = matchingNetwork(bSession.device.ospf.networks, b.ip);
    if (!aMatch || !bMatch) continue;
    if (aMatch.area !== bMatch.area) continue;

    const aRid = aSession.device.ospf.routerId ?? a.ip;
    const bRid = bSession.device.ospf.routerId ?? b.ip;

    neighborsByDevice.get(a.deviceId)!.set(bRid, {
      state: 'FULL',
      address: b.ip,
      interface: a.ifaceId,
    });
    neighborsByDevice.get(b.deviceId)!.set(aRid, {
      state: 'FULL',
      address: a.ip,
      interface: b.ifaceId,
    });

    appendAdvertised(
      bSession,
      ospfRoutesByDevice.get(a.deviceId)!,
      b.ip,
      a.ifaceId,
      aNet,
      a.mask,
    );
    appendAdvertised(
      aSession,
      ospfRoutesByDevice.get(b.deviceId)!,
      a.ip,
      b.ifaceId,
      bNet,
      b.mask,
    );
  }

  const result = new Map<string, Session>();
  for (const [id, prev] of routers) {
    const newNeighbors = neighborsByDevice.get(id)!;
    const newRoutes = ospfRoutesByDevice.get(id)!;
    if (
      neighborsEqual(prev.device.ospf.neighbors, newNeighbors) &&
      routesEqual(prev.ospfRoutes, newRoutes)
    ) {
      result.set(id, prev);
      continue;
    }
    result.set(id, {
      ...prev,
      device: {
        ...prev.device,
        ospf: { ...prev.device.ospf, neighbors: newNeighbors },
      },
      ospfRoutes: newRoutes,
    });
  }
  return result;
}

/** First network statement whose (prefix, wildcard) covers ip, or null. */
function matchingNetwork(
  networks: readonly OspfNetwork[],
  ip: string,
): OspfNetwork | null {
  for (const n of networks) {
    if (wildcardCovers(n.prefix, n.wildcard, ip)) return n;
  }
  return null;
}

/** Wildcard bits set to 1 are "don't care"; bits set to 0 must match. */
function wildcardCovers(prefix: string, wildcard: string, ip: string): boolean {
  const p = toInt(prefix);
  const w = toInt(wildcard);
  const i = toInt(ip);
  return ((p ^ i) & (~w >>> 0)) === 0;
}

function toInt(ip: string): number {
  const p = ip.split('.').map(Number);
  return (((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0);
}

function resolveEnd(
  routers: ReadonlyMap<string, Session>,
  deviceId: string,
  iface: string,
): IfaceView | null {
  const s = routers.get(deviceId);
  if (!s) return null;
  const i = s.device.interfaces[iface];
  if (!i || !i.ip || !i.mask) return null;
  return {
    deviceId,
    ifaceId: i.id,
    ip: i.ip,
    mask: i.mask,
    adminUp: i.adminUp,
  };
}

/** Push every connected, OSPF-covered, up interface on `peer` into `into`
 *  as an OSPF route reached via `nextHopIp` on `egressIfaceId`. Skips the
 *  shared subnet — that prefix is already in the local table as connected. */
function appendAdvertised(
  peer: Session,
  into: Route[],
  nextHopIp: string,
  egressIfaceId: string,
  sharedNet: string,
  sharedMask: string,
): void {
  for (const i of Object.values(peer.device.interfaces)) {
    if (!i.adminUp || !i.ip || !i.mask) continue;
    const net = networkAddress(i.ip, i.mask);
    if (net === sharedNet && i.mask === sharedMask) continue;
    if (!matchingNetwork(peer.device.ospf.networks, i.ip)) continue;
    if (into.some((r) => r.prefix === net && r.mask === i.mask)) continue;
    into.push({
      prefix: net,
      mask: i.mask,
      nextHop: nextHopIp,
      egressIface: egressIfaceId,
      source: 'ospf',
      adminDistance: 110,
      metric: 1,
    });
  }
}

function neighborsEqual(
  a: ReadonlyMap<string, OspfNeighborState>,
  b: ReadonlyMap<string, OspfNeighborState>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) return false;
    if (vb.state !== va.state || vb.address !== va.address || vb.interface !== va.interface) {
      return false;
    }
  }
  return true;
}

function routesEqual(a: readonly Route[], b: readonly Route[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.prefix !== y.prefix ||
      x.mask !== y.mask ||
      x.nextHop !== y.nextHop ||
      x.egressIface !== y.egressIface ||
      x.source !== y.source ||
      x.adminDistance !== y.adminDistance ||
      x.metric !== y.metric
    ) {
      return false;
    }
  }
  return true;
}
