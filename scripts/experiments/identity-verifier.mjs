#!/usr/bin/env node

import '../../src/load-env.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { calibrateIdentityVerifier, verifyIdentity } from '../../src/identity-verifier.mjs';

function usage() {
  return 'Usage:\n  node scripts/experiments/identity-verifier.mjs verify <request.json> <cache-dir> [--replay]\n  node scripts/experiments/identity-verifier.mjs calibrate <cases.jsonl> <cache-dir> <output-dir> [--replay]';
}

async function main() {
  const [command, inputArg, cacheArg, outputArg] = process.argv.slice(2).filter(arg => arg !== '--replay');
  const replayOnly = process.argv.includes('--replay');
  if (!command || !inputArg || !cacheArg) throw new Error(usage());
  const cacheDirectory = resolve(cacheArg);
  if (command === 'verify') {
    const input = JSON.parse(await readFile(resolve(inputArg), 'utf8'));
    const result = await verifyIdentity(input, { cacheDirectory, replayOnly });
    process.stdout.write(result.bytes);
    return;
  }
  if (command === 'calibrate') {
    if (!outputArg) throw new Error(usage());
    const cases = (await readFile(resolve(inputArg), 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const result = await calibrateIdentityVerifier(cases, { cacheDirectory, replayOnly });
    const outputDirectory = resolve(outputArg);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(outputDirectory, 'judgments.jsonl'), `${result.rows.map(row => JSON.stringify(row)).join('\n')}\n`);
    await writeFile(join(outputDirectory, 'summary.json'), `${JSON.stringify(result.summary, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result.summary)}\n`);
    return;
  }
  throw new Error(usage());
}

main().catch(error => {
  process.stderr.write(`identity verifier: ${error.message}\n`);
  process.exitCode = 1;
});
