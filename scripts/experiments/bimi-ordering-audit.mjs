#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index + 1]) throw new Error(`Missing value for ${argv[index]}.`);
    if (argv[index] === '--input') options.input = argv[index + 1];
    else if (argv[index] === '--output') options.output = argv[index + 1];
    else throw new Error(`Unknown option ${argv[index]}.`);
  }
  if (!options.input || !options.output) throw new Error('--input and --output are required.');
  return options;
}

const round = value => Math.round(value * 1_000) / 1_000;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export function summarizeOrderingEvidence(input) {
  if (input?.schema_version !== 1 || !Array.isArray(input.changed_selections)) throw new Error('Unsupported ordering evidence.');
  const changes = input.changed_selections;
  for (const item of changes) {
    for (const candidate of [item.control, item.bimi]) {
      if (!/^[a-f0-9]{64}$/.test(candidate?.content_sha256 ?? '')) throw new Error(`Invalid content fingerprint for ${item.website}.`);
      if (!['correct_brand', 'wrong_brand'].includes(candidate.identity) || !['correct', 'wrong_role'].includes(candidate.icon_role)) throw new Error(`Incomplete review for ${item.website}.`);
    }
    if (!/^[a-f0-9]{64}$/.test(item.bimi.record_sha256 ?? '')) throw new Error(`Invalid BIMI record fingerprint for ${item.website}.`);
  }
  const qualityMovement = changes.map(item => round(item.bimi.tiny_suitability - item.control.tiny_suitability));
  return {
    schema_version: 1,
    experiment: input.experiment,
    third_party_cache_configuration: input.third_party_cache_configuration,
    changed_selections: changes.length,
    correct_role_coverage: {
      control: changes.filter(item => item.control.identity === 'correct_brand' && item.control.icon_role === 'correct').length,
      bimi_before_cache: changes.filter(item => item.bimi.identity === 'correct_brand' && item.bimi.icon_role === 'correct').length,
      delta: changes.filter(item => item.bimi.identity === 'correct_brand' && item.bimi.icon_role === 'correct').length - changes.filter(item => item.control.identity === 'correct_brand' && item.control.icon_role === 'correct').length,
    },
    wrong_brand_selections: changes.filter(item => item.bimi.identity === 'wrong_brand').length,
    provenance: {
      control_domain_controlled: changes.filter(item => item.control.domain_controlled_provenance).length,
      bimi_domain_controlled: changes.filter(item => item.bimi.domain_controlled_provenance).length,
      certificate_validated: changes.filter(item => item.bimi.certificate_validation !== 'not_performed').length,
    },
    delivery: {
      control_vectors: changes.filter(item => item.control.format === 'svg').length,
      bimi_vectors: changes.filter(item => item.bimi.format === 'svg').length,
      control_min_edge_px: Math.min(...changes.map(item => Math.min(item.control.width, item.control.height))),
      bimi_min_intrinsic_edge: Math.min(...changes.map(item => Math.min(item.bimi.width, item.bimi.height))),
    },
    tiny_suitability: {
      control_mean: round(mean(changes.map(item => item.control.tiny_suitability))),
      bimi_mean: round(mean(changes.map(item => item.bimi.tiny_suitability))),
      mean_delta: round(mean(qualityMovement)),
      improved: qualityMovement.filter(value => value > 0).length,
      unchanged: qualityMovement.filter(value => value === 0).length,
      worsened: qualityMovement.filter(value => value < 0).length,
    },
    gated_cost: input.gated_cost,
    conclusion: 'provenance_and_scalability_gain_without_correct_role_coverage_gain',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseArgs(process.argv.slice(2));
  const result = summarizeOrderingEvidence(JSON.parse(await readFile(resolve(options.input), 'utf8')));
  await writeFile(resolve(options.output), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${resolve(options.output)}\n`);
}
