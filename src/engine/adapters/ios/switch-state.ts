/**
 * Cisco IOS switch state — per-device data model for an L2 switch.
 *
 * Switches share the IOS mode stack with routers (user/priv/config/config-if)
 * plus one extra submode (config-vlan). They are Layer 2 — interfaces are
 * "switchports", they don't have IPs, and there is no routing table. The VLAN
 * database is a Map keyed by VLAN id.
 *
 * Session 1 of the switch build (per work order): switch device kind, VLAN
 * database, access ports, VLAN-aware L2 forwarding. Trunking, inter-VLAN
 * routing, and STP are explicitly out of scope and land in later sessions.
 */

/** CLI mode stack levels supported by a switch. Adds `config-vlan` to the
 *  router mode set; `config-router` is omitted (switches don't run OSPF). */
export type SwitchMode = 'user' | 'priv' | 'config' | 'config-if' | 'config-vlan';

/** A row in the switch's VLAN database. VLAN 1 is created automatically on
 *  every switch and cannot be deleted. VLANs 1002-1005 are reserved (token
 *  ring / FDDI) and cannot be created. */
export interface Vlan {
  readonly id: number;
  name: string;
  active: boolean;
}

/** Per-port configuration. Switchports are L2 — they do NOT carry IPs.
 *
 *  Session 1 added access mode + the VLAN database. Session 2 adds trunk mode
 *  and per-trunk allowed/native VLAN configuration. `dynamic` remains reserved
 *  for a later session.
 *
 *  `trunkAllowedVlans === 'all'` is the sentinel for the IOS default (1-4094);
 *  the show layer renders it as the range string and `show running-config`
 *  omits the line entirely, matching IOS's "default value is hidden from
 *  running-config" behaviour. Storing a 4094-element array per port would
 *  match the spec literally but is wasteful and indistinguishable from a
 *  learner who explicitly typed the full list — the sentinel keeps the
 *  distinction. */
export type LacpMode = 'active' | 'passive' | 'on';

export interface Switchport {
  /** Canonical interface id, e.g. 'Fa0/1'. */
  readonly id: string;
  /** Full IOS name, e.g. 'FastEthernet0/1'. */
  readonly name: string;
  /** Optional interface description rendered by show interfaces status. */
  description: string | null;
  mode: 'access' | 'trunk' | 'dynamic';
  /** VLAN id this port belongs to in access mode. Defaults to 1. */
  accessVlan: number;
  /** Allowed VLAN list when in trunk mode. 'all' is the IOS default sentinel
   *  (1-4094). An explicit array is the learner-configured list. */
  trunkAllowedVlans: number[] | 'all';
  /** Native (untagged) VLAN on a trunk. IOS default is 1. */
  nativeVlan: number;
  adminUp: boolean;
  /** Refreshed by the LabSession layer — true when the cabled peer is up. */
  protocolUp: boolean;
  /** Port-channel group this physical switchport belongs to, if any. */
  channelGroup: number | null;
  /** EtherChannel mode configured by `channel-group <id> mode ...`. */
  lacpMode: LacpMode | null;
  /** Derived state: true when the member is bundled into its Port-channel. */
  bundled: boolean;
  /** Scoped CCNA STP edge-port setting configured by `spanning-tree portfast`. */
  stpPortfast: boolean;
  /** Scoped CCNA BPDU Guard setting configured by `spanning-tree bpduguard enable`. */
  bpduGuard: boolean;
  /** Scoped BPDU Guard err-disable trigger for learner-facing tshoot labs. */
  bpduGuardViolation: boolean;
  /** Derived/access-layer shutdown state rendered as err-disabled in show commands. */
  errDisabled: boolean;
  /** Scoped CCNA port-security model for access-port err-disable labs. */
  portSecurity: PortSecurityState | null;
}

