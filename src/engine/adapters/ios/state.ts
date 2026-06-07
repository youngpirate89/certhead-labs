/**
 * Cisco IOS device state — the per-device state machine's data model.
 *
 * State machines are per-device (CLAUDE.md): a multi-device lab is N of these
 * with explicit message passing. Everything here is plain serialisable data so
 * grading checks can query it declaratively and sessions can be cloned for
 * deterministic transitions.
 */
import { connectedRoutes, type Route } from './routing';

/** CLI mode stack levels. `config-subif` is the subinterface variant of
 *  `config-if` — entered by `interface gi0/0.10` from `config`, holds the
 *  active subinterface id, and accepts the same `ip address` / `shutdown`
 *  commands plus `encapsulation dot1q <vlan>`. `config-dhcp` is the per-pool
 *  configuration mode entered by `ip dhcp pool <name>` from `config`.
 *  `config-ext-nacl` is the per-ACL configuration mode entered by
 *  `ip access-list extended <name>` from `config` (Lab 12). */
export type Mode =
  | 'user'
  | 'priv'
  | 'config'
  | 'config-if'
  | 'config-subif'
  | 'config-router'
  | 'config-dhcp'
  | 'config-ext-nacl'
  | 'config-line';

/** A single `network <prefix> <wildcard> area <area-id>` statement. */
export interface OspfNetwork {
  /** Dotted-quad prefix as typed (host bits NOT cleared). */
  readonly prefix: string;
  /** Dotted-quad wildcard mask, e.g. '0.0.0.255'. */
  readonly wildcard: string;
  readonly area: number;
}

/** The neighbor's role on a broadcast segment, as elected. `undefined` on a
 *  point-to-point link, where no DR/BDR election runs (the State column then
 *  renders the IOS `/  -` placeholder). */
export type OspfNeighborRole = 'DR' | 'BDR' | 'DROTHER';

/** State of one OSPF adjacency from this router's point of view. */
export interface OspfNeighborState {
  readonly state: 'FULL' | 'INIT' | 'DOWN';
  /** Neighbor's interface IP on the shared link. */
  readonly address: string;
  /** Local interface (canonical id, e.g. 'Gi0/2') the adjacency formed on. */
  readonly interface: string;
  /** The NEIGHBOR's elected role on the segment — drives the `FULL/DR` etc.
   *  suffix in `show ip ospf neighbor`. Set on broadcast links; undefined on
   *  point-to-point (renders `/  -`). */
  readonly role?: OspfNeighborRole;
}

/** Per-router OSPF state. The neighbor table is keyed by neighbor router-id. */
export interface Ipv6StaticRoute {
  readonly prefix: string;
  readonly nextHop: string;
  readonly configuredAt: number;
}

export interface OspfState {
  process: number | null;
  routerId: string | null;
  /** Manual router-id configured while OSPF is already running; IOS applies it after clear/reload. */
  pendingRouterId: string | null;
  networks: OspfNetwork[];
  /** Neighbors keyed by neighbor router-id. Kept as a Map so iteration order
   *  is insertion order — show output reads deterministically. */
  neighbors: Map<string, OspfNeighborState>;
  /** Interfaces marked `passive-interface` under `router ospf <pid>`. A
   *  passive interface keeps its prefix advertised (the network statement
   *  still matches) but suppresses hello processing on that iface — no
   *  neighbor forms on a link where either endpoint is passive. Stored as a
   *  Set of canonical iface ids so `passive Gi0/0` dedups, iteration order is
   *  insertion-stable (the show-output renderer reads it directly), and
   *  structuredClone handles it without extra plumbing. (Lab 17.) */
  passive: Set<string>;
  /** `default-information originate` is configured — redistribute a default
   *  route (0.0.0.0/0) into OSPF, advertised to neighbors as an external
   *  Type-2 (`O*E2`) route. Without `always` the router only originates the
   *  default when it actually has one in its own RIB (the IOS condition);
   *  `defaultInfoAlways` advertises it unconditionally. Both reset on a
   *  process-id change, like `passive`. (Lab 21.) */
  defaultInfoOriginate: boolean;
  defaultInfoAlways: boolean;
}

