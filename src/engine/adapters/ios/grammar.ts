import type { CommandNode } from '@/engine/parser';
import type { Mode } from './state';

/**
 * IOS command grammar — one tree per CLI mode.
 *
 * These describe STRUCTURE only (valid keywords, argument slots, abbreviation
 * surface). Execution lives in interpret.ts, keyed on the resolved command
 * path. Runnable commands are marked `terminal: true`; commands that only lead
 * deeper (e.g. bare `show`) are not, so they resolve as "% Incomplete command".
 */

const arg = (name: string, node: CommandNode): CommandNode['argument'] => ({ name, node });
const done = (help: string): CommandNode => ({ terminal: true, help });

const showSubtree: CommandNode = {
  help: 'Display running system information',
  children: {
    'access-lists': done('All configured access lists'),
    ip: {
      children: {
        interface: {
          children: { brief: done('Brief interface summary') },
          // Per-interface form: `show ip interface <iface>` prints the
          // detailed status block (used for inspecting ACL bindings).
          argument: arg('iface', done('Per-interface IP details')),
        },
        route: done('IP routing table'),
        ospf: {
          terminal: true,
          help: 'OSPF process summary',
          children: {
            neighbor: done('OSPF neighbor table'),
          },
        },
      },
    },
    // `show interfaces` either dumps every interface (terminal here) OR takes a
    // single iface argument and prints just that one's IOS-style detail block.
    // Both forms must be reachable; the resolver picks the argument slot when
    // a trailing token doesn't match any keyword child.
    interfaces: {
      terminal: true,
      help: 'Interface status and configuration',
      argument: arg('iface', done('Per-interface status')),
    },
    version: done('System hardware and software status'),
    // `show running-config` dumps the full config. `show running-config
    // interface <iface>` returns just that interface's stanza — same display
    // logic as the full dump's interface block, scoped to one interface.
    'running-config': {
      terminal: true,
      help: 'Current operating configuration',
      children: {
        interface: {
          help: 'Filter to a single interface stanza',
          argument: arg('iface', done('Per-interface running config')),
        },
      },
    },
  },
};

const userMode: CommandNode = {
  children: {
    enable: done('Turn on privileged commands'),
    exit: done('Exit from the EXEC'),
    show: showSubtree,
  },
};

const privMode: CommandNode = {
  children: {
    enable: done('Already in privileged mode'),
    disable: done('Turn off privileged commands'),
    configure: { children: { terminal: done('Configure from the terminal') } },
    exit: done('Exit from the EXEC'),
    show: showSubtree,
    write: { terminal: true, help: 'Write running config to memory', children: { memory: done('Write to memory') } },
  },
};

const ipRouteSubtree: CommandNode = {
  help: 'Establish a static route',
  argument: arg('prefix', {
    argument: arg('mask', {
      argument: arg('target', done('Add a static route')),
    }),
  }),
};

/** `permit|deny` body for an `access-list <n>` entry.
 *
 *  Three source forms must coexist under one node:
 *    - `any`               → keyword child
 *    - `host <ip>`         → keyword child with one arg
 *    - `<network> <wildcard>` → falls through to the argument slot
 *
 *  The resolver tries keyword children first (prefix-match), so `permit a` →
 *  `any` and `permit h <ip>` → `host`. Numeric tokens never collide with
 *  the keywords, so the bare-network form lands cleanly in the argument
 *  slot. Shared between `permit` and `deny` — same shape, action differs. */
const accessListEntryBody: CommandNode = {
  children: {
    any: done('Match all sources'),
    host: { argument: arg('source', done('Match a single host (/32)')) },
  },
  argument: arg('source', {
    argument: arg('wildcard', done('Match a subnet with wildcard mask')),
  }),
};

const accessListSubtree: CommandNode = {
  help: 'Add to or define a numbered access list',
  argument: arg('number', {
    children: {
      permit: accessListEntryBody,
      deny: accessListEntryBody,
    },
  }),
};

const noAccessListSubtree: CommandNode = {
  help: 'Remove a numbered access list',
  argument: arg('number', done('Remove all entries in this ACL')),
};

const configMode: CommandNode = {
  children: {
    interface: {
      help: 'Select an interface to configure',
      argument: arg('iface', done('Enter interface configuration')),
    },
    hostname: {
      help: 'Set the device hostname',
      argument: arg('name', done('Apply hostname')),
    },
    ip: {
      help: 'IP configuration commands',
      children: { route: ipRouteSubtree },
    },
    'access-list': accessListSubtree,
    router: {
      help: 'Enable a routing process',
      children: {
        ospf: {
          help: 'Open Shortest Path First (OSPF)',
          argument: arg('pid', done('Enter OSPF process configuration')),
        },
      },
    },
    no: {
      help: 'Negate a command',
      children: {
        hostname: done('Reset hostname to default'),
        ip: { children: { route: ipRouteSubtree } },
        'access-list': noAccessListSubtree,
      },
    },
    exit: done('Exit from configuration mode'),
    end: done('Return to privileged EXEC'),
  },
};

const networkSubtree: CommandNode = {
  help: 'Enable OSPF on an interface and place it in an area',
  argument: arg('prefix', {
    argument: arg('wildcard', {
      children: {
        area: {
          argument: arg('area', done('Apply network statement')),
        },
      },
    }),
  }),
};

const configRouterMode: CommandNode = {
  children: {
    network: networkSubtree,
    no: {
      help: 'Negate a command',
      children: {
        network: networkSubtree,
      },
    },
    exit: done('Exit OSPF configuration'),
    end: done('Return to privileged EXEC'),
  },
};

const configIfMode: CommandNode = {
  children: {
    // Direct interface-to-interface hop — real IOS lets you type
    // `interface <new>` from inside another interface's config-if without
    // an intermediate `exit`. The dispatch's `enterInterface` is mode-agnostic
    // and just re-points currentInterface, so a single grammar entry here is
    // enough; mode stays `config-if`, prompt updates to the new interface,
    // and a subsequent `exit` returns to `(config)#` (not to the previous
    // interface — the engine doesn't track a nested interface stack).
    interface: {
      help: 'Select another interface to configure',
      argument: arg('iface', done('Switch to interface configuration')),
    },
    ip: {
      children: {
        address: {
          help: 'Set the interface IP address',
          argument: arg('ip', { argument: arg('mask', done('Apply IP and mask')) }),
        },
        'access-group': {
          help: 'Bind an ACL to this interface',
          argument: arg('number', {
            children: {
              in: done('Apply ACL inbound'),
              out: done('Apply ACL outbound'),
            },
          }),
        },
      },
    },
    description: {
      help: 'Set an interface description',
      argument: arg('text', done('Apply description')),
    },
    shutdown: done('Administratively shut down the interface'),
    no: {
      help: 'Negate a command',
      children: {
        shutdown: done('Bring the interface up'),
        ip: {
          children: {
            address: done('Remove the IP address'),
            'access-group': {
              help: 'Remove an ACL binding',
              argument: arg('number', {
                children: {
                  in: done('Remove inbound ACL'),
                  out: done('Remove outbound ACL'),
                },
              }),
            },
          },
        },
      },
    },
    exit: done('Exit interface configuration'),
    end: done('Return to privileged EXEC'),
  },
};

const GRAMMARS: Record<Mode, CommandNode> = {
  user: userMode,
  priv: privMode,
  config: configMode,
  'config-if': configIfMode,
  'config-router': configRouterMode,
};

export function grammarFor(mode: Mode): CommandNode {
  return GRAMMARS[mode];
}
