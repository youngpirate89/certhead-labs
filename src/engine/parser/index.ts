/**
 * Parser primitive — public surface.
 *
 * tokenize(line) -> resolve(tokens, tree) is the full pipeline. Syntax
 * adapters supply the command tree; this module owns the shared mechanics.
 */
export { tokenize } from './tokenizer';
export type { Tokenized } from './tokenizer';
export { resolve } from './resolver';
export type {
  CommandNode,
  CommandHandler,
  CommandContext,
  ResolveResult,
} from './resolver';
