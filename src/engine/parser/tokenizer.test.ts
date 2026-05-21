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
});
