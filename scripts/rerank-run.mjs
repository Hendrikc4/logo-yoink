#!/usr/bin/env node

import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { rankCandidates } from '../src/rank.mjs';

const sourceDirectory = resolve(process.argv[2] ?? '');
const outputDirectory = resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) {
  throw new Error('Usage: node scripts/rerank-run.mjs <source-run-directory> <output-run-directory>');
}
if (sourceDirectory === outputDirectory) throw new Error('Source and output run directories must differ.');

const rows = (await readFile(join(sourceDirectory, 'results.jsonl'), 'utf8'))
  .trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const reranked = rows.map(result => {
  const ranked = rankCandidates(result.candidates ?? [], { companyName: result.name });
  return {
    ...result,
    selected_by_role: Object.fromEntries(['icon', 'wide', 'favicon'].map(role => [role, ranked.selectedByRole[role]?.candidate_id ?? null])),
    candidates: ranked.candidates,
  };
});

await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, 'results.jsonl'), `${reranked.map(result => JSON.stringify(result)).join('\n')}\n`);
await symlink(join(sourceDirectory, 'assets'), join(outputDirectory, 'assets'), 'dir').catch(error => {
  if (error.code !== 'EEXIST') throw error;
});
await writeFile(join(outputDirectory, 'rerank.json'), `${JSON.stringify({
  source_run: sourceDirectory,
  result_count: reranked.length,
  generated_at: new Date().toISOString(),
}, null, 2)}\n`);

process.stdout.write(`${reranked.length} results reranked from ${basename(sourceDirectory)} into ${outputDirectory}\n`);
