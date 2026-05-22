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
  ApplyResult,
  CommandOutput,
  DeviceAdapter,
  DeviceTopologyView,
} from './types';
import { isValidIpv4, isValidMask } from './ios/state';

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
    };
  },

  applyCommand(prev, raw): ApplyResult<PcSession> {
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
    s.history.push(raw.trim());
    s.resolvedHistory.push(r.command.join(' '));

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
