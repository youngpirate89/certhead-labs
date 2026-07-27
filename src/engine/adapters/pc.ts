/**
 * PC device adapter.
 *
 * Per docs/ENGINE_ARCHITECTURE.md §3: a PC is the test endpoint — single NIC,
 * default gateway, never a transit hop. Per CLAUDE.md guardrail #2 the lab
 * is NOT a general-purpose simulator; the command surface is intentionally
 * curated. Two principles flow from that:
 *
 *  1. A learner who reaches for a sensible-but-unimplemented command
 *     (nslookup, arp, netstat, ...) never sees a bare "Unrecognized
 *     command" — they get a short, tailored redirect that points at what
 *     the lab DOES support. The redirect is the friendly door from
 *     "habit" to "in-scope".
 *  2. A genuine typo or malformed token (`traceroute192.168.2.10` with no
 *     space) still fails honestly with the IOS-style error. Honest
 *     failures > false friendliness.
 *
 * Both behaviors are implemented as a single COMMANDS registry: each entry
 * is either a `working` handler or a `redirect` message. Adding a new
 * command (or graduating a redirect to working) means editing this list —
 * NOT adding a switch case in applyCommand.
 *
 * PCs are configured via the lab spec (`LabDevice.pc`), not the CLI — that
 * matches CCNA-level pedagogy. The PcSession shape exposes enough surface
 * for the engine to validate source/destination semantics during
 * reachability evaluation.
 */
import type { CommandNode } from '@/engine/parser';
import { tokenize } from '@/engine/parser';
import type { LabDevice, Link } from '@/engine/types';
import type {
  AdapterContext,
  ApplyOptions,
  ApplyResult,
  CommandOutput,
  DeviceAdapter,
  DeviceTopologyView,
} from './types';
import {
  isSubInterfaceId,
  isValidIpv4,
  isValidIpv6Prefix,
  isValidMask,
  nextEngineSeq,
  routingTable,
  type Session as RouterSession,
  type SubInterface,
  type InterfaceState,
} from './ios/state';
import {
  ipInSubnet,
  longestPrefixMatch,
  networkAddress,
} from './ios/routing';
import { evaluateAcl } from './ios/acl';
import { trunkAllowsVlan } from './ios/switch-state';
import {
  canReach,
  type FailPoint,
  type FailReason,
} from '@/engine/reachability';
import type { DeviceSession, LabSession } from '@/engine/lab-session';

export interface WirelessDynamicInterface {
  readonly name: string;
  readonly vlanId: number;
  readonly configuredAt: number;
}

export interface WirelessLan {
  readonly id: number;
  readonly profile: string;
  readonly ssid: string;
  readonly interfaceName: string | null;
  readonly enabled: boolean;
  readonly configuredAt: number;
  readonly mappedAt: number;
  readonly enabledAt: number;
}

export interface WirelessControllerState {
  readonly interfaces: Map<string, WirelessDynamicInterface>;
  readonly wlans: Map<number, WirelessLan>;
  lastShowWlanSummary: number;
  readonly lastShowWlanDetail: Map<number, number>;
  lastShowClientSummary: number;
}

export interface PcSession {
  readonly kind: 'pc';
  readonly id: string;
  readonly hostname: string;
  /** Lab-spec platform label — shown in the topology card badge (e.g.
   *  `Server`, `Workstation`). Kept on the session so toTopologyView can
   *  surface it without re-reading the LabDevice spec at render time. */
  readonly platform: string;
  /** Single NIC label — kept stable for canvas labelling. */
  readonly nic: string;
  ip: string | null;
  mask: string | null;
  gateway: string | null;
  /** Scoped workstation DNS servers, shown by ipconfig /all. */
  dnsServers: string[];
  /** Scoped lab DNS records. Keys are normalized lowercase hostnames. */
  dnsRecords: Record<string, string>;
  /** Minimal Windows-style ARP cache learned by successful ping attempts. */
  arpCache: Record<string, string>;
  /** IPv6 unicast address/prefix configured on the PC, e.g. 2001:db8::10/64. */
  ipv6: string | null;
  /** IPv6 default gateway for the PC, normally the router interface address. */
  gateway6: string | null;
  /** True when the PC is a DHCP client — its `ip`/`mask`/`gateway` come from
   *  the connected router's matching DHCP binding, not the lab's static spec.
   *  Lab-session DHCP refresh pass writes those fields whenever a binding
   *  resolves; clears them back to null when the binding falls away. */
  readonly dhcpMode: boolean;
  /** Optional visual classification carried from the lab spec — drives the
   *  topology canvas's icon pick via DeviceTopologyView.deviceClass. Today
   *  only 'server' has a distinct icon; 'workstation' is the default and is
   *  equivalent to leaving the field unset. */
  readonly deviceClass?: 'workstation' | 'server' | 'access-point' | 'wireless-client';
  /** True when the PC's NIC is cabled to an up neighbor interface. Refreshed
   *  by the LabSession layer whenever device state changes. */
  nicUp: boolean;
  history: string[];
  resolvedHistory: string[];
  /** Outcome of the most recent ping command run from this PC, or null if
   *  the learner hasn't pinged yet. Written by the ping handler only,
   *  never elsewhere. Reachability objectives MUST check this (not raw
   *  canReach) so they require an actual learner-initiated ping — testing
   *  state alone auto-completes the instant routes are correct, which
   *  defeats the troubleshooting pedagogy. */
  lastPing: { target: string; ok: boolean } | null;
  /** Outcome of the most recent SSH command from this PC. */
  lastSsh: { target: string; user: string; ok: boolean } | null;
  /** Stamped each time the learner runs `ipconfig` on this PC. Verify-style
   *  objectives (Lab 14) compare this against 0 to require the show command
   *  to actually have been run — mirrors `lastPing` for ping and the router
   *  `lastShowDhcpBinding` stamp. Cleared by `record:false` so seeded runs
   *  cannot pre-satisfy a verify gate. */
  lastIpconfig: number;
  /** Stamped when the learner queries the read-only automation inventory API. */
  lastApiInventory: number;
  /** Stamped per device when the learner queries `/devices/<id>`. */
  readonly lastApiDeviceDetail: Map<string, number>;
  /** Stamped per device when the learner queries `/devices/<id>/interfaces`. */
  readonly lastApiInterfaces: Map<string, number>;
  /** Stamped per device/interface when the learner queries
   *  `/devices/<id>/interfaces/<interface-id>` after reading the list. */
  readonly lastApiInterfaceDetail: Map<string, number>;
  /** Scoped WLC-like command state for CCNA wireless WLAN-to-VLAN labs.
   *  Present only when the lab models a Wireless LAN Controller using the
   *  existing PC-kind adapter shell; normal workstations leave it undefined. */
  wirelessController?: WirelessControllerState;
}

/**
 * Decorative grammar tree. The registry below is the real dispatch surface;
 * this stays around so `grammarFor()` returns a non-trivial structure if
 * tab-complete / `?` help ever get wired up for PCs. Keep the shape in sync
 * with COMMANDS when adding new working commands.
 */
const pcGrammar: CommandNode = {
  children: {
    ipconfig: { terminal: true, help: 'Show IP configuration (add /all for more)' },
    ip: {
      help: 'Set IPv4 address and mask',
      argument: { name: 'ip', node: { argument: { name: 'mask', node: { terminal: true, help: 'Apply' } } } },
    },
    gateway: {
      help: 'Set default gateway',
      argument: { name: 'ip', node: { terminal: true, help: 'Apply' } },
    },
    ipv6: {
      help: 'Set IPv6 address/prefix',
      argument: { name: 'prefix', node: { terminal: true, help: 'Apply' } },
    },
    gateway6: {
      help: 'Set IPv6 default gateway',
      argument: { name: 'ip', node: { terminal: true, help: 'Apply' } },
    },
    ping: {
      help: 'Ping an IPv4 destination',
      argument: { name: 'target', node: { terminal: true, help: 'Send ICMP request' } },
    },
    route: {
      help: 'Show the workstation IPv4 route table',
      argument: { name: 'print', node: { terminal: true, help: 'Print routes' } },
    },
    tracert: {
      help: 'Trace the route to an IPv4 destination',
      argument: { name: 'target', node: { terminal: true, help: 'Trace hops' } },
    },
    ssh: {
      help: 'Connect to a network device over SSH',
      argument: { name: 'target', node: { terminal: true, help: 'Connect' } },
    },
    nslookup: {
      help: 'Resolve a scoped lab hostname',
      argument: { name: 'hostname', node: { terminal: true, help: 'Resolve host' } },
    },
    arp: {
      help: 'Display the workstation ARP cache',
      argument: { name: '-a', node: { terminal: true, help: 'Show ARP cache' } },
    },
    curl: {
      help: 'Query the scoped read-only automation API',
      argument: { name: 'url', node: { terminal: true, help: 'GET URL' } },
    },
    'invoke-restmethod': {
      help: 'Query the scoped read-only automation API',
      argument: { name: '-Uri', node: { argument: { name: 'url', node: { terminal: true, help: 'GET URL' } } } },
    },
    config: { help: 'Wireless controller configuration commands', terminal: true },
    show: { help: 'Wireless controller show commands', terminal: true },
    traceroute: {
      help: 'Alias of tracert',
      argument: { name: 'target', node: { terminal: true, help: 'Trace hops' } },
    },
    clear: { terminal: true, help: 'Clear the screen' },
  },
};

// ---------------------------------------------------------------------------
// Command registry — the dispatcher's source of truth.
// ---------------------------------------------------------------------------

type Handler = (
  session: PcSession,
  args: readonly string[],
  ctx: AdapterContext | undefined,
  opts: ApplyOptions | undefined,
) => ApplyResult<PcSession>;

type PcCommand =
  | {
      readonly name: string;
      readonly aliases?: readonly string[];
      readonly kind: 'working';
      readonly handler: Handler;
    }
  | {
      readonly name: string;
      readonly aliases?: readonly string[];
      readonly kind: 'redirect';
      /** One-line system message. Should redirect the learner toward an
       *  in-scope command (typically ping / tracert / ipconfig). */
      readonly message: string;
    };

