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
import type {
  InterfaceState,
  Session as RouterSession,
  SubInterface,
} from './adapters/ios/state';
import { isSubInterfaceId } from './adapters/ios/state';
import type { PcSession } from './adapters/pc';
import type { SwitchSession } from './adapters/ios/switch-state';
import { trunkAllowsVlan } from './adapters/ios/switch-state';
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
  | 'vlan-mismatch'
  | 'trunk-not-configured'
  | 'vlan-not-allowed';

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
  /** Extra context for `trunk-not-configured`: both ends of the inter-switch
   *  link that needs trunk mode. Undefined elsewhere. */
  readonly trunk?: {
    readonly aDevice: string;
    readonly aIface: string;
    readonly bDevice: string;
    readonly bIface: string;
  };
  /** Extra context for `vlan-not-allowed`: which VLAN was blocked. Device and
   *  iface come from the top-level FailPoint fields. Undefined elsewhere. */
  readonly vlanAllow?: {
    readonly vlanId: number;
  };
}

export type ReachResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failedAt: FailPoint };

/**
 * Evaluate L3-static reachability from `fromDeviceId` to `toIp`. Round-trip:
 * a missing return route is the headline failure case and surfaces with
 * `direction:'return'`.
 *
 * NAT (Lab 11) flips the return-walk destination: when the forward walk
 * crosses an inside→outside boundary with a matching PAT statement, the
 * packet's source IP becomes the outside interface's IP. The reply comes
 * back to THAT address — not to the original source. We capture the final
 * post-translation source via a NatContext written by the forward walk and
 * use it as the return walk's destination.
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

  const natCtx: NatContext = { finalSrcIp: srcIp };
  const fwd = walk(session, srcIp, toIp, 'forward', natCtx);
  if (!fwd.ok) return fwd;
  const ret = walk(session, toIp, natCtx.finalSrcIp, 'return');
  return ret;
}

/** Out-parameter the forward walk writes its post-NAT source IP into.
 *  Default = the source IP (i.e. no translation occurred). When the walk
 *  crosses an inside→outside NAT boundary with a matching statement, it
 *  updates `finalSrcIp` to the outside interface's IP. */
interface NatContext {
  finalSrcIp: string;
}

// ---------- Walk (§4) ----------

type Direction = 'forward' | 'return';

