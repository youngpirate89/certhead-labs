/**
 * Standard numbered ACL evaluation — pure, deterministic.
 *
 * Top-down first-match-wins, with an implicit `deny any` at the end of every
 * ACL. Matching is wildcard-bitmask: bits set to 0 in the wildcard must match
 * between source IP and entry source; bits set to 1 are "don't care". The
 * `host <ip>` form is encoded as wildcard:null (semantically 0.0.0.0).
 *
 * Reused by:
 *   - reachability.canReach           — out-ACL on egress, in-ACL on ingress
 *   - pc.tracert hop discovery        — keeps the trace's `[sim]` line in
 *                                       lockstep with ping's diagnosis
 *
 * Extended ACLs are intentionally out of scope: this file branches only on
 * standard-form entries (source IP + wildcard). Adding a second `type` to
 * Acl down the line means a new match function — not restructuring the
 * caller surface.
 */
import { ipToInt } from './routing';
import type { Acl, AclEntry } from './state';

/** Evaluate `sourceIp` against `acl`. Returns the first matching entry's
 *  action, or `'deny'` if no entry matches (the implicit deny). Pure. */
export function evaluateAcl(acl: Acl, sourceIp: string): 'permit' | 'deny' {
  for (const entry of acl.entries) {
    if (matchesEntry(entry, sourceIp)) return entry.action;
  }
  return 'deny';
}

/** True iff `ip` falls inside the entry's source/wildcard pair.
 *  `wildcard: null` (the `host <ip>` form) is treated as 0.0.0.0 — exact match. */
export function matchesEntry(entry: AclEntry, ip: string): boolean {
  const wildcard = entry.wildcard ?? '0.0.0.0';
  return wildcardCovers(entry.source, wildcard, ip);
}

/** Wildcard bits set to 1 are "don't care"; bits set to 0 must match.
 *  Mirrors the OSPF `network` matcher — same bitmask semantics. */
function wildcardCovers(prefix: string, wildcard: string, ip: string): boolean {
  const p = ipToInt(prefix);
  const w = ipToInt(wildcard);
  const i = ipToInt(ip);
  return ((p ^ i) & (~w >>> 0)) === 0;
}
