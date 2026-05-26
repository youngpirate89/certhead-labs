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
import type { InterfaceState, Session as RouterSession } from './adapters/ios/state';
import type { PcSession } from './adapters/pc';
import type { SwitchSession } from './adapters/ios/switch-state';
import { ipInSubnet, longestPrefixMatch, networkAddress } from './adapters/ios/routing';
import { routingTable } from './adapters/ios/state';
import { evaluateAcl } from './adapters/ios/acl';
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
  | 'routing-loop'
  | 'acl-deny'
  | 'vlan-mismatch';

export interface FailPoint {
  readonly direction: 'forward' | 'return';
  readonly deviceId: string;
  readonly iface: string | null;
  readonly reason: FailReason;
  /** Extra context for `acl-deny`: which ACL fired, which direction it was
   *  applied to the interface, and the source IP that hit the deny. Carried
   *  here so failureDetail can name the ACL in the `[sim]` sentence without
   *  re-walking the topology. Undefined for every other reason. */
  readonly acl?: {
    readonly aclNumber: number;
    readonly aclDirection: 'in' | 'out';
    readonly sourceIp: string;
  };
  /** Extra context for `vlan-mismatch`: the two PCs and the VLAN ids they
   *  are on. Lets failureDetail name both endpoints + VLANs in the `[sim]`
   *  sentence the work order requires verbatim. Undefined elsewhere. */
  readonly vlan?: {
    readonly aId: string;
    readonly aVlan: number;
    readonly bId: string;
    readonly bVlan: number;
  };
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
      // dst sits on the PC's local subnet. Same-subnet delivery through a
      // switch requires both PCs to be on the same VLAN — L2 broadcast domain
      // boundary. The switchL2Delivery check enforces this when applicable;
      // for direct PC-to-PC cabling (no switch) it short-circuits to true.
      const vlanCheck = switchL2DeliveryCheck(session, owner, dstIp, direction);
      if (!vlanCheck.ok) return vlanCheck;
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

    // Inbound ACL fires the moment the packet arrives on this router (after
    // a link crossing OR on the first hop from a PC). Locally-originated
    // traffic — when this is the source router — skips the inbound check
    // because there's no ingress interface (matches IOS behavior).
    if (ingressIface !== null) {
      const inIface = current.device.interfaces[ingressIface];
      if (inIface) {
        const denied = checkInterfaceAcl(current, inIface, srcIp, 'in', direction);
        if (denied) return denied;
      }
    }

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

