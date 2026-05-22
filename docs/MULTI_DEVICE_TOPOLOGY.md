# MULTI_DEVICE_TOPOLOGY.md — The Multi-Device Engine & Topology Canvas

> The headline feature. Turns the single-device lab into a Packet-Tracer-style
> network: multiple clickable device types, links between them, and traffic
> (ping) simulation across the topology. Gate for ~26 catalog labs (all of
> Phase 3 + capstones C3/C4/C5). Build AFTER the single-device feel is locked,
> and build incrementally — pilot each layer with one lab.

## Goal & non-goals

Goal: a learner sees a network diagram (router + switches + PCs, wired
together), clicks any device to open its console, configures each device, and
proves the network works by pinging from one PC to another. Objectives shift
from "did you type the right config" to "does traffic actually flow."

Non-goals (CLAUDE.md): NOT a general-purpose simulator (topologies are authored,
not built by the learner); NOT a real packet stack (reachability is a scoped,
deterministic rule model); NOT free-form cabling (links defined by the lab).

## Extends what exists (generalize, do not rewrite)

- `Session` (IOS) becomes one device session among several.
- `TopologyPanel` already has a multi-device API (devices[]/activeDeviceId/
  onSelectDevice); the canvas replaces the SVG render.
- The IOS adapter becomes the `router` adapter; `switch` and `pc` are new
  adapters following docs/PARSER_ADAPTERS.md.
- Grading adds reachability checks alongside state checks.

## Model

Device kinds: 'router' | 'switch' | 'pc'. Each is an adapter exposing
grammarFor / applyCommand / prompt / buildDevice / toTopologyView.
- router: existing IOS + routing table + `ip route` (+ OSPF later).
- switch: L2 IOS subset (vlan, switchport access/trunk, STP basics, MAC table).
- pc: minimal host {ip, mask, gateway} + `ipconfig` and `ping <ip>`. The TEST
  ENDPOINT — how a learner verifies the lab.

LabSession = devices: Record<id, DeviceSession>; activeDeviceId; links: Link[].
Link = { a:{deviceId,iface}, b:{deviceId,iface} }. Terminal binds to active
device; clicking a canvas node changes it.

## Reachability (the hard part — build in layers, pilot each)

canReach(session, fromDeviceId, toIp) -> { ok, failedAt? }. Deterministic graph
evaluation over the topology. Layers:
- L2 (same broadcast domain): same VLAN/segment; checks interfaces up, same
  subnet, switch ports in right VLAN, trunks carrying it. Unlocks switching labs.
- L3 static: per hop interface up, correct subnet on link, matching route
  (connected/static), return path. Unlocks static routing + PC ping.
- L3 dynamic (OSPF): routing tables populated by OSPF (adjacency, advertised
  networks). Unlocks OSPF labs.
- ACL: an ACL in the path can drop the packet; failedAt = that hop.
failedAt powers troubleshooting labs and good error feedback.

## Grading via reachability

Objectives gain a reachability form: check: (session) =>
canReach(session, "PC-A", "192.168.2.10").ok. Most multi-device objectives
become "X can reach Y" — the network working is the pass condition.

## Canvas (React Flow, per CLAUDE.md)

Nodes = devices as equipment icons (router/switch/PC) + hostname + active
highlight. Edges = links, optionally labeled with subnet/IPs. Click node ->
active console. Port/link state reflects config live. N=1 still works.
Keep canvas generic — renders device-kind-agnostic view objects.

## Build order (incremental — pilot each layer)

3a Multi-device foundation: multiple router sessions, active-device switching
   wired to canvas, links model, React Flow canvas. Pilot: two routers cabled,
   configure each console, see topology. No ping yet.
3b PC device + L3 static reachability: pc adapter, routing table + ip route,
   L3-static layer. Pilot: static-routing lab, PC-A pings PC-B across 2 routers.
   THIS is the Packet-Tracer moment.
3c Switch device + L2 reachability: switch adapter (VLANs, ports, STP), L2
   layer. Pilot: VLAN lab.
3d OSPF dynamic routing: OSPF feeds routing tables; reachability uses learned
   routes. Pilot: OSPFv2 single-area.
3e ACLs in path + remaining L2 (EtherChannel, STP depth). Reachability respects
   ACLs; failedAt drives troubleshooting labs.

After 3a-3e: full Phase 3 catalog + capstones C3/C4/C5 are buildable.

## Risks

Reachability scope creep is the big one — keep it rule-based and lab-scoped, do
NOT build a real network stack. Determinism: same config -> same result, no
randomness. Switch IOS surface: CCNA command set only. Canvas device icons are
the most visible polish surface after the terminal.
