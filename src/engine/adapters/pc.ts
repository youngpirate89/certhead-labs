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
  isValidIpv4,
  isValidMask,
  routingTable,
  type Session as RouterSession,
} from './ios/state';
import {
  ipInSubnet,
  longestPrefixMatch,
  networkAddress,
} from './ios/routing';
import {
  canReach,
  type FailPoint,
  type FailReason,
} from '@/engine/reachability';
import type { DeviceSession, LabSession } from '@/engine/lab-session';

export interface PcSession {
  readonly kind: 'pc';
  readonly id: string;
  readonly hostname: string;
  /** Single NIC label — kept stable for canvas labelling. */
  readonly nic: string;
  ip: string | null;
  mask: string | null;
  gateway: string | null;
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
    ping: {
      help: 'Ping an IPv4 destination',
      argument: { name: 'target', node: { terminal: true, help: 'Send ICMP request' } },
    },
    tracert: {
      help: 'Trace the route to an IPv4 destination',
      argument: { name: 'target', node: { terminal: true, help: 'Trace hops' } },
    },
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
  { name: 'ipconfig', kind: 'working', handler: handleIpconfig },
  { name: 'ping',     kind: 'working', handler: handlePing },
  { name: 'tracert',  aliases: ['traceroute'], kind: 'working', handler: handleTracert },
  { name: 'ip',       kind: 'working', handler: handleIp },
  { name: 'gateway',  kind: 'working', handler: handleGateway },
  { name: 'clear',    kind: 'working', handler: handleClear },

