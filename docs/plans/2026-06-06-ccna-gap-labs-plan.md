# CCNA Gap Labs Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add focused CCNA labs for missing loopback-address and STP configuration/troubleshooting coverage while preserving CertHead Labs' learner-realistic troubleshooting style.

**Architecture:** Extend the existing 50-lab catalog with a small, sequenced CCNA gap pack. Start with engine capability gaps that block credible labs, then add one lab per topic with focused Vitest coverage and catalog contract updates. Keep each lab scoped to evidence, configuration, verification, and realistic Cisco-style command output rather than broad packet-level protocol simulation.

**Tech Stack:** TypeScript, Vite, Vitest, CertHead Labs CLI simulation engine, existing `Lab` catalog pattern under `src/labs/ccna/`.

---

## Current Inventory Summary

Inspected repo: `/mnt/c/dev/certhead-labs`

Current branch: `checkpoint/labs-through-28`

Current catalog source: `src/labs/catalog.ts`

Current catalog contract: `src/labs/catalog.test.ts` expects exactly 50 labs, with 1 free public lab and 49 Pro labs.

Existing CCNA lab coverage includes:

- Fundamentals: interface IP, network discovery, subnetting, static routes, default routes, floating static routes.
- OSPF: single-area configuration, area mismatch troubleshooting, passive interface, hello/dead timers, MD5 auth mismatch, default route origination, multi-symptom OSPF tickets.
- VLAN/switching: access VLANs, trunking, inter-VLAN routing, EtherChannel LACP, one STP root bridge configuration lab.
- Services/security: DHCP, DHCP relay, NAT/PAT, standard ACL, extended ACL, SSH hardening, NTP/syslog.
- IPv6: addressing/default gateway, static routing, missing default gateway troubleshooting.
- Wireless/automation: WLAN-to-VLAN mapping, wireless wrong VLAN troubleshooting, API facts/ACL management ticket.

Confirmed gaps from inspection and Moises' note:

1. **Loopback address labs:** No lab currently teaches `interface loopback`, loopback addressing, using loopbacks as stable router IDs, or advertising loopbacks in OSPF. Engine comments explicitly say loopbacks are not modeled for router-ID selection today.
2. **STP troubleshooting:** Only `lab-23-stp-root-bridge.ts` exists. It covers root primary/secondary configuration and `show spanning-tree vlan 10`, but intentionally does not model BPDU exchange, convergence timers, loop-prevention behavior, blocked/forwarding port roles, or PortFast/BPDU Guard.
3. **STP configuration breadth:** Missing practical STP tasks such as per-VLAN root selection across redundant access/distribution switches, PortFast on access ports, BPDU Guard protection, and interpreting root/alternate ports.
4. **Layer 2 operational tickets:** Existing VLAN/DHCP/trunk tickets are strong, but there is no realistic ticket where the fault source is STP state/design rather than VLAN allowed-list or port-security.

---

## Proposed New Lab Pack

Add these in order. Do not add all at once without gates.

### Lab 31: Loopback Interfaces and OSPF Router ID

**ID:** `ccna-lab31-loopback-ospf-router-id`

**Title:** `Loopback Interfaces: Set a Stable OSPF Router ID`

**Purpose:** Teach why network engineers use loopbacks as stable logical interfaces and how OSPF selects router IDs.

**Scenario:** HQ has two routers already connected through a transit link. OSPF comes up, but router IDs are derived from physical interface IPs. Configure loopback interfaces with stable /32 addresses, set OSPF router IDs explicitly or via loopback selection, verify neighbors remain FULL, and confirm loopback reachability through OSPF.

**Topology:**

- `R1` ISR4321: `Gi0/0`, `Loopback0`
- `R2` ISR4321: `Gi0/0`, `Loopback0`
- Link: `R1 Gi0/0` to `R2 Gi0/0`

**Addressing:**

- Transit: `172.16.31.0/30`
  - R1 Gi0/0: `172.16.31.1/30`
  - R2 Gi0/0: `172.16.31.2/30`
