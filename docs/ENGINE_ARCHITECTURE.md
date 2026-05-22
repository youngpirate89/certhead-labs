# ENGINE_ARCHITECTURE.md — Reachability Engine (canReach)

> Seed doc, created when the first reachability-graded lab is designed (phase 3b),
> per CLAUDE.md's "create when the first multi-device lab is being designed" rule.
> Scope of this revision: the **L3-static layer of `canReach`** only. Later layers
> (L2, OSPF, ACL) extend the structures defined here; they are NOT implemented yet.
>
> Governing constraint (CLAUDE.md + MULTI_DEVICE_TOPOLOGY.md risks): this is a
> **scoped, deterministic rule model — NOT a real packet stack.** Same config →
> same result, always. No randomness, no timing simulation, no protocol fidelity
> beyond what a CCNA lab objective needs.

---

## 1. Contract

```
canReach(session: LabSession, fromDeviceId: string, toIp: string): ReachResult

type ReachResult =
  | { ok: true }
  | { ok: false; failedAt: FailPoint }

type FailPoint = {
  direction: 'forward' | 'return'
  deviceId: string          // device where evaluation stopped
  iface: string | null      // interface implicated (null for endpoint/source faults)
  reason: FailReason        // machine-readable; UI/grading maps to learner text
}
```

`canReach` is pure: it reads `session` and returns a result. It mutates nothing.
Grading objectives call it directly:

```ts
check: (session) => canReach(session, 'PC-A', '192.168.2.10').ok
```

`ping <ip>` on the pc adapter is the same call, with `failedAt` rendered as
learner-facing feedback.

---