/** One ACE in a standard OR extended ACL.
 *
 *  Standard entries set `source` + `wildcard` only (the legacy fields used by
 *  Lab 06 / Lab 11's numbered ACL grading). For these entries, `protocol` is
 *  undefined and the evaluator matches on source IP alone.
 *
 *  Extended entries (Lab 12) ALSO set `protocol`, `srcIp`, `srcWildcard`,
 *  `dstIp`, `dstWildcard`, and optionally `dstPort`. `source` and `wildcard`
 *  on extended entries mirror `srcIp`/`srcWildcard` so legacy readers that
 *  only inspect those two fields still see sensible values. The evaluator
 *  discriminates on `protocol`: undefined → standard path; defined →
 *  protocol + dst match in addition to the source check.
 *
 *  - `source` / `srcIp`: prefix (or host IP, or '0.0.0.0' for `any`).
 *  - `wildcard`: null encodes a `host <ip>` exact match for standard entries
 *    (semantically /32). Extended entries never use null — host form maps to
 *    `srcWildcard: '0.0.0.0'` (the canonical extended-ACL encoding).
 *  - `sequence` is the IOS line number, auto-assigned in 10s on insertion. */
export interface AclEntry {
  readonly sequence: number;
  readonly action: 'permit' | 'deny';
  readonly source: string;
  readonly wildcard: string | null;
  // Extended-only fields (undefined on standard entries):
  readonly protocol?: 'ip' | 'tcp' | 'udp' | 'icmp';
  readonly srcIp?: string;
  readonly srcWildcard?: string;
  readonly dstIp?: string;
  readonly dstWildcard?: string;
  readonly dstPort?: number;
}

/** A standard numbered IP ACL (range 1-99) or a named extended IP ACL.
 *  Numbered standard ACLs carry `number`; named extended ACLs (Lab 12)
 *  carry `name`. The `type` discriminator drives evaluator + render paths.
 *  Entries iterate in insertion order — first-match wins, with an implicit
 *  deny at the end. */
export interface Acl {
  readonly type: 'standard' | 'extended';
  readonly number?: number;
  readonly name?: string;
  entries: AclEntry[];
}

/** A DHCP pool — the per-pool configuration entered in config-dhcp mode.
 *  `network`/`mask` define the address range; `defaultRouter`/`dnsServer`
 *  are advertised to clients. `leaseTime` is accepted by the IOS grammar
 *  but no objective reads it — kept here so a learner running `lease 1`
 *  doesn't see an error. */
export interface DhcpPool {
  readonly name: string;
  network: string | null;
  mask: string | null;
  defaultRouter: string | null;
  dnsServer: string | null;
  leaseDays: number | null;
}

/** A single `ip dhcp excluded-address <start> [end]` range. `end === start`
 *  encodes a single-host exclusion (the IOS short form). */
export interface DhcpExcludedRange {
  readonly start: string;
  readonly end: string;
}

/** One DHCP binding — a client whose address has been allocated from a pool.
 *  Deterministic: a client with the same id, pool, and excluded set always
 *  gets the same IP. Recomputed by the lab-session DHCP refresh pass after
 *  every config change. */
export interface DhcpBinding {
  readonly clientId: string;
  readonly ip: string;
  readonly poolName: string;
}

/** A `ip nat inside source list <acl> interface <iface> overload` PAT
 *  statement. Today the engine only models the overload (PAT) form — the one
 *  CCNA cares about. `aclId` is the standard-ACL number that selects which
 *  inside sources get translated; `outsideInterface` is the canonical id of
 *  the interface whose IP is borrowed as the translated source. */
export interface NatStatement {
  readonly type: 'inside-source-list-overload';
  readonly aclId: number;
  readonly outsideInterface: string;
}

/** One active NAT translation entry — what `show ip nat translations`
 *  renders. Today we model only the overload (PAT) form, so port columns
 *  display as `---` in show output (no port tracking). `insideLocal` is the
 *  inside client's real IP; `insideGlobal` is the outside interface's IP
 *  that the inside source gets rewritten to. Recomputed by the lab-session
 *  NAT refresh pass any time interface state, ACL state, or topology shifts
 *  — same lifecycle as DHCP bindings. */
export interface NatTranslation {
  readonly insideLocal: string;
  readonly insideGlobal: string;
}

