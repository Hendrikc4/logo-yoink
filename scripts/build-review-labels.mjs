#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const runDirectory = resolve(process.argv[2] ?? '');
const reviewPath = resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node scripts/build-review-labels.mjs <run-directory> <review.json>');

const results = (await readFile(join(runDirectory, 'results.jsonl'), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const review = JSON.parse(await readFile(reviewPath, 'utf8'));
const overrideRecords = review.overrides ?? [];
if (!Array.isArray(overrideRecords)) throw new Error('review.overrides must be an array.');
const overrides = new Map();
const allowedIdentities = new Set(['correct', 'wrong', 'ambiguous']);
const allowedUsability = new Set(['good', 'conditional', 'unusable']);
function validateUsability(value, key) {
  const states = value && typeof value === 'object' && !Array.isArray(value) ? Object.values(value) : [value];
  if (!states.length || states.some(state => !allowedUsability.has(state))) {
    throw new Error(`${key} has invalid usability; expected good, conditional, unusable, or a theme-state object.`);
  }
}
for (const item of overrideRecords) {
  const key = `${item.website}\0${item.role}`;
  if (!item.website || !['icon', 'wide'].includes(item.role)) throw new Error('Every override requires website and role=icon|wide.');
  if (overrides.has(key)) throw new Error(`Duplicate override for ${item.website} ${item.role}.`);
  if (item.identity !== undefined && !allowedIdentities.has(item.identity)) throw new Error(`${item.website} ${item.role} has invalid identity.`);
  if (item.usability !== undefined) validateUsability(item.usability, `${item.website} ${item.role}`);
  overrides.set(key, item);
}
const labels = [];
const usedOverrides = new Set();

for (const result of results) {
  for (const role of ['icon', 'wide']) {
    const candidateId = result.selected_by_role?.[role];
    if (!candidateId) continue;
    const overrideKey = `${result.website}\0${role}`;
    const override = overrides.get(overrideKey) ?? {};
    if (overrides.has(overrideKey)) usedOverrides.add(overrideKey);
    labels.push({
      entity_id: result.entity_id,
      candidate_id: candidateId,
      role,
      identity: override.identity ?? 'correct',
      usability: override.usability ?? 'good',
      note: override.note ?? `Visually reviewed in the current ${results.length}-company selection montage.`,
    });
  }
}

const unusedOverrides = [...overrides.keys()].filter(key => !usedOverrides.has(key));
if (unusedOverrides.length) throw new Error(`Overrides do not match a selected role: ${unusedOverrides.map(key => key.replace('\0', ' ')).join(', ')}`);

const output = join(runDirectory, 'review-labels.jsonl');
await writeFile(output, `${labels.map(item => JSON.stringify(item)).join('\n')}\n`);
process.stdout.write(`${output}\n${labels.length} selected-role labels\n`);
