/**
 * Lab catalog — the source of truth for every deployed lab and the lookup
 * the `/embed` Pro route uses to resolve a token's `labId` claim.
 *
 * The catalog includes the free lab AND every Pro-tier lab. The split between
 * `/try` (free, public) and `/embed` (Pro, JWT-gated) is enforced at the
 * route entry points, not by partitioning the catalog: `TryMode` imports the
 * free lab directly so the `/try` bundle stays free-lab-only, while `/embed`
 * (Phase A2 of the Pro-labs integration) will route through `getLabById`.
 *
 * Because nothing on the `/try` code path imports this module today, the
 * catalog and every Pro-tier lab it transitively pulls in are tree-shaken
 * out of the current production bundle.
 */
import type { Lab } from '@/engine/types';
import { lab01InterfaceIp } from './ccna/lab-01-interface-ip';
import { tshootReturnRoute } from './ccna/tshoot-return-route';
import { tshootWrongNextHop } from './ccna/tshoot-wrong-next-hop';
import { tshootWanSubnetMismatch } from './ccna/tshoot-wan-subnet-mismatch';

const CATALOG: readonly Lab[] = [
  lab01InterfaceIp,
  tshootReturnRoute,
  tshootWrongNextHop,
  tshootWanSubnetMismatch,
];

const BY_ID: ReadonlyMap<string, Lab> = new Map(CATALOG.map((lab) => [lab.id, lab]));

/** Resolve a catalog id to its Lab, or null if no lab has that id.
 *  Null (rather than undefined) so callers branch on a single sentinel. */
export function getLabById(id: string): Lab | null {
  return BY_ID.get(id) ?? null;
}