- Loopbacks:
  - R1 Lo0: `10.255.31.1/32`
  - R2 Lo0: `10.255.31.2/32`

**Learner objectives:**

1. Configure `Loopback0` on both routers with /32 addresses.
2. Configure or reset OSPF router IDs so R1 is `10.255.31.1` and R2 is `10.255.31.2`.
3. Advertise loopbacks into OSPF area 0.
4. Verify `show ip ospf neighbor` is FULL.
5. Verify R1 can ping R2's loopback and R2 can ping R1's loopback.

**Engine prerequisite:** Add router loopback interface support. See Task 1.

---

### Lab 32: Troubleshoot OSPF Loopback Not Advertised

**ID:** `ccna-lab32-tshoot-loopback-not-advertised`

**Title:** `Troubleshoot: Loopback Missing from OSPF`

**Purpose:** Turn loopback knowledge into a practical evidence-reading ticket.

**Scenario:** Monitoring was moved to router loopbacks, but R1 cannot reach R2's management loopback. The OSPF neighbor is FULL and physical links are healthy. Learner must inspect OSPF routes/network statements and discover R2's loopback was not advertised.

**Topology:** Same as Lab 31, but add a simple management PC only if engine route/ping behavior needs a PC perspective. Prefer two routers first for scope.

**Fault:** R2 has `Loopback0 10.255.32.2/32`, but OSPF only advertises the transit network.

**Learner objectives:**

1. Verify physical/OSPF adjacency is healthy with `show ip ospf neighbor`.
2. Inspect routes with `show ip route` and confirm the remote loopback is missing.
3. Fix the OSPF network statement for R2's loopback or add interface-level OSPF if supported later.
4. Verify R1 can ping `10.255.32.2`.

---

### Lab 33: STP Port Roles and Blocked Link Interpretation

**ID:** `ccna-lab33-stp-port-roles`

**Title:** `STP Port Roles: Identify the Blocked Redundant Link`

**Purpose:** Teach interpretation of `show spanning-tree vlan <id>` output before troubleshooting repairs.

**Scenario:** Three switches form a triangle. Users are not down; the goal is to explain which switch is root, which ports are root/designated/alternate, and why one link is blocking. This is a guided interpretation lab, not a repair lab.

**Topology:**

- `SW1`, `SW2`, `SW3` C2960
- Redundant triangle links carrying VLAN 20
- Optional two PCs on VLAN 20 to verify user traffic still works despite one blocked link

**Learner objectives:**

1. Run `show spanning-tree vlan 20` on all switches.
2. Identify the root bridge.
3. Identify root ports and designated ports.
4. Identify the alternate/blocking port.
5. Confirm access traffic still works.

**Engine prerequisite:** Add enough STP state modeling/display for port roles and states. This can be deterministic, not a full BPDU simulator.

---

### Lab 34: Troubleshoot STP Wrong Root Bridge

**ID:** `ccna-lab34-tshoot-stp-wrong-root`

**Title:** `Troubleshoot: Wrong STP Root Bridge After Switch Replacement`

**Purpose:** Teach realistic STP troubleshooting and root-bridge correction.

**Scenario:** After a replacement access switch was installed, VLAN 20 traffic takes an unexpected Layer 2 path and the distribution switch is no longer root. Learner must compare bridge priorities/root IDs, set the intended root and secondary, then verify the election.

**Topology:**

- `DSW1` intended primary root
- `DSW2` intended secondary root
- `ASW1` access switch accidentally winning root due to lower MAC/default priority conditions or seeded priority
- VLAN 20 trunks between switches

**Learner objectives:**

1. Run `show spanning-tree vlan 20` to identify current root.
2. Configure DSW1 as primary root for VLAN 20.
3. Configure DSW2 as secondary root for VLAN 20.
4. Verify DSW1 is root and ASW1 is not root.
5. Confirm access VLAN 20 still has connectivity.

