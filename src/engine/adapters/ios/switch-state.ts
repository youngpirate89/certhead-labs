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
 *  `mode` is always 'access' in Session 1. The 'trunk' and 'dynamic' variants
 *  are reserved in the type so a later session can switch on them without
 *  restructuring the state shape. */
export interface Switchport {
  /** Canonical interface id, e.g. 'Fa0/1'. */
  readonly id: string;
  /** Full IOS name, e.g. 'FastEthernet0/1'. */
  readonly name: string;
  mode: 'access' | 'trunk' | 'dynamic';
  /** VLAN id this port belongs to in access mode. Defaults to 1. */
  accessVlan: number;
  adminUp: boolean;
  /** Refreshed by the LabSession layer — true when the cabled peer is up. */
  protocolUp: boolean;
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
      mode: 'access',
      accessVlan: 1,
      // Real switches boot with ports admin-up by default (unlike routers,
      // which require `no shutdown`). The work order's seeding pattern
      // assumes this — Fa0/1 and Fa0/2 are reachable at lab start.
      adminUp: true,
      // Default true; LabSession refresh pass overrides when uncabled or
      // when the cabled peer is admin-down.
      protocolUp: true,
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
  };
}

/** Deep-copy a SwitchDeviceState, including the VLAN Map. structuredClone
 *  handles Map natively. */
export function cloneSwitchDevice(device: SwitchDeviceState): SwitchDeviceState {
  return structuredClone(device);
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
