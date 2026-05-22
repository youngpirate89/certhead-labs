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
export type Mode = 'user' | 'priv' | 'config' | 'config-if';

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
}

export interface DeviceState {
  readonly id: string;
  hostname: string;
  readonly platform: string;
  interfaces: Record<string, InterfaceState>;
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
   *  state at query time via {@link routingTable}. OSPF (3d) appends to this
   *  same array with source:'ospf'. Insertion order is preserved for the §5
   *  deterministic tiebreak. */
  staticRoutes: Route[];
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

/** Build a fresh session from a lab's device + starting interface set. */
export function createSession(device: DeviceState): Session {
  return {
    kind: 'router',
    mode: 'user',
    currentInterface: null,
    device: structuredClone(device),
    history: [],
    resolvedHistory: [],
    staticRoutes: [],
  };
}

/**
 * Effective routing table: derived connected routes (from up interfaces with
 * IP/mask) followed by statics (and OSPF later). Insertion order is preserved
 * — connecteds first, statics in entry order — so the §5 tiebreak resolves
 * deterministically. Reachability (canReach, 3b-c5) walks this view.
 */
export function routingTable(s: Session): Route[] {
  return [...connectedRoutes(s.device), ...s.staticRoutes];
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
    };
  }
  return { id: spec.id, hostname: spec.id, platform: spec.platform, interfaces };
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
  }
}