const COMMANDS: readonly PcCommand[] = [
  // ---- WORKING tier ----
  { name: 'ipconfig', aliases: ['get-netipconfiguration'], kind: 'working', handler: handleIpconfig },
  { name: 'ping',     kind: 'working', handler: handlePing },
  { name: 'route',    kind: 'working', handler: handleRoute },
  { name: 'tracert',  aliases: ['traceroute'], kind: 'working', handler: handleTracert },
  { name: 'ssh',      kind: 'working', handler: handleSsh },
  { name: 'nslookup', kind: 'working', handler: handleNslookup },
  { name: 'arp',      kind: 'working', handler: handleArp },
  { name: 'curl',     kind: 'working', handler: handleAutomationApi },
  { name: 'invoke-restmethod', aliases: ['irm'], kind: 'working', handler: handleAutomationApi },
  { name: 'config',   kind: 'working', handler: handleWlcConfig },
  { name: 'show',     kind: 'working', handler: handleWlcShow },
  { name: 'ip',       kind: 'working', handler: handleIp },
  { name: 'gateway',  kind: 'working', handler: handleGateway },
  { name: 'new-netipaddress', kind: 'working', handler: handleNewNetIpAddress },
  { name: 'ipv6',     kind: 'working', handler: handleIpv6 },
  { name: 'gateway6', kind: 'working', handler: handleGateway6 },
  { name: 'clear',    kind: 'working', handler: handleClear },

  // ---- KNOWN-BUT-REDIRECTED tier (register here, don't implement) ----
  // Each message names the in-scope alternatives so the learner has a path
  // forward — never a dead-end "Unrecognized command" for a sensible try.
  {
    name: 'netstat',
    kind: 'redirect',
    message:
      "netstat isn't part of this lab — there are no active TCP/UDP connections to inspect. Use `ping <ip>` or `tracert <ip>` to test connectivity.",
  },
  {
    name: 'telnet',
    kind: 'redirect',
    message:
      "telnet isn't part of this lab — use `ssh <user>@<ip>` when a device-hardening lab asks you to test remote management.",
  },
  {
    name: 'ftp',
    kind: 'redirect',
    message:
      "ftp isn't part of this lab. Use `ping <ip>` or `tracert <ip>` to test connectivity.",
  },
  {
    name: 'getmac',
    kind: 'redirect',
    message:
      "getmac isn't part of this lab — MAC addresses aren't modeled. Use `ipconfig` for your IPv4 configuration.",
  },
  {
    name: 'nbtstat',
    kind: 'redirect',
    message:
      "nbtstat isn't part of this lab — NetBIOS isn't modeled. Use `ipconfig` for your own addressing or `ping <ip>` for reachability.",
  },
];

/** Lookup table: command name OR alias → registry entry. Built once at
 *  module load; immutable thereafter. */
