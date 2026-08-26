#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { rankCandidates, RANKING_VERSION } from '../../src/rank.mjs';

const sourceDirectory = resolve(process.argv[2] ?? '');
const outputDirectory = resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) {
  throw new Error('Usage: node scripts/experiments/rerank-run.mjs <source-run-directory> <output-run-directory>');
}
if (sourceDirectory === outputDirectory) throw new Error('Source and output run directories must differ.');

const sourceResults = await readFile(join(sourceDirectory, 'results.jsonl'));
const rows = sourceResults.toString('utf8')
  .trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const reranked = rows.map(result => {
  const ranked = rankCandidates(result.candidates ?? [], { companyName: result.name });
  return {
    ...result,
    selected_by_role: Object.fromEntries(['icon', 'wide', 'favicon'].map(role => [role, ranked.selectedByRole[role]?.candidate_id ?? null])),
    candidates: ranked.candidates,
  };
});
const selectionChangesByRole = Object.fromEntries(['icon', 'wide'].map(role => [role, rows.reduce((count, result, index) =>
  count + (result.selected_by_role?.[role] !== reranked[index].selected_by_role?.[role] ? 1 : 0), 0)]));

await mkdir(outputDirectory, { recursive: true });
const outputResults = Buffer.from(`${reranked.map(result => JSON.stringify(result)).join('\n')}\n`);
await writeFile(join(outputDirectory, 'results.jsonl'), outputResults);
await symlink(join(sourceDirectory, 'assets'), join(outputDirectory, 'assets'), 'dir').catch(error => {
  if (error.code !== 'EEXIST') throw error;
});
await writeFile(join(outputDirectory, 'rerank.json'), `${JSON.stringify({
  schema_version: 'logo-yoink-frozen-rerank-v1',
  source_run: sourceDirectory,
  source_results_sha256: createHash('sha256').update(sourceResults).digest('hex'),
  output_results_sha256: createHash('sha256').update(outputResults).digest('hex'),
  ranking_version: RANKING_VERSION,
  canonical_roles: ['icon', 'wide'],
  changed_selected_slots: Object.values(selectionChangesByRole).reduce((total, count) => total + count, 0),
  changed_selected_slots_by_role: selectionChangesByRole,
  result_count: reranked.length,
  generated_at: new Date().toISOString(),
}, null, 2)}\n`);

process.stdout.write(`${reranked.length} results reranked from ${basename(sourceDirectory)} into ${outputDirectory}\n`);