export interface InterfaceState {
  /** Canonical interface id, e.g. 'Gi0/0'. */
  readonly id: string;
  /** Full IOS name, e.g. 'GigabitEthernet0/0'. */
  readonly name: string;
  /** Dotted-quad IP, or null if unassigned. */
  ip: string | null;
  /** Dotted-quad subnet mask, or null if unassigned. */
  mask: string | null;
  /** IPv6 unicast addresses configured on the interface, e.g. 2001:db8::1/64.
   *  Lab 24 keeps IPv6 scoped to addressing/verification only; IPv6 routing
   *  and neighbor discovery are intentionally out of scope. */
  ipv6Addresses: string[];
  /** Interface description, or null. */
  description: string | null;
  /** true once `no shutdown` is applied. */
  adminUp: boolean;
  /** Line-protocol state: false when the link partner is admin-down or the
   *  interface is uncabled. Refreshed by the LabSession layer after every
   *  state-mutating command (mirrors the `nicUp` pass for PCs). Default true
   *  for tests / standalone sessions that never go through the refresh —
   *  show ip int brief falls back to adminUp gracefully in that case. */
  protocolUp: boolean;
  /** ACL identifiers bound inbound/outbound on this interface — a number for
   *  numbered standard ACLs, a string for named extended ACLs (Lab 12). Null
   *  = no ACL on that direction. Reachability evaluates these on every
   *  transit by looking the id up in `device.acls`. */
  accessGroups: { in: string | number | null; out: string | number | null };
  /** NAT boundary role set by `ip nat inside` / `ip nat outside`. Undefined
   *  means no NAT role (the interface does not participate in translation).
   *  canReach's NAT pass triggers only when a packet enters on an `inside`
   *  iface AND exits on an `outside` iface that has a matching overload
   *  statement. (Lab 11.) */
  natRole?: 'inside' | 'outside';
  /** DHCP relay target set by `ip helper-address <ip>` (Lab 14). When set, the
   *  DHCP refresh pass forwards a DHCP-mode PC cabled to this interface to the
   *  remote device whose interface owns `helperAddress`, instead of looking
   *  for a same-subnet pool on this router. Undefined = no relay. */
  helperAddress?: string;
  /** OSPF hello/dead interval overrides set by `ip ospf hello-interval <n>` /
   *  `ip ospf dead-interval <n>` (Lab 19). Undefined = the protocol default
   *  (OSPF_DEFAULT_HELLO_INTERVAL / OSPF_DEFAULT_DEAD_INTERVAL). recomputeOspf
   *  compares the EFFECTIVE values on both ends of a link — a mismatch (e.g.
   *  one side overridden, the other at default) suppresses neighbor formation,
   *  matching IOS, where hellos with mismatched timers are dropped. These are
   *  static config values, not a simulated timer. */
  ospfHelloInterval?: number;
  ospfDeadInterval?: number;
  /** OSPF interface authentication (Lab 20). `ip ospf authentication
   *  message-digest` sets `ospfAuthMessageDigest = true`; `ip ospf
   *  message-digest-key <key-id> md5 <key>` sets `ospfMd5KeyId` + `ospfMd5Key`.
   *  recomputeOspf compares both ends: an adjacency forms only when BOTH ends
   *  agree on whether message-digest auth is enabled AND, when it is, share the
   *  same key-id and key string. Any mismatch (auth on one side only, wrong key
   *  string, or wrong key-id) suppresses neighbor formation, matching IOS,
   *  where authenticated hellos that fail the digest check are dropped (RFC 2328
   *  App. D; Cisco IOS "Configuring OSPF"). Undefined = no auth (the default;
   *  plain/null authentication, type 0). One key per interface is modeled — the
   *  CCNA single-key case; IOS key rollover with multiple key-ids is out of
   *  scope. */
  ospfAuthMessageDigest?: boolean;
  ospfMd5KeyId?: number;
  ospfMd5Key?: string;
}

/** OSPF interface timer defaults (seconds), applied when an interface carries
 *  no explicit `ip ospf hello-interval` / `dead-interval` override. Broadcast
 *  and point-to-point Ethernet both default to hello 10 / dead 40 (4× hello). */
export const OSPF_DEFAULT_HELLO_INTERVAL = 10;
export const OSPF_DEFAULT_DEAD_INTERVAL = 40;

