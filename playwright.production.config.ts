import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const localPlaywrightLibPath = path.join(os.homedir(), '.local/playwright-libs/usr/lib/x86_64-linux-gnu');

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'free-starter-production.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
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
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/try',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
