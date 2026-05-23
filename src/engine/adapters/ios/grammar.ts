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
    ip: {
      children: {
        interface: { children: { brief: done('Brief interface summary') } },
        route: done('IP routing table'),
      },
    },
    interfaces: done('Interface status and configuration'),
    version: done('System hardware and software status'),
    'running-config': done('Current operating configuration'),
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
    no: {
      help: 'Negate a command',
      children: {
        hostname: done('Reset hostname to default'),
        ip: { children: { route: ipRouteSubtree } },
      },
    },
    exit: done('Exit from configuration mode'),
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
        ip: { children: { address: done('Remove the IP address') } },
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
};

export function grammarFor(mode: Mode): CommandNode {
  return GRAMMARS[mode];
}
