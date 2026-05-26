/**
 * IOS switch command grammar — one tree per CLI mode.
 *
 * Same structural conventions as router grammar (grammar.ts): keyword
 * abbreviation surface only, execution lives in switch-interpret.ts. The two
 * grammars are kept separate so a learner on a switch never sees router-only
 * commands (router ospf, ip route) in `?` help, and vice versa.
 */
import type { CommandNode } from '@/engine/parser';
import type { SwitchMode } from './switch-state';

const arg = (name: string, node: CommandNode): CommandNode['argument'] => ({ name, node });
const done = (help: string): CommandNode => ({ terminal: true, help });

const showSubtree: CommandNode = {
  help: 'Display running system information',
  children: {
    vlan: {
      // Bare `show vlan` and `show vlan brief` both print the same table —
      // `brief` is recognised so the muscle-memory form works, but the bare
      // form is the IOS default and also what `sh vl` resolves to.
      terminal: true,
      help: 'VLAN information',
      children: {
        brief: done('VLAN summary table'),
      },
    },
    interfaces: {
      terminal: true,
      help: 'Interface status and configuration',
      // `show interfaces trunk` is a keyword child, NOT an interface argument —
      // it lists every trunk-mode port rather than describing one named iface.
      // Must precede the `argument` slot for the resolver to prefer it on the
      // word `trunk`; the resolver's keyword-vs-argument precedence handles
      // this automatically (keywords first, argument fallback only when no
      // child keyword prefix-matches).
      children: {
        trunk: done('Status of trunking interfaces'),
      },
      argument: arg('iface', {
        terminal: true,
        help: 'Per-interface status',
        children: {
          switchport: done('Switchport configuration for this interface'),
        },
      }),
    },
    'running-config': done('Current operating configuration'),
    version: done('System hardware and software status'),
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
    write: {
      terminal: true,
      help: 'Write running config to memory',
      children: { memory: done('Write to memory') },
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
    vlan: {
      help: 'Create or configure a VLAN (enters config-vlan submode)',
      argument: arg('id', done('Enter VLAN configuration')),
    },
    no: {
      help: 'Negate a command',
      children: {
        hostname: done('Reset hostname to default'),
        vlan: {
          help: 'Delete a VLAN',
          argument: arg('id', done('Delete the VLAN from the database')),
        },
      },
    },
    exit: done('Exit from configuration mode'),
    end: done('Return to privileged EXEC'),
  },
};

const configIfMode: CommandNode = {
  children: {
    interface: {
      help: 'Select another interface to configure',
      argument: arg('iface', done('Switch to interface configuration')),
    },
    switchport: {
      help: 'Configure switchport parameters',
      children: {
        mode: {
          help: 'Set the switchport operating mode',
          children: {
            access: done('Set port to access mode'),
            trunk: done('Set port to unconditional trunk mode'),
            // Reserved — `dynamic auto/desirable` still lands on the
            // explicit "not supported in this lab" error so the learner
            // gets a clear message instead of a silent no-op.
            dynamic: {
              children: {
                auto: done('Dynamic negotiation, prefer access (not modeled)'),
                desirable: done('Dynamic negotiation, prefer trunk (not modeled)'),
              },
            },
          },
        },
        access: {
          help: 'Configure access-mode parameters',
          children: {
            vlan: {
              help: 'Assign the port to a VLAN',
              argument: arg('id', done('Apply access VLAN')),
            },
          },
        },
        trunk: {
          help: 'Configure trunk-mode parameters',
          children: {
            allowed: {
              help: 'VLAN list allowed on this trunk',
              children: {
                vlan: {
                  help: 'Set the allowed VLAN list',
                  children: {
                    all: done('Allow all VLANs (default)'),
                    none: done('Allow no VLANs'),
                    add: {
                      help: 'Append VLANs to the existing allowed list',
                      argument: arg('list', done('Apply VLAN list')),
                    },
                    remove: {
                      help: 'Remove VLANs from the allowed list',
                      argument: arg('list', done('Apply VLAN list')),
                    },
                  },
                  argument: arg('list', done('Replace the allowed VLAN list')),
                },
              },
            },
            native: {
              help: 'Configure the trunk native VLAN',
              children: {
                vlan: {
                  help: 'Set the native (untagged) VLAN',
                  argument: arg('id', done('Apply native VLAN')),
                },
              },
            },
          },
        },
      },
    },
    // IP address on a switchport — real IOS rejects with the specific sentence
    // in our spec, but we route it through the grammar so `?` shows it as a
    // recognised keyword (helps the learner discover the dispatch error).
    ip: {
      children: {
        address: {
          help: 'Set the interface IP address',
          argument: arg('ip', { argument: arg('mask', done('Apply IP (rejected on L2)')) }),
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
        switchport: {
          help: 'Reset switchport settings',
          children: {
            access: {
              help: 'Reset access-mode parameters',
              children: {
                vlan: done('Reset access VLAN to 1'),
              },
            },
            trunk: {
              help: 'Reset trunk-mode parameters',
              children: {
                allowed: {
                  help: 'Reset allowed VLAN list',
                  children: { vlan: done('Reset allowed list to all VLANs') },
                },
                native: {
                  help: 'Reset native VLAN',
                  children: { vlan: done('Reset native VLAN to 1') },
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

const configVlanMode: CommandNode = {
  children: {
    name: {
      help: 'Set the VLAN name',
      argument: arg('name', done('Apply VLAN name')),
    },
    // Direct hop from config-vlan → config-vlan. Real IOS lets you jump from
    // one VLAN's configuration into another without an intermediate exit;
    // mirrors the config-if → config-if hop in grammar.ts.
    vlan: {
      help: 'Create or configure another VLAN',
      argument: arg('id', done('Enter VLAN configuration')),
    },
    // Direct hop from config-vlan → config-if. Real IOS treats `interface X`
    // from any submode as a global-config command and lands directly in
    // config-if; same dispatch path as the in-mode case (enterInterface).
    interface: {
      help: 'Select an interface to configure',
      argument: arg('iface', done('Switch to interface configuration')),
    },
    exit: done('Exit to global config'),
    end: done('Return to privileged EXEC'),
  },
};

const GRAMMARS: Record<SwitchMode, CommandNode> = {
  user: userMode,
  priv: privMode,
  config: configMode,
  'config-if': configIfMode,
  'config-vlan': configVlanMode,
};

export function switchGrammarFor(mode: SwitchMode): CommandNode {
  return GRAMMARS[mode];
}
