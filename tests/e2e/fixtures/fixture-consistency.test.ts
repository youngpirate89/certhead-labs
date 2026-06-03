import { describe, expect, it } from 'vitest';
import { getLabById } from '@/labs/catalog';
import { getAllLabSmokeBatches, getSelectedLabSmokeBatch } from './index';

function expectedCountFor(labId: string): string {
  const lab = getLabById(labId);
  if (!lab) throw new Error(`Unknown catalog lab ${labId}`);
  return `${lab.objectives.length}/${lab.objectives.length}`;
}

describe('Playwright lab smoke fixtures', () => {
  it('every fixture lab resolves in the catalog and matches objective count', () => {
    for (const batch of getAllLabSmokeBatches()) {
      expect(batch.labs.length, `${batch.id} should include labs`).toBeGreaterThan(0);
      for (const smokeCase of batch.labs) {
        const lab = getLabById(smokeCase.id);
        expect(lab, `${batch.id}:${smokeCase.id} should resolve in catalog`).not.toBeNull();
        expect(smokeCase.expectedComplete, `${batch.id}:${smokeCase.id} objective count`).toBe(expectedCountFor(smokeCase.id));
        expect(smokeCase.expectedStart, `${batch.id}:${smokeCase.id} starting objective count`).toBe(
          `0/${lab!.objectives.length}`,
        );
        for (const step of smokeCase.steps) {
          expect(
            lab?.topology.devices.some((device) => device.id === step.device),
            `${smokeCase.id} step device ${step.device}`,
          ).toBe(true);
          expect(step.commands.length, `${smokeCase.id} ${step.device} commands`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('includes the Batch J Lab 47 and Lab 48 smoke fixtures', () => {
    const labIds = getAllLabSmokeBatches().flatMap((batch) => batch.labs.map((smokeCase) => smokeCase.id));

    expect(labIds).toContain('ccna-tshoot-ipv6-missing-default-gateway');
    expect(labIds).toContain('ccna-tshoot-api-management-acl-repair');
  });

  it('fails closed for unknown batches and unknown single-lab selections', () => {
    expect(() => getSelectedLabSmokeBatch('not-real')).toThrow(/Unknown lab smoke batch/);

    const previousLab = process.env.LAB_SMOKE_LAB;
    process.env.LAB_SMOKE_LAB = 'ccna-not-real';
    try {
      expect(() => getSelectedLabSmokeBatch('f')).toThrow(/Unknown lab smoke case/);
    } finally {
      if (previousLab === undefined) delete process.env.LAB_SMOKE_LAB;
      else process.env.LAB_SMOKE_LAB = previousLab;
    }
  });
});
