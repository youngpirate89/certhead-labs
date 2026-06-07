import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const localPlaywrightLibPath = path.join(os.homedir(), '.local/playwright-libs/usr/lib/x86_64-linux-gnu');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [localPlaywrightLibPath, process.env.LD_LIBRARY_PATH ?? '']
          .filter(Boolean)
          .join(':'),
      },
    },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
