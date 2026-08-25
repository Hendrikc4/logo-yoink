#!/usr/bin/env node

import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { extname, join } from 'node:path';

const SOURCE_ROOTS = ['api', 'benchmark', 'public', 'scripts', 'src', 'test'];
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs']);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

const files = (await Promise.all(SOURCE_ROOTS.map(sourceFiles))).flat().sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

process.stdout.write(`Syntax checked ${files.length} JavaScript files.\n`);