/** A dot1Q subinterface — Lab 09 router-on-a-stick. Subinterfaces live ON a
 *  physical parent (`parentId`) and tag egress traffic with `dot1qVlan`. They
 *  contribute their own connected route (per dot1qVlan + ip/mask) and their
 *  LINE STATE FOLLOWS THE PHYSICAL PARENT: a subif is operational iff the
 *  parent is up/up. Subinterfaces have no independent admin state — a per-subif
 *  `[no] shutdown` is a no-op on real IOS, so the engine carries no `adminUp`
 *  field here; `protocolUp` is derived solely from the parent. The dot1Q tag is
 *  checked at the cabled switch trunk's allowed-VLAN list (Lab 08 trunk engine,
 *  unchanged). [CONFIRMED-BY-SOURCE: Cisco CCNA curriculum 5.1.3.3 / 6.1.3.3;
 *  Cisco Press Inter-VLAN Routing 4.2.] */
export interface SubInterface {
  /** Canonical subif id, e.g. 'Gi0/0.10'. */
  readonly id: string;
  /** Parent physical interface id, e.g. 'Gi0/0'. */
  readonly parentId: string;
  /** dot1Q encapsulation VLAN. Null until `encapsulation dot1q <vlan>` runs;
   *  a subif with null encapsulation contributes no connected route. */
  dot1qVlan: number | null;
  ip: string | null;
  mask: string | null;
  /** Line-protocol state: true iff the parent physical is admin-up AND
   *  protocolUp (the subif inherits the parent's line state — it has no
   *  independent admin state). Refreshed by the LabSession protocolUp pass
   *  (same one that handles physical interfaces) — never set by the dispatcher. */
  protocolUp: boolean;
}

export interface SecurityUser {
  readonly username: string;
  readonly secret: string;
}

export interface SecurityState {
  domainName: string | null;
  enableSecret: string | null;
  users: Map<string, SecurityUser>;
  cryptoKeyModulus: number | null;
  vtyLoginLocal: boolean;
  vtyTransportInput: 'all' | 'ssh' | 'telnet' | 'none';
  /** Standard ACL applied inbound to VTY lines with `access-class <acl> in`. */
  vtyAccessClassIn: number | null;
  motdBanner: string | null;
}

export interface NtpServer {
  readonly server: string;
  readonly configuredAt: number;
}

export interface NtpState {
  servers: Map<string, NtpServer>;
}

export type SyslogTrapLevel =
  | 'emergencies'
  | 'alerts'
  | 'critical'
  | 'errors'
  | 'warnings'
  | 'notifications'
  | 'informational'
  | 'debugging';

export interface SyslogHost {
  readonly host: string;
  readonly configuredAt: number;
}

export interface SyslogState {
  hosts: Map<string, SyslogHost>;
  trapLevel: SyslogTrapLevel | null;
  serviceTimestampsLogDatetimeMsec: boolean;
}

export interface DeviceState {
  readonly id: string;
  hostname: string;
  readonly platform: string;
  interfaces: Record<string, InterfaceState>;
  /** Dot1Q subinterfaces keyed by canonical id (`Gi0/0.10`). Empty on a
   *  freshly-booted router; populated when the learner enters
   *  `interface gi0/0.10` from config mode. */
  subInterfaces: Record<string, SubInterface>;
  /** Per-router OSPF state. Process is null until `router ospf <pid>` runs.
   *  Recomputed by the LabSession after any change to networks or interface
   *  admin state. */
  ospf: OspfState;
  /** ACLs keyed by number (standard, 1-99) OR by name string (named extended,
   *  Lab 12). Map preserves insertion order for deterministic `show access-lists`
   *  rendering. Empty until the learner defines an ACL with
   *  `access-list <n> permit|deny ...` or `ip access-list extended <name>`. */
  acls: Map<string | number, Acl>;
  /** DHCP pools keyed by pool name. Insertion order preserved for
   *  deterministic `show ip dhcp pool` rendering. Empty until the learner
   *  creates a pool with `ip dhcp pool <name>`. */
  dhcpPools: Map<string, DhcpPool>;
  /** Global `ip dhcp excluded-address` ranges in insertion order. The DHCP
   *  binding-allocator skips any IP that falls inside one of these ranges. */
  dhcpExcluded: DhcpExcludedRange[];
  /** Active DHCP bindings keyed by client id (the requesting device's lab id).
   *  Rewritten by the LabSession's DHCP refresh pass after any change to
   *  pools, excluded ranges, or DHCP-client topology. */
  dhcpBindings: Map<string, DhcpBinding>;
  /** PAT (overload) statements in insertion order. Each statement maps a
   *  source-selecting ACL onto an outside interface whose IP becomes the
   *  translated source. canReach's NAT pass and the show handlers iterate
   *  this list; the LabSession NAT refresh pass uses it to rebuild
   *  {@link natTranslations} from current topology. */
  natStatements: NatStatement[];
  /** Active NAT translations keyed by the inside local IP. Rewritten by the
   *  LabSession's NAT refresh pass any time interfaces, ACLs, statements,
   *  or connected-PC IPs change. `show ip nat translations` renders this
   *  map verbatim. */
  natTranslations: Map<string, NatTranslation>;
  /** Scoped management-plane hardening state for SSH/device-hardening labs. */
  security: SecurityState;
  /** Scoped NTP client state for management-services labs. */
  ntp: NtpState;
  /** Scoped syslog client state for management-services labs. */
  syslog: SyslogState;
}

