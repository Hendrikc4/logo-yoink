#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const REACHABLE = new Set(['live_html', 'redirected_off_domain']);

async function readJsonl(path) {
  return (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function rank(seed, entityId) {
  return createHash('sha256').update(`${seed}\0${entityId}`).digest('hex');
}

export function selectMissingWideSample(results, count, seed) {
  return results
    .filter(result => result.status === 'success' && REACHABLE.has(result.reachability) && !result.selected_by_role?.wide)
    .map(result => ({ result, rank: rank(seed, result.entity_id) }))
    .sort((a, b) => a.rank.localeCompare(b.rank) || a.result.entity_id.localeCompare(b.result.entity_id))
    .slice(0, count);
}

async function main() {
  const [runArg, outputArg, countArg = '75', seed = 'missing-wide-root-cause-audit-v1'] = process.argv.slice(2);
  if (!runArg || !outputArg) {
    throw new Error('Usage: node scripts/experiments/prepare-missing-wide-audit.mjs <control-run> <output-run> [count] [seed]');
  }
  const count = Number(countArg);
  if (!Number.isInteger(count) || count < 50 || count > 100) throw new Error('count must be an integer from 50 through 100.');
  const runDirectory = resolve(runArg);
  const outputDirectory = resolve(outputArg);
  const results = await readJsonl(join(runDirectory, 'results.jsonl'));
  const eligible = results.filter(result => result.status === 'success' && REACHABLE.has(result.reachability) && !result.selected_by_role?.wide);
  if (eligible.length < count) throw new Error(`Only ${eligible.length} reachable missing-wide records are available.`);
  const sample = selectMissingWideSample(results, count, seed);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, 'results.jsonl'), `${sample.map(item => JSON.stringify(item.result)).join('\n')}\n`);
  await writeFile(join(outputDirectory, 'sample.json'), `${JSON.stringify({
    schema_version: 1,
    source_run: runDirectory,
    source_run_name: basename(runDirectory),
    seed,
    eligible_count: eligible.length,
    sample_count: sample.length,
    entity_ids: sample.map(item => item.result.entity_id),
    records: sample.map(item => ({
      entity_id: item.result.entity_id,
      name: item.result.name,
      website: item.result.website,
      homepage: item.result.homepage,
      reachability: item.result.reachability,
      sample_rank: item.rank,
    })),
  }, null, 2)}\n`);
  process.stdout.write(`${outputDirectory}\neligible ${eligible.length}; sampled ${sample.length}; seed ${seed}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch(error => { process.stderr.write(`prepare missing-wide audit: ${error.message}\n`); process.exitCode = 1; });
}