**Engine prerequisite:** Existing root primary/secondary support may be enough if the deterministic `show spanning-tree` output can represent current root across multiple switches.

---

### Lab 35: Configure PortFast and BPDU Guard on Access Ports

**ID:** `ccna-lab35-portfast-bpduguard-access`

**Title:** `STP Access Edge Protection: PortFast and BPDU Guard`

**Purpose:** Cover common CCNA STP configuration on access ports without over-simulating convergence.

**Scenario:** A switch has user-facing ports that should transition quickly and be protected from accidental switch connections. Configure PortFast and BPDU Guard only on access ports, not trunks.

**Topology:**

- `SW1` with access ports `Fa0/10`, `Fa0/11` and trunk `Gi0/1`
- `PC-A`, `PC-B` on access ports
- Upstream `SW2` on trunk

**Learner objectives:**

1. Verify access vs trunk ports using `show interfaces switchport` or `show interfaces trunk`.
2. Configure PortFast on `Fa0/10` and `Fa0/11`.
3. Configure BPDU Guard on `Fa0/10` and `Fa0/11`.
4. Do not configure PortFast/BPDU Guard on `Gi0/1` trunk.
5. Verify with `show spanning-tree interface fa0/10 detail` or `show running-config interface fa0/10` depending on engine support.

**Engine prerequisite:** Add switch interface state for PortFast/BPDU Guard and supporting config/show commands.

---

### Lab 36: Troubleshoot BPDU Guard Err-Disabled Access Port

**ID:** `ccna-lab36-tshoot-bpduguard-errdisabled`

**Title:** `Troubleshoot: BPDU Guard Err-Disabled an Access Port`

**Purpose:** Add a realistic STP/security operations ticket.

**Scenario:** A user reports a conference room jack is down after someone connected a small unmanaged switch. The access port is err-disabled due to BPDU Guard. Learner must identify the reason, remove the offending device conceptually, shut/no shut the port, and preserve edge protection.

**Topology:**

- `SW1` access switch
- `PC-CONF` or `UNMANAGED-SW` endpoint on `Fa0/18`
- Existing uplink trunk to `SW2`

**Learner objectives:**

1. Inspect `show interface status` or equivalent and see `err-disabled`.
2. Inspect `show port-security` is not the culprit, if port-security exists in the lab engine.
3. Inspect STP/BPDU Guard state or log hint.
4. Restore the port with `shutdown` / `no shutdown` after verifying configuration.
5. Keep BPDU Guard enabled.

**Engine prerequisite:** Could reuse existing port-security err-disabled patterns if the engine already models `errDisabledReason`, but likely needs BPDU Guard-specific state and command output.

---

## Implementation Tasks

### Task 1: Add router loopback interface support

**Objective:** Allow router labs to create and display `Loopback0`/`Lo0` interfaces with IPv4 addresses and include them in routing/OSPF behavior.

**Files:**

- Modify: `src/engine/adapters/ios/state.ts`
- Modify: `src/engine/adapters/ios/interpret.ts`
- Modify: `src/engine/adapters/ios/grammar.ts`
- Modify: `src/engine/adapters/ios/routing.ts` if route table generation omits loopback interfaces
- Modify: `src/engine/adapters/ios/ospf.ts` if OSPF interface detection omits loopbacks
- Test: `src/engine/adapters/ios/loopback.test.ts`
- Test: `src/engine/adapters/ios/ospf.test.ts`

**Step 1: Write failing tests**

Add tests that prove:

- `interface loopback0` enters interface config and creates the interface if absent.
- `ip address 10.255.31.1 255.255.255.255` appears in `show ip interface brief` as up/up.
- `show running-config interface loopback0` shows the loopback stanza.
- `deriveRouterId` prefers loopback IP over physical interface IP unless explicit router-id behavior already overrides this.
- OSPF can advertise and route to a loopback /32.

Run:

```bash
npm test -- src/engine/adapters/ios/loopback.test.ts src/engine/adapters/ios/ospf.test.ts
```

