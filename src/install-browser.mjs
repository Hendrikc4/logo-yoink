import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1') {
  console.log('Skipping Chromium install (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1).');
  process.exit(0);
}

const playwrightEntry = createRequire(import.meta.url).resolve('playwright');
const cli = join(dirname(playwrightEntry), 'cli.js');
const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
