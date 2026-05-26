# LAB_CATALOG.md — CCNA 200-301 Lab Catalog & Build Order

**~55 labs total (1 free + 49 Pro + 5 capstones).** Organized into build phases
by the *engine capability* each lab needs — that, not single- vs multi-device,
is the real dependency. Labs are built locally and deployed to CertHead Pro as a
decision (demand-gate removed); the only hard sequencing is technical.

## Design rules (locked)

- **Depth goes where students struggle**, not where it pads a count. Multiple
  labs in a domain only when each exercises a genuinely different state, command
  surface, or failure mode. Depth domains: subnetting, ACLs/wildcard masks,
  OSPF, VLANs/STP, and troubleshooting.
- **No padding on recall domains** (NAT, DHCP, NTP/syslog, hostname/SSH). One
  lab each — a second would be the same lab with the numbers changed.
- **The free lab is the polish bar.** All 50 clear it.
- **Troubleshooting is the highest-value type** (CCNA is a troubleshooting-heavy
  exam) and reuses the engine fully: a TS lab is a *wrong* starting state with
  objectives that check it's been *fixed*.

## Lab tiers

Every lab is one of three tiers. The arc within a domain is deliberate: drills
build a skill, scenarios integrate a few, the domain capstone proves mastery,
and a single grand capstone proves exam-readiness.

- **Drill** — one isolated skill, 3-5 objectives, ~5-8 min. Struggle domains get
  several (subnetting especially benefits from reps). Quick wins, focused.
- **Scenario** — 2-3 skills combined as they co-occur in practice, 6-10
  objectives, ~10-15 min (e.g. define an ACL, apply it the right direction,
  verify the traffic result).
- **Capstone** — 10-20 objectives, ~20-40 min, multi-skill and multi-device
  where the engine allows. One per major domain + one grand capstone. Built to
  feel like the exam's lab simulations; these are the marketing showcase labs.

Capstones are depth, not padding: each exercises a *combination* no drill does.
Most are gated on later engine phases (noted per capstone below).

## Coverage reality

These 50 cover the **labbable ~65%** of the exam by blueprint weight — the
config-and-verify core of Network Access, IP Connectivity, IP Services, and
Security. The remaining ~35% (OSI/cabling theory, wireless concepts, and the
~10% Automation & Programmability domain) does not fit a CLI sim and stays the
**question bank's** job. Subnetting is the one theory-adjacent area labs can
chip into, which is why it gets dedicated labs here. Labs + question bank
together cover CCNA; labs alone never will, by design.

---

## PHASE 1 — buildable on today's engine

Needs only: interface config, addressing, device management, `show`. No new
engine modules. **Start here.**

| #  | Lab | Domain | Depth |
|----|-----|--------|-------|
| 1  | Configure interface IP & bring link up | Fundamentals | *free — built* ✓ |
| 2  | IPv4 addressing across multiple interfaces & verify | Fundamentals | |
| 3  | Subnetting: design a flat network to host requirements | Addressing | subnetting |
| 4  | Subnetting: VLSM allocation across subnets | Addressing | subnetting |
| 5  | Subnetting: route summarization | Addressing | subnetting |
| 6  | IPv6 addressing — link-local, global, EUI-64 | Addressing | |
| 7  | Device hardening — hostname, banner, enable secret, line passwords | Mgmt | |
| 8  | SSH & VTY access control | Security | |
| 9  | Running vs startup config — save, reload, verify | Mgmt | |

*Three distinct subnetting labs (design / VLSM / summarization) — deliberately
not more, since subnetting labs risk feeling identical if over-multiplied.*

---

## PHASE 2 — single-device engine extensions

Each cluster adds one state module to the engine, then unlocks its labs. Order
within the phase is flexible; ACLs first (matches CLAUDE.md Weekend 5-6).

**ACL module** (rule list + traffic evaluation)

| #  | Lab | Domain | Depth |
|----|-----|--------|-------|
| 10 | Standard ACL | Security | ACL |
| 11 | Extended ACL | Security | ACL |
| 12 | Named ACLs — edit & resequence | Security | ACL |
| 13 | ACL wildcard mask practice | Security | ACL (struggle) |
| 14 | Restrict VTY/management access with an ACL | Security | ACL |

**NAT module** (translation table)

| #  | Lab | Domain | Depth |
|----|-----|--------|-------|
| 15 | Static NAT | IP Services | |
| 16 | PAT (NAT overload) | IP Services | |

**DHCP + services modules**

| #  | Lab | Domain | Depth |
|----|-----|--------|-------|
| 17 | DHCP server on a router | IP Services | |
| 18 | NTP, syslog & SNMP basics | IP Services | |
| 19 | Port security on an access switch | Security | |

**Single-device troubleshooting** (uses the modules above)

| #  | Lab | Domain | Depth |
|----|-----|--------|-------|
| 20 | TS: interface / IP misconfiguration | Fundamentals | troubleshooting |
| 21 | TS: SSH access broken (key / transport) | Security | troubleshooting |
| 22 | TS: ACL blocking legitimate traffic | Security | troubleshooting |
| 23 | TS: extended ACL wrong order / direction | Security | troubleshooting |
| 24 | TS: NAT / PAT misconfiguration | IP Services | troubleshooting |

