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
import { lab05OspfSingleArea } from './ccna/lab-05-ospf-single-area';
import { lab06StandardAcl } from './ccna/lab-06-standard-acl';
import { lab07VlanAccessPorts } from './ccna/lab-07-vlan-access-ports';
import { lab08VlanTrunking } from './ccna/lab-08-vlan-trunking';
import { lab09IntervlanRouting } from './ccna/lab-09-intervlan-routing';
import { lab10Dhcp } from './ccna/lab-10-dhcp';
import { lab11NatPat } from './ccna/lab-11-nat-pat';
import { lab12ExtendedAcl } from './ccna/lab-12-extended-acl';
import { tshootReturnRoute } from './ccna/tshoot-return-route';
import { tshootWrongNextHop } from './ccna/tshoot-wrong-next-hop';
import { tshootWanSubnetMismatch } from './ccna/tshoot-wan-subnet-mismatch';
import { tshootEgressDown } from './ccna/tshoot-egress-down';

const CATALOG: readonly Lab[] = [
  lab01InterfaceIp,
  lab05OspfSingleArea,
  lab06StandardAcl,
  lab07VlanAccessPorts,
  lab08VlanTrunking,
  lab09IntervlanRouting,
  lab10Dhcp,
  lab11NatPat,
  lab12ExtendedAcl,
  tshootReturnRoute,
  tshootWrongNextHop,
  tshootWanSubnetMismatch,
  tshootEgressDown,
];

const BY_ID: ReadonlyMap<string, Lab> = new Map(CATALOG.map((lab) => [lab.id, lab]));

/** Resolve a catalog id to its Lab, or null if no lab has that id.
 *  Null (rather than undefined) so callers branch on a single sentinel. */
export function getLabById(id: string): Lab | null {
  return BY_ID.get(id) ?? null;
}
