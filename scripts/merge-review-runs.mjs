#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
if (outputIndex < 0 || !args[outputIndex + 1]) {
  throw new Error('Usage: node scripts/merge-review-runs.mjs --output <directory> <review-run>...');
}
const outputDirectory = resolve(args[outputIndex + 1]);
const sourceDirectories = args
  .filter((_, index) => index !== outputIndex && index !== outputIndex + 1)
  .map(directory => resolve(directory));
if (!sourceDirectories.length) throw new Error('At least one review run is required.');

async function jsonl(path) {
  return (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

const results = (await Promise.all(sourceDirectories.map(directory => jsonl(join(directory, 'results.jsonl'))))).flat();
const labels = (await Promise.all(sourceDirectories.map(directory => jsonl(join(directory, 'review-labels.jsonl'))))).flat();
const entityIds = new Set();
for (const result of results) {
  if (entityIds.has(result.entity_id)) throw new Error(`Duplicate result entity_id ${result.entity_id}.`);
  entityIds.add(result.entity_id);
}
const labelKeys = new Set();
for (const label of labels) {
  const key = `${label.entity_id}\0${label.candidate_id}\0${label.role}`;
  if (labelKeys.has(key)) throw new Error(`Duplicate label ${key.replaceAll('\0', ' ')}.`);
  labelKeys.add(key);
}
const missing = results.flatMap(result => ['icon', 'wide'].flatMap(role => {
  const candidateId = result.selected_by_role?.[role];
  return candidateId && !labelKeys.has(`${result.entity_id}\0${candidateId}\0${role}`) ? [`${result.website} ${role}`] : [];
}));
if (missing.length) throw new Error(`Selected roles missing labels: ${missing.join(', ')}`);

await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, 'results.jsonl'), `${results.map(result => JSON.stringify(result)).join('\n')}\n`);
await writeFile(join(outputDirectory, 'review-labels.jsonl'), `${labels.map(label => JSON.stringify(label)).join('\n')}\n`);
await writeFile(join(outputDirectory, 'summary.json'), `${JSON.stringify({
  run_id: basename(outputDirectory), cohort: 'all-500', wall_time_ms: null, repeat_comparison: null,
}, null, 2)}\n`);
await writeFile(join(outputDirectory, 'sources.json'), `${JSON.stringify({
  source_runs: sourceDirectories, result_count: results.length, label_count: labels.length,
}, null, 2)}\n`);
process.stdout.write(`${results.length} results and ${labels.length} labels merged into ${outputDirectory}\n`);
