/**
 * canReach — L3-static reachability for the lab engine.
 *
 * Implements docs/ENGINE_ARCHITECTURE.md §1 / §4 / §5 / §6 / §8 EXACTLY.
 * Forward walk + return walk over the topology, returning either { ok:true }
 * or { ok:false, failedAt: { direction, deviceId, iface, reason } }.
 *
 * The walk is route-source-agnostic at the algorithm level: it reads the
 * EFFECTIVE routing table (connected + static today; OSPF will append in 3d
 * without touching this file). This is the abstraction in §3.
 *
 * Pure (§8): no clock, no Math.random, no async. Same session → same result.
 * The 3e troubleshooting labs reuse the FailReason enum verbatim, so do not
 * fold reasons together — each value carries its diagnostic value.
 */
import type { LabSession, DeviceSession } from './lab-session';
import type { Session as RouterSession } from './adapters/ios/state';
import type { PcSession } from './adapters/pc';
import { ipInSubnet, longestPrefixMatch, networkAddress } from './adapters/ios/routing';
import { routingTable } from './adapters/ios/state';
import type { Link } from './types';

// ---------- Public contract (§1) ----------

export type FailReason =
  | 'source-no-ip'
  | 'source-nic-down'
  | 'no-gateway'
  | 'no-route'
  | 'egress-down'
  | 'next-hop-unreachable'
  | 'link-peer-down'
  | 'link-subnet-mismatch'
  | 'dest-nic-down'
  | 'dest-unreachable'
  | 'routing-loop';

export interface FailPoint {
  readonly direction: 'forward' | 'return';
  readonly deviceId: string;
  readonly iface: string | null;
  readonly reason: FailReason;
}

export type ReachResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failedAt: FailPoint };

/**
 * Evaluate L3-static reachability from `fromDeviceId` to `toIp`. Round-trip:
 * a missing return route is the headline failure case and surfaces with
 * `direction:'return'`.
 */
export function canReach(
  session: LabSession,
  fromDeviceId: string,
  toIp: string,
): ReachResult {
  const src = session.devices[fromDeviceId];
  if (!src) {
    return fail('forward', fromDeviceId, null, 'source-no-ip');
  }
  const srcIp = sourceIpOf(src);
  if (srcIp === null) {
    return fail('forward', fromDeviceId, null, 'source-no-ip');
  }

  const fwd = walk(session, srcIp, toIp, 'forward');
  if (!fwd.ok) return fwd;
  const ret = walk(session, toIp, srcIp, 'return');
  return ret;
}

// ---------- Walk (§4) ----------

type Direction = 'forward' | 'return';

