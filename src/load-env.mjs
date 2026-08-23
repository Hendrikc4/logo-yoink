import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const localEnvPath = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(localEnvPath)) process.loadEnvFile(localEnvPath);