export interface Session {
  /** Device-kind discriminator — every adapter's session carries one. */
  readonly kind: 'router';
  mode: Mode;
  /** The interface currently selected in config-if mode. */
  currentInterface: string | null;
  /** The subinterface currently selected in config-subif mode (canonical id,
   *  e.g. 'Gi0/0.10'). Null outside config-subif — keeps the dispatcher
   *  symmetric with `currentInterface`. */
  activeSubIfId: string | null;
  /** The DHCP pool name being edited in config-dhcp mode. Null outside
   *  config-dhcp — symmetric with `currentInterface` / `activeSubIfId`. */
  activeDhcpPool: string | null;
  /** The named extended ACL being edited in config-ext-nacl mode (Lab 12).
   *  Null outside config-ext-nacl — symmetric with the other "active object"
   *  fields above. `permit`/`deny`/`no <seq>` lines mutate this ACL. */
  activeAcl: string | null;
  /** Active line configuration context. Lab 26 only models VTY 0 4. */
  activeLine: 'vty' | null;
  /** Monotonic engine-seq stamp updated each time the learner runs `show
   *  access-lists` AND at least one ACL is defined. Lab 12's verify-style
   *  objective compares this against 0 to require the show command to have
   *  actually run after at least one ACL exists (mirrors lastShowDhcpBinding
   *  / lastShowNatTranslations). */
  lastShowAccessLists: number;
  /** Monotonic engine-seq stamp updated each time the learner runs bare `show
   *  ip ospf` AND at least one OSPF interface is passive. Lab 17's verify-style
   *  objective compares this against 0 to require the show to run AFTER the
   *  learner has marked an interface passive (mirrors `lastShowAccessLists` /
   *  `lastShowDhcpBinding`). Gating on a non-empty passive set is what makes
   *  this observe-AFTER-configure: an inspect run before any passive-interface
   *  prints the header without a passive entry and does NOT satisfy the gate. */
  lastShowIpOspf: number;
  /** Monotonic engine-seq stamp updated each time the learner runs `show ip
   *  dhcp binding`. Verify-style objectives compare this against 0 to require
   *  the show command to actually have been run (mirrors `lastShowIpIntBrief`
   *  and `lastShowInterfacesTrunk`). */
  lastShowDhcpBinding: number;
  /** Monotonic engine-seq stamp updated each time the learner runs `show ip
   *  nat translations` AND the table is non-empty. Mirrors
   *  `lastShowDhcpBinding`: an empty-table run prints the IOS "no entries"
   *  line but doesn't satisfy the verify gate — the learner has to land NAT
   *  config first. (Lab 11.) */
  lastShowNatTranslations: number;
  /** Monotonic stamp (Date.now()) updated each time the learner runs
   *  `show ip interface brief` on this router. Verify-style objectives compare
   *  this against `subIfConfiguredAt[...]` to require the show to run AFTER
   *  the configure step (mirrors `lastShowInterfacesTrunk` on switches). */
  lastShowIpIntBrief: number;
  /** Per-subinterface stamp of when `no shutdown` brought it up (Date.now()).
   *  Cleared back to undefined on `shutdown`. Verify-style objectives compare
   *  these against `lastShowIpIntBrief` so a verify run BEFORE the configure
   *  step naturally fails the check. */
  subIfConfiguredAt: Record<string, number>;
  device: DeviceState;
  /** Every successfully entered command line, in order, AS-TYPED by the user
   *  (abbreviated, mixed-case, etc.). Used for display and command recall. */
  history: string[];
  /** Same commands as {@link history}, but in CANONICAL form — abbreviations
   *  expanded by the resolver (e.g. `sho ip int br` -> `show ip interface brief`).
   *  Used by verification-style objectives so a check can match the canonical
   *  command without enumerating every valid abbreviation in a regex. */
  resolvedHistory: string[];
  /** Static routes entered via `ip route` — adminDistance:1, source:'static'.
   *  Connected routes are NOT stored here; they're derived from live interface
   *  state at query time via {@link routingTable}. Insertion order is preserved
   *  for the §5 deterministic tiebreak. */
  staticRoutes: Route[];
  /** Scoped IPv6 static routes entered via `ipv6 route <prefix> <next-hop>`.
   *  Lab 25 intentionally stores route intent and verification state only; it
   *  does not add full IPv6 packet forwarding/NDP simulation. */
  ipv6StaticRoutes: Ipv6StaticRoute[];
  /** Monotonic stamp updated when `show ipv6 route` is run after at least one
   *  IPv6 static route exists. Verify objectives compare this to route stamps. */
  lastShowIpv6Route: number;
  /** Monotonic stamp updated when `show running-config` is run after SSH hardening or management services exist. */
  lastShowRunningConfig: number;
  /** Monotonic stamp updated when `show ntp status` is run after at least one NTP server exists. */
  lastShowNtpStatus: number;
  /** Monotonic stamp updated when `show ntp associations` is run after at least one NTP server exists. */
  lastShowNtpAssociations: number;
  /** Monotonic stamp updated when `show logging` is run after syslog configuration exists. */
  lastShowLogging: number;
  /** OSPF-learned routes (source:'ospf', adminDistance:110). Rewritten by the
   *  LabSession's OSPF recompute pass after any topology / config change.
   *  Insertion order matches the order in which adjacencies discovered their
   *  prefixes — kept stable for the §5 tiebreak. */
  ospfRoutes: Route[];
}

