import { describe, it, expect } from 'vitest';
import { complete } from './completer';
import type { CommandNode } from './resolver';

// Fixture tree exercising children, args, abbreviation, and terminals.
const tree: CommandNode = {
  children: {
    show: {
      help: 'Display information',
      children: {
        version: { run: () => 'v1', help: 'Software version' },
        history: { run: () => 'history', help: 'Command history' },
        ip: {
          help: 'IP information',
          children: { route: { run: () => 'r', help: 'Routing table' } },
        },
      },
    },
    set: {
      help: 'Set a value',
      argument: { name: 'value', node: { run: () => 'ok' } },
    },
    save: { run: () => 'saved', help: 'Save the config' },
  },
};

describe('complete', () => {
  it('lists all root children when tokens + partial are empty', () => {
    const r = complete([], tree);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.completions.map((c) => c.keyword)).toEqual(['save', 'set', 'show']);
    expect(r.completions[2].help).toBe('Display information');
  });

  it('filters root candidates by partial prefix', () => {
    const r = complete([], tree, 'sh');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.completions.map((c) => c.keyword)).toEqual(['show']);
  });

  it('lists children of a resolved keyword (sorted)', () => {
    const r = complete(['show'], tree);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.completions.map((c) => c.keyword)).toEqual(['history', 'ip', 'version']);
  });

  it('expands abbreviated tokens before descending', () => {
    const r = complete(['sh'], tree);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.completions.map((c) => c.keyword)).toEqual(['history', 'ip', 'version']);
  });

  it('filters child candidates by partial', () => {
    const r = complete(['show'], tree, 'i');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.completions.map((c) => c.keyword)).toEqual(['ip']);
  });

  it('reports expectsArgument with the declared name', () => {
    const r = complete(['set'], tree);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.completions).toEqual([]);
    expect(r.expectsArgument).toBe(true);
    expect(r.argumentName).toBe('value');
  });

  it('reports atTerminal on a runnable leaf with no children', () => {
    const r = complete(['save'], tree);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.atTerminal).toBe(true);
    expect(r.completions).toEqual([]);
  });

  it('returns ambiguous when an intermediate token matches multiple keywords', () => {
    const r = complete(['s'], tree);
    expect(r.kind).toBe('ambiguous');
    if (r.kind !== 'ambiguous') return;
    expect(r.token).toBe('s');
    expect(r.matches).toEqual(['save', 'set', 'show']);
  });

  it('returns invalid when an intermediate token matches nothing', () => {
    const r = complete(['show', 'frobnicate'], tree);
    expect(r.kind).toBe('invalid');
    if (r.kind !== 'invalid') return;
    expect(r.token).toBe('frobnicate');
  });

  it('is deterministic across repeated calls', () => {
    expect(complete(['show'], tree, 'i')).toEqual(complete(['show'], tree, 'i'));
  });
});
