/**
 * Sanitize raw terminal input — strip OS-level smart-punctuation substitutions
 * back to the ASCII equivalents the IOS / bash / PowerShell parsers expect.
 *
 * Both macOS and Windows aggressively auto-replace typed `-`, `'`, and `"`
 * with curly Unicode variants (U+2014 em-dash, U+2018/U+2019 curly singles,
 * U+201C/U+201D curly doubles) under "smart punctuation" / "autocorrect"
 * features. The terminal `<input>` element already disables
 * `spellCheck`/`autoCorrect`/`autoCapitalize`, but those flags don't bind
 * every OS-level substitution path (clipboard pastes from Notes, Mail,
 * Word, etc. arrive pre-substituted regardless of input attributes).
 *
 * Called from the terminal's onChange handler — the single chokepoint every
 * terminal in the app (PC, router, switch) routes input through, so a
 * single fix covers the whole CLI surface. Pure: same input → same output.
 */
export function sanitizeInput(raw: string): string {
  return raw
    .replace(/[–—―]/g, '-') // en-dash, em-dash, horizontal bar → -
    .replace(/[‘’‚‛]/g, "'") // curly single quotes / low-9 → '
    .replace(/[“”„‟]/g, '"'); // curly double quotes / low-9 → "
}
