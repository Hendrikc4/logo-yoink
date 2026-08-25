#!/usr/bin/env node

/**
 * Apply separately versioned candidate-label adjudications without modifying the
 * frozen source labels. Every override must prove the original label ID and the
 * original reviewed values before a corrected value can be written.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function candidateKey(record) {
  return `${record.entity_id}\0${record.candidate_id}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertOriginalValues(label, adjudication) {
  const expectedId = adjudication.source_label?.label_id;
  if (!expectedId || label.label_id !== expectedId) {
    throw new Error(`${candidateKey(adjudication)}: source label ID mismatch`);
  }
  const original = adjudication.source_label?.original_values;
  if (!original || stableJson(label.values) !== stableJson(original)) {
    throw new Error(`${candidateKey(adjudication)}: source label values mismatch`);
  }
}

export function applyCandidateLabelAdjudications(labels, adjudications) {
  const overrides = new Map();
  for (const adjudication of adjudications) {
    const key = candidateKey(adjudication);
    if (!adjudication.entity_id || !adjudication.candidate_id || !adjudication.corrected_values) {
      throw new Error('Every adjudication requires entity_id, candidate_id, and corrected_values');
    }
    if (overrides.has(key)) throw new Error(`Duplicate adjudication ${key}`);
    overrides.set(key, adjudication);
  }

  const applied = [];
  const output = labels.map(label => {
    const key = candidateKey(label);
    const adjudication = overrides.get(key);
    if (!adjudication) return label;
    assertOriginalValues(label, adjudication);
    overrides.delete(key);
    applied.push(key);
    return {
      ...label,
      values: { ...label.values, ...adjudication.corrected_values },
      provenance: {
        ...label.provenance,
        adjudication: {
          schema_version: adjudication.schema_version,
          artifact_status: adjudication.artifact_status,
          audit_category: adjudication.audit_category,
          rationale: adjudication.rationale ?? adjudication.audit_note,
          source_task_id: adjudication.source_label?.task_id,
          source_packet_fingerprint: adjudication.source_label?.packet_fingerprint,
          review_pass: adjudication.source_label?.review_pass,
        },
      },
    };
  });
  if (overrides.size) throw new Error(`Adjudications reference ${overrides.size} missing source labels`);
  return { labels: output, applied };
}

async function readJsonl(path) {
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`${path}:${index + 1}: ${error.message}`); }
  });
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--help') options.help = true;
    else if (token.startsWith('--')) options[token.slice(2)] = argv[++index];
    else throw new Error(`Unexpected argument: ${token}`);
  }
  return options;
}

function help() {
  return 'Usage: node scripts/benchmark/apply-candidate-label-adjudications.mjs --labels frozen.jsonl --adjudications overrides.jsonl --output derived.jsonl';
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { process.stdout.write(`${help()}\n`); return; }
  if (!options.labels || !options.adjudications || !options.output) throw new Error(help());
  const result = applyCandidateLabelAdjudications(
    await readJsonl(resolve(options.labels)),
    await readJsonl(resolve(options.adjudications)),
  );
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${result.labels.map(row => JSON.stringify(row)).join('\n')}\n`);
  process.stdout.write(`${output}\n${result.labels.length} labels; ${result.applied.length} adjudications applied\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  process.stderr.write(`apply-candidate-label-adjudications: ${error.message}\n`);
  process.exitCode = 1;
});