const COMMAND_BY_NAME: ReadonlyMap<string, PcCommand> = (() => {
  const m = new Map<string, PcCommand>();
  for (const c of COMMANDS) {
    m.set(c.name, c);
    for (const a of c.aliases ?? []) m.set(a, c);
  }
  return m;
})();

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const pcAdapter: DeviceAdapter<PcSession> = {
  kind: 'pc',

  buildDevice(spec: LabDevice): PcSession {
    const nic = spec.interfaces[0] ?? 'Eth0';
    const dhcpMode = spec.pc?.dhcp === true;
    return {
      kind: 'pc',
      id: spec.id,
      hostname: spec.id,
      platform: spec.platform,
      nic,
      // DHCP clients start with no addressing; the lab-session DHCP refresh
      // pass populates ip/mask/gateway when a binding resolves. Static specs
      // still take their values from spec.pc.
      ip: dhcpMode ? null : spec.pc?.ip ?? null,
      mask: dhcpMode ? null : spec.pc?.mask ?? null,
      gateway: dhcpMode ? null : spec.pc?.gateway ?? null,
      dnsServers: [...(spec.pc?.dnsServers ?? [])],
      dnsRecords: normalizeDnsRecords(spec.pc?.dnsRecords ?? {}),
      arpCache: {},
      ipv6: null,
      gateway6: null,
      dhcpMode,
      deviceClass: spec.deviceClass,
      nicUp: false,
      history: [],
      resolvedHistory: [],
      lastPing: null,
      lastSsh: null,
      lastIpconfig: 0,
      lastApiInventory: 0,
      lastApiDeviceDetail: new Map(),
      lastApiInterfaces: new Map(),
      lastApiInterfaceDetail: new Map(),
      wirelessController: isWirelessControllerPlatform(spec.platform)
        ? { interfaces: new Map(), wlans: new Map(), lastShowWlanSummary: 0, lastShowWlanDetail: new Map(), lastShowClientSummary: 0 }
        : undefined,
    };
  },

  applyCommand(
    prev,
    raw,
    ctx?: AdapterContext,
    opts?: ApplyOptions,
  ): ApplyResult<PcSession> {
    const { tokens } = tokenize(raw);
    if (tokens.length === 0) return { session: prev, output: [] };

    // Lightweight/controller-managed APs have an appliance CLI, not a
    // Windows shell and not a switch IOS configuration surface. Keep this
    // narrow and diagnostic: WLAN/VLAN policy belongs on the WLC in this lab.
    if (isLightweightAccessPoint(prev)) {
      return applyLightweightAccessPointCommand(prev, raw, tokens, ctx, opts);
    }

    // First token is the command name; lookup is exact (no prefix matching
    // for PC commands — Windows shell convention is full names). Aliases
    // (e.g., 'traceroute' → tracert) resolve through the same map.
    const head = tokens[0].toLowerCase();
    const cmd = COMMAND_BY_NAME.get(head);
    if (!cmd) {
      // MALFORMED / unknown — keep the existing honest IOS-style error so a
      // genuine typo ('tracerte', 'traceroute192.168.2.10') doesn't get a
      // false friendly message.
      return { session: prev, output: errLine(`% Unrecognized command: ${tokens[0]}`) };
    }

    // Recognized — clone session and record history under the CANONICAL
    // name (aliases collapse: 'traceroute …' resolves to 'tracert …' in
    // resolvedHistory, mirroring IOS abbreviation expansion).
    const s = structuredClone(prev) as PcSession;
    if (opts?.record !== false) {
      s.history.push(raw.trim());
      s.resolvedHistory.push([cmd.name, ...tokens.slice(1)].join(' '));
    }

    if (cmd.kind === 'redirect') {
      // System line — not an error, not a real command output. The terminal
      // surfaces it dimmer than user input, matching its "engine note" tone.
      return { session: s, output: [{ kind: 'system', text: cmd.message }] };
    }

    return cmd.handler(s, tokens.slice(1), ctx, opts);
  },

  prompt(session) {
    return isLightweightAccessPoint(session)
      ? `${session.hostname}#`
      : `${session.hostname}$`;
  },

  grammarFor() {
    return pcGrammar;
  },

  contextHelp(_session, _partialLine) {
    // Minimal: pcs don't ship IOS-style `?` help. Returning [] makes the
    // terminal a no-op on `?` — useful behavior, doesn't crash.
    return [];
  },

  tabComplete(_session, _partialLine) {
    return null;
  },

  toTopologyView(session): DeviceTopologyView {
    return {
      id: session.id,
      kind: 'pc',
      hostname: session.hostname,
      platform: session.platform,
      deviceClass: session.deviceClass,
      interfaces: [
        {
          id: session.nic,
          name: session.nic,
          status: !session.nicUp ? 'admin-down' : session.ip ? 'up' : 'no-ip',
          ip: session.ip,
          mask: session.mask,
          // PCs have no admin shutdown in our model — `adminUp` collapses to
          // `nicUp` (carrier state). The cable LED uses adminUp && protocolUp
          // so this gives PCs the same "link health" reading as routers/switches.
          adminUp: session.nicUp,
          protocolUp: session.nicUp,
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Working handlers
// ---------------------------------------------------------------------------

function handleIpconfig(
  s: PcSession,
  args: readonly string[],
  _ctx: AdapterContext | undefined,
  opts: ApplyOptions | undefined,
): ApplyResult<PcSession> {
  if (args.length === 0) {
    if (opts?.record !== false) s.lastIpconfig = nextEngineSeq();
    return { session: s, output: renderIpconfig(s, /* all */ false) };
  }
  const flag = args[0].toLowerCase();
  if (flag === '/all') {
    if (opts?.record !== false) s.lastIpconfig = nextEngineSeq();
    return { session: s, output: renderIpconfig(s, /* all */ true) };
  }
  // Unknown flag — Windows-shell-style honest error rather than silently
  // running the default form.
  return {
    session: s,
    output: errLine(`Unknown ipconfig switch: ${args[0]}. Try \`ipconfig\` or \`ipconfig /all\`.`),
  };
}

function handleIp(
  s: PcSession,
  args: readonly string[],
): ApplyResult<PcSession> {
  if (args.length < 2) return { session: s, output: errLine('% Incomplete command.') };
  const [ip, mask] = args;
  if (!isValidIpv4(ip)) return { session: s, output: errLine(`% Invalid IP address: ${ip}`) };
  if (!isValidMask(mask)) return { session: s, output: errLine('% Invalid subnet mask.') };
  s.ip = ip;
  s.mask = mask;
  return { session: s, output: [] };
}

function handleGateway(
  s: PcSession,
  args: readonly string[],
): ApplyResult<PcSession> {
  if (args.length < 1) return { session: s, output: errLine('% Incomplete command.') };
  const ip = args[0];
  if (!isValidIpv4(ip)) return { session: s, output: errLine(`% Invalid IP address: ${ip}`) };
  s.gateway = ip;
  return { session: s, output: [] };
}

function handleAutomationApi(
  s: PcSession,
  args: readonly string[],
  ctx: AdapterContext | undefined,
  opts: ApplyOptions | undefined,
): ApplyResult<PcSession> {
  const url = parseAutomationUrl(args);
  if (!url) {
    return {
      session: s,
      output: errLine('Usage: curl http://api.certhead.local/devices or Invoke-RestMethod -Uri http://api.certhead.local/devices/<device-id>'),
    };
  }
  if (!s.nicUp) {
    return { session: s, output: [{ kind: 'error', text: 'curl: (6) Could not resolve host: api.certhead.local' }] };
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname.toLowerCase() !== 'api.certhead.local' || parts[0] !== 'devices') {
    return { session: s, output: [{ kind: 'error', text: `404 Not Found: ${url.toString()}` }] };
  }

  const devices = ctx?.lab ? Object.values(ctx.lab.devices) : [s];
  if (parts.length === 1) {
    if (opts?.record !== false) s.lastApiInventory = nextEngineSeq();
    return {
      session: s,
      output: jsonLines({
        devices: devices.map((device) => ({
          id: deviceId(device),
          kind: device.kind,
          platform: devicePlatform(device),
          interfaceCount: deviceInterfaces(device).length,
        })),
      }),
    };
  }

  const targetId = decodeURIComponent(parts[1]);
  const target = devices.find((device) => deviceId(device).toLowerCase() === targetId.toLowerCase());
  if (!target) return { session: s, output: [{ kind: 'error', text: `404 Not Found: device ${targetId}` }] };

  if (parts.length === 2) {
    if (opts?.record !== false) s.lastApiDeviceDetail.set(deviceId(target), nextEngineSeq());
    return { session: s, output: jsonLines(deviceFact(target)) };
  }
  if (parts.length === 3 && parts[2] === 'interfaces') {
    if (opts?.record !== false) s.lastApiInterfaces.set(deviceId(target), nextEngineSeq());
    return { session: s, output: jsonLines({ deviceId: deviceId(target), interfaces: deviceInterfaces(target) }) };
  }
  if (parts.length === 4 && parts[2] === 'interfaces') {
    const requestedInterface = decodeURIComponent(parts[3]);
    const iface = deviceInterfaces(target).find(
      (candidate) => String(candidate.name).toLowerCase() === requestedInterface.toLowerCase(),
    );
    if (!iface) {
      return { session: s, output: [{ kind: 'error', text: `404 Not Found: interface ${requestedInterface}` }] };
    }
    if (opts?.record !== false) {
      s.lastApiInterfaceDetail.set(`${deviceId(target)}:${String(iface.name)}`, nextEngineSeq());
    }
    return { session: s, output: jsonLines({ deviceId: deviceId(target), interface: iface }) };
  }
  return { session: s, output: [{ kind: 'error', text: `404 Not Found: ${url.pathname}` }] };
}

function parseAutomationUrl(args: readonly string[]): URL | null {
  let candidate: string | undefined;
  const uriIdx = args.findIndex((arg) => arg.toLowerCase() === '-uri');
  if (uriIdx !== -1) candidate = args[uriIdx + 1];
  candidate ??= args.find((arg) => /^https?:\/\//i.test(arg));
  if (!candidate) return null;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function jsonLines(value: unknown): CommandOutput[] {
  return JSON.stringify(value, null, 2).split('\n').map((text) => ({ kind: 'output' as const, text }));
}

function deviceId(device: DeviceSession): string {
  return device.kind === 'pc' ? device.id : device.device.id;
}

function devicePlatform(device: DeviceSession): string {
  return device.kind === 'pc' ? device.platform : device.device.platform;
}

function deviceFact(device: DeviceSession): Record<string, unknown> {
  return {
    id: deviceId(device),
    kind: device.kind,
    platform: devicePlatform(device),
    interfaces: deviceInterfaces(device),
  };
}

function deviceInterfaces(device: DeviceSession): Record<string, unknown>[] {
  if (device.kind === 'pc') {
    return [
      {
        name: device.nic,
        status: device.nicUp ? (device.ip ? 'up' : 'no-ip') : 'admin-down',
        ipv4: device.ip,
        mask: device.mask,
        gateway: device.gateway,
      },
    ];
  }
  if (device.kind === 'switch') {
    return Object.values(device.device.switchports).map((port) => ({
      name: port.id,
      mode: port.mode,
      accessVlan: port.accessVlan,
      status: port.protocolUp ? 'up' : 'down',
    }));
  }
  return [
    ...Object.values(device.device.interfaces).map((iface) => ({
      name: iface.id,
      status: iface.adminUp ? (iface.ip ? 'up' : 'no-ip') : 'admin-down',
      ipv4: iface.ip,
      mask: iface.mask,
    })),
    ...Object.values(device.device.subInterfaces).map((iface) => ({
      name: iface.id,
      status: iface.protocolUp ? 'up' : 'down',
      ipv4: iface.ip,
      mask: iface.mask,
      vlan: iface.dot1qVlan,
    })),
  ];
}

function isWirelessControllerPlatform(platform: string): boolean {
  return /wireless\s+lan\s+controller|\bwlc\b/i.test(platform);
}

function isLightweightAccessPoint(session: PcSession): boolean {
  return session.deviceClass === 'access-point' || /lightweight\s+ap/i.test(session.platform);
}

function applyLightweightAccessPointCommand(
  prev: PcSession,
  raw: string,
  tokens: readonly string[],
  ctx: AdapterContext | undefined,
  opts: ApplyOptions | undefined,
): ApplyResult<PcSession> {
  const s = structuredClone(prev) as PcSession;
  const normalized = tokens.map((token) => token.toLowerCase()).join(' ');
  if (opts?.record !== false) {
    s.history.push(raw.trim());
    s.resolvedHistory.push(normalized);
  }

  if (normalized === 'show version') {
    return {
      session: s,
      output: [
        { kind: 'output', text: `Cisco ${s.platform}` },
        { kind: 'output', text: 'Operating mode       : CAPWAP lightweight access point' },
        { kind: 'output', text: 'Management interface : GigabitEthernet0' },
        { kind: 'output', text: 'Configuration owner  : Wireless LAN Controller' },
      ],
    };
  }

  if (normalized === 'show capwap client config' || normalized === 'show capwap client rcb') {
    const controller = Object.values(ctx?.lab.devices ?? {}).find(
      (device) => device.kind === 'pc' && device.wirelessController,
    );
    const controllerIp = controller?.kind === 'pc' ? controller.ip : null;
    return {
      session: s,
      output: [
        { kind: 'output', text: `AP Name                    : ${s.hostname}` },
        { kind: 'output', text: `AP IP Address              : ${s.ip ?? 'Unassigned'}` },
        { kind: 'output', text: `Primary Controller Address : ${controllerIp ?? 'Not discovered'}` },
        { kind: 'output', text: `CAPWAP State               : ${controllerIp ? 'Joined' : 'Discovery'}` },
        { kind: 'output', text: 'AP Mode                    : Local' },
      ],
    };
  }

  if (
    normalized === 'show interfaces wired' ||
    normalized === 'show interfaces gigabitethernet0' ||
    normalized === 'show interfaces'
  ) {
    return {
      session: s,
      output: [
        { kind: 'output', text: `GigabitEthernet0 is ${s.nicUp ? 'up' : 'down'}, line protocol is ${s.nicUp ? 'up' : 'down'}` },
        { kind: 'output', text: `  Internet address is ${s.ip ?? 'unassigned'}` },
        { kind: 'output', text: `  Subnet mask is ${s.mask ?? 'unassigned'}` },
        { kind: 'output', text: '  Hardware is Gigabit Ethernet, CAPWAP uplink' },
      ],
    };
  }

  return {
    session: s,
    output: errLine(`% Unrecognized command: ${tokens.join(' ')}`),
  };
}

function normalizeDnsRecords(records: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(records).map(([name, ip]) => [name.toLowerCase(), ip]),
  );
}

function requireWirelessController(s: PcSession): WirelessControllerState | null {
  return s.wirelessController ?? null;
}

function handleWlcConfig(
  s: PcSession,
  args: readonly string[],
): ApplyResult<PcSession> {
  const controller = requireWirelessController(s);
  if (!controller) return { session: s, output: errLine('% This is a wireless controller command. Select the WLC device to use it.') };
  if (args.length < 1) return { session: s, output: errLine('% Incomplete command.') };

  const [section, action, ...rest] = args;
  const sectionKey = section.toLowerCase();
  const actionKey = action?.toLowerCase();

  if (sectionKey === 'interface' && actionKey === 'create') {
    const [name, vlanRaw] = rest;
    const vlanId = Number(vlanRaw);
    if (!name || !Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094) {
      return { session: s, output: errLine('Usage: config interface create <name> <vlan-id>') };
    }
    controller.interfaces.set(name, { name, vlanId, configuredAt: nextEngineSeq() });
    return { session: s, output: [{ kind: 'output', text: `Interface ${name} created and mapped to VLAN ${vlanId}.` }] };
  }

  if (sectionKey === 'wlan' && actionKey === 'create') {
    const [idRaw, profile, ssid] = rest;
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id < 1 || id > 512 || !profile || !ssid) {
      return { session: s, output: errLine('Usage: config wlan create <wlan-id> <profile-name> <ssid>') };
    }
    controller.wlans.set(id, {
      id,
      profile,
      ssid,
      interfaceName: null,
      enabled: false,
      configuredAt: nextEngineSeq(),
      mappedAt: 0,
      enabledAt: 0,
    });
    return { session: s, output: [{ kind: 'output', text: `WLAN ${id} (${ssid}) created.` }] };
  }

  if (sectionKey === 'wlan' && actionKey === 'interface') {
    const [idRaw, interfaceName] = rest;
    const id = Number(idRaw);
    const wlan = controller.wlans.get(id);
    if (!Number.isInteger(id) || !interfaceName) {
      return { session: s, output: errLine('Usage: config wlan interface <wlan-id> <interface-name>') };
    }
    if (!wlan) return { session: s, output: errLine(`% WLAN ${id} does not exist.`) };
    if (!controller.interfaces.has(interfaceName)) {
      return { session: s, output: errLine(`% Interface ${interfaceName} does not exist.`) };
    }
    controller.wlans.set(id, { ...wlan, interfaceName, mappedAt: nextEngineSeq() });
    return { session: s, output: [{ kind: 'output', text: `WLAN ${id} mapped to interface ${interfaceName}.` }] };
  }

  if (sectionKey === 'wlan' && actionKey === 'enable') {
    const [idRaw] = rest;
    const id = Number(idRaw);
    const wlan = controller.wlans.get(id);
    if (!Number.isInteger(id)) return { session: s, output: errLine('Usage: config wlan enable <wlan-id>') };
    if (!wlan) return { session: s, output: errLine(`% WLAN ${id} does not exist.`) };
    if (!wlan.interfaceName) return { session: s, output: errLine(`% WLAN ${id} must be mapped to an interface before it can be enabled.`) };
    controller.wlans.set(id, { ...wlan, enabled: true, enabledAt: nextEngineSeq() });
    return { session: s, output: [{ kind: 'output', text: `WLAN ${id} enabled.` }] };
  }

  return { session: s, output: errLine('% Unsupported wireless controller config command.') };
}

function handleWlcShow(
  s: PcSession,
  args: readonly string[],
  _ctx: AdapterContext | undefined,
  opts: ApplyOptions | undefined,
): ApplyResult<PcSession> {
  const controller = requireWirelessController(s);
  if (!controller) return { session: s, output: errLine('% This is a wireless controller command. Select the WLC device to use it.') };
  if (args[0]?.toLowerCase() === 'client' && args[1]?.toLowerCase() === 'summary') {
    if (opts?.record !== false) controller.lastShowClientSummary = nextEngineSeq();
    return { session: s, output: renderClientSummary(controller) };
  }
  if (args[0]?.toLowerCase() !== 'wlan') return { session: s, output: errLine('% Unsupported show command.') };

  const selector = args[1]?.toLowerCase();
  if (selector === 'summary') {
    if (opts?.record !== false) controller.lastShowWlanSummary = nextEngineSeq();
    return { session: s, output: renderWlanSummary(controller) };
  }

  const id = Number(args[1]);
  if (!Number.isInteger(id)) return { session: s, output: errLine('Usage: show wlan summary or show wlan <wlan-id>') };
  const wlan = controller.wlans.get(id);
  if (!wlan) return { session: s, output: errLine(`% WLAN ${id} does not exist.`) };
  if (opts?.record !== false) controller.lastShowWlanDetail.set(id, nextEngineSeq());
  return { session: s, output: renderWlanDetail(controller, wlan) };
}

function renderWlanSummary(controller: WirelessControllerState): CommandOutput[] {
  const lines: CommandOutput[] = [
    { kind: 'output', text: 'WLAN ID  Profile     SSID        Status    Interface   VLAN' },
    { kind: 'output', text: '-------  ----------  ----------  --------  ----------  ----' },
  ];
  for (const wlan of [...controller.wlans.values()].sort((a, b) => a.id - b.id)) {
    const iface = wlan.interfaceName ?? '(none)';
    const vlan = wlan.interfaceName ? controller.interfaces.get(wlan.interfaceName)?.vlanId.toString() ?? '(none)' : '(none)';
    lines.push({
      kind: 'output',
      text: `${wlan.id.toString().padEnd(7)}  ${wlan.profile.padEnd(10)}  ${wlan.ssid.padEnd(10)}  ${(wlan.enabled ? 'Enabled' : 'Disabled').padEnd(8)}  ${iface.padEnd(10)}  ${vlan}`,
    });
  }
  return lines;
}

function renderWlanDetail(controller: WirelessControllerState, wlan: WirelessLan): CommandOutput[] {
  const iface = wlan.interfaceName ?? '(none)';
  const vlan = wlan.interfaceName ? controller.interfaces.get(wlan.interfaceName)?.vlanId.toString() ?? '(none)' : '(none)';
  return [
    { kind: 'output', text: `WLAN Identifier        : ${wlan.id}` },
    { kind: 'output', text: `Profile Name           : ${wlan.profile}` },
    { kind: 'output', text: `SSID                   : ${wlan.ssid}` },
    { kind: 'output', text: `Status                 : ${wlan.enabled ? 'Enabled' : 'Disabled'}` },
    { kind: 'output', text: `Interface              : ${iface}` },
    { kind: 'output', text: `VLAN                   : ${vlan}` },
  ];
}

function renderClientSummary(controller: WirelessControllerState): CommandOutput[] {
  const lines: CommandOutput[] = [
    { kind: 'output', text: 'Client           WLAN  SSID        Interface   VLAN  Status' },
    { kind: 'output', text: '---------------  ----  ----------  ----------  ----  -------------' },
  ];
  const wlan = controller.wlans.get(1);
  if (!wlan) {
    lines.push({ kind: 'output', text: 'Wireless-Client  -     (none)      (none)      -     WLAN missing' });
    return lines;
  }
  const ifaceName = wlan.interfaceName ?? '(none)';
  const vlan = wlan.interfaceName ? controller.interfaces.get(wlan.interfaceName)?.vlanId.toString() ?? '-' : '-';
  const status = wlan.enabled ? 'Ready' : 'WLAN disabled';
  lines.push({
    kind: 'output',
    text: `Wireless-Client  ${wlan.id.toString().padEnd(4)}  ${wlan.ssid.padEnd(10)}  ${ifaceName.padEnd(10)}  ${vlan.padEnd(4)}  ${status}`,
  });
  return lines;
}

function handleSsh(
  s: PcSession,
  args: readonly string[],
  ctx: AdapterContext | undefined,
  opts: ApplyOptions | undefined,
): ApplyResult<PcSession> {
  const parsed = parseSshTarget(args);
  if (!parsed) {
    return {
      session: s,
      output: errLine('usage: ssh <user>@<ip> or ssh <ip> -l <user>'),
    };
  }
  if (!s.nicUp) {
    if (opts?.record !== false) s.lastSsh = { target: parsed.host, user: parsed.user, ok: false };
    return {
      session: s,
      output: [{ kind: 'error', text: `ssh: connect to host ${parsed.host} port 22: Network is unreachable` }],
    };
  }
  if (!ctx?.lab) {
    if (opts?.record !== false) s.lastSsh = { target: parsed.host, user: parsed.user, ok: false };
    return {
      session: s,
      output: [
        { kind: 'output', text: `Connecting to ${parsed.host} as ${parsed.user}...` },
        { kind: 'system', text: '[sim] SSH requires a lab context for router login policy validation.' },
        { kind: 'error', text: `ssh: connect to host ${parsed.host} port 22: Connection refused` },
      ],
    };
  }

  const targetRouter = findRouterByInterfaceIp(ctx.lab, parsed.host);
  const reachable = canReach(ctx.lab, s.id, parsed.host, undefined, 'tcp');
  const vtyDenied = targetRouter && reachable.ok ? vtyAccessClassDenyReason(targetRouter, s.ip) : null;
  const ok = Boolean(targetRouter && reachable.ok && isRouterSshReady(targetRouter, parsed.user) && !vtyDenied);
  if (opts?.record !== false) s.lastSsh = { target: parsed.host, user: parsed.user, ok };

  if (ok && targetRouter) {
    return {
      session: s,
      output: [
        { kind: 'output', text: `Connecting to ${parsed.host} as ${parsed.user}...` },
        { kind: 'output', text: 'Password authentication accepted.' },
        { kind: 'output', text: `${targetRouter.device.hostname}#` },
      ],
    };
  }

  const reason = !targetRouter
    ? '[sim] No router interface owns that management IP.'
    : !reachable.ok
      ? `[sim] ${failureDetail(reachable.failedAt, parsed.host)}`
      : vtyDenied
        ? `[sim] ${vtyDenied}`
        : '[sim] SSH is not ready: configure a local user, domain name, RSA key, `login local`, and `transport input ssh`.';
  return {
    session: s,
    output: [
      { kind: 'output', text: `Connecting to ${parsed.host} as ${parsed.user}...` },
      { kind: 'system', text: reason },
      { kind: 'error', text: `ssh: connect to host ${parsed.host} port 22: Connection refused` },
    ],
  };
}


function findRouterByInterfaceIp(lab: LabSession, ip: string): RouterSession | null {
  for (const dev of Object.values(lab.devices)) {
    if (dev.kind !== 'router') continue;
    if (Object.values(dev.device.interfaces).some((iface) => iface.ip === ip)) return dev;
  }
  return null;
}

function isRouterSshReady(router: RouterSession, username: string): boolean {
  const sec = router.device.security;
  return Boolean(
    sec.domainName &&
      sec.enableSecret &&
      sec.users.has(username) &&
      sec.cryptoKeyModulus !== null &&
      sec.vtyLoginLocal &&
      sec.vtyTransportInput === 'ssh',
  );
}

function vtyAccessClassDenyReason(router: RouterSession, sourceIp: string | null): string | null {
  const aclNumber = router.device.security.vtyAccessClassIn;
  if (aclNumber === null) return null;
  if (!sourceIp) return `VTY access-class ${aclNumber} denies an unknown source.`;
  const acl = router.device.acls.get(aclNumber);
  if (!acl || evaluateAcl(acl, sourceIp, 'tcp', '0.0.0.0') !== 'permit') {
    return `VTY access-class ${aclNumber} denies ${sourceIp}.`;
  }
  return null;
}

function parseSshTarget(args: readonly string[]): { user: string; host: string } | null {
  if (args.length === 0) return null;
  const first = args[0];
  if (first.includes('@')) {
    const [user, host] = first.split('@');
    if (user && isValidIpv4(host)) return { user, host };
    return null;
  }
  const lIndex = args.findIndex((arg) => arg.toLowerCase() === '-l');
  if (isValidIpv4(first) && lIndex !== -1 && args[lIndex + 1]) {
    return { host: first, user: args[lIndex + 1] };
  }
  return null;
}

function handleClear(s: PcSession): ApplyResult<PcSession> {
  // Empty output — the terminal frontend handles screen-clear independently
  // when it sees no lines to append; same behavior as the prior switch case.
  return { session: s, output: [] };
}

function powershellArg(args: readonly string[], name: string): string | null {
  const idx = args.findIndex((arg) => arg.toLowerCase() === name.toLowerCase());
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function handleNewNetIpAddress(
  s: PcSession,
  args: readonly string[],
): ApplyResult<PcSession> {
  const iface = powershellArg(args, '-InterfaceAlias');
  const ip = powershellArg(args, '-IPAddress');
  const prefixLength = powershellArg(args, '-PrefixLength');
  const defaultGateway = powershellArg(args, '-DefaultGateway');

  if (!iface || !ip || !prefixLength || !defaultGateway) {
    return {
      session: s,
      output: errLine('Usage: New-NetIPAddress -InterfaceAlias Eth0 -IPAddress <ipv6> -PrefixLength <n> -DefaultGateway <ipv6>'),
    };
  }
  if (iface !== s.nic) {
    return { session: s, output: errLine(`Interface alias '${iface}' does not exist. Use ${s.nic}.`) };
  }
  const prefix = `${ip.toLowerCase()}/${prefixLength}`;
  if (!isValidIpv6Prefix(prefix)) return { session: s, output: errLine(`% Invalid IPv6 address/prefix: ${ip}/${prefixLength}`) };
  const gateway = defaultGateway.toLowerCase();
  if (!gateway.includes(':') || !/^[0-9a-f:]+$/i.test(gateway)) {
    return { session: s, output: errLine(`% Invalid IPv6 default gateway: ${defaultGateway}`) };
  }
  s.ipv6 = prefix;
  s.gateway6 = gateway;
  return { session: s, output: [] };
}

function handleIpv6(
  s: PcSession,
  args: readonly string[],
): ApplyResult<PcSession> {
  if (args.length < 1) return { session: s, output: errLine('% Incomplete command.') };
  const prefix = args[0].toLowerCase();
  if (!isValidIpv6Prefix(prefix)) return { session: s, output: errLine(`% Invalid IPv6 address/prefix: ${args[0]}`) };
  s.ipv6 = prefix;
  return { session: s, output: [] };
}

function handleGateway6(
  s: PcSession,
  args: readonly string[],
): ApplyResult<PcSession> {
  if (args.length < 1) return { session: s, output: errLine('% Incomplete command.') };
  const gateway = args[0].toLowerCase();
  if (!gateway.includes(':') || !/^[0-9a-f:]+$/i.test(gateway)) {
    return { session: s, output: errLine(`% Invalid IPv6 address: ${args[0]}`) };
  }
  s.gateway6 = gateway;
  return { session: s, output: [] };
}

function handleRoute(
  s: PcSession,
  args: readonly string[],
): ApplyResult<PcSession> {
  if (args.length !== 1 || args[0].toLowerCase() !== 'print') {
    return { session: s, output: errLine('Usage: route print') };
  }
  return { session: s, output: renderRoutePrint(s) };
}

function handleNslookup(
  s: PcSession,
  args: readonly string[],
): ApplyResult<PcSession> {
  const hostname = args[0]?.toLowerCase();
  if (!hostname) return { session: s, output: errLine('Usage: nslookup <hostname>') };
  const server = s.dnsServers[0];
  if (!server) {
    return { session: s, output: errLine(`*** No DNS servers are configured for ${s.hostname}`) };
  }
  const ip = s.dnsRecords[hostname];
  if (!ip) {
    return {
      session: s,
      output: [
        { kind: 'output', text: `Server:  ${server}` },
        { kind: 'output', text: '' },
        { kind: 'error', text: `*** ${server} can't find ${hostname}: Non-existent domain` },
      ],
    };
  }
  return {
    session: s,
    output: [
      { kind: 'output', text: `Server:  ${server}` },
      { kind: 'output', text: '' },
      { kind: 'output', text: `Name:    ${hostname}` },
      { kind: 'output', text: `Address: ${ip}` },
    ],
  };
}

function handleArp(
  s: PcSession,
  args: readonly string[],
): ApplyResult<PcSession> {
  if (args.length !== 1 || args[0].toLowerCase() !== '-a') {
    return { session: s, output: errLine('Usage: arp -a') };
  }
  return { session: s, output: renderArp(s) };
}

function handlePing(
  s: PcSession,
  args: readonly string[],
  ctx: AdapterContext | undefined,
  opts: ApplyOptions | undefined,
): ApplyResult<PcSession> {
  if (args.length < 1) return { session: s, output: errLine('% Incomplete command.') };
  const requestedTarget = args[0];
  const resolvedTarget = resolvePingTarget(s, requestedTarget);
  if (!resolvedTarget) {
    return {
      session: s,
      output: errLine(`Ping request could not find host ${requestedTarget}. Please check the name and try again.`),
    };
  }
  if (!ctx?.lab) {
    return { session: s, output: errLine('Ping requires a lab context.') };
  }
  // Ping is ICMP — pass the protocol so extended `deny icmp` ACLs (Lab 12)
  // fire. Standard ACLs ignore the protocol arg, so this is backward-safe.
  const result = canReach(ctx.lab, s.id, resolvedTarget.ip, undefined, 'icmp');
  if (result.ok) learnArpForPing(s, resolvedTarget.ip);
  // Record the ping outcome so reachability objectives can require an ACTUAL
  // ping from the learner (not just state-permits-reachability). Gated on
  // record:false so a seeded ping (Lab.setup) couldn't pre-satisfy a
  // verification objective — same contract as history.
  if (opts?.record !== false) {
    s.lastPing = { target: requestedTarget, ok: result.ok };
  }
  return { session: s, output: renderPing(result, resolvedTarget.ip, resolvedTarget.name) };
}

function resolvePingTarget(s: PcSession, target: string): { ip: string; name?: string } | null {
  if (isValidIpv4(target)) return { ip: target };
  const name = target.toLowerCase();
  const ip = s.dnsRecords[name];
  if (!ip || !isValidIpv4(ip)) return null;
  return { ip, name };
}

function learnArpForPing(s: PcSession, targetIp: string): void {
  if (!s.ip || !s.mask) return;
  const arpIp = ipInSubnet(targetIp, s.ip, s.mask) ? targetIp : s.gateway;
  if (!arpIp || arpIp === s.ip) return;
  s.arpCache[arpIp] = macAddressFor(arpIp);
}

/**
 * tracert / traceroute — walk the forward path hop by hop, then per-hop
 * test reachability via canReach. A working path lists each hop IP and ends
 * with "Trace complete." A broken path shows the hops that succeed, the
 * hop where it dies, then timeouts up to MAX_HOPS, and a final muted
 * `[sim] ...` annotation that prints the SAME failure sentence the ping
 * handler emits. The shared `failureSentence` keeps the two in lockstep.
 *
 * Output is split: the header (Tracing route…) is sync; hop rows + the
 * trailing summary stream out one at a time with HOP_DELAY_MS between each
 * so the trace reads as activity, not a wall of text. Discovery + grading
 * are fully synchronous — the stream is presentation only, so the engine
 * stays deterministic and testable.
 *
 * Deterministic: hop chain is derived from current routing tables (no
 * randomness, no real ICMP) and RTTs are always "<1 ms". A single probe per
 * hop, not three — the curated lab does not need the realism of three
 * RTT columns and the extra width hurt the embedded terminal at 520px.
 *
 * MAX_HOPS = 8: large enough to convey "many timeouts after the dead hop"
 * for any pedagogical CCNA topology (largest in roadmap is ~6 routers),
 * small enough not to spam 30 timeout rows past the terminal scrollback.
 * Real Windows tracert defaults to 30; our lower bound is a UX choice for
 * the embedded terminal, NOT a semantic change.
 */
const MAX_HOPS = 8;
let hopDelayMs = 150;

/** Test-only: override the inter-hop streaming delay (default 150ms). The
 *  cadence is presentation, not engine logic — running tests with delay=0
 *  exercises the streaming path without paying ~150ms per hop. NEVER call
 *  from production code; only the engine's adapter tests need this. */
export function __setTracertDelayMs(ms: number): void {
  hopDelayMs = ms;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function handleTracert(
  s: PcSession,
  args: readonly string[],
  ctx: AdapterContext | undefined,
): ApplyResult<PcSession> {
  if (args.length < 1) return { session: s, output: errLine('% Incomplete command.') };
  const target = args[0];
  if (!isValidIpv4(target)) {
    return {
      session: s,
      output: errLine(`Tracert target '${target}' is not a valid IPv4 address.`),
    };
  }
  if (!ctx?.lab) {
    return { session: s, output: errLine('Tracert requires a lab context.') };
  }

  const header: CommandOutput[] = [
    { kind: 'output', text: '' },
    { kind: 'output', text: `Tracing route to ${target} over a maximum of ${MAX_HOPS} hops:` },
    { kind: 'output', text: '' },
  ];

  // Pre-compute the entire output tail synchronously. The session state is
  // a snapshot at command-issue time; resolving hops lazily mid-stream
  // would let an unrelated state change (e.g., user editing R1 in another
  // tab) reshape an in-flight trace, which would be confusing.
  const tail = computeTracertTail(ctx.lab, s.id, target);

  return {
    session: s,
    output: header,
    stream: streamLines(tail, hopDelayMs),
  };
}

/** Walk the topology, render hops + summary + optional [sim] line. Pure. */
function computeTracertTail(
  lab: LabSession,
  fromPcId: string,
  target: string,
): CommandOutput[] {
  const discovery = discoverHops(lab, fromPcId, target);
  const hops = 'hops' in discovery ? discovery.hops : [];
  const walkFailedAt = 'failedAt' in discovery ? discovery.failedAt : null;

  const out: CommandOutput[] = [];
  let traceCompleted = false;
  let firstFailedAt: FailPoint | null = null;

  for (let i = 0; i < MAX_HOPS; i++) {
    const hopNum = i + 1;
    const hop = hops[i];

    if (!hop) {
      // No topological hop at this position — either the walk failed
      // earlier (walkFailedAt set) or we've already exhausted the chain
      // without reaching the destination. Print a timeout row.
      out.push({ kind: 'error', text: formatTimeoutRow(hopNum) });
      continue;
    }

    // Per-hop reachability test uses canReach so timeouts include
    // return-side failures (the missing-return-route scenario won't show
    // up in the topological walk — the route exists going OUT — but the
    // ICMP reply can't get back, so canReach to that hop returns false).
    // tracert is itself ICMP (Windows default) — pass the protocol so any
    // extended `deny icmp` ACL (Lab 12) blocks the trace identically to ping.
    const result = canReach(lab, fromPcId, hop.hopIp, undefined, 'icmp');
    if (result.ok) {
      out.push({ kind: 'output', text: formatHopRow(hopNum, hop.hopIp) });
      if (hop.isDestination) {
        traceCompleted = true;
        break;
      }
    } else {
      out.push({ kind: 'error', text: formatTimeoutRow(hopNum) });
      if (firstFailedAt === null) firstFailedAt = result.failedAt;
    }
  }

  out.push({ kind: 'output', text: '' });
  if (traceCompleted) {
    out.push({ kind: 'output', text: 'Trace complete.' });
  } else {
    out.push({ kind: 'error', text: 'Trace did not complete.' });
    // Prefer the walk's failedAt (earliest known failure on the forward
    // path) over per-hop firstFailedAt — they should agree for forward-only
    // breaks, but the walk's reason is canonical for cases like egress-down
    // where canReach to the destination would report the same thing. The
    // sentence is rendered as a `[sim]` system line so the learner can tell
    // the diagnosis apart from raw tool output — it's the simulator
    // narrating, not Windows.
    const reason = walkFailedAt ?? firstFailedAt;
    if (reason) {
      out.push({ kind: 'system', text: `[sim] ${failureDetail(reason, target)}` });
    }
  }

  return out;
}

async function* streamLines(
  lines: readonly CommandOutput[],
  delayMs: number,
): AsyncIterable<CommandOutput> {
  for (const line of lines) {
    await sleep(delayMs);
    yield line;
  }
}

/** Single probe column (`<1 ms`), not the Windows three-column default —
 *  the lab terminal must stay readable at ~520px; three RTT columns wrap. */
function formatHopRow(hopNum: number, ip: string): string {
  return `${hopNum.toString().padStart(3)}    <1 ms  ${ip}`;
}

function formatTimeoutRow(hopNum: number): string {
  return `${hopNum.toString().padStart(3)}    *      Request timed out.`;
}

// ---------------------------------------------------------------------------
// Hop discovery (tracert support) — topological forward walk
// ---------------------------------------------------------------------------

interface Hop {
  readonly hopIp: string;
  readonly isDestination: boolean;
}
type HopDiscovery =
  | { readonly hops: Hop[] }
  | { readonly failedAt: FailPoint; readonly hops: Hop[] };

/**
 * Enumerate the hop IPs a packet from `fromPcId` WOULD pass through to
 * reach `dstIp`. Structurally mirrors canReach's forward walk
 * (reachability.ts §4): same FailReasons, same order of checks, same place
 * names. The return shape is richer (per-hop IPs + failure point) because
 * the tracert UI needs both, which is why this isn't a refactor of
 * canReach — that contract stays a pure boolean evaluator.
 *
 * Critical: this MUST keep parity with canReach's forward walk. If a route
 * dies somewhere (e.g., egress admin-down), canReach reports egress-down
 * naming the egress interface — and so must we. The egress-down vs
 * no-route bug class is the exact "don't dress one failure as another"
 * trap from LAB_AUTHORING §4; if these two walks drift, tracert's final
 * line will print a different FailReason from the ping, confusing the
 * learner about which diagnosis applies. The cross-test (tracert on the
 * egress-down lab) pins this symmetry.
 */
function discoverHops(
  session: LabSession,
  fromPcId: string,
  dstIp: string,
): HopDiscovery {
  // tracert is ICMP — match the ping path so extended ACL deny icmp entries
  // surface here too (Lab 12). canReach calls in the per-hop loop above use
  // the same protocol; this constant feeds the in-walk aclCheck calls below.
  const protocol = 'icmp';

  const pc = session.devices[fromPcId];
  if (!pc || pc.kind !== 'pc') {
    return { hops: [], failedAt: fp('forward', fromPcId, null, 'source-no-ip') };
  }
  if (!pc.ip || !pc.mask) {
    return { hops: [], failedAt: fp('forward', pc.id, null, 'source-no-ip') };
  }
  if (!pc.nicUp) {
    return { hops: [], failedAt: fp('forward', pc.id, null, 'source-nic-down') };
  }

  const localNet = networkAddress(pc.ip, pc.mask);
  if (ipInSubnet(dstIp, localNet, pc.mask)) {
    // Destination on the PC's own subnet — no router hops, just delivery.
    return { hops: [{ hopIp: dstIp, isDestination: true }] };
  }

  if (!pc.gateway || !ipInSubnet(pc.gateway, localNet, pc.mask)) {
    return { hops: [], failedAt: fp('forward', pc.id, null, 'no-gateway') };
  }

  const link = findLink(session, pc.id, pc.nic);
  if (!link) {
    return { hops: [], failedAt: fp('forward', pc.id, null, 'source-nic-down') };
  }
  const peerEnd = otherEndOf(link, pc.id, pc.nic);
  const peer = session.devices[peerEnd.deviceId];
  if (!peer) {
    return { hops: [], failedAt: fp('forward', pc.id, null, 'source-nic-down') };
  }

  // First router hop. For PC cabled to a router, the gateway IS the cabled
  // interface; for PC cabled to a switch (Lab 09), walk the switch L2
  // broadcast domain on the PC's access VLAN to find the router subif that
  // owns the gateway IP. Both cases collapse to "first hop = a router; first
  // hop IP = the gateway IP that's printed at row 1 of the trace".
  let firstRouter: RouterSession;
  let firstIngressIface: string;
  let firstHopIp: string;
  if (peer.kind === 'router') {
    const peerIface = peer.device.interfaces[peerEnd.iface];
    if (!peerIface || !peerIface.adminUp || !peerIface.ip) {
      return { hops: [], failedAt: fp('forward', pc.id, null, 'source-nic-down') };
    }
    firstRouter = peer;
    firstIngressIface = peerEnd.iface;
    firstHopIp = peerIface.ip;
  } else if (peer.kind === 'switch') {
    const swPort = peer.device.switchports[peerEnd.iface];
    if (!swPort || !swPort.adminUp || swPort.mode !== 'access') {
      return { hops: [], failedAt: fp('forward', pc.id, null, 'no-gateway') };
    }
    const gw = findRouterGatewayThroughSwitch(
      session,
      peer.device.id,
      swPort.accessVlan,
      pc.gateway,
    );
    if (!gw) {
      return { hops: [], failedAt: fp('forward', pc.id, null, 'no-gateway') };
    }
    firstRouter = gw.router;
    firstIngressIface = gw.routerParentIface;
    firstHopIp = pc.gateway;
  } else {
    return { hops: [], failedAt: fp('forward', pc.id, null, 'source-nic-down') };
  }

  const hops: Hop[] = [{ hopIp: firstHopIp, isDestination: false }];

  let current: RouterSession = firstRouter;
  let ingressIfaceId: string | null = firstIngressIface;
  const sourceIp = pc.ip;
  const limit = Object.keys(session.devices).length + 2;

  for (let i = 0; i < limit; i++) {
    const currentId = current.device.id;

    // Inbound ACL on the arrival interface mirrors canReach. Drift here
    // would print a different `[sim]` line in the tracert summary than the
    // ping shows — LAB_AUTHORING §4 warns against exactly that.
    if (ingressIfaceId !== null) {
      const inIface = current.device.interfaces[ingressIfaceId];
      if (inIface) {
        const denied = aclCheck(current, inIface, sourceIp, dstIp, protocol, 'in');
        if (denied) return { hops, failedAt: denied };
      }
    }

    const route = longestPrefixMatch(routingTable(current), dstIp);
    if (!route) {
      return { hops, failedAt: fp('forward', currentId, null, 'no-route') };
    }

    let egressIfaceId: string | null = route.egressIface ?? null;
    if (egressIfaceId === null && route.nextHop) {
      egressIfaceId = findEgressForNextHop(current, route.nextHop);
    }
    if (!egressIfaceId) {
      return { hops, failedAt: fp('forward', currentId, null, 'next-hop-unreachable') };
    }

    // Subif egress mirrors canReach: validate subif + parent, then use the
    // parent for the cable lookup. Connected dst on the subif's subnet is
    // handled below as a destination delivery — no extra physical hop is
    // printed in the trace, the next hop IS the destination.
    let egressSubif: SubInterface | null = null;
    let egressIface: InterfaceState | undefined;
    if (isSubInterfaceId(egressIfaceId)) {
      egressSubif = current.device.subInterfaces[egressIfaceId] ?? null;
      if (!egressSubif) {
        return { hops, failedAt: fp('forward', currentId, egressIfaceId, 'no-route') };
      }
      if (egressSubif.dot1qVlan === null) {
        return { hops, failedAt: fp('forward', currentId, egressIfaceId, 'no-route') };
      }
      // Subif line state follows the parent — the parent admin check below is
      // the egress-down lever (a subif has no independent admin state). Mirrors
      // reachability.ts.
      const parent = current.device.interfaces[egressSubif.parentId];
      if (!parent || !parent.adminUp) {
        return { hops, failedAt: fp('forward', currentId, egressSubif.parentId, 'egress-down') };
      }
      egressIface = parent;
    } else {
      egressIface = current.device.interfaces[egressIfaceId];
      // Egress admin-down BEFORE everything else — keeps the egress-down
      // FailReason canonical (matches canReach §4). If we crossed the link
      // anyway, the per-hop canReach below would diagnose the broken next-
      // hop reachability as no-route instead, and the trace's final
      // sentence would drift from the ping's.
      if (!egressIface || !egressIface.adminUp) {
        return { hops, failedAt: fp('forward', currentId, egressIfaceId, 'egress-down') };
      }
    }

    // Validate the next-hop sits inside the egress subnet.
    if (route.nextHop && egressIface.ip && egressIface.mask) {
      const egressNet = networkAddress(egressIface.ip, egressIface.mask);
      if (!ipInSubnet(route.nextHop, egressNet, egressIface.mask)) {
        return { hops, failedAt: fp('forward', currentId, egressIfaceId, 'next-hop-unreachable') };
      }
    }

    // Outbound ACL on the egress mirrors canReach. Evaluated before
    // delivery / link crossing so the failure names the forwarding router.
    {
      const denied = aclCheck(current, egressIface, sourceIp, dstIp, protocol, 'out');
      if (denied) return { hops, failedAt: denied };
    }

    // Connected route AND dst on this subnet ⇒ destination is on this link.
    // For subif egress the subnet is on the subif (parent has no IP); validate
    // the trunk + walk to the access port, then push dst as the final hop.
    if (egressSubif) {
      const subif = egressSubif;
      if (subif.ip && subif.mask) {
        const ourNet = networkAddress(subif.ip, subif.mask);
        if (ipInSubnet(dstIp, ourNet, subif.mask)) {
          const trunkResult = subifEgressToDelivery(session, current, subif, egressIface, dstIp);
          if (!trunkResult.ok) {
            return { hops, failedAt: trunkResult.failedAt };
          }
          hops.push({ hopIp: dstIp, isDestination: true });
          return { hops };
        }
      }
      // Multi-router-on-a-stick (dst not on this subif's subnet) — not modeled.
      return { hops, failedAt: fp('forward', currentId, egressIfaceId, 'no-route') };
    }
    if (route.source === 'connected' && egressIface.ip && egressIface.mask) {
      const ourNet = networkAddress(egressIface.ip, egressIface.mask);
      if (ipInSubnet(dstIp, ourNet, egressIface.mask)) {
        hops.push({ hopIp: dstIp, isDestination: true });
        return { hops };
      }
    }

    const nextLink = findLink(session, currentId, egressIfaceId);
    if (!nextLink) {
      return { hops, failedAt: fp('forward', currentId, egressIfaceId, 'link-peer-down') };
    }
    const nextPeerEnd = otherEndOf(nextLink, currentId, egressIfaceId);
    const nextPeer = session.devices[nextPeerEnd.deviceId];
    if (!nextPeer) {
      return { hops, failedAt: fp('forward', currentId, egressIfaceId, 'link-peer-down') };
    }

    if (peerOwnsDst(nextPeer, dstIp)) {
      hops.push({ hopIp: dstIp, isDestination: true });
      return { hops };
    }

    if (nextPeer.kind !== 'router') {
      return { hops, failedAt: fp('forward', currentId, egressIfaceId, 'dest-unreachable') };
    }

    const nextPeerIface = nextPeer.device.interfaces[nextPeerEnd.iface];
    if (!nextPeerIface || !nextPeerIface.adminUp) {
      return { hops, failedAt: fp('forward', currentId, egressIfaceId, 'link-peer-down') };
    }
    if (
      egressIface.ip &&
      egressIface.mask &&
      nextPeerIface.ip &&
      nextPeerIface.mask
    ) {
      const ourNet = networkAddress(egressIface.ip, egressIface.mask);
      const peerNet = networkAddress(nextPeerIface.ip, nextPeerIface.mask);
      if (ourNet !== peerNet) {
        return { hops, failedAt: fp('forward', currentId, egressIfaceId, 'link-subnet-mismatch') };
      }
    }

    if (!nextPeerIface.ip) {
      return { hops, failedAt: fp('forward', currentId, egressIfaceId, 'link-peer-down') };
    }
    hops.push({ hopIp: nextPeerIface.ip, isDestination: false });
    current = nextPeer;
    ingressIfaceId = nextPeerEnd.iface;
  }

  return { hops, failedAt: fp('forward', current.device.id, null, 'routing-loop') };
}

function fp(
  direction: 'forward' | 'return',
  deviceId: string,
  iface: string | null,
  reason: FailReason,
): FailPoint {
  return { direction, deviceId, iface, reason };
}

/** Mirror of reachability.findGatewayThroughSwitch — keeps the tracert PC→
 *  router lookup in lockstep with the ping path. Returns the router whose
 *  dot1Q subif owns gatewayIp on the matching access VLAN, reached over
 *  switch trunks from `srcSwitchId`. */
function findRouterGatewayThroughSwitch(
  session: LabSession,
  srcSwitchId: string,
  vlan: number,
  gatewayIp: string,
): { router: RouterSession; routerParentIface: string } | null {
  const visited = new Set<string>([srcSwitchId]);
  const queue: string[] = [srcSwitchId];
  while (queue.length > 0) {
    const swId = queue.shift()!;
    const sw = session.devices[swId];
    if (!sw || sw.kind !== 'switch') continue;
    for (const link of session.links) {
      let myIface: string;
      let peerEnd: { deviceId: string; iface: string };
      if (link.a.deviceId === swId) {
        myIface = link.a.iface;
        peerEnd = { deviceId: link.b.deviceId, iface: link.b.iface };
      } else if (link.b.deviceId === swId) {
        myIface = link.b.iface;
        peerEnd = { deviceId: link.a.deviceId, iface: link.a.iface };
      } else continue;

      const myPort = sw.device.switchports[myIface];
      // protocolUp (not adminUp) gates the trunk hop — a shut on either end
      // drops it. Matches reachability.trunkHopUp so ping and tracert agree
      // on the ROAS trunk path (ping/tracert mirror-parity invariant).
      if (!myPort || !myPort.protocolUp) continue;
      const peer = session.devices[peerEnd.deviceId];
      if (!peer) continue;

      if (peer.kind === 'router') {
        if (myPort.mode !== 'trunk') continue;
        if (!trunkAllowsVlan(myPort.trunkAllowedVlans, vlan)) continue;
        const parent = peer.device.interfaces[peerEnd.iface];
        if (!parent || !parent.adminUp) continue;
        for (const sub of Object.values(peer.device.subInterfaces)) {
          if (sub.parentId !== peerEnd.iface) continue;
          if (sub.dot1qVlan !== vlan) continue;
          if (sub.ip !== gatewayIp) continue;
          if (!sub.protocolUp) continue;
          return { router: peer, routerParentIface: peerEnd.iface };
        }
        continue;
      }
      if (peer.kind === 'switch') {
        if (visited.has(peer.device.id)) continue;
        if (myPort.mode !== 'trunk') continue;
        if (!trunkAllowsVlan(myPort.trunkAllowedVlans, vlan)) continue;
        const peerPort = peer.device.switchports[peerEnd.iface];
        if (!peerPort || peerPort.mode !== 'trunk') continue;
        if (!trunkAllowsVlan(peerPort.trunkAllowedVlans, vlan)) continue;
        visited.add(peer.device.id);
        queue.push(peer.device.id);
      }
    }
  }
  return null;
}

/** Subif egress at the last hop: validate the cabled switch trunk allows the
 *  dot1Q tag and the destination's access port is on the same VLAN. Returns
 *  ok on a clean trunk path, fail with a meaningful FailPoint otherwise.
 *  Mirrors reachability.deliverViaSubifTrunk — keeping the tracert summary
 *  consistent with the ping summary (LAB_AUTHORING §4). */
function subifEgressToDelivery(
  session: LabSession,
  router: RouterSession,
  subif: SubInterface,
  parent: InterfaceState,
  dstIp: string,
):
  | { ok: true }
  | { ok: false; failedAt: FailPoint } {
  const link = findLink(session, router.device.id, parent.id);
  if (!link) {
    return { ok: false, failedAt: fp('forward', router.device.id, parent.id, 'link-peer-down') };
  }
  const peerEnd = otherEndOf(link, router.device.id, parent.id);
  const peer = session.devices[peerEnd.deviceId];
  if (!peer) {
    return { ok: false, failedAt: fp('forward', router.device.id, parent.id, 'link-peer-down') };
  }
  if (peer.kind !== 'switch') {
    return { ok: false, failedAt: fp('forward', router.device.id, parent.id, 'dest-unreachable') };
  }
  const trunkPort = peer.device.switchports[peerEnd.iface];
  // protocolUp (not adminUp): the router→switch trunk hop is usable only when
  // the line protocol is up on both ends. Mirrors reachability.deliverViaSubifTrunk
  // so ping and tracert agree on the ROAS trunk path.
  if (!trunkPort || !trunkPort.protocolUp) {
    return { ok: false, failedAt: fp('forward', router.device.id, parent.id, 'link-peer-down') };
  }
  const tag = subif.dot1qVlan!;
  if (trunkPort.mode !== 'trunk') {
    return {
      ok: false,
      failedAt: {
        direction: 'forward',
        deviceId: peer.device.id,
        iface: peerEnd.iface,
        reason: 'trunk-not-configured',
        trunk: {
          aDevice: router.device.id,
          aIface: parent.id,
          bDevice: peer.device.id,
          bIface: peerEnd.iface,
        },
      },
    };
  }
  if (!trunkAllowsVlan(trunkPort.trunkAllowedVlans, tag)) {
    return {
      ok: false,
      failedAt: {
        direction: 'forward',
        deviceId: peer.device.id,
        iface: peerEnd.iface,
        reason: 'vlan-not-allowed',
        vlanAllow: { vlanId: tag },
      },
    };
  }
  // Destination must be a PC with an access port on the same VLAN reachable
  // from this switch. We don't render the switch hop in the trace — that's
  // L2 transit, not an L3 hop — but we still validate the path.
  const dstOwner = findOwnerOfIp(session, dstIp);
  if (!dstOwner || dstOwner.kind !== 'pc') {
    return { ok: false, failedAt: fp('forward', peer.device.id, null, 'dest-unreachable') };
  }
  return { ok: true };
}

function findOwnerOfIp(session: LabSession, ip: string): DeviceSession | null {
  for (const s of Object.values(session.devices)) {
    if (s.kind === 'pc') {
      if (s.ip === ip) return s;
      continue;
    }
    if (s.kind === 'switch') continue;
    for (const i of Object.values(s.device.interfaces)) {
      if (i.ip === ip) return s;
    }
    for (const sub of Object.values(s.device.subInterfaces)) {
      if (sub.ip === ip) return s;
    }
  }
  return null;
}

/** Match canReach's ACL hook (reachability.checkInterfaceAcl) — tracert MUST
 *  surface the same acl-deny FailPoint canReach does so the `[sim]` trailer
 *  reads the same sentence as the ping. Pure: returns the FailPoint on deny,
 *  null on permit / no binding / undefined ACL. `protocol`/`dstIp` feed the
 *  extended-ACL evaluator (Lab 12) — passing the trace's `icmp` here keeps
 *  the diagnosis aligned with the ping for `deny icmp` entries. */
function aclCheck(
  router: RouterSession,
  iface: InterfaceState,
  sourceIp: string,
  dstIp: string,
  protocol: 'ip' | 'tcp' | 'udp' | 'icmp',
  aclDirection: 'in' | 'out',
): FailPoint | null {
  const aclId = iface.accessGroups[aclDirection];
  if (aclId === null) return null;
  const acl = router.device.acls.get(aclId);
  if (!acl) return null;
  if (evaluateAcl(acl, sourceIp, protocol, dstIp) !== 'deny') return null;
  return {
    direction: 'forward',
    deviceId: router.device.id,
    iface: iface.id,
    reason: 'acl-deny',
    acl: { aclNumber: aclId, aclDirection, sourceIp },
  };
}

function findLink(session: LabSession, deviceId: string, iface: string): Link | null {
  for (const l of session.links) {
    if (l.a.deviceId === deviceId && l.a.iface === iface) return l;
    if (l.b.deviceId === deviceId && l.b.iface === iface) return l;
  }
  return null;
}

function otherEndOf(
  link: Link,
  deviceId: string,
  iface: string,
): { readonly deviceId: string; readonly iface: string } {
  if (link.a.deviceId === deviceId && link.a.iface === iface) return link.b;
  return link.a;
}

function findEgressForNextHop(router: RouterSession, nextHop: string): string | null {
  for (const i of Object.values(router.device.interfaces)) {
    if (!i.ip || !i.mask) continue;
    const net = networkAddress(i.ip, i.mask);
    if (ipInSubnet(nextHop, net, i.mask)) return i.id;
  }
  return null;
}

function peerOwnsDst(peer: DeviceSession, dstIp: string): boolean {
  if (peer.kind === 'pc') return peer.ip === dstIp;
  if (peer.kind === 'switch') return false;
  if (Object.values(peer.device.interfaces).some((i) => i.ip === dstIp)) return true;
  return Object.values(peer.device.subInterfaces).some((sub) => sub.ip === dstIp);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function errLine(text: string): CommandOutput[] {
  return [{ kind: 'error', text }];
}

/** Render Windows-style `ipconfig` output. `all` adds the Host Name +
 *  Description fields we actually model — nothing fabricated. When the PC
 *  is a DHCP client (dhcpMode), an unresolved but connected NIC shows a
 *  deterministic APIPA 169.254.x.x address with the Windows APIPA mask. */
function renderIpconfig(s: PcSession, all: boolean): CommandOutput[] {
  const out: CommandOutput[] = [];
  if (all) {
    out.push({ kind: 'output', text: '' });
    out.push({ kind: 'output', text: 'Windows IP Configuration' });
    out.push({ kind: 'output', text: '' });
    out.push({ kind: 'output', text: `   Host Name . . . . . . . . . . . . : ${s.hostname}` });
  }
  out.push({ kind: 'output', text: '' });
  out.push({ kind: 'output', text: `Ethernet adapter ${s.nic}:` });
  out.push({ kind: 'output', text: '' });
  if (all) {
    out.push({ kind: 'output', text: `   Description . . . . . . . . . . . : Workstation` });
    if (s.dhcpMode) {
      out.push({ kind: 'output', text: `   DHCP Enabled. . . . . . . . . . . : Yes` });
    }
  }
  const ipv4 = pcEffectiveIpv4(s);
  const ipLabel = ipv4.ip ?? '(none)';
  const maskLabel = ipv4.mask ?? '(none)';
  out.push({ kind: 'output', text: `   IPv4 Address. . . . . . . . . . . : ${ipLabel}` });
  out.push({ kind: 'output', text: `   Subnet Mask . . . . . . . . . . . : ${maskLabel}` });
  out.push({ kind: 'output', text: `   Default Gateway . . . . . . . . . : ${s.gateway ?? '(none)'}` });
  if (all && s.dnsServers.length > 0) {
    out.push({ kind: 'output', text: `   DNS Servers . . . . . . . . . . . : ${s.dnsServers[0]}` });
    for (const server of s.dnsServers.slice(1)) {
      out.push({ kind: 'output', text: `                                       ${server}` });
    }
  }
  out.push({ kind: 'output', text: `   IPv6 Address. . . . . . . . . . . : ${s.ipv6 ?? '(none)'}` });
  out.push({ kind: 'output', text: `   IPv6 Default Gateway . . . . . . : ${s.gateway6 ?? '(none)'}` });
  out.push({
    kind: s.nicUp ? 'system' : 'error',
    text: `   Media State . . . . . . . . . . . : ${s.nicUp ? 'connected' : 'Media disconnected'}`,
  });
  return out;
}

function renderRoutePrint(s: PcSession): CommandOutput[] {
  const out: CommandOutput[] = [
    { kind: 'output', text: '==========================================================================' },
    { kind: 'output', text: 'Interface List' },
    { kind: 'output', text: ` 12...${s.nic}...${s.platform}` },
    { kind: 'output', text: '==========================================================================' },
    { kind: 'output', text: '' },
    { kind: 'output', text: 'IPv4 Route Table' },
    { kind: 'output', text: '==========================================================================' },
    { kind: 'output', text: 'Active Routes:' },
    { kind: 'output', text: 'Network Destination        Netmask          Gateway       Interface  Metric' },
    { kind: 'output', text: routeRow('127.0.0.0', '255.0.0.0', 'On-link', '127.0.0.1', '331') },
  ];

  const ipv4 = pcEffectiveIpv4(s);
  if (s.nicUp && ipv4.ip && ipv4.mask) {
    const localNetwork = networkAddress(ipv4.ip, ipv4.mask);
    out.push({ kind: 'output', text: routeRow(localNetwork, ipv4.mask, 'On-link', ipv4.ip, '281') });
    out.push({ kind: 'output', text: routeRow(ipv4.ip, '255.255.255.255', 'On-link', ipv4.ip, '281') });
    if (s.gateway) {
      out.push({ kind: 'output', text: routeRow('0.0.0.0', '0.0.0.0', s.gateway, ipv4.ip, '25') });
    }
  }

  out.push({ kind: 'output', text: '==========================================================================' });
  return out;
}

function renderArp(s: PcSession): CommandOutput[] {
  const iface = pcEffectiveIpv4(s).ip ?? '0.0.0.0';
  const entries = Object.entries(s.arpCache).sort(([a], [b]) => a.localeCompare(b));
  const out: CommandOutput[] = [
    { kind: 'output', text: '' },
    { kind: 'output', text: `Interface: ${iface} --- 0xc` },
    { kind: 'output', text: '  Internet Address      Physical Address      Type' },
  ];
  if (entries.length === 0) {
    out.push({ kind: 'output', text: '  No ARP Entries Found' });
    return out;
  }
  for (const [ip, mac] of entries) {
    out.push({ kind: 'output', text: `  ${ip.padEnd(20)}${mac.padEnd(22)}dynamic` });
  }
  return out;
}

function routeRow(destination: string, mask: string, gateway: string, iface: string, metric: string): string {
  return `${destination.padEnd(19)} ${mask.padEnd(15)} ${gateway.padEnd(15)} ${iface.padEnd(12)} ${metric}`;
}

function pcEffectiveIpv4(s: PcSession): { ip: string | null; mask: string | null } {
  if (s.dhcpMode && s.nicUp && !s.ip) {
    return { ip: apipaAddressFor(s.id), mask: '255.255.0.0' };
  }
  return { ip: s.ip, mask: s.mask };
}

function apipaAddressFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash + char.charCodeAt(0)) % 65024;
  const third = Math.floor(hash / 254);
  const fourth = (hash % 254) + 1;
  return `169.254.${third}.${fourth}`;
}

function macAddressFor(ip: string): string {
  const octets = ip.split('.').map((part) => Number(part));
  const bytes = [0x02, 0x42, ...octets.slice(0, 4)];
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('-');
}

/**
 * Render a `ping` result — Windows-flavored.
 *
 * On success: Reply/statistics block. On failure: timed-out lines + stats
 * block, then a dim `[sim] …` annotation that names the device and interface
 * at fault. The `[sim]` line is `system` kind (matches tracert) so the
 * learner can tell the simulator narrating apart from raw OS output — the
 * red `Request timed out.` lines above are what real Windows printed; the
 * dim line is the engine explaining why. On success no `[sim]` line appears
 * (silence-is-good).
 */
function renderPing(
  result: ReturnType<typeof canReach>,
  target: string,
  resolvedName?: string,
): CommandOutput[] {
  const pingTarget = resolvedName ? `${resolvedName} [${target}]` : target;
  if (result.ok) {
    return [
      { kind: 'output', text: '' },
      { kind: 'output', text: `Pinging ${pingTarget} with 32 bytes of data:` },
      { kind: 'output', text: `Reply from ${target}: bytes=32 time<1ms TTL=64` },
      { kind: 'output', text: `Reply from ${target}: bytes=32 time<1ms TTL=64` },
      { kind: 'output', text: `Reply from ${target}: bytes=32 time<1ms TTL=64` },
      { kind: 'output', text: `Reply from ${target}: bytes=32 time<1ms TTL=64` },
      { kind: 'output', text: '' },
      { kind: 'output', text: `Ping statistics for ${target}:` },
      { kind: 'output', text: '    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)' },
    ];
  }
  return [
    { kind: 'output', text: '' },
    { kind: 'output', text: `Pinging ${pingTarget} with 32 bytes of data:` },
    { kind: 'error', text: 'Request timed out.' },
    { kind: 'error', text: 'Request timed out.' },
    { kind: 'error', text: 'Request timed out.' },
    { kind: 'error', text: 'Request timed out.' },
    { kind: 'output', text: '' },
    { kind: 'output', text: `Ping statistics for ${target}:` },
    { kind: 'error', text: '    Packets: Sent = 4, Received = 0, Lost = 4 (100% loss)' },
    { kind: 'system', text: `[sim] ${failureDetail(result.failedAt, target)}` },
  ];
}

/**
 * Map a canReach failure to a learner-facing sentence, first letter upper-cased
 * so it stands as a complete sentence. The ONE source of truth for the
 * FailReason → English mapping; both ping and tracert use it for their
 * `[sim]` lines. 3e troubleshooting labs reuse the FailReason enum directly
 * and depend on this mapping — add a `case` per new reason.
 */
function failureDetail(failedAt: FailPoint, target: string): string {
  const { reason, direction, deviceId, iface, acl, vlan, trunk, vlanAllow } = failedAt;
  const place = iface ? `${deviceId} ${iface}` : deviceId;
  const d = detailFor(reason, place, deviceId, direction, target, acl, vlan, trunk, vlanAllow);
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function detailFor(
  reason: FailReason,
  place: string,
  deviceId: string,
  direction: 'forward' | 'return',
  target: string,
  acl: FailPoint['acl'],
  vlan: FailPoint['vlan'],
  trunk: FailPoint['trunk'],
  vlanAllow: FailPoint['vlanAllow'],
): string {
  switch (reason) {
    case 'no-route':
      return direction === 'forward'
        ? `${deviceId} has no route to ${target}.`
        : `${deviceId} has no return route to the source.`;
    case 'source-no-ip':
      return 'the source has no IP address configured.';
    case 'source-nic-down':
      return 'the source NIC has no link to a neighbor.';
    case 'no-gateway':
      return 'no default gateway is set, or the gateway is outside the local subnet.';
    case 'egress-down':
      return `${place} is administratively down.`;
    case 'next-hop-unreachable':
      return `the next-hop on ${place} is not in that interface's subnet.`;
    case 'link-peer-down':
      // Reachability §4 sets `link-peer-down` only when the peer interface's
      // adminUp is false, so "administratively down" is precise. Wording was
      // "the peer of ${place} is down" — ambiguous (parses as "${place} IS
      // the peer, and it's down"). The possessive form is unambiguous and
      // points the learner at the OTHER end of the cable.
      return `${place}'s link partner is administratively down.`;
    case 'link-subnet-mismatch':
      return `the subnets on the two ends of the link at ${place} do not match.`;
    case 'dest-nic-down':
      return 'the destination NIC has no link.';
    case 'dest-unreachable':
      return 'the destination is unreachable (no responding interface).';
    case 'routing-loop':
      return 'static routes form a loop — packets never arrive.';
    case 'acl-deny':
      // ACL details are always present when reason==='acl-deny' — the walk
      // builds the FailPoint with the acl block populated. Falling back to a
      // generic sentence keeps the type checker happy and never fires in
      // practice.
      if (!acl) return `${place} denied the packet via an access list.`;
      return `traffic from ${acl.sourceIp} is denied by ACL ${acl.aclNumber} on ${place} (${acl.aclDirection}).`;
    case 'vlan-mismatch':
      // VLAN context is always present when reason==='vlan-mismatch' — the
      // walk builds the FailPoint with the vlan block populated. The
      // sentence wording is fixed by the work order so a lab can match it
      // verbatim in test assertions.
      if (!vlan) return `${place} blocked the packet at the VLAN boundary.`;
      return `${vlan.aId} and ${vlan.bId} are on different VLANs (${vlan.aVlan} and ${vlan.bVlan}) — inter-VLAN routing is not configured.`;
    case 'trunk-not-configured':
      // Trunk context is always present when reason==='trunk-not-configured';
      // sentence wording is fixed by the Session-2 work order so labs can
      // match it verbatim. Names BOTH ends of the link — the learner needs
      // to configure trunk mode on both switches, so both should appear.
      if (!trunk) return `${place} is not configured as a trunk.`;
      return `the link between ${trunk.aDevice} ${trunk.aIface} and ${trunk.bDevice} ${trunk.bIface} is not configured as a trunk — VLANs cannot pass between switches.`;
    case 'trunk-link-down':
      // The trunk IS configured but the link is down — a port is shut on one
      // end (protocolUp folds in both ends). Name both ends so the learner
      // checks the whole link, not just one switch.
      if (!trunk) return `${place} trunk link is down.`;
      return `the trunk link between ${trunk.aDevice} ${trunk.aIface} and ${trunk.bDevice} ${trunk.bIface} is down — a port is shut or its line protocol is down.`;
    case 'vlan-not-allowed':
      // vlanAllow always present — names the VLAN that was filtered out of
      // the trunk's allowed list. The trunk IS configured; the learner just
      // needs to add the VLAN to the allowed list on the named port.
      if (!vlanAllow) return `${place} blocked the packet at the trunk boundary.`;
      return `VLAN ${vlanAllow.vlanId} is not in the allowed VLAN list on ${place}.`;
  }
}
