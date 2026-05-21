import { describe, it, expect } from 'vitest';
import { resolve, type CommandNode, type ResolveResult } from './resolver';

// A small generic tree exercising every resolution path. This is NOT the
// Cisco IOS adapter — it is a fixture for testing the shared primitive.
const tree: CommandNode = {
  children: {
    show: {
      help: 'Display information',
      children: {
        version: { run: () => 'v1', help: 'Software version' },
        history: { run: () => 'history', help: 'Command history' },
      },
    },
    set: {
      help: 'Set a value',
      argument: { name: 'value', node: { run: ({ args }) => `set ${args.value}` } },
    },
    interface: {
      help: 'Select an interface',
      argument: {
        name: 'iface',
        node: { run: ({ args }) => `entered ${args.iface}` },
      },
    },
  },
};

function kind(r: ResolveResult): string {
  return r.kind;
}

describe('resolve', () => {
  it('returns empty for no tokens', () => {
    expect(kind(resolve([], tree))).toBe('empty');
  });

  it('resolves an exact full command', () => {
    const r = resolve(['show', 'version'], tree);
    expect(r.kind).toBe('complete');
    if (r.kind === 'complete') expect(r.command).toEqual(['show', 'version']);
  });

  it('expands unique prefix abbreviations to full keywords', () => {
    const r = resolve(['sh', 'ver'], tree);
    expect(r.kind).toBe('complete');
    if (r.kind === 'complete') expect(r.command).toEqual(['show', 'version']);
  });

  it('flags an ambiguous prefix with sorted candidate matches', () => {
    const r = resolve(['s'], tree); // matches show + set
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      expect(r.token).toBe('s');
      expect(r.matches).toEqual(['set', 'show']);
    }
  });

  it('disambiguates a longer prefix', () => {
    const r = resolve(['sh'], tree); // only show
    expect(r.kind).toBe('incomplete'); // show alone is not runnable
    if (r.kind === 'incomplete') expect(r.command).toEqual(['show']);
  });

  it('prefers an exact keyword over a longer keyword it prefixes', () => {
    const ipTree: CommandNode = {
      children: {
        ip: { run: () => 'ip' },
        ipv6: { run: () => 'ipv6' },
      },
    };
    const r = resolve(['ip'], ipTree);
    expect(r.kind).toBe('complete');
    if (r.kind === 'complete') expect(r.command).toEqual(['ip']);
  });

  it('reports incomplete when tokens run out on a non-runnable node', () => {
    const r = resolve(['show'], tree);
    expect(r.kind).toBe('incomplete');
  });

  it('reports invalid input with the offending token and position', () => {
    const r = resolve(['show', 'bogus'], tree);
    expect(r.kind).toBe('invalid');
    if (r.kind === 'invalid') {
      expect(r.token).toBe('bogus');
      expect(r.position).toBe(1);
    }
  });

  it('captures an argument token under its declared name', () => {
    const r = resolve(['interface', 'GigabitEthernet0/0'], tree);
    expect(r.kind).toBe('complete');
    if (r.kind === 'complete') {
      expect(r.args.iface).toBe('GigabitEthernet0/0');
      expect(r.run).toBeDefined();
      expect(r.run?.({ args: r.args, command: r.command, raw: 'interface GigabitEthernet0/0' })).toBe(
        'entered GigabitEthernet0/0',
      );
    }
  });

  it('does not prefix-match argument values against keywords', () => {
    // `set show` — `show` here is an arg value, not the show keyword.
    const r = resolve(['set', 'show'], tree);
    expect(r.kind).toBe('complete');
    if (r.kind === 'complete') expect(r.args.value).toBe('show');
  });

  it('is deterministic across repeated calls', () => {
    expect(resolve(['sh', 'ver'], tree)).toEqual(resolve(['sh', 'ver'], tree));
  });
});
