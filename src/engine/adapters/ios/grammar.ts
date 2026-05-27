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
        dhcp: {
          help: 'DHCP server status',
          children: {
            pool: done('DHCP pool details'),
            binding: done('Active DHCP bindings'),
            conflict: done('Address conflicts (none in simulation)'),
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

/** `ip dhcp pool <name>` — enters config-dhcp for the named pool. */
const ipDhcpPoolSubtree: CommandNode = {
  help: 'Create or edit a DHCP pool',
  argument: arg('name', done('Enter DHCP pool configuration')),
};

/** `ip dhcp excluded-address <start> [end]` — reserves a host or range so
 *  the allocator skips it. Single-host form omits the end argument; the
 *  resolver lets the optional second argument fall through cleanly because
 *  the inner argument node is itself terminal. */
const ipDhcpExcludedSubtree: CommandNode = {
  help: 'Reserve addresses so DHCP does not hand them out',
  argument: arg('start', {
    terminal: true,
    help: 'Single-host exclusion',
    argument: arg('end', done('Range exclusion (start..end inclusive)')),
  }),
};

const ipConfigSubtree: CommandNode = {
  help: 'IP configuration commands',
  children: {
    route: ipRouteSubtree,
    dhcp: {
      help: 'DHCP server configuration',
      children: {
        pool: ipDhcpPoolSubtree,
        'excluded-address': ipDhcpExcludedSubtree,
      },
    },
  },
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
    ip: ipConfigSubtree,
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
        ip: {
          children: {
            route: ipRouteSubtree,
            dhcp: {
              help: 'Remove DHCP server configuration',
              children: {
                pool: ipDhcpPoolSubtree,
                'excluded-address': ipDhcpExcludedSubtree,
              },
            },
          },
        },
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

/** config-subif keyword surface — dot1Q router-on-a-stick. Mirrors
 *  config-if's `ip address` / `shutdown` / `no` / `exit` / `end`, plus the
 *  subif-only `encapsulation dot1q <vlan>` line. `description` is intentionally
 *  omitted (not needed for Lab 09; physical iface keeps it).
 *
 *  Like config-if, this also accepts `interface <name>` so the learner can hop
 *  between subifs (or back to a physical interface) without `exit` first —
 *  the dispatcher's `enterInterface` is mode-agnostic and re-routes correctly. */
const configSubIfMode: CommandNode = {
  children: {
    interface: {
      help: 'Select another interface to configure',
      argument: arg('iface', done('Switch to interface configuration')),
    },
    encapsulation: {
      help: 'Set encapsulation type',
      children: {
        dot1q: {
          help: 'IEEE 802.1Q VLAN tagging',
          argument: arg('vlan', done('Apply dot1Q tag for this subinterface')),
        },
      },
    },
    ip: {
      children: {
        address: {
          help: 'Set the subinterface IP address',
          argument: arg('ip', { argument: arg('mask', done('Apply IP and mask')) }),
        },
      },
    },
    shutdown: done('Administratively shut down the subinterface'),
    no: {
      help: 'Negate a command',
      children: {
        shutdown: done('Bring the subinterface up'),
        ip: {
          children: { address: done('Remove the IP address') },
        },
        encapsulation: {
          children: {
            dot1q: {
              help: 'Remove dot1Q encapsulation',
              argument: arg('vlan', done('Remove the dot1Q tag')),
            },
          },
        },
      },
    },
    exit: done('Exit subinterface configuration'),
    end: done('Return to privileged EXEC'),
  },
};

/** config-dhcp keyword surface — the per-pool config entered by
 *  `ip dhcp pool <name>` from config. Real IOS exposes a much larger set of
 *  options; we scope to the four CCNA learners are tested on (network,
 *  default-router, dns-server, lease) plus their `no` negations. */
const configDhcpMode: CommandNode = {
  children: {
    network: {
      help: 'Pool network and mask',
      argument: arg('ip', { argument: arg('mask', done('Apply pool network')) }),
    },
    'default-router': {
      help: 'Default gateway advertised to clients',
      argument: arg('ip', done('Apply default-router')),
    },
    'dns-server': {
      help: 'DNS server advertised to clients',
      argument: arg('ip', done('Apply DNS server')),
    },
    lease: {
      help: 'Lease duration in days',
      argument: arg('days', done('Apply lease duration')),
    },
    no: {
      help: 'Negate a command',
      children: {
        network: done('Clear pool network and mask'),
        'default-router': done('Clear default-router'),
        'dns-server': done('Clear DNS server'),
        lease: done('Reset lease duration'),
      },
    },
    exit: done('Exit DHCP pool configuration'),
    end: done('Return to privileged EXEC'),
  },
};

const GRAMMARS: Record<Mode, CommandNode> = {
  user: userMode,
  priv: privMode,
  config: configMode,
  'config-if': configIfMode,
  'config-subif': configSubIfMode,
  'config-router': configRouterMode,
  'config-dhcp': configDhcpMode,
};

export function grammarFor(mode: Mode): CommandNode {
  return GRAMMARS[mode];
}
