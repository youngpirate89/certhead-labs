/**
 * ACL evaluation — pure, deterministic. Handles both standard (source-only)
 * and named extended (protocol + source + destination) ACL entries.
 *
 * Top-down first-match-wins, with an implicit `deny any` at the end of every
 * ACL. Matching is wildcard-bitmask: bits set to 0 in the wildcard must match
 * between source IP and entry source; bits set to 1 are "don't care". The
 * standard `host <ip>` form is encoded as wildcard:null (semantically /32);
 * extended entries always use a real wildcard string ('0.0.0.0' for host).
 *
 * Extended entries (Lab 12) additionally constrain by `protocol` and by a
 * destination IP + wildcard. The evaluator discriminates on `entry.protocol`:
 * undefined → standard path (source only); defined → extended path. Standard
 * entries are unaffected by the protocol/dstIp args — backward-compatible
 * with every Lab 06 / Lab 11 ACL.
 *
 * Reused by:
 *   - reachability.canReach           — out-ACL on egress, in-ACL on ingress
 *   - pc.tracert hop discovery        — keeps the trace's `[sim]` line in
 *                                       lockstep with ping's diagnosis
 */
import { ipToInt } from './routing';
import type { Acl, AclEntry } from './state';

/** Traffic protocol type passed to the ACL evaluator. Standard ACL entries
 *  ignore it; extended entries match against it. The default in canReach is
 *  'ip' — a permissive identity that matches both the `permit ip any any`
 *  IOS idiom AND any non-ICMP/TCP/UDP forward traffic. Ping handlers pass
 *  'icmp' explicitly so extended `deny icmp ...` entries fire. */
export type AclProtocol = 'ip' | 'tcp' | 'udp' | 'icmp';

/** Evaluate (`sourceIp`, `protocol`, `dstIp`) against `acl`. Returns the first
 *  matching entry's action, or `'deny'` if no entry matches (the implicit
 *  deny). `protocol`/`dstIp` are only consulted by extended entries; standard
 *  entries match on source alone, so omitting them is safe. Pure. */
export function evaluateAcl(
  acl: Acl,
  sourceIp: string,
  protocol: AclProtocol = 'ip',
  dstIp: string = '0.0.0.0',
): 'permit' | 'deny' {
  for (const entry of acl.entries) {
    if (matchesEntry(entry, sourceIp, protocol, dstIp)) return entry.action;
  }
  return 'deny';
}

/** True iff (`ip`, `protocol`, `dstIp`) is matched by `entry`.
 *
 *  Standard entries (no `protocol` set): source IP match alone.
 *  Extended entries: protocol match (ACL 'ip' matches every protocol) + source
 *  IP match + destination IP match. Port filtering is not modeled in canReach
 *  (no per-packet port context), so extended entries with `dstPort` set still
 *  match traffic of the right protocol/src/dst — pedagogy-wise, the lab cares
 *  about icmp-vs-not, not specific TCP ports. */
export function matchesEntry(
  entry: AclEntry,
  ip: string,
  protocol: AclProtocol = 'ip',
  dstIp: string = '0.0.0.0',
): boolean {
  // Source match (shared by both shapes). Standard entries store source +
  // wildcard|null; extended entries mirror these via the same fields plus
  // srcIp/srcWildcard. Read source/wildcard so both shapes share one path.
  const wildcard = entry.wildcard ?? '0.0.0.0';
  if (!wildcardCovers(entry.source, wildcard, ip)) return false;

  // Standard entries match on source alone — no protocol/dst check.
  if (entry.protocol === undefined) return true;

  // Extended entry: protocol — `ip` matches any protocol; otherwise must equal.
  if (entry.protocol !== 'ip' && entry.protocol !== protocol) return false;

  // Extended entry: destination match.
  if (entry.dstIp !== undefined && entry.dstWildcard !== undefined) {
    if (!wildcardCovers(entry.dstIp, entry.dstWildcard, dstIp)) return false;
  }

  return true;
}

/** Wildcard bits set to 1 are "don't care"; bits set to 0 must match.
 *  Mirrors the OSPF `network` matcher — same bitmask semantics. */
function wildcardCovers(prefix: string, wildcard: string, ip: string): boolean {
  const p = ipToInt(prefix);
  const w = ipToInt(wildcard);
  const i = ipToInt(ip);
  return ((p ^ i) & (~w >>> 0)) === 0;
}