function walk(
  session: LabSession,
  srcIp: string,
  dstIp: string,
  direction: Direction,
  natCtx?: NatContext,
): ReachResult {
  // Mutable "what's the source IP in the packet right now" for the walk.
  // Starts at srcIp; updated when an inside→outside NAT translation fires.
  // ACL checks use this so an inbound ACL on the inside iface sees the
  // pre-NAT source (correct: IOS evaluates inbound before NAT) and an
  // outbound ACL on the outside iface sees the post-NAT source.
  let effectiveSrcIp = srcIp;

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
        const denied = checkInterfaceAcl(current, inIface, effectiveSrcIp, 'in', direction);
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

    // Subinterface egress: the cable lives on the parent physical. Validate
    // subif state (admin/proto/encap) and parent admin state independently —
    // a clear failure point matters for diagnosis (work order §3.6). After
    // these checks we use the PARENT for link traversal; the dot1Q tag goes
    // out with the frame and is checked at the switch trunk.
    let egressSubif: SubInterface | null = null;
    let egressIface: InterfaceState | undefined;
    if (isSubInterfaceId(egressIfaceId)) {
      egressSubif = current.device.subInterfaces[egressIfaceId] ?? null;
      if (!egressSubif) {
        return fail(direction, currentId, egressIfaceId, 'no-route');
      }
      if (egressSubif.dot1qVlan === null) {
        // No encapsulation → no connected route in the first place; treat as
        // no-route so the diagnosis points at "R1 has no route to X".
        return fail(direction, currentId, egressIfaceId, 'no-route');
      }
      if (!egressSubif.adminUp) {
        return fail(direction, currentId, egressIfaceId, 'egress-down');
      }
      const parent = current.device.interfaces[egressSubif.parentId];
      if (!parent || !parent.adminUp) {
        return fail(direction, currentId, egressSubif.parentId, 'egress-down');
      }
      egressIface = parent;
    } else {
      egressIface = current.device.interfaces[egressIfaceId];
      if (!egressIface || !egressIface.adminUp) {
        return fail(direction, currentId, egressIfaceId, 'egress-down');
      }
    }

    // For a static route via next-hop, verify the next-hop sits in the
    // egress interface's subnet (else the next-hop itself is unreachable).
    if (route.nextHop && egressIface.ip && egressIface.mask) {
      const egressNet = networkAddress(egressIface.ip, egressIface.mask);
      if (!ipInSubnet(route.nextHop, egressNet, egressIface.mask)) {
        return fail(direction, currentId, egressIfaceId, 'next-hop-unreachable');
      }
    }

    // NAT inside→outside translation, evaluated AFTER the routing decision
    // (so we know the egress) and BEFORE the outbound ACL (so the outbound
    // ACL sees the post-NAT source — matches IOS semantics). Only the
    // physical-egress path participates; the subif egress path is the
    // Lab 09 router-on-a-stick boundary, where NAT isn't applicable.
    if (!egressSubif) {
      const translated = computeNatTranslation(
        current,
        ingressIface,
        egressIfaceId,
        effectiveSrcIp,
      );
      if (translated !== null) {
        effectiveSrcIp = translated;
        if (natCtx) natCtx.finalSrcIp = translated;
      }
    }

    // Outbound ACL fires as the packet leaves the egress interface. Evaluated
    // before delivery / link traversal so the failure point is named on the
    // forwarding router (not the destination), matching IOS semantics.
    {
      const denied = checkInterfaceAcl(current, egressIface, effectiveSrcIp, 'out', direction);
      if (denied) return denied;
    }

    // Connected route AND dst on this directly-attached subnet — hand off to
    // delivery. Subif egress takes the trunk-aware path: validate the switch
    // trunk allows the dot1Q tag and the destination's access port sits on
    // the same VLAN. Physical egress takes the legacy fast path.
    if (egressSubif) {
      const subnet = egressSubif.ip && egressSubif.mask
        ? { net: networkAddress(egressSubif.ip, egressSubif.mask), mask: egressSubif.mask }
        : null;
      if (subnet && ipInSubnet(dstIp, subnet.net, subnet.mask)) {
        return deliverViaSubifTrunk(session, current, egressSubif, egressIface, dstIp, direction);
      }
      // dst not on this subif's subnet — multi-router-on-a-stick is out of
      // scope; fail clearly rather than silently traversing the trunk.
      return fail(direction, currentId, egressIfaceId, 'no-route');
    }

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

  // PC cabled to a switch: Lab 09 router-on-a-stick. The gateway lives on a
  // router subinterface reached through the switch's trunk(s) on the PC's
  // access VLAN. Walk the switch L2 broadcast domain on that VLAN looking
  // for a router whose dot1Q subif (parent = the cabled router iface)
  // carries the PC's access VLAN AND owns the gateway IP. On success the
  // router becomes firstHop; ingressIface is the router's PARENT physical
  // (the cable lands on the physical, the subif is virtual).
  if (peer.kind === 'switch') {
    const swPort = peer.device.switchports[peerEnd.iface];
    if (!swPort || !swPort.adminUp) {
      return fwd(fail(direction, pc.id, null, 'source-nic-down'));
    }
    // The PC sits on an access port — `accessVlan` is the L2 broadcast domain.
    // (Trunk-mode PC-facing ports are non-standard and out of scope.)
    if (swPort.mode !== 'access') {
      return fwd(fail(direction, pc.id, null, 'no-gateway'));
    }
    const vlan = swPort.accessVlan;
    const gw = findGatewayThroughSwitch(session, peer.device.id, vlan, pc.gateway);
    if (!gw) return fwd(fail(direction, pc.id, null, 'no-gateway'));
    return { kind: 'forward', firstHop: gw.router, ingressIface: gw.routerParentIface };
  }
  // Other unexpected peer kinds — should never appear in a valid topology.
  if (peer.kind !== 'router') {
    return fwd(fail(direction, pc.id, null, 'no-gateway'));
  }
  const peerIface = peer.device.interfaces[peerEnd.iface];
  if (!peerIface || !peerIface.adminUp) {
    return fwd(fail(direction, pc.id, null, 'source-nic-down'));
  }
  return { kind: 'forward', firstHop: peer, ingressIface: peerEnd.iface };
}