    // Outbound ACL fires as the packet leaves the egress interface. Evaluated
    // before delivery / link traversal so the failure point is named on the
    // forwarding router (not the destination), matching IOS semantics.
    {
      const denied = checkInterfaceAcl(current, egressIface, srcIp, 'out', direction);
      if (denied) return denied;
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

  // Cross the PC's link to the neighbor.
  const link = findLink(session, pc.id, pc.nic);
  if (!link) return fwd(fail(direction, pc.id, null, 'source-nic-down'));
  const peerEnd = otherEndOf(link, pc.id, pc.nic);
  const peer = session.devices[peerEnd.deviceId];
  if (!peer) {
    return fwd(fail(direction, pc.id, null, 'source-nic-down'));
  }

  // PC cabled directly to a switch can only reach off-subnet destinations if
  // the switch routes (it doesn't, in Session 1) — no router peer means no
  // gateway can be reached. The same-subnet delivery branch above is the
  // only valid L2 path through a switch this session.
  if (peer.kind !== 'router') {
    return fwd(fail(direction, pc.id, null, 'no-gateway'));
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
  if (owner.kind === 'switch') {
    // Switches don't own L3 addresses in our model — deviceOwningIp won't
    // return one, but the type system needs the exhaustive branch.
    return fail(direction, owner.device.id, null, 'dest-unreachable');
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

function failAcl(
  direction: Direction,
  deviceId: string,
  iface: string,
  aclNumber: number,
  aclDirection: 'in' | 'out',
  sourceIp: string,
): ReachResult {
  return {
    ok: false,
    failedAt: {
      direction,
      deviceId,
      iface,
      reason: 'acl-deny',
      acl: { aclNumber, aclDirection, sourceIp },
    },
  };
}

/** Run the ACL bound to `iface` in the given `aclDirection` against `sourceIp`.
 *  Returns the failing ReachResult on deny, or null when the packet passes
 *  (no ACL bound, ACL number references no defined ACL, or first-match permit).
 *  Pure: never mutates inputs. */
function checkInterfaceAcl(
  router: RouterSession,
  iface: InterfaceState,
  sourceIp: string,
  aclDirection: 'in' | 'out',
  walkDirection: Direction,
): ReachResult | null {
  const aclNumber = iface.accessGroups[aclDirection];
  if (aclNumber === null) return null;
  const acl = router.device.acls.get(aclNumber);
  // Real IOS: an `ip access-group N <dir>` pointing at an undefined ACL is a
  // no-op (nothing to filter against). Keep the lab consistent with that —
  // the learner only sees blocks once they've actually defined the ACL.
  if (!acl) return null;
  if (evaluateAcl(acl, sourceIp) === 'deny') {
    return failAcl(walkDirection, router.device.id, iface.id, aclNumber, aclDirection, sourceIp);
  }
  return null;
}

function idOf(s: DeviceSession): string {
  return s.kind === 'pc' ? s.id : s.device.id;
}

function sourceIpOf(s: DeviceSession): string | null {
  if (s.kind === 'pc') return s.ip;
  if (s.kind === 'switch') return null;
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
    if (s.kind === 'switch') continue;
    for (const i of Object.values(s.device.interfaces)) {
      if (i.ip === ip) return s;
    }
  }
  return null;
}

function peerOwnsDst(peer: DeviceSession, dstIp: string): boolean {
  if (peer.kind === 'pc') return peer.ip === dstIp;
  if (peer.kind === 'switch') return false;
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

// ---------- VLAN-aware L2 delivery (Session 1 of switch build) ----------

/**
 * When the source PC's NIC is cabled to a switch AND the destination PC's
 * NIC is also cabled to that same switch, both must sit on the same VLAN for
 * L2 delivery to succeed. Different VLANs are different broadcast domains;
 * without inter-VLAN routing (Session 2+), the frame never gets across.
 *
 * Cases handled (all return ok:true unless the VLAN check fails):
 *   - Source PC's neighbor is a router (not a switch) → ok (no VLAN context).
 *   - Source PC's neighbor is a switch BUT dst PC isn't on that switch → ok
 *     (the topology isn't a pure-L2 PC↔SW↔PC; deliveryCheck handles the rest).
 *   - Source PC and dst PC sit on the same switch, same VLAN → ok.
 *   - Same switch, different VLAN → vlan-mismatch with the verbatim sentence
 *     the work order requires.
 *
 * Pure: reads session state only, allocates a single FailPoint on the failure
 * path. Same-VLAN succeeds in O(links + ports-on-switch).
 */
function switchL2DeliveryCheck(
  session: LabSession,
  srcPc: PcSession,
  dstIp: string,
  direction: Direction,
): ReachResult {
  const srcEdge = pcSwitchEdge(session, srcPc.id, srcPc.nic);
  if (!srcEdge) return { ok: true };

  const dstOwner = deviceOwningIp(session, dstIp);
  if (!dstOwner || dstOwner.kind !== 'pc') return { ok: true };

  const dstEdge = pcSwitchEdge(session, dstOwner.id, dstOwner.nic);
  if (!dstEdge || dstEdge.switchId !== srcEdge.switchId) return { ok: true };

  if (srcEdge.vlan === dstEdge.vlan) return { ok: true };

  return {
    ok: false,
    failedAt: {
      direction,
      deviceId: srcEdge.switchId,
      iface: null,
      reason: 'vlan-mismatch',
      vlan: {
        aId: srcPc.id,
        aVlan: srcEdge.vlan,
        bId: dstOwner.id,
        bVlan: dstEdge.vlan,
      },
    },
  };
}

/** If `pcId.nic` is cabled to a switch, return the switch id + the VLAN the
 *  cabled switchport sits on. Null when the cable runs to anything else or
 *  the PC is uncabled — caller treats null as "no switch context here". */
function pcSwitchEdge(
  session: LabSession,
  pcId: string,
  nic: string,
): { switchId: string; vlan: number } | null {
  const link = findLink(session, pcId, nic);
  if (!link) return null;
  const peer = link.a.deviceId === pcId ? link.b : link.a;
  const neighbor = session.devices[peer.deviceId];
  if (!neighbor || neighbor.kind !== 'switch') return null;
  return switchPortVlan(neighbor, peer.iface);
}

function switchPortVlan(
  sw: SwitchSession,
  ifaceId: string,
): { switchId: string; vlan: number } | null {
  const port = sw.device.switchports[ifaceId];
  if (!port) return null;
  // Session 1: only access mode carries a definite VLAN. Trunk/dynamic land
  // in Session 2 — we treat them as access (VLAN 1) until then so the
  // engine stays deterministic; the grammar rejects mode changes anyway.
  return { switchId: sw.device.id, vlan: port.accessVlan };
}
