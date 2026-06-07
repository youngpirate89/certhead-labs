import { test } from '@playwright/test';
import { getSelectedLabSmokeBatch } from './fixtures';
import { runLabSmokeCase, writeSmokeReport, type LabSmokeResult } from './helpers/labRunner';

const selectedBatch = getSelectedLabSmokeBatch();
const results: LabSmokeResult[] = [];

test.describe.serial(`${selectedBatch.name} browser smoke`, () => {
  for (const lab of selectedBatch.labs) {
    test(`${lab.id} completes through learner-style commands`, async ({ page }) => {
      results.push(await runLabSmokeCase(page, lab));
    });
  }

  test.afterAll(async () => {
    await writeSmokeReport(results);
  });
});
