import { expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LabCommandStep, LabSmokeCase } from '../fixtures/batch-d';

export type LabSmokeResult = {
  id: string;
  title: string;
  expectedComplete: string;
  consoleErrors: string[];
  screenshotPath: string;
};

const QA_ROOT = path.resolve('qa-runs/lab-smoke');

export async function runLabSmokeCase(page: Page, lab: LabSmokeCase): Promise<LabSmokeResult> {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto(`/?lab=${lab.id}&review=1`);
  await expect(page.getByRole('heading', { name: lab.title.replace(/^Lab \d+ — /, ''), exact: false })).toBeVisible();
  await page.getByRole('button', { name: /Start lab/i }).click();
  await expect(page.getByRole('button', { name: /Reset lab/i })).toBeVisible();
  await expect(page.getByText(lab.expectedStart, { exact: true })).toBeVisible();

  for (const step of lab.steps) {
    await runStep(page, step);
  }

  await expect(page.getByRole('heading', { name: /Lab Complete/i })).toBeVisible();
  await expect(page.getByText(lab.expectedComplete, { exact: true })).toBeVisible();
  expect(consoleErrors, `browser console errors for ${lab.id}`).toEqual([]);

  await closeAllTerminals(page);
  await page.getByRole('button', { name: /Fit topology to view/i }).click();
  await page.waitForTimeout(250);

  const screenshotDir = path.join(QA_ROOT, 'screenshots');
  await mkdir(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, `${lab.id}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  return {
    id: lab.id,
    title: lab.title,
    expectedComplete: lab.expectedComplete,
    consoleErrors,
    screenshotPath,
  };
}

export async function writeSmokeReport(results: LabSmokeResult[]): Promise<void> {
  await mkdir(QA_ROOT, { recursive: true });
  const lines = [
    '# CertHead Labs Browser Smoke Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Labs: ${results.length}`,
    '',
  ];

  for (const result of results) {
    lines.push(
      `## ${result.title}`,
      '',
      `- Lab ID: ${result.id}`,
      `- Final objective count: ${result.expectedComplete}`,
      `- Browser console errors: ${result.consoleErrors.length}`,
      `- Screenshot: ${result.screenshotPath}`,
      '',
    );
  }

  await writeFile(path.join(QA_ROOT, 'report.md'), lines.join('\n'), 'utf8');
  await writeFile(path.join(QA_ROOT, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
}

async function runStep(page: Page, step: LabCommandStep): Promise<void> {
  await closeAllTerminals(page);
  await page.getByRole('button', { name: `Console for ${step.device}` }).click();

  if (step.workbench === 'Command Prompt' || step.workbench === 'Controller CLI') {
    await page.getByRole('button', { name: step.workbench }).click();
  } else if (step.workbench === 'Terminal') {
    await page.getByRole('tab', { name: 'Terminal' }).click();
  }

  await expect(page.getByLabel('Terminal input')).toBeVisible();

  for (const command of step.commands) {
    await page.getByLabel('Terminal input').fill(command);
    await page.getByLabel('Terminal input').press('Enter');
    await page.waitForTimeout(125);
  }
}

async function closeAllTerminals(page: Page): Promise<void> {
  const closeAll = page.getByRole('button', { name: /Close all terminals/i });
  if (await closeAll.isVisible().catch(() => false)) {
    await closeAll.click();
  }
}
