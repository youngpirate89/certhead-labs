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
            // `show ip ospf interface` dumps every OSPF interface; the
            // optional iface argument scopes it to one (where the hello/dead
            // timer line lives — Lab 19's diagnostic).
            interface: {
              terminal: true,
              help: 'OSPF interface settings (timers, area, cost)',
              argument: arg('iface', done('Per-interface OSPF settings')),
            },
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
        nat: {
          help: 'NAT status',
          children: {
            translations: done('Active NAT translations'),
            statistics: done('NAT activity summary'),
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
    ping: {
      help: 'Send ICMP echo to a destination',
      argument: arg('target', done('Ping the destination')),
    },
    show: showSubtree,
    write: { terminal: true, help: 'Write running config to memory', children: { memory: done('Write to memory') } },
  },
};

const ipRouteSubtree: CommandNode = {
  help: 'Establish a static route',
  argument: arg('prefix', {
    argument: arg('mask', {
      // `target` is terminal — `ip route <net> <mask> <nh>` runs as-is — but
      // also accepts an optional trailing `<ad>` token so floating statics
      // (e.g. `ip route 0.0.0.0 0.0.0.0 10.1.2.2 200`) parse without a
      // second grammar path.
      argument: arg('target', {
        terminal: true,
        help: 'Add a static route',
        argument: arg('ad', done('Set administrative distance (1-255)')),
      }),
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

/** `ip nat inside source list <acl> interface <iface> overload` — the PAT
 *  (NAT overload) statement. The same subtree is reused under config's
 *  `no` branch so the negate form removes the matching statement. */
const ipNatStatementSubtree: CommandNode = {
  help: 'Define a NAT translation statement',
  children: {
    inside: {
      help: 'Translate inside source addresses',
      children: {
        source: {
          help: 'Source-list NAT',
          children: {
            list: {
              help: 'Match traffic by ACL number',
              argument: arg('acl', {
                children: {
                  interface: {
                    help: 'Use an interface IP as the translated source',
                    argument: arg('iface', {
                      children: {
                        overload: done(
                          'Apply PAT (port address translation)',
                        ),
                      },
                    }),
                  },
                },
              }),
            },
          },
        },
      },
    },
  },
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

/** `ip access-list extended <name>` — enters config-ext-nacl for the named
 *  extended ACL (Lab 12). Numbered extended ACLs (100-199) are deferred. */
const ipAccessListSubtree: CommandNode = {
  help: 'Configure an IP access list',
  children: {
    extended: {
      help: 'Extended IP access list (named)',
      argument: arg('name', done('Enter extended ACL configuration')),
    },
  },
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
    nat: ipNatStatementSubtree,
    'access-list': ipAccessListSubtree,
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
    // `ping` is parsed here so the dispatcher can emit a tailored redirect
    // ("ping is available in privileged EXEC mode") instead of the resolver's
    // generic invalid-input error. Both bare `ping` and `ping <target>`
    // resolve to keep the redirect firing regardless of arity.
    ping: {
      terminal: true,
      help: 'Not available in configuration mode',
      argument: arg('target', done('Not available in configuration mode')),
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
            nat: ipNatStatementSubtree,
            'access-list': ipAccessListSubtree,
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

const passiveInterfaceSubtree: CommandNode = {
  help: 'Suppress OSPF hello processing on the named interface',
  argument: arg('iface', done('Mark this interface passive')),
};

const configRouterMode: CommandNode = {
  children: {
    network: networkSubtree,
    'passive-interface': passiveInterfaceSubtree,
    no: {
      help: 'Negate a command',
      children: {
        network: networkSubtree,
        'passive-interface': passiveInterfaceSubtree,
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
    // Mirrors the config-mode entry: parse here so the dispatcher can emit
    // the privileged-EXEC redirect rather than letting the resolver fail.
    ping: {
      terminal: true,
      help: 'Not available in interface configuration mode',
      argument: arg('target', done('Not available in interface configuration mode')),
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
        nat: {
          help: 'Mark this interface for NAT translation',
          children: {
            inside: done('Mark interface as NAT inside'),
            outside: done('Mark interface as NAT outside'),
          },
        },
        'helper-address': {
          help: 'Forward DHCP broadcasts to a remote server',
          argument: arg('ip', done('Apply DHCP relay target')),
        },
        ospf: {
          help: 'OSPF interface parameters',
          children: {
            'hello-interval': {
              help: 'Time between OSPF hello packets (seconds)',
              argument: arg('seconds', done('Apply hello interval')),
            },
            'dead-interval': {
              help: 'Interval before declaring a silent neighbor down (seconds)',
              argument: arg('seconds', done('Apply dead interval')),
            },
            authentication: {
              help: 'Enable OSPF authentication on this interface',
              children: {
                'message-digest': done('Use MD5 (message-digest) authentication'),
              },
            },
            'message-digest-key': {
              help: 'Configure an OSPF MD5 authentication key',
              argument: arg('key-id', {
                children: {
                  md5: {
                    help: 'Use MD5 hashing for the key',
                    argument: arg('key', done('Apply the MD5 key')),
                  },
                },
              }),
            },
          },
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
            nat: {
              help: 'Remove a NAT interface marking',
              children: {
                inside: done('Remove NAT inside marking'),
                outside: done('Remove NAT outside marking'),
              },
            },
            'helper-address': done('Remove the DHCP relay target'),
            ospf: {
              help: 'Reset OSPF interface parameters to default',
              children: {
                'hello-interval': done('Reset hello interval to default'),
                'dead-interval': done('Reset dead interval to default'),
                authentication: done('Disable OSPF authentication on this interface'),
                'message-digest-key': {
                  help: 'Remove an OSPF MD5 authentication key',
                  argument: arg('key-id', done('Remove the MD5 key')),
                },
              },
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

/** config-ext-nacl keyword surface — the per-ACL config entered by
 *  `ip access-list extended <name>` from config (Lab 12). Each `permit`/`deny`
 *  line appends an entry: protocol → source form → destination form → optional
 *  `eq <port>`. Source and destination both accept `any`, `host <ip>`, or
 *  bare `<ip> <wildcard>` — three sub-trees sharing the same shape.
 *
 *  `no <sequence>` removes the entry with that line number. `exit` returns to
 *  config and clears `activeAcl`. `end` jumps straight to privileged EXEC. */
const extOptionalEq: CommandNode = {
  terminal: true,
  help: 'Apply the entry',
  children: {
    eq: {
      help: 'Match a specific TCP/UDP port',
      argument: arg('port', done('Apply the entry')),
    },
  },
};

const extDstClause: CommandNode = {
  children: {
    any: extOptionalEq,
    host: {
      help: 'Match a single destination host (/32)',
      argument: arg('dst-ip', extOptionalEq),
    },
  },
  argument: arg('dst-ip', {
    argument: arg('dst-wildcard', extOptionalEq),
  }),
};

const extSrcAndDst: CommandNode = {
  children: {
    any: extDstClause,
    host: {
      help: 'Match a single source host (/32)',
      argument: arg('src-ip', extDstClause),
    },
  },
  argument: arg('src-ip', {
    argument: arg('src-wildcard', extDstClause),
  }),
};

/** Protocol selector for `permit`/`deny` in config-ext-nacl. IOS shows the
 *  named protocol list under `?` rather than a `<protocol>` placeholder — we
 *  scope to the CCNA-relevant set (ip/tcp/udp/icmp). Each protocol child
 *  shares the same downstream src→dst→`eq` sub-tree (`extSrcAndDst`); the
 *  selected protocol is read by the interpreter from `command[1]`. */
const extPermitDeny: CommandNode = {
  children: {
    ip: { help: 'Any Internet Protocol', ...extSrcAndDst },
    tcp: { help: 'Transmission Control Protocol', ...extSrcAndDst },
    udp: { help: 'User Datagram Protocol', ...extSrcAndDst },
    icmp: { help: 'Internet Control Message Protocol', ...extSrcAndDst },
  },
};

const configExtNaclMode: CommandNode = {
  children: {
    permit: extPermitDeny,
    deny: extPermitDeny,
    no: {
      help: 'Remove an entry by sequence number',
      argument: arg('sequence', done('Remove the entry')),
    },
    exit: done('Exit extended ACL configuration'),
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
  'config-ext-nacl': configExtNaclMode,
};

export function grammarFor(mode: Mode): CommandNode {
  return GRAMMARS[mode];
}