/** Walk the switch L2 broadcast domain on `vlan` looking for a router whose
 *  dot1Q subif (with `dot1qVlan === vlan` AND `ip === gatewayIp`) sits on the
 *  parent physical at the switch-router link. Returns the router + its parent
 *  physical iface (the cable's landing point) on the first match, null
 *  otherwise. BFS through switch-trunk hops keeps the multi-switch case
 *  symmetric with Lab 08's walkSwitchToSwitch. For Lab 09 (single switch)
 *  this collapses to one iteration. */
function findGatewayThroughSwitch(
  session: LabSession,
  srcSwitchId: string,
  vlan: number,
  gatewayIp: string,
): { router: RouterSession; routerParentIface: string } | null {
  const visited = new Set<string>([srcSwitchId]);
  const queue: string[] = [srcSwitchId];
  while (queue.length > 0) {
    const swId = queue.shift()!;
    const sw = session.devices[swId];
    if (!sw || sw.kind !== 'switch') continue;
    for (const link of session.links) {
      let myIface: string;
      let peerEnd: { deviceId: string; iface: string };
      if (link.a.deviceId === swId) {
        myIface = link.a.iface;
        peerEnd = { deviceId: link.b.deviceId, iface: link.b.iface };
      } else if (link.b.deviceId === swId) {
        myIface = link.b.iface;
        peerEnd = { deviceId: link.a.deviceId, iface: link.a.iface };
      } else continue;

      const myPort = sw.device.switchports[myIface];
      if (!myPort || !myPort.adminUp) continue;
      const peer = session.devices[peerEnd.deviceId];
      if (!peer) continue;

      if (peer.kind === 'router') {
        // Router hop: requires a properly-configured trunk on the switch side
        // AND a subif on the router's cabled parent with the right tag + IP.
        if (myPort.mode !== 'trunk') continue;
        if (!trunkAllowsVlan(myPort.trunkAllowedVlans, vlan)) continue;
        const parent = peer.device.interfaces[peerEnd.iface];
        if (!parent || !parent.adminUp) continue;
        for (const sub of Object.values(peer.device.subInterfaces)) {
          if (sub.parentId !== peerEnd.iface) continue;
          if (sub.dot1qVlan !== vlan) continue;
          if (sub.ip !== gatewayIp) continue;
          if (!sub.adminUp || !sub.protocolUp) continue;
          return { router: peer, routerParentIface: peerEnd.iface };
        }
        continue;
      }
      if (peer.kind === 'switch') {
        // Switch-to-switch trunk hop — both ends must trunk and allow VLAN.
        if (visited.has(peer.device.id)) continue;
        if (myPort.mode !== 'trunk') continue;
        if (!trunkAllowsVlan(myPort.trunkAllowedVlans, vlan)) continue;
        const peerPort = peer.device.switchports[peerEnd.iface];
        if (!peerPort || peerPort.mode !== 'trunk') continue;
        if (!trunkAllowsVlan(peerPort.trunkAllowedVlans, vlan)) continue;
        visited.add(peer.device.id);
        queue.push(peer.device.id);
      }
    }
  }
  return null;
}

/** Subif egress with dst on the connected subnet: validate the cabled
 *  switch trunk allows the dot1Q tag, walk the L2 broadcast domain for that
 *  VLAN to find the destination access port, then deliver. The dst lookup
 *  reuses deliveryCheck so PC nicUp / router admin-state checks stay one
 *  function. Symmetric with the forward-from-PC path through a switch. */
