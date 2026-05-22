import { describe, it, expect } from 'vitest';
import { tokenize } from './tokenizer';

describe('tokenize', () => {
  it('splits a simple command line', () => {
    expect(tokenize('show ip interface brief').tokens).toEqual([
      'show',
      'ip',
      'interface',
      'brief',
    ]);
  });

  it('collapses runs of whitespace including tabs', () => {
    const { tokens } = tokenize('show   ip\tint   br');
    expect(tokens).toEqual(['show', 'ip', 'int', 'br']);
  });

  it('trims leading and trailing whitespace from raw', () => {
    expect(tokenize('   enable   ').raw).toBe('enable');
  });

  it('returns no tokens for an empty or whitespace-only line', () => {
    expect(tokenize('').tokens).toEqual([]);
    expect(tokenize('    ').tokens).toEqual([]);
  });

  it('is deterministic for identical input', () => {
    expect(tokenize('a  b   c')).toEqual(tokenize('a  b   c'));
  });

  it('records each token start offset relative to the ORIGINAL line', () => {
    const { tokens, offsets } = tokenize('  show   ip int br ');
    expect(tokens).toEqual(['show', 'ip', 'int', 'br']);
    // 'show'=2, 'ip'=9, 'int'=12, 'br'=16 in the untrimmed line
    expect(offsets).toEqual([2, 9, 12, 16]);
  });

  it('reports offsets that point inside the source line', () => {
    const line = 'do frobnicate';
    const { tokens, offsets } = tokenize(line);
    expect(tokens).toEqual(['do', 'frobnicate']);
    expect(offsets).toEqual([0, 3]);
    expect(line.slice(offsets[1], offsets[1] + tokens[1].length)).toBe('frobnicate');
  });

  it('returns empty offsets for an empty/whitespace-only line', () => {
    expect(tokenize('').offsets).toEqual([]);
    expect(tokenize('   ').offsets).toEqual([]);
  });
});
