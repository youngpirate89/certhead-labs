# CertHead Labs — Handoff

## Working model
Claude Code implements (edits repo, runs dev server, verifies
in-browser). claude.ai handles planning, architecture, specs,
and work-order prompts. claude.ai does NOT have live repo access
— sees only what is pasted + CLAUDE.md.

Gotchas:
- Cloudflare Pages is direct-upload (npx wrangler pages deploy),
  NOT deploy-on-push.
- PowerShell has no && and cannot edit files.
- Always verify files landed (git status / git show HEAD:path)
  before assuming.
- Never paste secrets.
- tsc -b before committing (Vitest green ≠ prod build green).
- Programmatic browser checks ≠ human-usable. §7 cold human run
  is the only sign-off.
- Viewport matrix every cold run: desktop + ~520px embed width,
  using a multi-device lab.

## Repo + state
Repo: github.com/youngpirate89/certhead-labs
Local: C:\Dev\certhead-labs
Stack: Vite + React 18 + TS + Tailwind · Vitest · React Flow
       (@xyflow/react@12.10.2 pinned)
Tests: 428 passing · tsc clean · prod build clean
HEAD: 1c5d601 (Lab 07 commit) — Lab 08 built but not yet committed
Live: https://main.certhead-labs.pages.dev/ — free lab only

## Catalog (8 labs, all human-verified)
- Lab 01: Interface IP config — free lab, public at /try ✅
- Lab 02: Tshoot — wrong return route ✅
- Lab 03: Tshoot — wrong next-hop ✅
- Lab 04: Tshoot — WAN subnet mismatch ✅
- egress-down: Tshoot — WAN connectivity loss (R1 Gi0/2 admin-down) ✅
- Lab 05: OSPF single-area — configure + verify adjacency ✅
- Lab 06: Standard ACL — deny host, permit subnet, apply outbound ✅
- Lab 07: VLAN access ports — create VLANs, assign ports, verify segmentation ✅
- Lab 08: VLAN trunking — IN PROGRESS, fixes pending before commit

## Engine capabilities
Router (Cisco IOS):
- Interface config: ip address, no shutdown, shutdown
- Static routes: ip route
- OSPF single-area: router ospf, network, show ip ospf neighbor,
  show ip ospf, O routes in show ip route
- Standard ACLs: access-list 1-99, ip access-group,
  show access-lists, ACL evaluation in canReach
- Show commands: show ip interface brief, show interfaces <iface>,
  show run, show run interface <iface>, show ip route

Switch (Cisco IOS):
- VLAN database: vlan <id>, name, show vlan brief, show vlan
- Access ports: switchport mode access, switchport access vlan
- Trunk ports: switchport mode trunk, switchport trunk allowed vlan,
  switchport trunk native vlan, show interfaces trunk
- show run interface <iface>: switchport stanza output
- VLAN-aware forwarding: same-VLAN reachable, different-VLAN
  blocked, trunk-aware forwarding across switches

PC commands:
- ping (4 packets), tracert (streamed 150ms/hop, cancels on reset)
- ipconfig, ipconfig /all
- Redirect tier: nslookup, arp, netstat, telnet, ssh, ftp,
  getmac, route, nbtstat

Terminal:
- Streaming output, input disabled during stream
- Reset cancels in-flight streams
- [sim] dim line for failure sentences on ping + tracert
- PC IPs visible in topology panel by default

Hint system:
- On-demand reveal — timer gates availability, student clicks
  to reveal
- Each hint independent, stays visible after reveal
- Reset clears all revealed hint state

## Permanent rules (locked, never revisit)
- Research official Cisco docs before building any engine behavior
  or lab. No assumptions. Sources: cisco.com/c/en/us/td/docs,
  Wendell Odom CCNA Official Cert Guide, IETF RFCs.
- One VLAN = one subnet. Always.
- Static vs DHCP must be explicit in scenario text.
- Mode hops work across all config submodes — no forced exits.
- Ping = 4 packets engine-wide.
- PC IPs always visible in topology unless discovery is a lab
  objective.
- show <keyword> bare always works if show <keyword> brief exists.
- Hints are on-demand, never auto-display.
- Programmatic tests are not a sign-off. Cold human run only.

## Strategic position
- 0 paid subscribers — pre-launch, building catalog depth.
- Free lab live at labs.certhead.com/try, not yet linked from
  CertHead landing page (gated on CertHead launch).
- EmbedMode (/embed + JWT) not started — gated on subscriber
  traction.
- Next after Lab 08: inter-VLAN routing (Session 3 of switch
  track) — requires Lab 08 trunk engine as foundation.

## FIRST THING NEXT SESSION
Paste CC's Lab 08 fix summary (show run interface on switch +
hint system on-demand + LAB_AUTHORING.md updates). Do the cold
run. Commit only after human verification passes.