function deliverViaSubifTrunk(
  session: LabSession,
  router: RouterSession,
  subif: SubInterface,
  parent: InterfaceState,
  dstIp: string,
  direction: Direction,
): ReachResult {
  const link = findLink(session, router.device.id, parent.id);
  if (!link) {
    return fail(direction, router.device.id, parent.id, 'link-peer-down');
  }
  const peerEnd = otherEndOf(link, router.device.id, parent.id);
  const peer = session.devices[peerEnd.deviceId];
  if (!peer) {
    return fail(direction, router.device.id, parent.id, 'link-peer-down');
  }
  // Subif egress assumes the parent cables to a switch — the routed-VLAN
  // hand-off only makes sense at an L2 boundary. Other peer kinds are an
  // unsupported topology; fail clearly.
  if (peer.kind !== 'switch') {
    return fail(direction, router.device.id, parent.id, 'dest-unreachable');
  }
  const trunkPort = peer.device.switchports[peerEnd.iface];
  if (!trunkPort || !trunkPort.adminUp) {
    return fail(direction, router.device.id, parent.id, 'link-peer-down');
  }
  const tag = subif.dot1qVlan!;
  if (trunkPort.mode !== 'trunk') {
    return {
      ok: false,
      failedAt: {
        direction,
        deviceId: peer.device.id,
        iface: peerEnd.iface,
        reason: 'trunk-not-configured',
        trunk: {
          aDevice: router.device.id,
          aIface: parent.id,
          bDevice: peer.device.id,
          bIface: peerEnd.iface,
        },
      },
    };
  }
  if (!trunkAllowsVlan(trunkPort.trunkAllowedVlans, tag)) {
    return {
      ok: false,
      failedAt: {
        direction,
        deviceId: peer.device.id,
        iface: peerEnd.iface,
        reason: 'vlan-not-allowed',
        vlanAllow: { vlanId: tag },
      },
    };
  }
  // Confirm the destination PC's access port sits on the same VLAN — walk
  // through trunks if the destination is on a different switch in the L2
  // graph. For Lab 09 (one switch) this collapses to a same-switch check.
  const reachableAccess = findAccessPortReachableForIp(session, peer, tag, dstIp);
  if (!reachableAccess.ok) return reachableAccess;
  return deliveryCheck(session, dstIp, direction);
}

/** Confirm dstIp's owner (a PC) has an access port on `vlan` reachable from
 *  `startSwitch` over trunks. Failure surfaces a meaningful reason — wrong
 *  VLAN, trunk break in the middle, or destination not on this L2 domain. */