const FULL_NAMES: Record<string, string> = {
  Gi: 'GigabitEthernet',
  Fa: 'FastEthernet',
  Lo: 'Loopback',
};

/**
 * Normalise an interface token to a canonical id.
 * Accepts forms like `gi0/0`, `Gig0/1`, `GigabitEthernet0/2`, `fa0/0`, and
 * dot1Q subinterface forms `gi0/0.10`, `GigabitEthernet0/0.20` — the dot suffix
 * is preserved verbatim on the canonical id.
 * Returns null if the token is not a recognised interface spec.
 */
export function normaliseInterface(token: string): string | null {
  const loop = /^(loopback|lo)(\d+)$/i.exec(token);
  if (loop) return `Lo${loop[2]}`;
  const m = /^(gigabitethernet|gig|gi|g|fastethernet|fa|f)(\d+\/\d+(?:\/\d+)?)(\.\d+)?$/i.exec(
    token,
  );
  if (!m) return null;
  const prefix = m[1].toLowerCase();
  const slot = m[2];
  const subif = m[3] ?? '';
  const kind = prefix.startsWith('f') ? 'Fa' : 'Gi';
  return `${kind}${slot}${subif}`;
}

/** True iff `id` looks like a subinterface canonical id (`Gi0/0.10`). */
export function isSubInterfaceId(id: string): boolean {
  return /\.\d+$/.test(id);
}

/** Monotonic engine sequence — strictly increasing across the process. Used
 *  to stamp verify-style ordering pairs (e.g. `subIfConfiguredAt` and
 *  `lastShowIpIntBrief` on the router) so an objective can require "show ran
 *  AFTER no shutdown" without any chance of a Date.now() ms collision under
 *  test. Pure function with internal mutable state — the only side effect is
 *  the counter increment, which is invisible to any consumer that just reads
 *  the return value. */
let __engineSeq = 0;
export function nextEngineSeq(): number {
  return ++__engineSeq;
}

/** For a subinterface id (`Gi0/0.10`) returns the parent physical id (`Gi0/0`).
 *  For a non-subif id, returns the id unchanged. */
export function parentInterfaceId(id: string): string {
  const dot = id.indexOf('.');
  return dot === -1 ? id : id.slice(0, dot);
}

export function fullInterfaceName(id: string): string {
  const m = /^([A-Za-z]+)(\d.*)$/.exec(id);
  if (!m) return id;
  return `${FULL_NAMES[m[1]] ?? m[1]}${m[2]}`;
}