export interface PortSecurityState {
  enabled: boolean;
  maximum: number;
  violationMode: 'shutdown';
  sticky: boolean;
  secureMac: string | null;
  violation: boolean;
  lastSourceAddress: string | null;
}

export interface PortChannel {
  readonly id: number;
  readonly name: string;
  mode: 'access' | 'trunk' | 'dynamic';
  accessVlan: number;
  trunkAllowedVlans: number[] | 'all';
  nativeVlan: number;
  bundled: boolean;
}

export interface SpanningTreeVlan {
  readonly vlanId: number;
  priority: number;
  rootRole: 'primary' | 'secondary' | null;
}

export interface SwitchDeviceState {
  readonly id: string;
  hostname: string;
  readonly platform: string;
  /** VLAN database keyed by id. Map preserves insertion order so
   *  `show vlan brief` reads deterministically. */
  vlans: Map<number, Vlan>;
  /** Switchports keyed by canonical interface id. */
  switchports: Record<string, Switchport>;
  /** Logical Port-channel interfaces keyed by channel-group id. */
  portChannels: Map<number, PortChannel>;
  /** Scoped per-VLAN STP settings modeled for CCNA root bridge labs. */
  spanningTree: Map<number, SpanningTreeVlan>;
}

export interface SwitchSession {
  /** Device-kind discriminator — every adapter's session carries one. */
  readonly kind: 'switch';
  mode: SwitchMode;
  /** The interface currently selected in config-if mode. */
  currentInterface: string | null;
  /** The VLAN currently selected in config-vlan mode. */
  currentVlan: number | null;
  device: SwitchDeviceState;
  history: string[];
  resolvedHistory: string[];
  /** Snapshot recorded by the `show interfaces trunk` handler at command-eval
   *  time — `trunkPortIds` is the list of switchports that were in trunk mode
   *  on this switch the moment the learner ran the command. Mirrors `lastPing`
   *  on PcSession: verify-style objectives MUST read this rather than command
   *  history + current state, otherwise a verify run BEFORE the trunk was
   *  configured auto-completes the objective the instant trunks come up later. */
  lastShowInterfacesTrunk: { trunkPortIds: readonly string[] } | null;
  /** Snapshot recorded by `show etherchannel summary` at command-eval time.
   *  Objectives use this to require verify-after-config behavior. */
  lastShowEtherchannelSummary: { bundledGroups: readonly number[] } | null;
  /** Snapshot recorded by `show spanning-tree vlan <id>` at command-eval time. */
  lastShowSpanningTreeVlans: { vlanIds: readonly number[] } | null;
  /** Snapshot recorded by `show interfaces status` for verify-after-repair gates. */
  lastShowInterfacesStatus: { connectedPortIds: readonly string[]; errDisabledPortIds: readonly string[] } | null;
}

/** Reserved VLAN range — token ring/FDDI in real IOS. Creation is rejected
 *  with the IOS error sentence; deletion of these is silently ignored. */
export const RESERVED_VLAN_MIN = 1002;
export const RESERVED_VLAN_MAX = 1005;
/** Max VLAN id IOS will accept on standard switch images. */
export const MAX_VLAN_ID = 4094;

export function isReservedVlan(id: number): boolean {
  return id >= RESERVED_VLAN_MIN && id <= RESERVED_VLAN_MAX;
}

export function isValidVlanId(id: number): boolean {
  if (!Number.isInteger(id)) return false;
  if (id < 1 || id > MAX_VLAN_ID) return false;
  return true;
}

/** Default VLAN name follows IOS convention: 'VLAN<padded-id>' e.g. 'VLAN0010'.
 *  The default VLAN 1 is named 'default' on a fresh switch. */
export function defaultVlanName(id: number): string {
  if (id === 1) return 'default';
  return `VLAN${id.toString().padStart(4, '0')}`;
}

/** Full IOS interface name from a short id. Switches lean on Fa<slot>/<port>
 *  and Gi<slot>/<port>; mirrors router state's mapping. */