function findAccessPortReachableForIp(
  session: LabSession,
  startSwitch: SwitchSession,
  vlan: number,
  dstIp: string,
): ReachResult {
  const dstOwner = deviceOwningIp(session, dstIp);
  if (!dstOwner) {
    return fail('forward', startSwitch.device.id, null, 'dest-unreachable');
  }
  // Dst on a router subif (multi-router-on-a-stick) — not modeled; the
  // single-router Lab 09 keeps dst as a PC. Fail clearly.
  if (dstOwner.kind !== 'pc') {
    return fail('forward', startSwitch.device.id, null, 'dest-unreachable');
  }
  const dstEdge = pcSwitchEdge(session, dstOwner.id, dstOwner.nic);
  if (!dstEdge) {
    return fail('forward', dstOwner.id, null, 'dest-nic-down');
  }
  if (dstEdge.vlan !== vlan) {
    // The destination PC is on a different VLAN — the dot1Q tag from the
    // router subif wouldn't be accepted at the access port.
    return {
      ok: false,
      failedAt: {
        direction: 'forward',
        deviceId: dstEdge.switchId,
        iface: null,
        reason: 'vlan-mismatch',
        vlan: {
          aId: '',
          aVlan: vlan,
          bId: dstOwner.id,
          bVlan: dstEdge.vlan,
        },
      },
    };
  }
  if (dstEdge.switchId === startSwitch.device.id) return { ok: true };
  // Multi-switch case — reuse Lab 08's trunk walker. Direction is best-effort
  // 'forward' here; the caller passed the real direction via deliveryCheck.
  return walkSwitchToSwitch(
    session,
    startSwitch.device.id,
    dstEdge.switchId,
    vlan,
    'forward',
  );
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
  // Router — confirm the interface holding dstIp is admin-up. Subifs count
  // as long as both the subif AND its parent are admin-up (the parent owns
  // the cable; without it the dot1Q frame never arrives at the subif).
  const iface = Object.values(owner.device.interfaces).find((i) => i.ip === dstIp);
  if (iface) {
    if (!iface.adminUp) {
      return fail(direction, owner.device.id, iface.id, 'dest-unreachable');
    }
    return { ok: true };
  }
  const sub = Object.values(owner.device.subInterfaces).find((s) => s.ip === dstIp);
  if (sub) {
    if (!sub.adminUp) {
      return fail(direction, owner.device.id, sub.id, 'dest-unreachable');
    }
    const parent = owner.device.interfaces[sub.parentId];
    if (!parent || !parent.adminUp) {
      return fail(direction, owner.device.id, sub.parentId, 'dest-unreachable');
    }
    return { ok: true };
  }
  return fail(direction, owner.device.id, null, 'dest-unreachable');
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

/** If a PAT (overload) statement on `router` would translate a packet that
 *  arrived on `ingressIfaceId` (must be inside) and exits via `egressIfaceId`
 *  (must be outside, with an IP) when the source is `sourceIp` (must match
 *  the statement's ACL), return the new effective source IP — the outside
 *  interface's IP. Otherwise return null and the walk continues unchanged.
 *
 *  Permissive on missing ACLs: an `ip nat inside source list N ...` whose
 *  referenced ACL `N` doesn't exist is a no-translate (matches the same
 *  "undefined ACL = no-op" posture as {@link checkInterfaceAcl}). The
 *  symptom in that case is the return walk failing with the original
 *  private source — exactly the teaching moment in Lab 11. */
function computeNatTranslation(
  router: RouterSession,
  ingressIfaceId: string | null,
  egressIfaceId: string,
  sourceIp: string,
): string | null {
  if (ingressIfaceId === null) return null;
  const inIface = router.device.interfaces[ingressIfaceId];
  const outIface = router.device.interfaces[egressIfaceId];
  if (!inIface || inIface.natRole !== 'inside') return null;
  if (!outIface || outIface.natRole !== 'outside' || !outIface.ip) return null;
  for (const stmt of router.device.natStatements) {
    if (stmt.outsideInterface !== egressIfaceId) continue;
    const acl = router.device.acls.get(stmt.aclId);
    if (!acl) continue;
    if (evaluateAcl(acl, sourceIp) === 'permit') {
      return outIface.ip;
    }
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
  for (const sub of Object.values(s.device.subInterfaces)) {
    if (sub.adminUp && sub.ip) return sub.ip;
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
    for (const sub of Object.values(s.device.subInterfaces)) {
      if (sub.ip === ip) return s;
    }
  }
  return null;
}

function peerOwnsDst(peer: DeviceSession, dstIp: string): boolean {
  if (peer.kind === 'pc') return peer.ip === dstIp;
  if (peer.kind === 'switch') return false;
  if (Object.values(peer.device.interfaces).some((i) => i.ip === dstIp)) return true;
  return Object.values(peer.device.subInterfaces).some((sub) => sub.ip === dstIp);
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
  if (!dstEdge) return { ok: true };

  // Same-switch case (Session 1): VLAN match is enough; no trunk walk needed.
  if (dstEdge.switchId === srcEdge.switchId) {
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

  // Different switches: VLAN mismatch trumps everything else — different
  // broadcast domains are different broadcast domains regardless of trunks.
  if (srcEdge.vlan !== dstEdge.vlan) {
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

  // Walk switch ⇄ switch via trunks. trunk-not-configured / vlan-not-allowed
  // surface here; a clean path returns ok.
  return walkSwitchToSwitch(
    session,
    srcEdge.switchId,
    dstEdge.switchId,
    srcEdge.vlan,
    direction,
  );
}

/** BFS across the switch graph, traversing only properly-configured trunks
 *  that allow `vlan`. Returns ok on the first complete path found. When no
 *  path exists, returns the most informative failure observed — preferring
 *  the diagnostic-strong reasons (trunk-not-configured, vlan-not-allowed)
 *  over the generic dest-unreachable fallback.
 *
 *  For Lab 08's direct SW1 ⇄ SW2 link this collapses to a single iteration:
 *  one link to validate, one failure mode to report. Designed to scale to
 *  multi-hop trunk topologies without restructure. */
function walkSwitchToSwitch(
  session: LabSession,
  fromSwId: string,
  toSwId: string,
  vlan: number,
  direction: Direction,
): ReachResult {
  if (fromSwId === toSwId) return { ok: true };

  const visited = new Set<string>([fromSwId]);
  const queue: string[] = [fromSwId];
  let firstFailure: ReachResult | null = null;

  while (queue.length > 0) {
    const swId = queue.shift()!;
    const swSession = session.devices[swId];
    if (!swSession || swSession.kind !== 'switch') continue;

    for (const link of session.links) {
      let myIface: string;
      let peerEnd: { deviceId: string; iface: string };
      if (link.a.deviceId === swId) {
        myIface = link.a.iface;
        peerEnd = { deviceId: link.b.deviceId, iface: link.b.iface };
      } else if (link.b.deviceId === swId) {
        myIface = link.b.iface;
        peerEnd = { deviceId: link.a.deviceId, iface: link.a.iface };
      } else {
        continue;
      }

      const peer = session.devices[peerEnd.deviceId];
      if (!peer || peer.kind !== 'switch') continue;
      if (visited.has(peer.device.id)) continue;

      const myPort = swSession.device.switchports[myIface];
      const peerPort = peer.device.switchports[peerEnd.iface];
      if (!myPort || !peerPort) continue;

      // Both ends must be in trunk mode. Either end in access mode → the
      // link cannot carry VLAN tags. Reporting trunk-not-configured names the
      // ENTIRE link in the sentence (both ends), which is the cleanest
      // diagnostic regardless of which side the learner mis-configured.
      if (myPort.mode !== 'trunk' || peerPort.mode !== 'trunk') {
        if (!firstFailure) {
          firstFailure = {
            ok: false,
            failedAt: {
              direction,
              deviceId: swId,
              iface: myIface,
              reason: 'trunk-not-configured',
              trunk: {
                aDevice: swId,
                aIface: myIface,
                bDevice: peer.device.id,
                bIface: peerEnd.iface,
              },
            },
          };
        }
        continue;
      }

      // Both ends trunk — VLAN must appear in BOTH allowed lists.
      if (!trunkAllowsVlan(myPort.trunkAllowedVlans, vlan)) {
        if (!firstFailure) {
          firstFailure = {
            ok: false,
            failedAt: {
              direction,
              deviceId: swId,
              iface: myIface,
              reason: 'vlan-not-allowed',
              vlanAllow: { vlanId: vlan },
            },
          };
        }
        continue;
      }
      if (!trunkAllowsVlan(peerPort.trunkAllowedVlans, vlan)) {
        if (!firstFailure) {
          firstFailure = {
            ok: false,
            failedAt: {
              direction,
              deviceId: peer.device.id,
              iface: peerEnd.iface,
              reason: 'vlan-not-allowed',
              vlanAllow: { vlanId: vlan },
            },
          };
        }
        continue;
      }

      // Valid trunk crossing. If this is the destination switch, we're done.
      if (peer.device.id === toSwId) return { ok: true };
      visited.add(peer.device.id);
      queue.push(peer.device.id);
    }
  }

  if (firstFailure) return firstFailure;
  // Fully disjoint switch graph — nothing wrong with any individual link,
  // there just isn't one between fromSw and toSw. Treat as dest-unreachable.
  return fail(direction, fromSwId, null, 'dest-unreachable');
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
