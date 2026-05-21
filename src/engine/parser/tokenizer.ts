/**
 * Tokenizer — the first stage of the parser primitive.
 *
 * Splits a raw command line into a list of tokens on runs of whitespace.
 * Deliberately minimal: CLI syntaxes we target (IOS, bash, kubectl, SQL...)
 * tokenize on whitespace at this layer. Syntax-specific concerns (quoting,
 * operators, redirection) belong to per-stack parser adapters built later,
 * not to this shared primitive.
 *
 * Determinism guarantee (CLAUDE.md constraint #8): same input -> same output.
 */

export interface Tokenized {
  /** The original line, trimmed of leading/trailing whitespace. */
  readonly raw: string;
  /** Non-empty tokens in order. */
  readonly tokens: readonly string[];
}

/**
 * Tokenize a raw command line.
 *
 * @example
 * tokenize('  show   ip int br ') // -> { raw: 'show   ip int br', tokens: ['show','ip','int','br'] }
 */
export function tokenize(line: string): Tokenized {
  const raw = line.trim();
  const tokens = raw.length === 0 ? [] : raw.split(/\s+/);
  return { raw, tokens };
}