function walk(
  session: LabSession,
  srcIp: string,
  dstIp: string,
  direction: Direction,
): ReachResult {
  const owner = deviceOwningIp(session, srcIp);
  if (!owner) return fail(direction, '', null, 'source-no-ip');

  let current: DeviceSession;
  let ingressIface: string | null = null;

  if (owner.kind === 'pc') {
    const startResult = startFromPc(session, owner, dstIp, direction);
    if (startResult.kind === 'fail') return startResult.result;
    if (startResult.kind === 'delivery') {
      // dst sits on the PC's local subnet — verify delivery directly.
      return deliveryCheck(session, dstIp, direction);
    }
    current = startResult.firstHop;
    ingressIface = startResult.ingressIface;
  } else {
    // Router as source — used by the return walk when toIp lives on a router.
    current = owner;
  }

  const maxHops = Object.keys(session.devices).length + 2;
  for (let hop = 0; hop < maxHops; hop++) {
    if (current.kind !== 'router') {
      // PCs are not transit hops — should never appear mid-walk.
      return fail(direction, idOf(current), null, 'dest-unreachable');
    }
    const currentId = current.device.id;

    const route = longestPrefixMatch(routingTable(current), dstIp);
    if (!route) return fail(direction, currentId, ingressIface, 'no-route');

    // Determine the egress interface for this route.
    let egressIfaceId: string | null = route.egressIface ?? null;
    if (egressIfaceId === null && route.nextHop) {
      egressIfaceId = findEgressForNextHop(current, route.nextHop);
    }
    if (!egressIfaceId) {
      return fail(direction, currentId, null, 'next-hop-unreachable');
    }

    const egressIface = current.device.interfaces[egressIfaceId];
    if (!egressIface || !egressIface.adminUp) {
      return fail(direction, currentId, egressIfaceId, 'egress-down');
    }

    // For a static route via next-hop, verify the next-hop sits in the
    // egress interface's subnet (else the next-hop itself is unreachable).
    if (route.nextHop && egressIface.ip && egressIface.mask) {
      const egressNet = networkAddress(egressIface.ip, egressIface.mask);
      if (!ipInSubnet(route.nextHop, egressNet, egressIface.mask)) {
        return fail(direction, currentId, egressIfaceId, 'next-hop-unreachable');
      }
    }

    // Connected route AND dst lives on this directly-attached subnet —
    // skip the link traversal and hand off to the delivery check, which
    // looks up the device owning dstIp regardless of physical cabling.
    if (route.source === 'connected' && egressIface.ip && egressIface.mask) {
      const ourNet = networkAddress(egressIface.ip, egressIface.mask);
      if (ipInSubnet(dstIp, ourNet, egressIface.mask)) {
        return deliveryCheck(session, dstIp, direction);
      }
    }

    // Cross the link to the peer end.
    const link = findLink(session, currentId, egressIfaceId);
    if (!link) {
      return fail(direction, currentId, egressIfaceId, 'link-peer-down');
    }
    const peerEnd = otherEndOf(link, currentId, egressIfaceId);
    const peer = session.devices[peerEnd.deviceId];
    if (!peer) {
      return fail(direction, currentId, egressIfaceId, 'link-peer-down');
    }

    // If the peer owns dstIp, we've arrived — verify delivery.
    if (peerOwnsDst(peer, dstIp)) {
      return deliveryCheck(session, dstIp, direction);
    }

    // PCs aren't transit hops; static routes pointing at a PC's link
    // for non-PC destinations fail clearly.
    if (peer.kind !== 'router') {
      return fail(direction, currentId, egressIfaceId, 'dest-unreachable');
    }

    const peerIface = peer.device.interfaces[peerEnd.iface];
    if (!peerIface || !peerIface.adminUp) {
      return fail(direction, currentId, egressIfaceId, 'link-peer-down');
    }
    if (
      egressIface.ip &&
      egressIface.mask &&
      peerIface.ip &&
      peerIface.mask
    ) {
      const ourNet = networkAddress(egressIface.ip, egressIface.mask);
      const peerNet = networkAddress(peerIface.ip, peerIface.mask);
      if (ourNet !== peerNet) {
        return fail(direction, currentId, egressIfaceId, 'link-subnet-mismatch');
      }
    }

    current = peer;
    ingressIface = peerEnd.iface;
  }

  return fail(direction, idOf(current), ingressIface, 'routing-loop');
}

/**
 * Source-side endpoint check for a PC source. Returns one of:
 *  - kind:'fail'      — a Reach failure (PC config or NIC fault)
 *  - kind:'delivery'  — dst is on the PC's local subnet; skip routing
 *  - kind:'forward'   — step onto the neighbor router; continue the walk
 */
type StartResult =
  | { readonly kind: 'fail'; readonly result: ReachResult }
  | { readonly kind: 'delivery' }
  | {
      readonly kind: 'forward';
      readonly firstHop: DeviceSession;
      readonly ingressIface: string | null;
    };