/** Default OSPF network type for an interface, keyed off its hardware type.
 *  Ethernet (GigabitEthernet/FastEthernet, i.e. `Gi`/`Fa` ids) defaults to
 *  BROADCAST — a DR/BDR election runs on the segment. Serial would default to
 *  POINT_TO_POINT, but no serial interfaces are modeled today, so every OSPF
 *  segment we ship is broadcast. [CONFIRMED-BY-SOURCE: Cisco "What Does the
 *  show ip ospf interface Command Reveal" (13689-17); networklessons "OSPF
 *  Network Types" — Ethernet defaults to broadcast.] */
export function ospfNetworkType(id: string): 'BROADCAST' | 'POINT_TO_POINT' {
  return /^(Gi|Fa)/.test(id) ? 'BROADCAST' : 'POINT_TO_POINT';
}

const QUAD = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function isValidIpv4(value: string): boolean {
  return QUAD.test(value);
}

export function isValidIpv6Prefix(value: string): boolean {
  const slash = value.lastIndexOf('/');
  if (slash <= 0) return false;
  const address = value.slice(0, slash);
  const prefixText = value.slice(slash + 1);
  const prefix = Number.parseInt(prefixText, 10);
  return (
    String(prefix) === prefixText &&
    prefix >= 1 &&
    prefix <= 128 &&
    address.includes(':') &&
    /^[0-9a-f:]+$/i.test(address)
  );
}

/** Common valid contiguous IPv4 subnet masks. */
const VALID_MASKS = new Set([
  '255.0.0.0',
  '255.128.0.0',
  '255.192.0.0',
  '255.224.0.0',
  '255.240.0.0',
  '255.248.0.0',
  '255.252.0.0',
  '255.254.0.0',
  '255.255.0.0',
  '255.255.128.0',
  '255.255.192.0',
  '255.255.224.0',
  '255.255.240.0',
  '255.255.248.0',
  '255.255.252.0',
  '255.255.254.0',
  '255.255.255.0',
  '255.255.255.128',
  '255.255.255.192',
  '255.255.255.224',
  '255.255.255.240',
  '255.255.255.248',
  '255.255.255.252',
  '255.255.255.254',
  '255.255.255.255',
]);

export function isValidMask(value: string): boolean {
  return VALID_MASKS.has(value);
}

/** Like {@link isValidMask} but also accepts `0.0.0.0` — the /0 mask used by
 *  the default route (`ip route 0.0.0.0 0.0.0.0 <next-hop>`). Interface-IP
 *  validation keeps using isValidMask (a /0 interface address is nonsense),
 *  so this helper is route-grammar-only. */
export function isValidRouteMask(value: string): boolean {
  return value === '0.0.0.0' || VALID_MASKS.has(value);
}

/** Build a fresh session from a lab's device + starting interface set.
 *  `structuredClone` is replaced by a deep-copy that preserves the OSPF
 *  neighbor Map — structuredClone DOES handle Maps, but we still call it
 *  to clone the whole device so that callers can safely mutate downstream. */
export function createSession(device: DeviceState): Session {
  return {
    kind: 'router',
    mode: 'user',
    currentInterface: null,
    activeSubIfId: null,
    activeDhcpPool: null,
    activeAcl: null,
    activeLine: null,
    lastShowIpIntBrief: 0,
    lastShowDhcpBinding: 0,
    lastShowNatTranslations: 0,
    lastShowAccessLists: 0,
    lastShowIpOspf: 0,
    subIfConfiguredAt: {},
    device: cloneDevice(device),
    history: [],
    resolvedHistory: [],
    staticRoutes: [],
    ipv6StaticRoutes: [],
    lastShowIpv6Route: 0,
    lastShowRunningConfig: 0,
    lastShowNtpStatus: 0,
    lastShowNtpAssociations: 0,
    lastShowLogging: 0,
    ospfRoutes: [],
  };
}

/** Deep-copy a DeviceState including the OSPF Map (structuredClone handles
 *  Map natively; this exists as a single seam for tests that want to clone
 *  device state without the rest of the Session machinery). */
export function cloneDevice(device: DeviceState): DeviceState {
  return structuredClone(device);
}

