/**
 * PC device adapter.
 *
 * Per docs/ENGINE_ARCHITECTURE.md §3: a PC is the test endpoint — single NIC,
 * default gateway, never a transit hop. The CLI is intentionally tiny:
 * `ipconfig` reads state today; `ping` (3b-c6) will invoke canReach.
 *
 * PCs are configured via the lab spec (`LabDevice.pc`), not the CLI — that
 * matches CCNA-level pedagogy (real PC end-user config is not a CCNA skill;
 * the network is). The PcSession shape exposes enough surface for the engine
 * to validate source/destination semantics during reachability evaluation.
 */
import type { CommandNode } from '@/engine/parser';
import { tokenize, resolve } from '@/engine/parser';
import type { LabDevice } from '@/engine/types';
import type {
  AdapterContext,
  ApplyOptions,
  ApplyResult,
  CommandOutput,
  DeviceAdapter,
  DeviceTopologyView,
} from './types';
import { isValidIpv4, isValidMask } from './ios/state';
import { canReach, type FailPoint, type FailReason } from '@/engine/reachability';

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

const pcGrammar: CommandNode = {
  children: {
    ipconfig: { terminal: true, help: 'Show IP configuration' },
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
    clear: { terminal: true, help: 'Clear the screen' },
  },
};

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
    const r = resolve(tokens, pcGrammar);

    if (r.kind === 'empty') return { session: prev, output: [] };
    if (r.kind === 'ambiguous') {
      return {
        session: prev,
        output: errLine(`% Ambiguous command: "${r.token}"`),
      };
    }
    if (r.kind === 'incomplete') {
      return { session: prev, output: errLine('% Incomplete command.') };
    }
    if (r.kind === 'invalid') {
      return { session: prev, output: errLine(`% Unrecognized command: ${r.token}`) };
    }

    const s = structuredClone(prev) as PcSession;
    if (opts?.record !== false) {
      s.history.push(raw.trim());
      s.resolvedHistory.push(r.command.join(' '));
    }

    const head = r.command[0];
    switch (head) {
      case 'ipconfig':
        return { session: s, output: renderIpconfig(s) };
      case 'ip': {
        if (!isValidIpv4(r.args.ip)) return { session: s, output: errLine(`% Invalid IP address: ${r.args.ip}`) };
        if (!isValidMask(r.args.mask)) return { session: s, output: errLine('% Invalid subnet mask.') };
        s.ip = r.args.ip;
        s.mask = r.args.mask;
        return { session: s, output: [] };
      }
      case 'gateway': {
        if (!isValidIpv4(r.args.ip)) return { session: s, output: errLine(`% Invalid IP address: ${r.args.ip}`) };
        s.gateway = r.args.ip;
        return { session: s, output: [] };
      }
      case 'ping': {
        if (!isValidIpv4(r.args.target)) {
          return {
            session: s,
            output: errLine(`Ping target '${r.args.target}' is not a valid IPv4 address.`),
          };
        }
        if (!ctx?.lab) {
          // Should never happen in production — lab-session passes ctx. Belt
          // + suspenders for adapter-level tests that forget.
          return { session: s, output: errLine('Ping requires a lab context.') };
        }
        const result = canReach(ctx.lab, s.id, r.args.target);
        // Record the ping outcome so reachability objectives can require an
        // ACTUAL ping from the learner (not just state-permits-reachability).
        // Gated on record:false so a seeded ping (Lab.setup) couldn't
        // pre-satisfy a verification objective — same contract as history.
        if (opts?.record !== false) {
          s.lastPing = { target: r.args.target, ok: result.ok };
        }
        return { session: s, output: renderPing(result, r.args.target) };
      }
      case 'clear':
        return { session: s, output: [], };
    }
    return { session: s, output: errLine('% Unknown command.') };
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

function errLine(text: string): CommandOutput[] {
  return [{ kind: 'error', text }];
}

/** Render Windows-style `ipconfig` output. Kept terse but recognizable. */
function renderIpconfig(s: PcSession): CommandOutput[] {
  return [
    { kind: 'output', text: '' },
    { kind: 'output', text: `Ethernet adapter ${s.nic}:` },
    { kind: 'output', text: '' },
    { kind: 'output', text: `   IPv4 Address. . . . . . . . . . . : ${s.ip ?? '(none)'}` },
    { kind: 'output', text: `   Subnet Mask . . . . . . . . . . . : ${s.mask ?? '(none)'}` },
    { kind: 'output', text: `   Default Gateway . . . . . . . . . : ${s.gateway ?? '(none)'}` },
    {
      kind: s.nicUp ? 'system' : 'error',
      text: `   Media State . . . . . . . . . . . : ${s.nicUp ? 'connected' : 'Media disconnected'}`,
    },
  ];
}

/**
 * Render a `ping` result — IOS/Windows-flavored.
 *
 * On success: short Reply/statistics block. On failure: a "Request/Reply
 * timed out" header followed by a learner-facing sentence derived from
 * `failedAt`. The sentence mapping is the ONE place reasons get translated;
 * 3e troubleshooting labs read FailReason directly and reuse this mapping.
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
    { kind: 'error', text: pingFailureSentence(result.failedAt, target) },
  ];
  return lines;
}

/**
 * Map a canReach failure to a learner-facing sentence.
 *
 * Single source of truth: 3e troubleshooting labs reuse `FailReason` directly
 * and lean on this same mapping. Adding a new reason = add a case.
 */
function pingFailureSentence(failedAt: FailPoint, target: string): string {
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