Expected first run: FAIL because loopback interfaces are not modeled today.

**Step 2: Implement minimal loopback support**

Implementation constraints:

- Support `interface loopback0` and common abbreviations only as needed by resolver normalization.
- Loopback should default admin/protocol up.
- Loopback should not require cabling.
- Loopback should appear as connected `/32` in `show ip route` when addressed.
- `show interfaces loopback0` should not say physical link/down due to uncabled state.
- Keep this scoped to routers first. Do not add switch virtual interfaces unless needed for another lab.

**Step 3: Verify**

Run:

```bash
npm test -- src/engine/adapters/ios/loopback.test.ts src/engine/adapters/ios/ospf.test.ts src/engine/adapters/ios/state.test.ts
npm run build
```

**Step 4: Commit**

```bash
git add src/engine/adapters/ios src/engine/adapters/ios/loopback.test.ts
git commit -m "feat: support router loopback interfaces"
```

---

### Task 2: Add Lab 31 loopback OSPF router ID

**Objective:** Create the first learner-facing loopback lab.

**Files:**

- Create: `src/labs/ccna/lab-31-loopback-ospf-router-id.ts`
- Create: `src/labs/ccna/lab-31-loopback-ospf-router-id.test.ts`
- Modify: `src/labs/catalog.ts`
- Modify: `src/labs/catalog.test.ts`

**Step 1: Write failing lab test**

Test:

- Published solution completes all objectives.
- Objective checks require actual verification commands, not config only.
- Loopback addresses are present and pingable.
- OSPF neighbor verification is required.

Run:

```bash
npm test -- src/labs/ccna/lab-31-loopback-ospf-router-id.test.ts src/labs/catalog.test.ts
```

Expected first run: FAIL because the lab and catalog ID do not exist.

**Step 2: Create lab file**

Use varied addressing from existing labs:

- Transit: `172.16.31.0/30`
- Loopbacks: `10.255.31.1/32`, `10.255.31.2/32`

Solution should include:

```text
R1:
interface loopback0
ip address 10.255.31.1 255.255.255.255
router ospf 1
router-id 10.255.31.1
network 172.16.31.0 0.0.0.3 area 0
network 10.255.31.1 0.0.0.0 area 0
end
show ip ospf neighbor
ping 10.255.31.2

R2:
interface loopback0
ip address 10.255.31.2 255.255.255.255
router ospf 1
router-id 10.255.31.2
network 172.16.31.0 0.0.0.3 area 0
network 10.255.31.2 0.0.0.0 area 0
end
show ip ospf neighbor
ping 10.255.31.1
```

If current engine lacks `router-id`, either add it in Task 1 or revise the lab to rely on loopback-derived router ID after OSPF process restart. Prefer explicit `router-id` because it is practical CCNA-relevant behavior.

**Step 3: Update catalog**

- Import the lab in `src/labs/catalog.ts`.
- Append after Lab 30.
- Add ID to `CATALOG_IDS` in `src/labs/catalog.test.ts`.
- Update exact catalog count from 50 to 51 and Pro count from 49 to 50.

**Step 4: Verify**

Run:

```bash
npm test -- src/labs/ccna/lab-31-loopback-ospf-router-id.test.ts src/labs/catalog.test.ts
npm run build
```

**Step 5: Commit**

```bash
git add src/labs/ccna/lab-31-loopback-ospf-router-id.ts src/labs/ccna/lab-31-loopback-ospf-router-id.test.ts src/labs/catalog.ts src/labs/catalog.test.ts
git commit -m "feat: add CCNA loopback OSPF router-id lab"
```

---

### Task 3: Add Lab 32 loopback OSPF troubleshooting ticket

**Objective:** Create a troubleshooting lab where a remote loopback is missing from routing due to OSPF advertisement omission.

**Files:**

- Create: `src/labs/ccna/lab-32-tshoot-loopback-not-advertised.ts`
- Create: `src/labs/ccna/lab-32-tshoot-loopback-not-advertised.test.ts`
- Modify: `src/labs/catalog.ts`
- Modify: `src/labs/catalog.test.ts`

