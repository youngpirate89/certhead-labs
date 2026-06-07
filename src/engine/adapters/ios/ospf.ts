/**
 * OSPF neighbor formation + route injection — synchronous, scenario-scoped.
 *
 * Per CLAUDE.md guardrail #8 the engine is deterministic; OSPF here is NOT a
 * timer-based protocol implementation. There is no control-plane traffic:
 * DR/BDR elections and LSAs are intentionally omitted. Adjacency is evaluated
 * SYNCHRONOUSLY after any change to interface admin state or to the per-
 * router OSPF config (process / networks / passive / timers). For the curated
 * scenarios we ship — two routers exchanging routes across a /30 link — this
 * captures the misconfigurations CCNA learners need to recognize (missing
 * network statement, mismatched area, mismatched hello/dead intervals)
 * without simulating control-plane traffic. The hello/dead intervals are
 * compared as STATIC config values (Lab 19), not run as actual timers — a
 * mismatch suppresses neighbor formation the same way an area mismatch does.
 *
 * The single entry point is {@link recomputeOspf}: pass the per-device
 * router sessions + link list, get back new sessions with neighbor maps +
 * ospfRoutes updated. Pure — no mutation; returns the same session
 * identities for routers whose state did not change, so the LabSession
 * refresh layer can skip a no-op replacement.
 */
import type { Session, OspfNetwork, OspfNeighborState, OspfNeighborRole } from './state';
import {
  OSPF_DEFAULT_HELLO_INTERVAL,
  OSPF_DEFAULT_DEAD_INTERVAL,
  ospfNetworkType,
} from './state';
import type { Link } from '@/engine/types';
import { ipInSubnet, networkAddress, type Route } from './routing';

interface IfaceView {
  readonly deviceId: string;
  readonly ifaceId: string;
  readonly ip: string;
  readonly mask: string;
  readonly adminUp: boolean;
  /** Effective OSPF hello/dead intervals — the configured override, or the
   *  protocol default when unset. Compared end-to-end for adjacency. */
  readonly helloInterval: number;
  readonly deadInterval: number;
  /** OSPF MD5 authentication state (Lab 20). `authMessageDigest` is whether
   *  `ip ospf authentication message-digest` is set; `md5KeyId`/`md5Key` are
   *  the configured key, or undefined when none. Compared end-to-end: both
   *  ends must agree on auth-enabled, and when enabled share key-id + key. */
  readonly authMessageDigest: boolean;
  readonly md5KeyId: number | undefined;
  readonly md5Key: string | undefined;
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
    // Passive on either side suppresses hello processing → no neighbor forms,
    // but the prefix stays advertised (the network statement still matches).
    // Lab 17: tagging the LAN iface as passive is the teaching point — it
    // doesn't drop the WAN adjacency because only the WAN iface remains
    // hello-active.
    if (aSession.device.ospf.passive.has(a.ifaceId)) continue;
    if (bSession.device.ospf.passive.has(b.ifaceId)) continue;
    // Hello and dead intervals must match on both ends — IOS drops hellos
    // whose timers disagree, so the adjacency never forms (Lab 19). We
    // compare the effective (configured-or-default) values statically.
    if (a.helloInterval !== b.helloInterval) continue;
    if (a.deadInterval !== b.deadInterval) continue;
    // MD5 (message-digest) authentication must agree end-to-end (Lab 20). IOS
    // drops authenticated hellos that fail the digest check, so a mismatch
    // never forms the adjacency. Both ends must agree on whether auth is
    // enabled; when both have it, the key-id AND key string must match. This
    // covers all three failure modes — auth on one side only, wrong key
    // string, wrong key-id. [CONFIRMED-BY-SOURCE: RFC 2328 App. D
    // (Authentication); Cisco IOS "Configuring OSPF" — neighbors must share
    // the same key-id and key for MD5/cryptographic authentication.]
    if (a.authMessageDigest !== b.authMessageDigest) continue;
    if (a.authMessageDigest && b.authMessageDigest) {
      if (a.md5KeyId !== b.md5KeyId) continue;
      if (a.md5Key !== b.md5Key) continue;
    }

    const aRid = aSession.device.ospf.routerId ?? a.ip;
    const bRid = bSession.device.ospf.routerId ?? b.ip;