const FULL_NAMES: Record<string, string> = {
  Gi: 'GigabitEthernet',
  Fa: 'FastEthernet',
};

export function fullSwitchportName(id: string): string {
  const m = /^([A-Za-z]+)(\d.*)$/.exec(id);
  if (!m) return id;
  return `${FULL_NAMES[m[1]] ?? m[1]}${m[2]}`;
}

/** Normalise a user-typed interface token to a canonical id.
 *  Accepts both short (`fa0/1`, `gi0/2`) and long (`FastEthernet0/1`) forms. */
export function normaliseSwitchportId(token: string): string | null {
  const m = /^(gigabitethernet|gig|gi|g|fastethernet|fa|f)(\d+\/\d+(?:\/\d+)?)$/i.exec(token);
  if (!m) return null;
  const prefix = m[1].toLowerCase();
  const slot = m[2];
  const kind = prefix.startsWith('f') ? 'Fa' : 'Gi';
  return `${kind}${slot}`;
}

export function normalisePortChannelId(token: string): number | null {
  const m = /^(?:port-channel|po)(\d+)$/i.exec(token);
  if (!m) return null;
  const id = Number.parseInt(m[1], 10);
  return isValidChannelGroup(id) ? id : null;
}

export function portChannelName(id: number): string {
  return `Port-channel${id}`;
}

export const MIN_CHANNEL_GROUP = 1;
export const MAX_CHANNEL_GROUP = 128;

export function isValidChannelGroup(id: number): boolean {
  return Number.isInteger(id) && id >= MIN_CHANNEL_GROUP && id <= MAX_CHANNEL_GROUP;
}

export function makePortChannel(id: number): PortChannel {
  return {
    id,
    name: portChannelName(id),
    mode: 'dynamic',
    accessVlan: 1,
    trunkAllowedVlans: 'all',
    nativeVlan: 1,
    bundled: false,
  };
}

export const DEFAULT_STP_PRIORITY = 32768;
export const ROOT_PRIMARY_PRIORITY = 24576;
export const ROOT_SECONDARY_PRIORITY = 28672;

export function makeSpanningTreeVlan(
  vlanId: number,
  rootRole: 'primary' | 'secondary' | null = null,
): SpanningTreeVlan {
  const priority =
    rootRole === 'primary'
      ? ROOT_PRIMARY_PRIORITY
      : rootRole === 'secondary'
        ? ROOT_SECONDARY_PRIORITY
        : DEFAULT_STP_PRIORITY;
  return { vlanId, priority, rootRole };
}

/** Build a starting switch device from a topology spec. Every switchport
 *  defaults to access mode in VLAN 1, admin-up — matches real IOS where
 *  switchports come up out of the box and forward in VLAN 1. The default
 *  VLAN 1 is seeded into the database with name 'default'. */
export function buildSwitchDevice(spec: {
  id: string;
  platform: string;
  interfaces: readonly string[];
}): SwitchDeviceState {
  const switchports: Record<string, Switchport> = {};
  for (const id of spec.interfaces) {
    switchports[id] = {
      id,
      name: fullSwitchportName(id),
      description: null,
      mode: 'access',
      accessVlan: 1,
      // Trunk fields default to IOS factory: all VLANs allowed, native VLAN 1.
      // They are unused while mode === 'access' but keep the type non-optional
      // so the dispatcher doesn't need conditional reads.
      trunkAllowedVlans: 'all',
      nativeVlan: 1,
      // Real switches boot with ports admin-up by default (unlike routers,
      // which require `no shutdown`). The work order's seeding pattern
      // assumes this — Fa0/1 and Fa0/2 are reachable at lab start.
      adminUp: true,
      // Default true; LabSession refresh pass overrides when uncabled or
      // when the cabled peer is admin-down.
      protocolUp: true,
      channelGroup: null,
      lacpMode: null,
      bundled: false,
      stpPortfast: false,
      bpduGuard: false,
      bpduGuardViolation: false,
      errDisabled: false,
      portSecurity: null,
    };
  }
  const vlans = new Map<number, Vlan>();
  vlans.set(1, { id: 1, name: defaultVlanName(1), active: true });
  return {
    id: spec.id,
    hostname: spec.id,
    platform: spec.platform,
    vlans,
    switchports,
    portChannels: new Map(),
    spanningTree: new Map(),
  };
}

