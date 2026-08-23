#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const runDirectory = resolve(process.argv[2] ?? '');
const reviewPath = resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node scripts/build-review-labels.mjs <run-directory> <review.json>');

const results = (await readFile(join(runDirectory, 'results.jsonl'), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const review = JSON.parse(await readFile(reviewPath, 'utf8'));
const overrides = new Map((review.overrides ?? []).map(item => [`${item.website}\0${item.role}`, item]));
const labels = [];

for (const result of results) {
  for (const role of ['icon', 'wide']) {
    const candidateId = result.selected_by_role?.[role];
    if (!candidateId) continue;
    const override = overrides.get(`${result.website}\0${role}`) ?? {};
    labels.push({
      entity_id: result.entity_id,
      candidate_id: candidateId,
      role,
      identity: override.identity ?? 'correct',
      usability: override.usability ?? 'good',
      note: override.note ?? 'Visually reviewed in the final 100-company montage.',
    });
  }
}

const output = join(runDirectory, 'review-labels.jsonl');
await writeFile(output, `${labels.map(item => JSON.stringify(item)).join('\n')}\n`);
process.stdout.write(`${output}\n${labels.length} selected-role labels\n`);