/**
 * Effective routing table: derived connected routes (from up interfaces with
 * IP/mask) followed by statics and OSPF-learned routes. Insertion order is
 * preserved — connecteds first, then statics in entry order, then OSPF
 * routes in adjacency-discovery order — so the §5 tiebreak resolves
 * deterministically (mask DESC → adminDistance ASC → insertion ASC).
 * Reachability (canReach, 3b-c5) walks this view; OSPF routes carry
 * adminDistance:110, so they lose to a same-prefix static (AD 1) and a
 * connected (AD 0) as real IOS does.
 */
export function routingTable(s: Session): Route[] {
  return [...connectedRoutes(s.device), ...s.staticRoutes, ...s.ospfRoutes];
}

/**
 * Build a starting device from a topology spec: every interface admin-down with
 * no IP, matching a freshly-booted router (CLAUDE.md free-lab starting state).
 */
export function buildDevice(spec: {
  id: string;
  platform: string;
  interfaces: readonly string[];
}): DeviceState {
  const interfaces: Record<string, InterfaceState> = {};
  for (const id of spec.interfaces) {
    interfaces[id] = {
      id,
      name: fullInterfaceName(id),
      ip: null,
      mask: null,
      ipv6Addresses: [],
      description: null,
      adminUp: false,
      // Defaults true; the lab-session refresh pass overrides this to false
      // when the cabled peer is admin-down or the interface is uncabled.
      // Direct adapter tests (no lab session) see protocolUp follow adminUp
      // via showIpIntBrief's fallback.
      protocolUp: true,
      accessGroups: { in: null, out: null },
    };
  }
  return {
    id: spec.id,
    hostname: spec.id,
    platform: spec.platform,
    interfaces,
    // No subinterfaces on a freshly-booted router — they're created lazily
    // by `interface gi0/0.<n>` from config mode.
    subInterfaces: {},
    ospf: {
      process: null,
      routerId: null,
      pendingRouterId: null,
      networks: [],
      neighbors: new Map(),
      passive: new Set(),
      defaultInfoOriginate: false,
      defaultInfoAlways: false,
    },
    acls: new Map(),
    dhcpPools: new Map(),
    dhcpExcluded: [],
    dhcpBindings: new Map(),
    natStatements: [],
    natTranslations: new Map(),
    security: {
      domainName: null,
      enableSecret: null,
      users: new Map(),
      cryptoKeyModulus: null,
      vtyLoginLocal: false,
      vtyTransportInput: 'all',
      vtyAccessClassIn: null,
      motdBanner: null,
    },
    ntp: {
      servers: new Map(),
    },
    syslog: {
      hosts: new Map(),
      trapLevel: null,
      serviceTimestampsLogDatetimeMsec: false,
    },
  };
}

/**
 * Derive the OSPF router-id: highest loopback IP wins, then highest non-loopback
 * interface IP. Returns null if no interface has an IP — process is created but
 * adjacency cannot form.
 */
export function deriveRouterId(device: DeviceState): string | null {
  const chooseHighest = (ifaces: InterfaceState[]): string | null => {
    let best: string | null = null;
    let bestVal = -1;
    for (const i of ifaces) {
      if (!i.ip) continue;
      const parts = i.ip.split('.').map(Number);
      const n = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
      if (n > bestVal) {
        bestVal = n;
        best = i.ip;
      }
    }
    return best;
  };
  const all = Object.values(device.interfaces);
  return chooseHighest(all.filter((i) => i.id.startsWith('Lo'))) ?? chooseHighest(all);
}

export function createLoopbackInterface(id: string): InterfaceState {
  return {
    id,
    name: fullInterfaceName(id),
    ip: null,
    mask: null,
    ipv6Addresses: [],
    description: null,
    adminUp: true,
    protocolUp: true,
    accessGroups: { in: null, out: null },
  };
}
/** The prompt string for the current mode, e.g. `R1(config-if)#`. */
export function prompt(session: Session): string {
  const h = session.device.hostname;
  switch (session.mode) {
    case 'user':
      return `${h}>`;
    case 'priv':
      return `${h}#`;
    case 'config':
      return `${h}(config)#`;
    case 'config-if':
      return `${h}(config-if)#`;
    case 'config-subif':
      return `${h}(config-subif)#`;
    case 'config-router':
      return `${h}(config-router)#`;
    case 'config-dhcp':
      return `${h}(config-dhcp)#`;
    case 'config-ext-nacl':
      return `${h}(config-ext-nacl)#`;
    case 'config-line':
      return `${h}(config-line)#`;
  }
}