function startFromPc(
  session: LabSession,
  pc: PcSession,
  dstIp: string,
  direction: Direction,
): StartResult {
  const fwd = (result: ReachResult): StartResult => ({ kind: 'fail', result });

  if (!pc.ip || !pc.mask) return fwd(fail(direction, pc.id, null, 'source-no-ip'));
  if (!pc.nicUp) return fwd(fail(direction, pc.id, null, 'source-nic-down'));

  const localNet = networkAddress(pc.ip, pc.mask);
  if (ipInSubnet(dstIp, localNet, pc.mask)) {
    return { kind: 'delivery' };
  }

  if (!pc.gateway || !ipInSubnet(pc.gateway, localNet, pc.mask)) {
    return fwd(fail(direction, pc.id, null, 'no-gateway'));
  }

  // Cross the PC's link to the neighbor router.
  const link = findLink(session, pc.id, pc.nic);
  if (!link) return fwd(fail(direction, pc.id, null, 'source-nic-down'));
  const peerEnd = otherEndOf(link, pc.id, pc.nic);
  const peer = session.devices[peerEnd.deviceId];
  if (!peer || peer.kind !== 'router') {
    return fwd(fail(direction, pc.id, null, 'source-nic-down'));
  }
  const peerIface = peer.device.interfaces[peerEnd.iface];
  if (!peerIface || !peerIface.adminUp) {
    return fwd(fail(direction, pc.id, null, 'source-nic-down'));
  }
  return { kind: 'forward', firstHop: peer, ingressIface: peerEnd.iface };
}

/** Final-hop check: confirm dstIp is owned by a reachable up endpoint. */
function deliveryCheck(
  session: LabSession,
  dstIp: string,
  direction: Direction,
): ReachResult {
  const owner = deviceOwningIp(session, dstIp);
  if (!owner) return fail(direction, '', null, 'dest-unreachable');
  if (owner.kind === 'pc') {
    if (!owner.nicUp) return fail(direction, owner.id, null, 'dest-nic-down');
    return { ok: true };
  }
  // Router — confirm the interface holding dstIp is admin-up.
  const iface = Object.values(owner.device.interfaces).find((i) => i.ip === dstIp);
  if (!iface || !iface.adminUp) {
    return fail(direction, owner.device.id, iface?.id ?? null, 'dest-unreachable');
  }
  return { ok: true };
}

// ---------- Helpers ----------

function fail(
  direction: Direction,
  deviceId: string,
  iface: string | null,
  reason: FailReason,
): ReachResult {
  return { ok: false, failedAt: { direction, deviceId, iface, reason } };
}

function idOf(s: DeviceSession): string {
  return s.kind === 'pc' ? s.id : s.device.id;
}

function sourceIpOf(s: DeviceSession): string | null {
  if (s.kind === 'pc') return s.ip;
  for (const i of Object.values(s.device.interfaces)) {
    if (i.adminUp && i.ip) return i.ip;
  }
  return null;
}

function deviceOwningIp(session: LabSession, ip: string): DeviceSession | null {
  for (const s of Object.values(session.devices)) {
    if (s.kind === 'pc') {
      if (s.ip === ip) return s;
      continue;
    }
    for (const i of Object.values(s.device.interfaces)) {
      if (i.ip === ip) return s;
    }
  }
  return null;
}

function peerOwnsDst(peer: DeviceSession, dstIp: string): boolean {
  if (peer.kind === 'pc') return peer.ip === dstIp;
  return Object.values(peer.device.interfaces).some((i) => i.ip === dstIp);
}

function findLink(session: LabSession, deviceId: string, iface: string): Link | null {
  for (const l of session.links) {
    if (l.a.deviceId === deviceId && l.a.iface === iface) return l;
    if (l.b.deviceId === deviceId && l.b.iface === iface) return l;
  }
  return null;
}

function otherEndOf(
  link: Link,
  deviceId: string,
  iface: string,
): { readonly deviceId: string; readonly iface: string } {
  if (link.a.deviceId === deviceId && link.a.iface === iface) return link.b;
  return link.a;
}

/** Pick the egress interface for a next-hop IP: the interface (up OR down)
 *  whose subnet contains the next-hop. Filtering by adminUp here would mask
 *  a down egress as `next-hop-unreachable`; §4 wants egress determined
 *  first, then the admin-up check fires as `egress-down`. */
function findEgressForNextHop(router: RouterSession, nextHop: string): string | null {
  for (const i of Object.values(router.device.interfaces)) {
    if (!i.ip || !i.mask) continue;
    const net = networkAddress(i.ip, i.mask);
    if (ipInSubnet(nextHop, net, i.mask)) return i.id;
  }
  return null;
}
