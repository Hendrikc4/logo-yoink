import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['install'], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