/** Build a fresh session at the user prompt. Deep-copies the device so callers
 *  can mutate without aliasing the spec. */
export function createSwitchSession(device: SwitchDeviceState): SwitchSession {
  return {
    kind: 'switch',
    mode: 'user',
    currentInterface: null,
    currentVlan: null,
    device: cloneSwitchDevice(device),
    history: [],
    resolvedHistory: [],
    lastShowInterfacesTrunk: null,
    lastShowEtherchannelSummary: null,
    lastShowSpanningTreeVlans: null,
    lastShowInterfacesStatus: null,
  };
}

/** Deep-copy a SwitchDeviceState, including the VLAN Map. structuredClone
 *  handles Map natively. */
export function cloneSwitchDevice(device: SwitchDeviceState): SwitchDeviceState {
  return structuredClone(device);
}

/** Parse a Cisco-style VLAN list — `10`, `10,20`, `10-20`, `10,20-25,30` —
 *  into a sorted, deduplicated array of VLAN ids. Returns null on any
 *  malformed token (non-numeric, reversed range, out-of-range id, reserved
 *  id). Whitespace is not allowed around `,` or `-` — IOS rejects spaces
 *  inside the list too. */
export function parseVlanList(input: string): number[] | null {
  if (input.length === 0) return null;
  const out = new Set<number>();
  for (const part of input.split(',')) {
    if (part.length === 0) return null;
    if (part.includes('-')) {
      const m = /^(\d+)-(\d+)$/.exec(part);
      if (!m) return null;
      const a = Number.parseInt(m[1], 10);
      const b = Number.parseInt(m[2], 10);
      if (!isValidVlanId(a) || !isValidVlanId(b) || isReservedVlan(a) || isReservedVlan(b)) {
        return null;
      }
      if (a > b) return null;
      for (let i = a; i <= b; i++) out.add(i);
    } else {
      const n = Number.parseInt(part, 10);
      if (String(n) !== part || !isValidVlanId(n) || isReservedVlan(n)) return null;
      out.add(n);
    }
  }
  return Array.from(out).sort((x, y) => x - y);
}

/** Format a sorted VLAN-id array as a Cisco-style condensed list (`1,3-5,8`).
 *  Empty array renders as 'none' — what IOS prints for an empty allowed list. */
export function formatVlanList(vlans: readonly number[]): string {
  if (vlans.length === 0) return 'none';
  const out: string[] = [];
  let runStart = vlans[0];
  let runEnd = vlans[0];
  for (let i = 1; i < vlans.length; i++) {
    const v = vlans[i];
    if (v === runEnd + 1) {
      runEnd = v;
      continue;
    }
    out.push(runStart === runEnd ? `${runStart}` : `${runStart}-${runEnd}`);
    runStart = v;
    runEnd = v;
  }
  out.push(runStart === runEnd ? `${runStart}` : `${runStart}-${runEnd}`);
  return out.join(',');
}

/** True when the trunk's allowed list includes the given VLAN. The 'all'
 *  sentinel means every VLAN 1-4094 is allowed, matching the IOS default. */
export function trunkAllowsVlan(
  allowed: readonly number[] | 'all',
  vlanId: number,
): boolean {
  if (allowed === 'all') return true;
  return allowed.includes(vlanId);
}

/** The prompt string for the switch's current mode. */
export function switchPrompt(session: SwitchSession): string {
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
    case 'config-vlan':
      return `${h}(config-vlan)#`;
  }
}
