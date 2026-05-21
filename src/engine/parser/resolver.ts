/**
 * Resolver — the second stage of the parser primitive.
 *
 * Walks a tree of registered commands and resolves a token list against it,
 * supporting IOS-style prefix abbreviation (`sh ip int br` -> `show ip
 * interface brief`). This is tech-stack-agnostic: a syntax adapter (Cisco IOS,
 * bash, kubectl, ...) supplies the {@link CommandNode} tree; the resolution
 * algorithm is shared by every stack.
 *
 * Behaviour mirrors a real CLI:
 *   - a token may abbreviate a keyword to any UNIQUE prefix
 *   - a prefix matching >1 keyword is ambiguous   ("% Ambiguous command")
 *   - a token matching 0 keywords (with no arg slot) is invalid ("% Invalid input")
 *   - exhausting tokens on a non-runnable node is incomplete   ("% Incomplete command")
 *
 * Fully deterministic (CLAUDE.md constraint #8).
 */

export interface CommandContext {
  /** Captured argument values, keyed by the argument's declared name. */
  readonly args: Readonly<Record<string, string>>;
  /** The fully-expanded command line (abbreviations resolved to keywords). */
  readonly command: readonly string[];
  /** The original raw line. */
  readonly raw: string;
}

/** A command handler returns lines of output to print to the terminal. */
export type CommandHandler = (ctx: CommandContext) => string | string[];

export interface CommandNode {
  /** Keyword children, keyed by the full (unabbreviated) keyword. */
  children?: Record<string, CommandNode>;
  /**
   * An argument slot consumed when no keyword child matches the next token.
   * The captured raw token is stored under `name` and resolution continues
   * into `node`.
   */
  argument?: { name: string; node: CommandNode };
  /** A string-producing handler. For simple, stateless commands. */
  run?: CommandHandler;
  /**
   * Marks this node as a complete command without a string handler. Used by
   * stateful adapters (e.g. Cisco IOS) where execution mutates device state via
   * a separate interpreter keyed on the resolved `command` path — the grammar
   * tree only describes structure.
   */
  terminal?: boolean;
  /** One-line help shown in context help / completion. */
  help?: string;
}

export type ResolveResult =
  | { kind: 'empty' }
  | {
      kind: 'complete';
      command: string[];
      args: Record<string, string>;
      run?: CommandHandler;
    }
  | { kind: 'incomplete'; command: string[] }
  | { kind: 'ambiguous'; token: string; matches: string[]; command: string[] }
  | { kind: 'invalid'; token: string; position: number; command: string[] };

/** Keyword children of `node` whose key starts with `prefix`. */
function prefixMatches(node: CommandNode, prefix: string): string[] {
  if (!node.children) return [];
  const keys = Object.keys(node.children);
  // Exact match wins outright, even if it's a prefix of a longer keyword
  // (e.g. `ip` should resolve to `ip` even if `ipv6` also exists).
  if (keys.includes(prefix)) return [prefix];
  return keys.filter((k) => k.startsWith(prefix));
}

/**
 * Resolve a token list against a command tree.
 *
 * @param tokens fully tokenized input (see tokenize)
 * @param root   the root command node for the current context (e.g. a CLI mode)
 */
export function resolve(tokens: readonly string[], root: CommandNode): ResolveResult {
  if (tokens.length === 0) return { kind: 'empty' };

  let node = root;
  const command: string[] = [];
  const args: Record<string, string> = {};

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const matches = prefixMatches(node, token);

    if (matches.length === 1) {
      const keyword = matches[0];
      command.push(keyword);
      node = node.children![keyword];
      continue;
    }

    if (matches.length > 1) {
      return { kind: 'ambiguous', token, matches: matches.sort(), command };
    }

    // No keyword match — fall back to an argument slot if the node has one.
    if (node.argument) {
      args[node.argument.name] = token;
      command.push(token);
      node = node.argument.node;
      continue;
    }

    return { kind: 'invalid', token, position: i, command };
  }

  if (node.run || node.terminal) {
    return { kind: 'complete', command, args, run: node.run };
  }
  return { kind: 'incomplete', command };
}
