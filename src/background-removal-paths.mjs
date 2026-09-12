import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export function backgroundRemovalPaths(cacheDirectory = process.env.LOGO_YOINK_MODEL_CACHE || join(homedir(), '.cache', 'logo-yoink', 'background-removal')) {
  const cache = resolve(cacheDirectory);
  return { cacheDirectory: cache, runtimeDirectory: join(cache, 'runtime'), modelsDirectory: join(cache, 'models'), markerPath: join(cache, 'installation.json') };
}
export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
