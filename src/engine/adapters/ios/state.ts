/**
 * Cisco IOS device state — the per-device state machine's data model.
 *
 * State machines are per-device (CLAUDE.md): a multi-device lab is N of these
 * with explicit message passing. Everything here is plain serialisable data so
 * grading checks can query it declaratively and sessions can be cloned for
 * deterministic transitions.
 */
import { connectedRoutes, type Route } from './routing';

/** CLI mode stack levels. */
export type Mode = 'user' | 'priv' | 'config' | 'config-if' | 'config-router';

/** A single `network <prefix> <wildcard> area <area-id>` statement. */
export interface OspfNetwork {
  /** Dotted-quad prefix as typed (host bits NOT cleared). */
  readonly prefix: string;
  /** Dotted-quad wildcard mask, e.g. '0.0.0.255'. */
  readonly wildcard: string;
  readonly area: number;
}

/** State of one OSPF adjacency from this router's point of view. */
export interface OspfNeighborState {
  readonly state: 'FULL' | 'INIT' | 'DOWN';
  /** Neighbor's interface IP on the shared link. */
  readonly address: string;
  /** Local interface (canonical id, e.g. 'Gi0/2') the adjacency formed on. */
  readonly interface: string;
}

/** Per-router OSPF state. The neighbor table is keyed by neighbor router-id. */
export interface OspfState {
  process: number | null;
  routerId: string | null;
  networks: OspfNetwork[];
  /** Neighbors keyed by neighbor router-id. Kept as a Map so iteration order
   *  is insertion order — show output reads deterministically. */
  neighbors: Map<string, OspfNeighborState>;
}

export interface InterfaceState {
  /** Canonical interface id, e.g. 'Gi0/0'. */
  readonly id: string;
  /** Full IOS name, e.g. 'GigabitEthernet0/0'. */
  readonly name: string;
  /** Dotted-quad IP, or null if unassigned. */
  ip: string | null;
  /** Dotted-quad subnet mask, or null if unassigned. */
  mask: string | null;
  /** Interface description, or null. */
  description: string | null;
  /** true once `no shutdown` is applied. */
  adminUp: boolean;
  /** Line-protocol state: false when the link partner is admin-down or the
   *  interface is uncabled. Refreshed by the LabSession layer after every
   *  state-mutating command (mirrors the `nicUp` pass for PCs). Default true
   *  for tests / standalone sessions that never go through the refresh —
   *  show ip int brief falls back to adminUp gracefully in that case. */
  protocolUp: boolean;
}

export interface DeviceState {
  readonly id: string;
  hostname: string;
  readonly platform: string;
  interfaces: Record<string, InterfaceState>;
  /** Per-router OSPF state. Process is null until `router ospf <pid>` runs.
   *  Recomputed by the LabSession after any change to networks or interface
   *  admin state. */
  ospf: OspfState;
}

export interface Session {
  /** Device-kind discriminator — every adapter's session carries one. */
  readonly kind: 'router';
  mode: Mode;
  /** The interface currently selected in config-if mode. */
  currentInterface: string | null;
  device: DeviceState;
  /** Every successfully entered command line, in order, AS-TYPED by the user
   *  (abbreviated, mixed-case, etc.). Used for display and command recall. */
  history: string[];
  /** Same commands as {@link history}, but in CANONICAL form — abbreviations
   *  expanded by the resolver (e.g. `sho ip int br` -> `show ip interface brief`).
   *  Used by verification-style objectives so a check can match the canonical
   *  command without enumerating every valid abbreviation in a regex. */
  resolvedHistory: string[];
  /** Static routes entered via `ip route` — adminDistance:1, source:'static'.
   *  Connected routes are NOT stored here; they're derived from live interface
   *  state at query time via {@link routingTable}. Insertion order is preserved
   *  for the §5 deterministic tiebreak. */
  staticRoutes: Route[];
  /** OSPF-learned routes (source:'ospf', adminDistance:110). Rewritten by the
   *  LabSession's OSPF recompute pass after any topology / config change.
   *  Insertion order matches the order in which adjacencies discovered their
   *  prefixes — kept stable for the §5 tiebreak. */
  ospfRoutes: Route[];
}

const FULL_NAMES: Record<string, string> = {
  Gi: 'GigabitEthernet',
  Fa: 'FastEthernet',
};

/**
 * Normalise an interface token to a canonical id.
 * Accepts forms like `gi0/0`, `Gig0/1`, `GigabitEthernet0/2`, `fa0/0`.
 * Returns null if the token is not a recognised interface spec.
 */
export function normaliseInterface(token: string): string | null {
  const m = /^(gigabitethernet|gig|gi|g|fastethernet|fa|f)(\d+\/\d+(?:\/\d+)?)$/i.exec(token);
  if (!m) return null;
  const prefix = m[1].toLowerCase();
  const slot = m[2];
  const kind = prefix.startsWith('f') ? 'Fa' : 'Gi';
  return `${kind}${slot}`;
}