## 2. Three resolved design decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Ping model | **Full round-trip** (forward walk, then return walk) | The "forward route exists, return route missing" bug is a core CCNA teaching objective. One-directional can't model it. |
| `failedAt` granularity | **Hop-level** `{deviceId, iface, reason}` | The spec ties `failedAt` to troubleshooting labs (3e). Device-only granularity can't say "no return route" vs "interface down." Return contract is inherited by every later layer — build it right once. |
| 3b layer scope | **L3-static only on behavior; hop-walk reads a routing-table abstraction** | No speculative L2/OSPF/ACL stubs (guardrail #21). But the walk resolves hops via `routingTable`, so OSPF (3d) adds entries instead of rewriting the walk. The abstraction is non-speculative — OSPF is named and scheduled. |

---

## 3. Data model additions (3b)

### Router DeviceSession gains a routing table

```ts
type Route = {
  prefix: string        // network address, e.g. '192.168.2.0'
  mask: string          // e.g. '255.255.255.0'
  nextHop?: string      // for static via next-hop
  egressIface?: string  // for static via interface, or resolved connected iface
  source: 'connected' | 'static'   // 'ospf' added in 3d — same table
  adminDistance: number // connected=0, static=1 (ospf=110 later)
}
```

- **Connected routes** are derived automatically from each up interface that has
  an IP/mask. (Interface down → its connected route is absent.)
- **Static routes** come from `ip route <prefix> <mask> <next-hop | egress-iface>`.
- OSPF later adds `source:'ospf'` rows to this same array. **The walk does not
  change** — that is the entire point of the abstraction.

### PC DeviceSession (new — the test endpoint)

```ts
type PcSession = {
  ip?: string
  mask?: string
  gateway?: string
  nicUp: boolean   // true when the pc's single NIC is cabled to an up neighbor iface
}
```

PCs are **endpoints, not forwarders.** A PC has one NIC and a default gateway; it
never appears as a transit hop. Commands: `ipconfig` (show state), `ping <ip>`
(invoke `canReach`).

---

## 4. The algorithm

`canReach` runs `walk` twice and combines:

```
canReach(session, fromId, toIp):
    fwd = walk(session, sourceIpOf(fromId), toIp, direction='forward')
    if not fwd.ok: return { ok:false, failedAt: fwd.failedAt }
    ret = walk(session, toIp, sourceIpOf(fromId), direction='return')
    if not ret.ok: return { ok:false, failedAt: ret.failedAt }
    return { ok:true }
```

### `walk(session, srcIp, dstIp, direction)`

A deterministic hop-by-hop forwarding evaluation from the endpoint owning `srcIp`
toward `dstIp`.

```
1. SOURCE ENDPOINT CHECK
   owner = deviceOwningIp(srcIp)
   if owner is a PC:
     - if no ip/mask:        fail(owner, null, 'source-no-ip')
     - if not nicUp:         fail(owner, null, 'source-nic-down')
     - if dstIp in owner's local subnet:  current = owner; deliverDirect → step 4
     - else: gateway must be set AND in owner's subnet AND reachable on the
             cabled neighbor interface (that iface up)
             if gateway unset/out-of-subnet: fail(owner, null, 'no-gateway')
             current = neighbor router reached via the PC's link
   (routers as source only arise mid-walk, handled in step 2)

2. ROUTE LOOKUP AT current (router)
   route = longestPrefixMatch(current.routingTable, dstIp)   // §5 tiebreak
   if none:                  fail(current, ingressIface, 'no-route')

3. FORWARD ONE HOP
   if route.source == 'connected' AND dstIp in that interface's subnet:
       → dstIp is on a directly attached subnet; go to step 4 (delivery)
   else (static/next-hop):
       egress = interface whose subnet contains route.nextHop (or route.egressIface)
       if egress missing or down:        fail(current, egress, 'egress-down')
       if route.nextHop not in egress subnet: fail(current, egress, 'next-hop-unreachable')
       neighborIface = otherEndOfLink(current, egress)   // links model
       if neighborIface down:            fail(current, egress, 'link-peer-down')
       if neighbor subnet != egress subnet: fail(current, egress, 'link-subnet-mismatch')
       current = neighbor device
       loopGuard()   // §6
       goto step 2

4. DELIVERY
   dst = deviceOwningIp(dstIp)
   if dst is PC and not nicUp:   fail(dst, null, 'dest-nic-down')
   if dst does not own dstIp on an up interface: fail(dst, null, 'dest-unreachable')
   return { ok: true }
```

`fail(deviceId, iface, reason)` returns
`{ ok:false, failedAt:{ direction, deviceId, iface, reason } }`.

### `FailReason` enumeration (3b)

```
'source-no-ip' | 'source-nic-down' | 'no-gateway' | 'no-route'
| 'egress-down' | 'next-hop-unreachable' | 'link-peer-down'
| 'link-subnet-mismatch' | 'dest-nic-down' | 'dest-unreachable'
| 'routing-loop'
```

Grading reads only `ok`. The terminal's `ping` output maps `reason` + `deviceId`
+ `iface` to a learner sentence (e.g. `no-route` at R2 → "R2 has no route to
192.168.1.0/24").

---

## 5. Longest-prefix match + deterministic tiebreak

```
longestPrefixMatch(table, dstIp):
    candidates = routes whose (prefix/mask) contains dstIp
    sort by: (1) mask length DESC   — most specific wins
             (2) adminDistance ASC  — connected < static (< ospf later)
             (3) stable insertion order — final deterministic tiebreak
    return candidates[0] or none
```

No ECMP, no load-balancing, no randomness. Equal-cost ties resolve by insertion
order so the result is identical on every evaluation.

---

## 6. Termination / loop guard

A misconfigured static route can point in a circle. The walk caps hops at
`session.devices.count + 2`. Exceeding the cap returns
`fail(current, ingressIface, 'routing-loop')`. Deterministic and bounded — no
infinite evaluation, no stack risk.

---

## 7. Explicitly OUT of scope for 3b

These are NOT evaluated and NOT stubbed as fake-passing layers:

- **L2 / VLAN / switch transit** — no switch devices exist in 3b; PCs cable
  directly to routers. A topology requiring an L2 segment is a 3c lab. (3c adds
  an L2 resolution step *before* `walk`'s router hops.)
- **OSPF-learned routes** — only `connected` + `static` populate the table in 3b.
  3d adds `source:'ospf'` rows; the walk is unchanged.
- **ACL filtering** — no ACL evaluation in the path. 3e inserts an ACL check per
  hop that can set `failedAt` with an `'acl-drop'` reason.

If a lab definition references a switch kind or OSPF/ACL config in 3b, it fails
loudly at load (same gate pattern as the 3a switch/pc kind guard) — it does not
silently pass `canReach`.

---

## 8. Determinism guarantees (the non-negotiable)

- Pure function of `session`. No clock, no `Math.random`, no async.
- Tiebreaks fully ordered (§5). Loop bound fixed (§6).
- Same `session` → same `ReachResult`, every call, every machine.

This is the inverse of CertHead's probabilistic question generation, and it is a
hard constraint (CLAUDE.md #8).

---

## 9. 3b pilot lab (validation target)

Topology: `PC-A — R1 — R2 — PC-B` (two point-to-point router links + two
PC-to-router links). Objectives:

- State checks: each router interface IP'd and up; static routes configured both
  directions; PC IP/gateway set.
- **Reachability check (the headline):**
  `canReach(session, 'PC-A', <PC-B ip>).ok` — the lab passes when the ping
  actually crosses the network *and the reply gets back*.

The deliberately instructive failure: configure the forward statics but omit a
return route → forward walk passes, return walk fails with `no-route` on the
router missing the back-route. That is the Packet-Tracer moment the whole engine
has been building toward.
