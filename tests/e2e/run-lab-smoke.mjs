import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function parseLabSmokeArgs(args) {
  const parsed = { batch: 'd', passthrough: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--batch') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--batch requires a value');
      parsed.batch = value.toLowerCase();
      index += 1;
      continue;
    }
    if (arg.startsWith('--batch=')) {
      const value = arg.slice('--batch='.length);
      if (!value) throw new Error('--batch requires a value');
      parsed.batch = value.toLowerCase();
      continue;
    }
    if (arg === '--lab') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--lab requires a value');
      parsed.lab = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--lab=')) {
      const value = arg.slice('--lab='.length);
      if (!value) throw new Error('--lab requires a value');
      parsed.lab = value;
      continue;
    }
    if (arg === '--headed' || arg === '--debug' || arg === '--ui' || arg === '--project=chromium') {
      parsed.passthrough.push(arg);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

function main() {
  const parsed = parseLabSmokeArgs(process.argv.slice(2));
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'playwright',
      'test',
      'tests/e2e/lab-walkthrough.spec.ts',
      '--project=chromium',
      ...parsed.passthrough,
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, LAB_SMOKE_BATCH: parsed.batch, LAB_SMOKE_LAB: parsed.lab ?? '' },
    },
  );
  process.exit(result.status ?? 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
