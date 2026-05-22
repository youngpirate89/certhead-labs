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
 *
 * Offsets: each entry in `offsets[i]` is the 0-based start index of `tokens[i]`
 * within the ORIGINAL (untrimmed) input line. Adapters use this to position
 * IOS-style `^` carets under the offending token in the echoed command.
 */

export interface Tokenized {
  /** The original line, trimmed of leading/trailing whitespace. */
  readonly raw: string;
  /** Non-empty tokens in order. */
  readonly tokens: readonly string[];
  /** Start char-index of each token within the ORIGINAL untrimmed line. */
  readonly offsets: readonly number[];
}

/**
 * Tokenize a raw command line.
 *
 * @example
 * tokenize('  show   ip int br ')
 *   // -> { raw: 'show   ip int br',
 *   //      tokens: ['show','ip','int','br'],
 *   //      offsets: [2, 9, 12, 16] }
 */
export function tokenize(line: string): Tokenized {
  const tokens: string[] = [];
  const offsets: number[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    const start = i;
    while (i < line.length && !/\s/.test(line[i])) i++;
    tokens.push(line.slice(start, i));
    offsets.push(start);
  }
  return { raw: line.trim(), tokens, offsets };
}
