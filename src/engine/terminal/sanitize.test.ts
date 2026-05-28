import { describe, it, expect } from 'vitest';
import { sanitizeInput } from './sanitize';

describe('sanitizeInput', () => {
  it('passes plain ASCII through unchanged', () => {
    expect(sanitizeInput('no shutdown')).toBe('no shutdown');
    expect(sanitizeInput('access-list 1 permit any')).toBe('access-list 1 permit any');
    expect(sanitizeInput('')).toBe('');
  });

  it('converts em-dash (U+2014) to ASCII hyphen', () => {
    // "no—shutdown" — a smart-punctuation rewrite of `no-shutdown`.
    expect(sanitizeInput('no—shutdown')).toBe('no-shutdown');
    expect(sanitizeInput('access—list 1 permit any')).toBe('access-list 1 permit any');
  });

  it('converts en-dash (U+2013) to ASCII hyphen', () => {
    expect(sanitizeInput('no–shutdown')).toBe('no-shutdown');
  });

  it('converts curly single quotes (U+2018/U+2019) to straight apostrophe', () => {
    expect(sanitizeInput('R1’s‘config')).toBe("R1's'config");
  });

  it('converts curly double quotes (U+201C/U+201D) to straight double quote', () => {
    expect(sanitizeInput('description “WAN link”')).toBe('description "WAN link"');
  });

  it('handles all four substitutions in the same input line', () => {
    const raw = 'description “R1’s WAN—test”';
    expect(sanitizeInput(raw)).toBe('description "R1\'s WAN-test"');
  });

  it('leaves other Unicode untouched (e.g. learner pastes IPv6 with non-ASCII alongside)', () => {
    // Sanity check that we only strip the smart-punct ranges; arbitrary
    // multibyte glyphs pass through (downstream tokenizer will reject as
    // invalid IPs, but sanitize is not the gate for that).
    expect(sanitizeInput('host café')).toBe('host café');
  });
});