---

## PHASE 3 — multi-device engine + clickable topology

The big build (CLAUDE.md Weekend 9-10): N per-device state machines with
message-passing, plus the interactive topology panel (click a device to focus
its console). **Everything below is blocked until this engine exists** — you
cannot author a two-router OSPF lab before two routers can talk.

**Static routing**

| #  | Lab | Domain | Depth |
|----|-----|--------|-------|
| 25 | Static routing between two routers | IP Connectivity | |
| 26 | Default route / gateway of last resort | IP Connectivity | |
| 27 | Floating static routes (administrative distance) | IP Connectivity | |
| 28 | IPv6 static routing | IP Connectivity | |

**Switching / Layer 2**

| #  | Lab | Domain | Depth |
|----|-----|--------|-------|
| 29 | VLANs & access-port assignment | Network Access | VLAN — *built* ✓ (`ccna-lab07-vlan-access-ports`) |
| 30 | 802.1Q trunking | Network Access | VLAN |
| 31 | Inter-VLAN routing — router-on-a-stick | Network Access | VLAN |
| 32 | Inter-VLAN routing — SVIs / L3 switch | Network Access | VLAN |
| 33 | STP root bridge election | Network Access | STP |
| 34 | STP port roles — PortFast & BPDU Guard | Network Access | STP |
| 35 | EtherChannel (LACP) | Network Access | |
| 36 | CDP / LLDP neighbor discovery | Mgmt | |

**OSPF** (deepest domain — hardest on the exam)

| #  | Lab | Domain | Depth |
|----|-----|--------|-------|
| 37 | OSPFv2 single-area | IP Connectivity | OSPF |
| 38 | OSPFv2 multi-area | IP Connectivity | OSPF |
| 39 | OSPF DR/BDR election & priority | IP Connectivity | OSPF |
| 40 | OSPF cost / metric tuning | IP Connectivity | OSPF |
| 41 | OSPF passive-interface & default-route injection | IP Connectivity | OSPF |
| 42 | OSPFv3 for IPv6 | IP Connectivity | OSPF |

**First-hop redundancy**

| #  | Lab | Domain | Depth |
|----|-----|--------|-------|
| 43 | HSRP first-hop redundancy | IP Connectivity | |

**Multi-device troubleshooting**

| #  | Lab | Domain | Depth |
|----|-----|--------|-------|
| 44 | TS: no connectivity — subnet mask mismatch | Fundamentals | troubleshooting |
| 45 | TS: VLAN access port in wrong VLAN | Network Access | troubleshooting |
| 46 | TS: trunk / native VLAN mismatch | Network Access | troubleshooting |
| 47 | TS: STP unexpectedly blocking a path | Network Access | troubleshooting |
| 48 | TS: OSPF adjacency won't form (area / timers / MTU) | IP Connectivity | troubleshooting |
| 49 | TS: OSPF missing route / wrong network statement | IP Connectivity | troubleshooting |
| 50 | TS: static / missing default route | IP Connectivity | troubleshooting |

---

## Distribution check (against the depth rule)

- Subnetting: 3 dedicated + addressing labs — *struggle depth* ✓
- ACLs: 5 + 2 troubleshooting — *struggle depth* ✓
- OSPF: 6 + 2 troubleshooting — *struggle depth* ✓
- VLANs/STP: 6 + 2 troubleshooting — *struggle depth* ✓
- Troubleshooting: 12 total — *highest-value type* ✓
- NAT (2), DHCP (1), services (1), hardening/SSH (2) — *lean, no padding* ✓

## Build effort

- **Phase 1: ~8 new labs**, no engine work — fastest, ships value immediately.
- **Phase 2: ~15 labs + 4 engine modules** (ACL, NAT, DHCP, services) — each
  module piloted by one lab before the rest (CLAUDE.md pilot rule).
- **Phase 3: ~26 labs + the multi-device engine + clickable topology** — the
  largest investment; the engine is the gate, not the lab count.
- **Capstones: 5 labs**, each built after its domain's drills and engine support
  exist (the capstone is the domain's final integration test).

---

## CAPSTONES — domain integration labs (the showcase tier)

Built last within each domain, once its drills and engine support exist. These
are the elaborate, exam-feeling labs.

| #  | Capstone | Integrates | Gated on |
|----|----------|-----------|----------|
| C1 | Address a branch office end-to-end | VLSM + IPv6 + multi-interface + verify | Phase 1 + IPv6 module |
| C2 | Fully harden a router | SSH + line auth + VTY ACL + traffic ACLs + NAT | Phase 2 (ACL + NAT + mgmt) |
| C3 | Build a campus Layer 2 | VLANs + trunking + STP root + EtherChannel + port security | Phase 3 (multi-device) |
| C4 | Multi-area OSPF network | multi-area + cost tuning + default injection across 3 routers | Phase 3 (multi-device) |
| C5 | Grand CCNA capstone (final boss) | addressing + inter-VLAN + OSPF + ACL + NAT, end to end | Phase 3 (multi-device) |

