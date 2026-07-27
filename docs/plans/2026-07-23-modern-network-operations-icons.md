# Modern Network Operations Icon Upgrade Plan

**Goal:** Replace the inexpensive single-stroke topology symbols with a cohesive, vendor-neutral network-operations hardware icon family that remains readable in dark, light, desktop, compact, and mobile topologies.

**Scope:** Router, switch, workstation, server, access point, wireless client, and WAN cloud icons plus icon dispatch/tests and the minimum DeviceNode/CSS adjustments required for polished rendering. Preserve topology state, card dimensions, interface placement, device selection, and all lab behavior.

## Task 1 — Lock icon contracts with tests

- Add focused tests for `DeviceIcon` dispatch.
- Require dedicated access-point and wireless-client components rather than router/workstation fallback.
- Require every icon to expose a consistent SVG viewBox, sizing, current color, semantic data hook, and non-interactive accessibility treatment.
- Preserve all existing type aliases and fallback behavior.
- Run focused tests and record RED.

## Task 2 — Build the icon family

- Upgrade router to a compact modern edge-appliance faceplate with status/port detail.
- Upgrade switch to a recognizable multi-port rack-switch faceplate.
- Upgrade workstation to a professional endpoint/monitor silhouette.
- Upgrade server to a structured dual-unit rack/server front.
- Create a dedicated ceiling/access-point symbol with radio arcs and hardware body.
- Create a dedicated wireless-client/laptop symbol with Wi-Fi indicator.
- Upgrade WAN cloud to a cleaner carrier-network cloud with internal routing motif.
- Use consistent 48×48 geometry, stroke weight, rounded joins, restrained layered fills, and status accents.
- Avoid trademarks, vendor logos, cartoon styling, neon glow, and detail that collapses at mobile scale.

## Task 3 — Integrate into topology cards

- Update `DeviceIcon` dispatch and exports.
- Render at the largest size that fits existing cards without changing card dimensions or port/interface positions.
- Add stable icon-family hooks for light/dark styling.
- Preserve active/inactive icon contrast and existing selection semantics.
- Ensure decorations using DeviceIcon remain visually valid.

## Task 4 — Verify

- Focused icon/TopologyPanel tests.
- Full Vitest suite, build, lint, and `git diff --check`.
- Browser QA representative router/switch, workstation/server, wireless/AP, and WAN/cloud topologies in:
  - dark desktop
  - light desktop
  - compact desktop
  - 390px mobile topology
- Check recognition, clipping, interface-label collisions, active/inactive contrast, and no horizontal overflow.
- Complete spec review and code-quality review.
- Commit only scoped files and save a CertHead handoff. Do not deploy without separate authorization.
