/**
 * DHCP binding allocator — synchronous, deterministic.
 *
 * Per CLAUDE.md guardrail #8 the engine is deterministic; DHCP here is NOT a
 * timer-based protocol implementation. DISCOVER/OFFER/REQUEST/ACK exchanges,
 * lease timers, conflict detection, and option negotiation are all skipped.
 * Bindings are evaluated SYNCHRONOUSLY after any change to pools, excluded
 * ranges, or the topology's DHCP-client set. For the curated scenarios we
 * ship — a single router serving one PC on a /24 subnet — this captures the
 * configuration choices CCNA learners need to recognize (pool fields, excluded
 * range) without simulating control-plane traffic.
 *
 * The single entry point is {@link recomputeBindings}: given the router's
 * pool map + excluded ranges + the lab-derived list of DHCP clients on this
 * router, return a fresh `Map<clientId, DhcpBinding>`. Pure.
 */
import {
  type DhcpBinding,
  type DhcpExcludedRange,
  type DhcpPool,
} from './state';
import { ipInSubnet, ipToInt, intToIp, networkAddress } from './routing';

/** True when `ip` falls within any of the excluded ranges (inclusive both
 *  ends). Single-host exclusions are encoded as `start === end`. */
export function isExcluded(ip: string, excluded: readonly DhcpExcludedRange[]): boolean {
  const n = ipToInt(ip);
  for (const r of excluded) {
    if (n >= ipToInt(r.start) && n <= ipToInt(r.end)) return true;
  }
  return false;
}

/** True when `pool` has the minimum fields required to allocate addresses
 *  (network + mask). `defaultRouter`/`dnsServer` are advisory option data
 *  that get handed to clients but are not required for allocation. */
export function poolIsReady(pool: DhcpPool): boolean {
  return pool.network !== null && pool.mask !== null;
}

/**
 * Allocate one IP for `clientId` from `pool`, deterministic.
 *
 * Allocation order: walk the network range from `.0 + 1` upward, skipping the
 * network address, broadcast address, excluded ranges, and any address already
 * allocated to a peer client whose id sorts before `clientId`. Returns the
 * first available IP, or `undefined` if the range is exhausted or the pool is
 * not ready.
 *
 * The clientId sort is what makes the allocation deterministic across
 * recomputes — the same client always lands on the same slot in the order, so
 * the same binding always falls out. Per the work order spec.
 */
export function computeBinding(
  pool: DhcpPool,
  excluded: readonly DhcpExcludedRange[],
  clientId: string,
  allClientIds: readonly string[],
): string | undefined {
  if (!poolIsReady(pool)) return undefined;
  const network = pool.network as string;
  const mask = pool.mask as string;
  const netInt = ipToInt(networkAddress(network, mask));
  const maskInt = ipToInt(mask);
  const broadcastInt = (netInt | (~maskInt >>> 0)) >>> 0;

  const reserved = new Set<number>();
  reserved.add(netInt);
  reserved.add(broadcastInt);

  // Allocate to peers that sort earlier, claiming their slots before we ask
  // for ours. Tied to the client-id sort order so the same input always
  // produces the same binding.
  const sorted = [...allClientIds].sort();
  for (const cid of sorted) {
    if (cid === clientId) break;
    const peerIp = nextAvailable(netInt, broadcastInt, excluded, reserved);
    if (peerIp === undefined) return undefined;
    reserved.add(ipToInt(peerIp));
  }
  return nextAvailable(netInt, broadcastInt, excluded, reserved);
}

function nextAvailable(
  netInt: number,
  broadcastInt: number,
  excluded: readonly DhcpExcludedRange[],
  reserved: ReadonlySet<number>,
): string | undefined {
  for (let i = netInt + 1; i < broadcastInt; i++) {
    if (reserved.has(i)) continue;
    const ip = intToIp(i >>> 0);
    if (isExcluded(ip, excluded)) continue;
    return ip;
  }
  return undefined;
}

/** One DHCP client request — "this device wants an IP from this router's
 *  named pool". The lab-session refresh pass derives the list from the
 *  topology (PCs with `dhcpMode: true` cabled into the router) and the
 *  router's pool set (the pool whose network covers the cabled subnet). */
export interface DhcpClientRequest {
  readonly clientId: string;
  readonly poolName: string;
}

/**
 * Recompute the full binding map for one router. Groups clients by pool,
 * sorts each group deterministically, and walks them through
 * {@link computeBinding}. Returns a `Map<clientId, DhcpBinding>` — clients
 * for which no slot was available (range exhausted, pool not ready) are
 * simply absent from the result, NOT mapped to a sentinel.
 */
export function recomputeBindings(
  pools: ReadonlyMap<string, DhcpPool>,
  excluded: readonly DhcpExcludedRange[],
  clients: readonly DhcpClientRequest[],
): Map<string, DhcpBinding> {
  const byPool = new Map<string, string[]>();
  for (const { clientId, poolName } of clients) {
    const list = byPool.get(poolName) ?? [];
    list.push(clientId);
    byPool.set(poolName, list);
  }

  const out = new Map<string, DhcpBinding>();
  for (const [poolName, ids] of byPool) {
    const pool = pools.get(poolName);
    if (!pool || !poolIsReady(pool)) continue;
    for (const cid of ids) {
      const ip = computeBinding(pool, excluded, cid, ids);
      if (ip !== undefined) {
        out.set(cid, { clientId: cid, ip, poolName });
      }
    }
  }
  return out;
}

/** Pick the pool on this router whose network covers `ip`. Returns the first
 *  match — pools should not overlap in a well-formed config; if they do, the
 *  first-defined wins. Returns null when no pool matches. */
export function findPoolForIp(
  pools: ReadonlyMap<string, DhcpPool>,
  ip: string,
): DhcpPool | null {
  for (const pool of pools.values()) {
    if (!pool.network || !pool.mask) continue;
    if (ipInSubnet(ip, networkAddress(pool.network, pool.mask), pool.mask)) {
      return pool;
    }
  }
  return null;
}
