#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [sourceArg, targetArg, reviewArg] = process.argv.slice(2);
if (!sourceArg || !targetArg || !reviewArg) {
  throw new Error('Usage: node scripts/review/transfer-review-labels.mjs <source-run> <target-run> <changed-review.json>');
}

async function readJsonl(path) {
  return (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

const sourceDirectory = resolve(sourceArg);
const targetDirectory = resolve(targetArg);
const sourceResults = await readJsonl(join(sourceDirectory, 'results.jsonl'));
const targetResults = await readJsonl(join(targetDirectory, 'results.jsonl'));
const sourceLabels = await readJsonl(join(sourceDirectory, 'review-labels.jsonl'));
const review = JSON.parse(await readFile(resolve(reviewArg), 'utf8'));
const allowedIdentities = new Set(['correct', 'wrong', 'ambiguous']);
const allowedUsability = new Set(['good', 'conditional', 'unusable']);

const sourceResultByEntity = new Map(sourceResults.map(result => [result.entity_id, result]));
const sourceLabelBySelection = new Map(sourceLabels.map(label => [
  `${label.entity_id}\0${label.candidate_id}\0${label.role}`,
  label,
]));
const overrides = new Map();
for (const override of review.overrides ?? []) {
  const key = `${override.website}\0${override.role}`;
  if (overrides.has(key)) throw new Error(`Duplicate override for ${override.website} ${override.role}.`);
  if (!allowedIdentities.has(override.identity)) throw new Error(`Invalid identity for ${override.website} ${override.role}.`);
  const usabilityStates = override.usability && typeof override.usability === 'object'
    ? Object.values(override.usability)
    : [override.usability];
  if (!usabilityStates.length || usabilityStates.some(state => !allowedUsability.has(state))) {
    throw new Error(`Invalid usability for ${override.website} ${override.role}.`);
  }
  overrides.set(key, override);
}

const labels = [];
const usedOverrides = new Set();
for (const target of targetResults) {
  const source = sourceResultByEntity.get(target.entity_id);
  if (!source) throw new Error(`Target entity ${target.entity_id} is absent from the source run.`);
  for (const role of ['icon', 'wide']) {
    const candidateId = target.selected_by_role?.[role];
    if (!candidateId) continue;
    const sourceCandidateId = source.selected_by_role?.[role];
    if (candidateId === sourceCandidateId) {
      const label = sourceLabelBySelection.get(`${target.entity_id}\0${candidateId}\0${role}`);
      if (!label) throw new Error(`Missing source label for ${target.website} ${role}.`);
      labels.push(label);
      continue;
    }
    const overrideKey = `${target.website}\0${role}`;
    const override = overrides.get(overrideKey);
    if (!override) throw new Error(`Changed selection requires review: ${target.website} ${role}.`);
    usedOverrides.add(overrideKey);
    labels.push({
      entity_id: target.entity_id,
      candidate_id: candidateId,
      role,
      identity: override.identity,
      usability: override.usability,
      note: override.note ?? 'Visually reviewed after precision reranking.',
    });
  }
}

const unusedOverrides = [...overrides.keys()].filter(key => !usedOverrides.has(key));
if (unusedOverrides.length) throw new Error(`Unused changed-selection reviews: ${unusedOverrides.map(key => key.replace('\0', ' ')).join(', ')}.`);

const output = join(targetDirectory, 'review-labels.jsonl');
await writeFile(output, `${labels.map(label => JSON.stringify(label)).join('\n')}\n`);
process.stdout.write(`${labels.length} labels transferred to ${output}\n`);