    // DR/BDR election. On a broadcast (Ethernet) segment IOS elects a DR and a
    // BDR; on a point-to-point link it does not. We don't model OSPF priority
    // (default 1 everywhere, so it never breaks the tie), so the election
    // reduces to the router-id tiebreak: highest RID is DR, the other is BDR.
    // Deterministic — the same topology always elects the same DR (guardrail
    // #8). Roles are stored from each router's POV as the NEIGHBOR's role, so
    // `show ip ospf neighbor` renders FULL/DR or FULL/BDR. [CONFIRMED-BY-SOURCE:
    // networklessons "OSPF DR/BDR Election"; study-ccna — highest priority then
    // highest router-id wins.]
    let aRoleSeenByB: OspfNeighborRole | undefined;
    let bRoleSeenByA: OspfNeighborRole | undefined;
    if (
      ospfNetworkType(a.ifaceId) === 'BROADCAST' &&
      ospfNetworkType(b.ifaceId) === 'BROADCAST'
    ) {
      const aIsDr = toInt(aRid) > toInt(bRid);
      aRoleSeenByB = aIsDr ? 'DR' : 'BDR';
      bRoleSeenByA = aIsDr ? 'BDR' : 'DR';
    }

    neighborsByDevice.get(a.deviceId)!.set(bRid, {
      state: 'FULL',
      address: b.ip,
      interface: a.ifaceId,
      role: bRoleSeenByA,
    });
    neighborsByDevice.get(b.deviceId)!.set(aRid, {
      state: 'FULL',
      address: a.ip,
      interface: b.ifaceId,
      role: aRoleSeenByB,
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

    // default-information originate (Lab 21): a router that originates a
    // default route injects 0.0.0.0/0 into every FULL neighbor as an external
    // Type-2 route. The neighbor reaches it via the originator's IP on the
    // shared link. Only the receiver installs it — the originator keeps its
    // own (static/connected) default, not a self-learned OSPF copy.
    if (originatesDefault(bSession)) {
      appendDefault(ospfRoutesByDevice.get(a.deviceId)!, b.ip, a.ifaceId);
    }
    if (originatesDefault(aSession)) {
      appendDefault(ospfRoutesByDevice.get(b.deviceId)!, a.ip, b.ifaceId);
    }
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

/** First network statement whose (prefix, wildcard) covers ip, or null.
 *  Exported so `show ip ospf interface` can decide which interfaces OSPF
 *  considers enabled and report each one's area. */
export function matchingNetwork(
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
    helloInterval: i.ospfHelloInterval ?? OSPF_DEFAULT_HELLO_INTERVAL,
    deadInterval: i.ospfDeadInterval ?? OSPF_DEFAULT_DEAD_INTERVAL,
    authMessageDigest: i.ospfAuthMessageDigest === true,
    md5KeyId: i.ospfMd5KeyId,
    md5Key: i.ospfMd5Key,
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

/** Whether this router currently originates a default route into OSPF.
 *  `default-information originate` only advertises when the router actually
 *  has a default (0.0.0.0/0) in its own RIB — modeled here as a static
 *  default (the lab seeds one toward the ISP). The `always` keyword lifts
 *  that condition and advertises unconditionally. [CONFIRMED-BY-SOURCE: Cisco
 *  IOS "Configuring OSPF" — without `always`, the router originates the
 *  default only if it has a default route; `always` removes that check.] */
function originatesDefault(s: Session): boolean {
  if (!s.device.ospf.defaultInfoOriginate) return false;
  if (s.device.ospf.defaultInfoAlways) return true;
  return s.staticRoutes.some((r) => r.prefix === '0.0.0.0' && r.mask === '0.0.0.0');
}

/** Push a 0.0.0.0/0 external default into `into`, reached via `nextHopIp` on
 *  `egressIfaceId`. AD 110 / metric 1 is the IOS default for an
 *  `O*E2` route from `default-information originate`. Deduped — a router with
 *  more than one adjacency to the originator installs a single default. */
function appendDefault(into: Route[], nextHopIp: string, egressIfaceId: string): void {
  if (into.some((r) => r.prefix === '0.0.0.0' && r.mask === '0.0.0.0')) return;
  into.push({
    prefix: '0.0.0.0',
    mask: '0.0.0.0',
    nextHop: nextHopIp,
    egressIface: egressIfaceId,
    source: 'ospf',
    adminDistance: 110,
    metric: 1,
    ospfExternal: true,
  });
}

function neighborsEqual(
  a: ReadonlyMap<string, OspfNeighborState>,
  b: ReadonlyMap<string, OspfNeighborState>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) return false;
    if (
      vb.state !== va.state ||
      vb.address !== va.address ||
      vb.interface !== va.interface ||
      vb.role !== va.role
    ) {
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
      x.metric !== y.metric ||
      x.ospfExternal !== y.ospfExternal
    ) {
      return false;
    }
  }
  return true;
}
