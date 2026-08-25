#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { captureShard } from '../../benchmark/lib/capture.mjs';

function usage() {
  return 'Usage: node scripts/benchmark/visual-capture.mjs [--fixture path] [--output path] [--shard-index n] [--shard-count n] [--resume] [--timeout-ms n] [--max-instances n] [--max-crops n]';
}

function parseArgs(argv) {
  const args = { fixture: 'fixtures/visual-benchmark-pilot-20.json', output: 'runs/visual-benchmark-v1', shardIndex: 0, shardCount: 1, resume: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') { process.stdout.write(`${usage()}\n`); process.exit(0); }
    const [key, inline] = argument.split('=', 2);
    if (!key.startsWith('--')) throw new Error(`Unknown argument: ${argument}`);
    if (key === '--resume') { args.resume = true; continue; }
    const value = inline ?? argv[++index];
    if (value == null || value.startsWith('--')) throw new Error(`Missing value for ${key}.`);
    if (key === '--fixture') args.fixture = value;
    else if (key === '--output') args.output = value;
    else if (key === '--assignment-root') args.assignmentRoot = value;
    else if (key === '--assignment-manifest') args.assignmentManifest = value;
    else if (key === '--worker-id') args.workerId = value;
    else if (key === '--task-id') args.taskId = value;
    else if (key === '--shard-index') args.shardIndex = Number(value);
    else if (key === '--shard-count') args.shardCount = Number(value);
    else if (key === '--timeout-ms') args.timeoutMs = Number(value);
    else if (key === '--hydration-ms') args.hydrationMs = Number(value);
    else if (key === '--max-requests') args.maxRequests = Number(value);
    else if (key === '--max-transfer-bytes') args.maxTransferBytes = Number(value);
    else if (key === '--max-full-height') args.maxFullHeight = Number(value);
    else if (key === '--max-tiles') args.maxTiles = Number(value);
    else if (key === '--max-instances') args.maxInstances = Number(value);
    else if (key === '--max-crops') args.maxCrops = Number(value);
    else throw new Error(`Unknown argument: ${key}`);
  }
  if (!Number.isInteger(args.shardIndex) || args.shardIndex < 0 || !Number.isInteger(args.shardCount) || args.shardCount < 1 || args.shardIndex >= args.shardCount) throw new Error('Invalid shard index/count.');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixturePath = resolve(args.fixture), outputRoot = resolve(args.output);
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const result = await captureShard(fixture, { ...args, outputRoot, fixturePath });
  process.stdout.write(`${JSON.stringify({ manifest: result.manifest, shard: result.shard, assigned: result.assigned, complete: result.records.filter(record => record.complete).length })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch(error => { process.stderr.write(`visual capture: ${error.message}\n${usage()}\n`); process.exitCode = 1; });
}

export { parseArgs };