export function fullInterfaceName(id: string): string {
  const m = /^([A-Za-z]+)(\d.*)$/.exec(id);
  if (!m) return id;
  return `${FULL_NAMES[m[1]] ?? m[1]}${m[2]}`;
}

const QUAD = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function isValidIpv4(value: string): boolean {
  return QUAD.test(value);
}

/** Common valid contiguous IPv4 subnet masks. */
const VALID_MASKS = new Set([
  '255.0.0.0',
  '255.128.0.0',
  '255.192.0.0',
  '255.224.0.0',
  '255.240.0.0',
  '255.248.0.0',
  '255.252.0.0',
  '255.254.0.0',
  '255.255.0.0',
  '255.255.128.0',
  '255.255.192.0',
  '255.255.224.0',
  '255.255.240.0',
  '255.255.248.0',
  '255.255.252.0',
  '255.255.254.0',
  '255.255.255.0',
  '255.255.255.128',
  '255.255.255.192',
  '255.255.255.224',
  '255.255.255.240',
  '255.255.255.248',
  '255.255.255.252',
]);

export function isValidMask(value: string): boolean {
  return VALID_MASKS.has(value);
}

/** Build a fresh session from a lab's device + starting interface set.
 *  `structuredClone` is replaced by a deep-copy that preserves the OSPF
 *  neighbor Map — structuredClone DOES handle Maps, but we still call it
 *  to clone the whole device so that callers can safely mutate downstream. */
export function createSession(device: DeviceState): Session {
  return {
    kind: 'router',
    mode: 'user',
    currentInterface: null,
    device: cloneDevice(device),
    history: [],
    resolvedHistory: [],
    staticRoutes: [],
    ospfRoutes: [],
  };
}

/** Deep-copy a DeviceState including the OSPF Map (structuredClone handles
 *  Map natively; this exists as a single seam for tests that want to clone
 *  device state without the rest of the Session machinery). */
export function cloneDevice(device: DeviceState): DeviceState {
  return structuredClone(device);
}

/**
 * Effective routing table: derived connected routes (from up interfaces with
 * IP/mask) followed by statics and OSPF-learned routes. Insertion order is
 * preserved — connecteds first, then statics in entry order, then OSPF
 * routes in adjacency-discovery order — so the §5 tiebreak resolves
 * deterministically (mask DESC → adminDistance ASC → insertion ASC).
 * Reachability (canReach, 3b-c5) walks this view; OSPF routes carry
 * adminDistance:110, so they lose to a same-prefix static (AD 1) and a
 * connected (AD 0) as real IOS does.
 */
export function routingTable(s: Session): Route[] {
  return [...connectedRoutes(s.device), ...s.staticRoutes, ...s.ospfRoutes];
}

/**
 * Build a starting device from a topology spec: every interface admin-down with
 * no IP, matching a freshly-booted router (CLAUDE.md free-lab starting state).
 */
export function buildDevice(spec: {
  id: string;
  platform: string;
  interfaces: readonly string[];
}): DeviceState {
  const interfaces: Record<string, InterfaceState> = {};
  for (const id of spec.interfaces) {
    interfaces[id] = {
      id,
      name: fullInterfaceName(id),
      ip: null,
      mask: null,
      description: null,
      adminUp: false,
      // Defaults true; the lab-session refresh pass overrides this to false
      // when the cabled peer is admin-down or the interface is uncabled.
      // Direct adapter tests (no lab session) see protocolUp follow adminUp
      // via showIpIntBrief's fallback.
      protocolUp: true,
    };
  }
  return {
    id: spec.id,
    hostname: spec.id,
    platform: spec.platform,
    interfaces,
    ospf: { process: null, routerId: null, networks: [], neighbors: new Map() },
  };
}

/**
 * Derive the OSPF router-id: highest interface IP (loopbacks would win in
 * real IOS but the engine doesn't model them, so this is the
 * highest-IP-across-all-up-or-down interfaces rule). Returns null if no
 * interface has an IP — process is created but adjacency cannot form.
 */
export function deriveRouterId(device: DeviceState): string | null {
  let best: string | null = null;
  let bestVal = -1;
  for (const i of Object.values(device.interfaces)) {
    if (!i.ip) continue;
    const parts = i.ip.split('.').map(Number);
    const n = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    if (n > bestVal) {
      bestVal = n;
      best = i.ip;
    }
  }
  return best;
}

/** The prompt string for the current mode, e.g. `R1(config-if)#`. */
export function prompt(session: Session): string {
  const h = session.device.hostname;
  switch (session.mode) {
    case 'user':
      return `${h}>`;
    case 'priv':
      return `${h}#`;
    case 'config':
      return `${h}(config)#`;
    case 'config-if':
      return `${h}(config-if)#`;
    case 'config-router':
      return `${h}(config-router)#`;
  }
}
