/**
 * Completer — third stage of the parser primitive, alongside tokenize/resolve.
 *
 * Given a list of fully-resolved tokens plus an optional `partial` prefix being
 * typed, returns the valid next keywords (with help text) at that position.
 * Drives both IOS-style `?` context help and Tab completion. Like the resolver
 * it is tech-stack-agnostic — adapters supply the {@link CommandNode} tree.
 *
 * Determinism (CLAUDE.md constraint #8): pure function over its inputs.
 */
import type { CommandNode } from './resolver';

export interface Completion {
  /** The full unabbreviated keyword. */
  readonly keyword: string;
  /** One-line help string from the tree (if any). */
  readonly help?: string;
}

export type CompleteResult =
  | {
      readonly kind: 'ok';
      /** Keyword candidates at this position, filtered by `partial`, sorted. */
      readonly completions: Completion[];
      /** True when the deepest resolved node expects a free-form argument. */
      readonly expectsArgument: boolean;
      /** The argument slot's declared name (if {@link expectsArgument}). */
      readonly argumentName?: string;
      /** True when the deepest resolved node is itself a complete command. */
      readonly atTerminal: boolean;
    }
  | {
      readonly kind: 'ambiguous';
      readonly token: string;
      readonly matches: string[];
    }
  | {
      readonly kind: 'invalid';
      readonly token: string;
    };

/** Children of `node` whose keys begin with `prefix` (exact match wins). */
function prefixMatches(node: CommandNode, prefix: string): string[] {
  if (!node.children) return [];
  const keys = Object.keys(node.children);
  if (keys.includes(prefix)) return [prefix];
  return keys.filter((k) => k.startsWith(prefix));
}

/**
 * Walk the tree to the position implied by `tokens` and return completion
 * candidates for the next keyword (filtered by `partial`).
 *
 * Mirrors {@link resolve} for the walk — same abbreviation rules, same
 * argument fallback — so completions reflect what the user could actually
 * submit. Stops before the partial: the partial is matched against the
 * deepest fully-resolved node's children.
 */
export function complete(
  tokens: readonly string[],
  root: CommandNode,
  partial: string = '',
): CompleteResult {
  let node = root;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const matches = prefixMatches(node, token);

    if (matches.length === 1) {
      node = node.children![matches[0]];
      continue;
    }
    if (matches.length > 1) {
      return { kind: 'ambiguous', token, matches: matches.sort() };
    }
    if (node.argument) {
      node = node.argument.node;
      continue;
    }
    return { kind: 'invalid', token };
  }

  const candidates = prefixMatches(node, partial).sort();
  const completions: Completion[] = candidates.map((keyword) => ({
    keyword,
    help: node.children![keyword].help,
  }));

  return {
    kind: 'ok',
    completions,
    expectsArgument: !!node.argument && completions.length === 0,
    argumentName: node.argument?.name,
    atTerminal: !!(node.terminal || node.run) && completions.length === 0 && !node.argument,
  };
}
