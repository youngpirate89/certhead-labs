import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseLabSmokeArgs } from './run-lab-smoke.mjs';

describe('parseLabSmokeArgs', () => {
  it('defaults to batch d when no batch is provided', () => {
    assert.deepEqual(parseLabSmokeArgs([]), { batch: 'd', passthrough: [] });
  });

  it('accepts --batch e and preserves Playwright passthrough args', () => {
    assert.deepEqual(parseLabSmokeArgs(['--batch', 'e', '--headed']), {
      batch: 'e',
      passthrough: ['--headed'],
    });
  });

  it('accepts --batch=e', () => {
    assert.deepEqual(parseLabSmokeArgs(['--batch=e']), { batch: 'e', passthrough: [] });
  });

  it('rejects unknown options before invoking Playwright', () => {
    assert.throws(() => parseLabSmokeArgs(['--not-real']), /Unknown option/);
  });
});