**Step 1: Write failing test**

Test:

- Initial state: OSPF neighbor is FULL but R1 cannot ping R2 loopback.
- Initial `show ip route` from R1 lacks the remote loopback route.
- Solution adds the missing OSPF advertisement and ping succeeds.
- Learner must inspect OSPF neighbor or route output before final objective completes.

**Step 2: Implement lab**

Use different addressing than Lab 31:

- Transit: `172.16.42.0/30`
- R1 Loopback0: `10.255.42.1/32`
- R2 Loopback0: `10.255.42.2/32`

Seed R1 correctly and seed R2 incorrectly by omitting its loopback network statement.

**Step 3: Verify and commit**

```bash
npm test -- src/labs/ccna/lab-32-tshoot-loopback-not-advertised.test.ts src/labs/catalog.test.ts
npm run build
git add src/labs/ccna/lab-32-tshoot-loopback-not-advertised.ts src/labs/ccna/lab-32-tshoot-loopback-not-advertised.test.ts src/labs/catalog.ts src/labs/catalog.test.ts
git commit -m "feat: add CCNA loopback OSPF troubleshooting lab"
```

---

### Task 4: Add deterministic STP port-role display support

**Objective:** Add enough STP state to support interpretation and troubleshooting labs without attempting full BPDU/convergence simulation.

**Files:**

- Modify: `src/engine/adapters/ios/switch-state.ts`
- Modify: `src/engine/adapters/ios/switch-interpret.ts`
- Modify: `src/engine/adapters/ios/switch-grammar.ts`
- Test: `src/engine/adapters/switch.test.ts` or new `src/engine/adapters/ios/switch-stp.test.ts`

**Step 1: Write failing tests**

Test deterministic output for a three-switch VLAN:

- One switch can be marked root for VLAN 20.
- Root bridge output says `This bridge is the root` on root switch.
- Non-root output includes a root port.
- One redundant port can display alternate/blocking.
- `show spanning-tree vlan 20` stamps verification state with VLAN ID and device.

**Step 2: Implement scoped state**

Do not build a full BPDU simulator. Add lab-seeded STP metadata that can represent:

- per-VLAN bridge priority/root role
- per-port STP role: root, designated, alternate
- per-port state: forwarding, blocking
- output rendering for `show spanning-tree vlan <id>`

**Step 3: Verify and commit**

```bash
npm test -- src/engine/adapters/ios/switch-stp.test.ts src/labs/ccna/lab-23-stp-root-bridge.test.ts
npm run build
git add src/engine/adapters/ios/switch-state.ts src/engine/adapters/ios/switch-interpret.ts src/engine/adapters/ios/switch-grammar.ts src/engine/adapters/ios/switch-stp.test.ts
git commit -m "feat: model deterministic STP port roles"
```

---

### Task 5: Add Lab 33 STP port-role interpretation

**Objective:** Teach learners to read STP state before repairing it.

**Files:**

- Create: `src/labs/ccna/lab-33-stp-port-roles.ts`
- Create: `src/labs/ccna/lab-33-stp-port-roles.test.ts`
- Modify: `src/labs/catalog.ts`
- Modify: `src/labs/catalog.test.ts`

**Step 1: Write failing test**

Test:

- Published solution runs `show spanning-tree vlan 20` on all three switches.
- Objectives complete only after the learner has inspected root and alternate state.
- Any PC reachability objective, if included, still passes with one blocked redundant link.

**Step 2: Implement lab**

Use VLAN 20 and topology positions with enough spacing for switch labels.

**Step 3: Verify and commit**

```bash
npm test -- src/labs/ccna/lab-33-stp-port-roles.test.ts src/labs/catalog.test.ts
npm run build
git add src/labs/ccna/lab-33-stp-port-roles.ts src/labs/ccna/lab-33-stp-port-roles.test.ts src/labs/catalog.ts src/labs/catalog.test.ts
git commit -m "feat: add CCNA STP port-role interpretation lab"
```

