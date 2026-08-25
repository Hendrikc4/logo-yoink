#!/usr/bin/env node

/**
 * Offline, cohort-specific ablations for the major-brands-300 frozen capture.
 *
 * This script never fetches or mutates the source run. Profiles only restrict
 * role eligibility before invoking the production ranker, so each hypothesis
 * can be measured independently over the same captured candidates.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { rankCandidates } from '../../src/rank.mjs';

const PROFILES = new Set([
  'control',
  'unlinked-body-path-agreement',
  'descriptive-body-raster',
  'foreign-named-nav-logo',
  'combined-precision',
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    options[token.slice(2)] = argv[++index];
  }
  if (!options.run || !options.split || !options.labels || !options.output || !PROFILES.has(options.profile)) {
    throw new Error(`Usage: major-brands-ranking-cycle.mjs --run RUN --split SPLIT.jsonl --labels LABELS.jsonl --profile ${[...PROFILES].join('|')} --output DIR`);
  }
  return options;
}

async function readJsonl(path) {
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function words(value) {
  return String(value ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function companyTokens(companyName) {
  return words(companyName).filter(token => token.length >= 3 && !['inc', 'llc', 'ltd', 'corp', 'corporation', 'company', 'group', 'the'].includes(token));
}

function explicitTextAgreement(candidate, companyName) {
  const text = `${candidate.evidence?.alt ?? ''} ${candidate.evidence?.aria_label ?? ''}`.toLowerCase();
  return companyTokens(companyName).some(token => text.includes(token));
}

function isDomAsset(candidate) {
  return ['dom-img', 'dom-picture', 'browser-img'].includes(candidate.source);
}

function unlinkedBodyPathAgreement(candidate, companyName) {
  return isDomAsset(candidate) && candidate.evidence?.dom_region === 'body' && !candidate.evidence?.home_linked &&
    !explicitTextAgreement(candidate, companyName) && candidate.score_reasons?.includes('company agreement +12');
}

function descriptiveBodyRaster(candidate) {
  const altWords = words(candidate.evidence?.alt);
  return isDomAsset(candidate) && !candidate.scalable && candidate.evidence?.dom_region === 'body' &&
    !candidate.evidence?.home_linked && altWords.length >= 8;
}

function foreignNamedNavLogo(candidate, companyName) {
  if (!isDomAsset(candidate) || !['header', 'nav'].includes(candidate.evidence?.dom_region) || candidate.evidence?.home_linked) return false;
  const alt = String(candidate.evidence?.alt ?? '').toLowerCase();
  if (!/\blogo\b/.test(alt)) return false;
  const company = new Set(companyTokens(companyName));
  const meaningful = words(alt).filter(token => token.length >= 3 && !['logo', 'icon', 'home', 'header', 'footer', 'light', 'dark'].includes(token));
  return meaningful.length > 0 && meaningful.every(token => !company.has(token));
}

function reasonsFor(candidate, companyName, profile) {
  const reasons = [];
  if (['unlinked-body-path-agreement', 'combined-precision'].includes(profile) && unlinkedBodyPathAgreement(candidate, companyName)) {
    reasons.push('unlinked body candidate qualified only by URL-path company agreement');
  }
  if (['descriptive-body-raster', 'combined-precision'].includes(profile) && descriptiveBodyRaster(candidate)) {
    reasons.push('unlinked body raster has descriptive non-logo alt text');
  }
  if (['foreign-named-nav-logo', 'combined-precision'].includes(profile) && foreignNamedNavLogo(candidate, companyName)) {
    reasons.push('unlinked navigation asset explicitly names another logo');
  }
  return reasons;
}

function labelValue(label) {
  return label?.values ?? label ?? {};
}

const options = parseArgs(process.argv.slice(2));
const sourcePath = resolve(options.run, 'results.jsonl');
const splitRows = await readJsonl(resolve(options.split));
const splitIds = new Set(splitRows.map(row => row.entity_id));
const results = (await readJsonl(sourcePath)).filter(row => splitIds.has(row.entity_id));
const labels = await readJsonl(resolve(options.labels));
const labelByCandidate = new Map(labels.map(label => [`${label.entity_id}\0${label.candidate_id}`, labelValue(label)]));
const exclusions = [];
const reranked = results.map(result => {
  const candidates = (result.candidates ?? []).map(candidate => {
    const reasons = reasonsFor(candidate, result.name, options.profile);
    if (!reasons.length) return candidate;
    exclusions.push({ entity_id: result.entity_id, name: result.name, website: result.website, candidate_id: candidate.candidate_id, profile: options.profile, reasons });
    return { ...candidate, evidence: { ...candidate.evidence, eligible_roles: [] } };
  });
  const ranked = rankCandidates(candidates, { companyName: result.name });
  return {
    ...result,
    selected_by_role: Object.fromEntries(['icon', 'wide', 'favicon'].map(role => [role, ranked.selectedByRole[role]?.candidate_id ?? null])),
    candidates: ranked.candidates,
  };
});

const afterById = new Map(reranked.map(row => [row.entity_id, row]));
const changes = [];
for (const before of results) {
  const after = afterById.get(before.entity_id);
  for (const role of ['icon', 'wide']) {
    const beforeId = before.selected_by_role?.[role] ?? null;
    const afterId = after.selected_by_role?.[role] ?? null;
    if (beforeId === afterId) continue;
    const beforeLabel = labelByCandidate.get(`${before.entity_id}\0${beforeId}`) ?? null;
    const afterLabel = labelByCandidate.get(`${before.entity_id}\0${afterId}`) ?? null;
    changes.push({
      entity_id: before.entity_id,
      name: before.name,
      website: before.website,
      role,
      before_candidate_id: beforeId,
      after_candidate_id: afterId,
      before_source_identity: beforeLabel?.identity ?? null,
      after_source_identity: afterLabel?.identity ?? null,
    });
  }
}

const knownCorrectRegressions = changes.filter(change => change.before_source_identity === 'correct' && change.after_source_identity !== 'correct');
const sourceWrongRemovals = changes.filter(change => change.before_source_identity === 'wrong').length;
const summary = {
  schema_version: 1,
  profile: options.profile,
  source_run: sourcePath,
  split_file: resolve(options.split),
  entity_count: results.length,
  excluded_candidate_count: exclusions.length,
  changed_slot_count: changes.length,
  source_wrong_removals: sourceWrongRemovals,
  known_correct_regressions: knownCorrectRegressions.length,
  caveat: 'The v3 source labels categorically mark every DOM image/picture candidate wrong. Source-wrong removals are diagnostic only and are not precision evidence.',
  changes,
};

const output = resolve(options.output);
await mkdir(output, { recursive: true });
await writeFile(join(output, 'results.jsonl'), `${reranked.map(JSON.stringify).join('\n')}\n`);
await writeFile(join(output, 'exclusions.jsonl'), exclusions.length ? `${exclusions.map(JSON.stringify).join('\n')}\n` : '');
await writeFile(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${options.profile}: ${changes.length} changed slots; ${knownCorrectRegressions.length} known-correct regressions\n`);