  // ---- KNOWN-BUT-REDIRECTED tier (register here, don't implement) ----
  // Each message names the in-scope alternatives so the learner has a path
  // forward — never a dead-end "Unrecognized command" for a sensible try.
  {
    name: 'nslookup',
    kind: 'redirect',
    message:
      "nslookup isn't part of this lab — there's no DNS in this environment. Use `ping <ip>` or `tracert <ip>` to test connectivity.",
  },
  {
    name: 'arp',
    kind: 'redirect',
    message:
      "arp isn't part of this lab — ARP tables aren't modeled. Use `ping <ip>` to confirm reachability or `ipconfig` to see your own addressing.",
  },
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
      "telnet isn't part of this lab — open a router's console from the topology canvas (click the device) instead of from the PC.",
  },
  {
    name: 'ssh',
    kind: 'redirect',
    message:
      "ssh isn't part of this lab — open a router's console from the topology canvas (click the device) instead of from the PC.",
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
    name: 'route',
    kind: 'redirect',
    message:
      "route isn't part of this lab on PCs — routing happens on R1/R2. Click a router and run `show ip route` to inspect its table.",
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
    return {
      kind: 'pc',
      id: spec.id,
      hostname: spec.id,
      nic,
      ip: spec.pc?.ip ?? null,
      mask: spec.pc?.mask ?? null,
      gateway: spec.pc?.gateway ?? null,
      nicUp: false,
      history: [],
      resolvedHistory: [],
      lastPing: null,
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
    return `${session.hostname}$`;
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
      platform: 'Workstation',
      interfaces: [
        {
          id: session.nic,
          name: session.nic,
          status: !session.nicUp ? 'admin-down' : session.ip ? 'up' : 'no-ip',
          ip: session.ip,
          mask: session.mask,
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
): ApplyResult<PcSession> {
  if (args.length === 0) {
    return { session: s, output: renderIpconfig(s, /* all */ false) };
  }
  const flag = args[0].toLowerCase();
  if (flag === '/all') {
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

function handleClear(s: PcSession): ApplyResult<PcSession> {
  // Empty output — the terminal frontend handles screen-clear independently
  // when it sees no lines to append; same behavior as the prior switch case.
  return { session: s, output: [] };
}

function handlePing(
  s: PcSession,
  args: readonly string[],
  ctx: AdapterContext | undefined,
  opts: ApplyOptions | undefined,
): ApplyResult<PcSession> {
  if (args.length < 1) return { session: s, output: errLine('% Incomplete command.') };
  const target = args[0];
  if (!isValidIpv4(target)) {
    return {
      session: s,
      output: errLine(`Ping target '${target}' is not a valid IPv4 address.`),
    };
  }
  if (!ctx?.lab) {
    return { session: s, output: errLine('Ping requires a lab context.') };
  }
  const result = canReach(ctx.lab, s.id, target);
  // Record the ping outcome so reachability objectives can require an ACTUAL
  // ping from the learner (not just state-permits-reachability). Gated on
  // record:false so a seeded ping (Lab.setup) couldn't pre-satisfy a
  // verification objective — same contract as history.
  if (opts?.record !== false) {
    s.lastPing = { target, ok: result.ok };
  }
  return { session: s, output: renderPing(result, target) };
}

/**
 * tracert / traceroute — walk the forward path hop by hop, then per-hop
 * test reachability via canReach. A working path lists each hop IP and ends
 * with "Trace complete." A broken path shows the hops that succeed, the
 * hop where it dies, then timeouts up to MAX_HOPS, and a final "Trace did
 * not complete: <sentence>" line using the SAME sentence the ping handler
 * would print. The shared `failureSentence` keeps the two in lockstep.
 *
 * Deterministic: hop chain is derived from current routing tables (no
 * randomness, no real ICMP) and RTTs are always "<1 ms".
 *
 * MAX_HOPS = 8: large enough to convey "many timeouts after the dead hop"
 * for any pedagogical CCNA topology (largest in roadmap is ~6 routers),
 * small enough not to spam 30 timeout rows past the terminal scrollback.
 * Real Windows tracert defaults to 30; our lower bound is a UX choice for
 * the embedded terminal, NOT a semantic change.
 */
const MAX_HOPS = 8;

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

  const lines: CommandOutput[] = [
    { kind: 'output', text: '' },
    { kind: 'output', text: `Tracing route to ${target} over a maximum of ${MAX_HOPS} hops:` },
    { kind: 'output', text: '' },
  ];

  const discovery = discoverHops(ctx.lab, s.id, target);
  const hops = 'hops' in discovery ? discovery.hops : [];
  const walkFailedAt = 'failedAt' in discovery ? discovery.failedAt : null;

  let traceCompleted = false;
  let firstFailedAt: FailPoint | null = null;

  for (let i = 0; i < MAX_HOPS; i++) {
    const hopNum = i + 1;
    const hop = hops[i];

    if (!hop) {
      // No topological hop at this position — either the walk failed
      // earlier (walkFailedAt set) or we've already exhausted the chain
      // without reaching the destination. Print a timeout row.
      lines.push({ kind: 'error', text: formatTimeoutRow(hopNum) });
      continue;
    }

    // Per-hop reachability test uses canReach so timeouts include
    // return-side failures (the missing-return-route scenario won't show
    // up in the topological walk — the route exists going OUT — but the
    // ICMP reply can't get back, so canReach to that hop returns false).
    const result = canReach(ctx.lab, s.id, hop.hopIp);
    if (result.ok) {
      lines.push({ kind: 'output', text: formatHopRow(hopNum, hop.hopIp) });
      if (hop.isDestination) {
        traceCompleted = true;
        break;
      }
    } else {
      lines.push({ kind: 'error', text: formatTimeoutRow(hopNum) });
      if (firstFailedAt === null) firstFailedAt = result.failedAt;
    }
  }

  lines.push({ kind: 'output', text: '' });
  if (traceCompleted) {
    lines.push({ kind: 'output', text: 'Trace complete.' });
  } else {
    // Prefer the walk's failedAt (earliest known failure on the forward
    // path) over per-hop firstFailedAt — they should agree for forward-only
    // breaks, but the walk's reason is canonical for cases like egress-down
    // where canReach to the destination would report the same thing.
    const reason = walkFailedAt ?? firstFailedAt;
    const tail = reason ? `Trace did not complete: ${failureSentence(reason, target)}` : 'Trace did not complete.';
    lines.push({ kind: 'error', text: tail });
  }

  return { session: s, output: lines };
}

function formatHopRow(hopNum: number, ip: string): string {
  return `${hopNum.toString().padStart(3)}    <1 ms    <1 ms    <1 ms  ${ip}`;
}

function formatTimeoutRow(hopNum: number): string {
  return `${hopNum.toString().padStart(3)}    *        *        *      Request timed out.`;
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
  if (!peer || peer.kind !== 'router') {
    return { hops: [], failedAt: fp('forward', pc.id, null, 'source-nic-down') };
  }
  const peerIface = peer.device.interfaces[peerEnd.iface];
  if (!peerIface || !peerIface.adminUp || !peerIface.ip) {
    return { hops: [], failedAt: fp('forward', pc.id, null, 'source-nic-down') };
  }

  const hops: Hop[] = [{ hopIp: peerIface.ip, isDestination: false }];

  let current: RouterSession = peer;
  const limit = Object.keys(session.devices).length + 2;

  for (let i = 0; i < limit; i++) {
    const currentId = current.device.id;

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

    const egressIface = current.device.interfaces[egressIfaceId];
    // Egress admin-down BEFORE everything else — keeps the egress-down
    // FailReason canonical (matches canReach §4). If we crossed the link
    // anyway, the per-hop canReach below would diagnose the broken next-
    // hop reachability as no-route instead, and the trace's final
    // sentence would drift from the ping's.
    if (!egressIface || !egressIface.adminUp) {
      return { hops, failedAt: fp('forward', currentId, egressIfaceId, 'egress-down') };
    }

    // Validate the next-hop sits inside the egress subnet.
    if (route.nextHop && egressIface.ip && egressIface.mask) {
      const egressNet = networkAddress(egressIface.ip, egressIface.mask);
      if (!ipInSubnet(route.nextHop, egressNet, egressIface.mask)) {
        return { hops, failedAt: fp('forward', currentId, egressIfaceId, 'next-hop-unreachable') };
      }
    }

    // Connected route AND dst on this subnet ⇒ destination is on this link.
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
  return Object.values(peer.device.interfaces).some((i) => i.ip === dstIp);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function errLine(text: string): CommandOutput[] {
  return [{ kind: 'error', text }];
}

/** Render Windows-style `ipconfig` output. `all` adds the Host Name +
 *  Description fields we actually model — nothing fabricated. */
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
  }
  out.push({ kind: 'output', text: `   IPv4 Address. . . . . . . . . . . : ${s.ip ?? '(none)'}` });
  out.push({ kind: 'output', text: `   Subnet Mask . . . . . . . . . . . : ${s.mask ?? '(none)'}` });
  out.push({ kind: 'output', text: `   Default Gateway . . . . . . . . . : ${s.gateway ?? '(none)'}` });
  out.push({
    kind: s.nicUp ? 'system' : 'error',
    text: `   Media State . . . . . . . . . . . : ${s.nicUp ? 'connected' : 'Media disconnected'}`,
  });
  return out;
}

/**
 * Render a `ping` result — IOS/Windows-flavored.
 *
 * On success: short Reply/statistics block. On failure: a "Request/Reply
 * timed out" header followed by a learner-facing sentence derived from
 * `failedAt`. The sentence mapping is the ONE place reasons get translated;
 * tracert reuses the same `failureSentence` helper so the two stay in lockstep.
 */
function renderPing(
  result: ReturnType<typeof canReach>,
  target: string,
): CommandOutput[] {
  if (result.ok) {
    return [
      { kind: 'output', text: '' },
      { kind: 'output', text: `Pinging ${target} with 32 bytes of data:` },
      { kind: 'output', text: `Reply from ${target}: bytes=32 time<1ms TTL=64` },
      { kind: 'output', text: `Reply from ${target}: bytes=32 time<1ms TTL=64` },
      { kind: 'output', text: '' },
      { kind: 'output', text: `Ping statistics for ${target}:` },
      { kind: 'output', text: '    Packets: Sent = 2, Received = 2, Lost = 0 (0% loss)' },
    ];
  }
  const lines: CommandOutput[] = [
    { kind: 'output', text: '' },
    { kind: 'output', text: `Pinging ${target} with 32 bytes of data:` },
    { kind: 'error', text: 'Request timed out.' },
    { kind: 'error', text: 'Request timed out.' },
    { kind: 'output', text: '' },
    { kind: 'output', text: `Ping statistics for ${target}:` },
    { kind: 'error', text: '    Packets: Sent = 2, Received = 0, Lost = 2 (100% loss)' },
    { kind: 'error', text: '' },
    { kind: 'error', text: failureSentence(result.failedAt, target) },
  ];
  return lines;
}

/**
 * Map a canReach failure to a learner-facing sentence. The ONE source of
 * truth for the FailReason → English mapping; both ping and tracert use it.
 * 3e troubleshooting labs reuse the FailReason enum directly and rely on
 * this mapping. Adding a new reason = add a case.
 */
function failureSentence(failedAt: FailPoint, target: string): string {
  const { reason, direction, deviceId, iface } = failedAt;
  const place = iface ? `${deviceId} ${iface}` : deviceId;
  const prefix = direction === 'forward' ? 'Request timed out' : 'Reply timed out';
  return `${prefix} — ${detailFor(reason, place, deviceId, direction, target)}`;
}

function detailFor(
  reason: FailReason,
  place: string,
  deviceId: string,
  direction: 'forward' | 'return',
  target: string,
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
      return `the peer of ${place} is down.`;
    case 'link-subnet-mismatch':
      return `the subnets on the two ends of the link at ${place} do not match.`;
    case 'dest-nic-down':
      return 'the destination NIC has no link.';
    case 'dest-unreachable':
      return 'the destination is unreachable (no responding interface).';
    case 'routing-loop':
      return 'static routes form a loop — packets never arrive.';
  }
}