---

### Task 6: Add Lab 34 wrong STP root troubleshooting

**Objective:** Add a realistic repair ticket for STP root bridge election.

**Files:**

- Create: `src/labs/ccna/lab-34-tshoot-stp-wrong-root.ts`
- Create: `src/labs/ccna/lab-34-tshoot-stp-wrong-root.test.ts`
- Modify: `src/labs/catalog.ts`
- Modify: `src/labs/catalog.test.ts`

**Step 1: Write failing test**

Test:

- Initial root is `ASW1`, not `DSW1`.
- Solution identifies current root via `show spanning-tree vlan 20`.
- Solution configures DSW1 root primary and DSW2 root secondary.
- Final output verifies DSW1 root.

**Step 2: Implement lab**

Keep the scenario learner-realistic: switch replacement caused an unexpected root. Avoid overclaiming convergence simulation.

**Step 3: Verify and commit**

```bash
npm test -- src/labs/ccna/lab-34-tshoot-stp-wrong-root.test.ts src/labs/catalog.test.ts
npm run build
git add src/labs/ccna/lab-34-tshoot-stp-wrong-root.ts src/labs/ccna/lab-34-tshoot-stp-wrong-root.test.ts src/labs/catalog.ts src/labs/catalog.test.ts
git commit -m "feat: add CCNA STP wrong-root troubleshooting lab"
```

---

### Task 7: Add PortFast/BPDU Guard support

**Objective:** Support access-edge STP protection labs with realistic config and show output.

**Files:**

- Modify: `src/engine/adapters/ios/switch-state.ts`
- Modify: `src/engine/adapters/ios/switch-interpret.ts`
- Modify: `src/engine/adapters/ios/switch-grammar.ts`
- Test: `src/engine/adapters/ios/switch-stp-edge.test.ts`

**Step 1: Write failing tests**

Test commands:

```text
interface fa0/10
spanning-tree portfast
spanning-tree bpduguard enable
show running-config interface fa0/10
show spanning-tree interface fa0/10 detail
```

Also test that PortFast on trunks either errors or is flagged as unsafe by lab objective checks.

**Step 2: Implement scoped support**

- Add switchport state fields: `portFast`, `bpduGuard`, `errDisabledReason` if not already reusable.
- Add show output lines that learners can inspect.
- Preserve existing port-security behavior.

**Step 3: Verify and commit**

```bash
npm test -- src/engine/adapters/ios/switch-stp-edge.test.ts src/engine/adapters/switch.test.ts
npm run build
git add src/engine/adapters/ios/switch-state.ts src/engine/adapters/ios/switch-interpret.ts src/engine/adapters/ios/switch-grammar.ts src/engine/adapters/ios/switch-stp-edge.test.ts
git commit -m "feat: support STP edge-port protection commands"
```

---

### Task 8: Add Lab 35 PortFast/BPDU Guard configuration

**Objective:** Add a CCNA config lab for access edge protection.

**Files:**

- Create: `src/labs/ccna/lab-35-portfast-bpduguard-access.ts`
- Create: `src/labs/ccna/lab-35-portfast-bpduguard-access.test.ts`
- Modify: `src/labs/catalog.ts`
- Modify: `src/labs/catalog.test.ts`

**Step 1: Write failing test**

Test:

- Objectives require PortFast/BPDU Guard on access ports.
- Objectives fail if trunk `Gi0/1` has PortFast/BPDU Guard.
- Published solution verifies using show/running-config output.

**Step 2: Implement lab**

Use VLAN 50 or VLAN 60 to avoid repeating VLAN 10/20/30 too heavily.

**Step 3: Verify and commit**

