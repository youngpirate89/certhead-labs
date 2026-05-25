/**
 * IPv4 routing primitives for the router adapter.
 *
 * Defines the Route shape (per docs/ENGINE_ARCHITECTURE.md §3), the
 * connected-route derivation from live interface state, and the
 * longest-prefix-match resolver with the §5 deterministic tiebreak
 * (mask DESC → adminDistance ASC → insertion ASC).
 *
 * Everything here is pure: same input → same output. The reachability
 * engine (canReach, landing in 3b-c5) walks these routes; OSPF later
 * (3d) appends rows to the same table without touching the walk.
 */
import type { DeviceState } from './state';

export type RouteSource = 'connected' | 'static' | 'ospf';

export interface Route {
  /** Network address (host bits cleared), dotted-quad. */
  readonly prefix: string;
  readonly mask: string;
  /** Next-hop IP if the route is static via next-hop. */
  readonly nextHop?: string;
  /** Egress interface id (e.g. `Gi0/0`). Present on connected routes and on
   *  static routes that point at an interface rather than an IP. */
  readonly egressIface?: string;
  readonly source: RouteSource;
  /** Per §3: connected=0, static=1, ospf=110. */
  readonly adminDistance: number;
  /** OSPF cost — only present when source==='ospf'. Render in [AD/metric]
   *  brackets so the show-ip-route line reads `[110/1]`. */
  readonly metric?: number;
}

// ---------- IPv4 bit utilities ----------

/** Coerce a dotted-quad to an unsigned 32-bit integer. Trusts the caller —
 *  validation happens in state.isValidIpv4. */
export function ipToInt(ip: string): number {
  const p = ip.split('.').map(Number);
  return (((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0);
}

export function intToIp(n: number): string {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}

/** Prefix length (number of leading 1 bits) of a contiguous IPv4 mask. */
export function maskLength(mask: string): number {
  const n = ipToInt(mask);
  // Count leading ones. Mask is contiguous by precondition (isValidMask).
  let len = 0;
  for (let i = 31; i >= 0; i--) {
    if ((n >>> i) & 1) len++;
    else break;
  }
  return len;
}

/** Network address obtained by masking `ip` with `mask`. */
export function networkAddress(ip: string, mask: string): string {
  return intToIp((ipToInt(ip) & ipToInt(mask)) >>> 0);
}

/** Whether `ip` falls inside the subnet (prefix, mask). */
export function ipInSubnet(ip: string, prefix: string, mask: string): boolean {
  const m = ipToInt(mask);
  return (ipToInt(ip) & m) === (ipToInt(prefix) & m);
}

// ---------- Connected route derivation ----------

/** Connected routes derived from live interface state. An interface produces
 *  one route iff it is admin-up AND has an IP+mask. Order follows interface
 *  iteration order, which is stable for the lab-spec interfaces[] declaration. */
export function connectedRoutes(device: DeviceState): Route[] {
  const out: Route[] = [];
  for (const iface of Object.values(device.interfaces)) {
    if (!iface.adminUp || !iface.ip || !iface.mask) continue;
    out.push({
      prefix: networkAddress(iface.ip, iface.mask),
      mask: iface.mask,
      egressIface: iface.id,
      source: 'connected',
      adminDistance: 0,
    });
  }
  return out;
}

// ---------- Lookup ----------

/**
 * Longest-prefix match with the §5 deterministic tiebreak ordering:
 *   1. mask length DESC (most specific wins)
 *   2. adminDistance ASC (connected < static < ospf)
 *   3. insertion order ASC (stable final tiebreak)
 *
 * Returns the chosen route, or undefined if no route covers dstIp. Pure.
 */
export function longestPrefixMatch(
  table: readonly Route[],
  dstIp: string,
): Route | undefined {
  const matches = table
    .map((r, idx) => ({ r, idx, len: maskLength(r.mask) }))
    .filter(({ r }) => ipInSubnet(dstIp, r.prefix, r.mask));
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => {
    if (b.len !== a.len) return b.len - a.len;
    if (a.r.adminDistance !== b.r.adminDistance) {
      return a.r.adminDistance - b.r.adminDistance;
    }
    return a.idx - b.idx;
  });
  return matches[0].r;
}
