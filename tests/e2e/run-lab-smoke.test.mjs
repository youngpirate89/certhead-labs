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

  it('accepts --lab for a single lab rerun', () => {
    assert.deepEqual(parseLabSmokeArgs(['--lab', 'ccna-lab28-wireless-wlan-vlan-mapping']), {
      batch: 'd',
      lab: 'ccna-lab28-wireless-wlan-vlan-mapping',
      passthrough: [],
    });
  });

  it('accepts --lab=<id>', () => {
    assert.deepEqual(parseLabSmokeArgs(['--lab=ccna-lab22-etherchannel-lacp']), {
      batch: 'd',
      lab: 'ccna-lab22-etherchannel-lacp',
      passthrough: [],
    });
  });

  it('rejects unknown options before invoking Playwright', () => {
    assert.throws(() => parseLabSmokeArgs(['--not-real']), /Unknown option/);
  });
});