```bash
npm test -- src/labs/ccna/lab-35-portfast-bpduguard-access.test.ts src/labs/catalog.test.ts
npm run build
git add src/labs/ccna/lab-35-portfast-bpduguard-access.ts src/labs/ccna/lab-35-portfast-bpduguard-access.test.ts src/labs/catalog.ts src/labs/catalog.test.ts
git commit -m "feat: add CCNA PortFast BPDU Guard lab"
```

---

### Task 9: Add Lab 36 BPDU Guard troubleshooting ticket

**Objective:** Add an STP-edge troubleshooting lab for err-disabled access port recovery.

**Files:**

- Create: `src/labs/ccna/lab-36-tshoot-bpduguard-errdisabled.ts`
- Create: `src/labs/ccna/lab-36-tshoot-bpduguard-errdisabled.test.ts`
- Modify: `src/labs/catalog.ts`
- Modify: `src/labs/catalog.test.ts`

**Step 1: Write failing test**

Test:

- Initial user port is down/err-disabled due to BPDU Guard.
- Learner can identify reason through show output/log state.
- Solution uses `shutdown` / `no shutdown` or supported recovery path.
- Objective requires BPDU Guard remains enabled after recovery.

**Step 2: Implement lab**

Keep endpoint behavior realistic but simple. Do not require modeling an unmanaged switch if engine cannot represent it; describe the offending device in scenario and represent the result as seeded switchport state.

**Step 3: Verify and commit**

```bash
npm test -- src/labs/ccna/lab-36-tshoot-bpduguard-errdisabled.test.ts src/labs/catalog.test.ts
npm run build
git add src/labs/ccna/lab-36-tshoot-bpduguard-errdisabled.ts src/labs/ccna/lab-36-tshoot-bpduguard-errdisabled.test.ts src/labs/catalog.ts src/labs/catalog.test.ts
git commit -m "feat: add CCNA BPDU Guard troubleshooting lab"
```

---

## Catalog Count Updates

Update `src/labs/catalog.test.ts` incrementally after each lab:

- After Lab 31: 51 total, 50 Pro.
- After Lab 32: 52 total, 51 Pro.
- After Lab 33: 53 total, 52 Pro.
- After Lab 34: 54 total, 53 Pro.
- After Lab 35: 55 total, 54 Pro.
- After Lab 36: 56 total, 55 Pro.

Do not batch all count changes before labs exist. Let the catalog contract fail until each lab is added.

---

## Verification Gates

For each engine-support commit:

```bash
npm test -- <focused engine tests>
npm run build
git diff --check
```

For each lab commit:

```bash
npm test -- src/labs/ccna/<new-lab>.test.ts src/labs/catalog.test.ts
npm run build
git diff --check
```

After every two new labs, run a broader gate:

```bash
npm test -- src/labs/catalog.test.ts src/engine/lab-session.test.ts src/engine/reachability.test.ts
npm run build
```

For visual/topology changes, browser-smoke at least the new lab route and check:

- topology devices and labels do not overlap
- objectives visible
- terminal usable and not covering topology/objectives
- no console errors
- solution commands complete all objectives

---

## Stop / Approval Triggers

Stop and ask Moises before:

- Replacing deterministic STP modeling with a broad BPDU/convergence simulator.
- Changing the terminal grammar in a way that affects existing labs outside loopback/STP.
- Reworking catalog structure or Pro/free gating.
- Normalizing many files' line endings or creating a large diff unrelated to a lab.
- Adding new non-requested topic families beyond loopbacks and STP.

---

## Recommended Execution Order

1. Task 1: engine loopback support.
2. Task 2: Lab 31 loopback/router-ID config.
3. Task 3: Lab 32 loopback missing-advertisement ticket.
4. Task 4: deterministic STP port-role display support.
5. Task 5: Lab 33 STP port-role interpretation.
6. Task 6: Lab 34 wrong-root troubleshooting.
7. Task 7: PortFast/BPDU Guard support.
8. Task 8: Lab 35 edge-port protection config.
9. Task 9: Lab 36 BPDU Guard err-disabled ticket.

This order teaches concepts before tickets and adds engine capability only when a lab needs it.
