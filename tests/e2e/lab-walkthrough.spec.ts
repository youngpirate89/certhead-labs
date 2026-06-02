import { test } from '@playwright/test';
import { batchDOspfLabs } from './fixtures/batch-d';
import { runLabSmokeCase, writeSmokeReport, type LabSmokeResult } from './helpers/labRunner';

const results: LabSmokeResult[] = [];

test.describe.serial('Batch D OSPF lab browser smoke', () => {
  for (const lab of batchDOspfLabs) {
    test(`${lab.id} completes through learner-style commands`, async ({ page }) => {
      results.push(await runLabSmokeCase(page, lab));
    });
  }

  test.afterAll(async () => {
    await writeSmokeReport(results);
  });
});
