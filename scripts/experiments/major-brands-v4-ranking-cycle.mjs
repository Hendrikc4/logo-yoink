#!/usr/bin/env node

/** Role-scoped structural ablations over the independently reviewed 300 cohort. */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { rankCandidates } from '../../src/rank.mjs';

const PROFILES = new Set(['control', 'body-dom-icon-veto', 'unplaced-dom-icon-veto', 'prefer-declared-icon', 'prefer-declared-icon-unplaced', 'conservative-icon-bundle']);
const DOM_SOURCES = new Set(['dom-img', 'dom-picture', 'browser-img']);
const DECLARED_ICON_SOURCES = new Set(['manifest', 'apple', 'mask-icon', 'ms-tile', 'html-icon', 'google-favicon', 'duckduckgo-favicon', 'root-favicon']);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) options[token.slice(2)] = argv[++index];
    else throw new Error(`Unexpected argument: ${token}`);
  }
  if (!options.run || !options.split || !options.labels || !options.output || !PROFILES.has(options.profile)) {
    throw new Error(`Usage: major-brands-v4-ranking-cycle.mjs --run RUN --split SPLIT --labels LABELS --profile ${[...PROFILES].join('|')} --output DIR`);
  }
  return options;
}

async function readJsonl(path) {
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function values(label) {
  return label?.values && typeof label.values === 'object' ? label.values : label ?? {};
}

function withholdRole(candidate, role) {
  const current = Array.isArray(candidate.evidence?.eligible_roles) ? candidate.evidence.eligible_roles : ['icon', 'wide'];
  return { ...candidate, evidence: { ...candidate.evidence, eligible_roles: current.filter(item => item !== role) } };
}

function shouldVetoBodyDomIcon(candidate) {
  return DOM_SOURCES.has(candidate.source) && candidate.evidence?.dom_region === 'body' && !candidate.evidence?.home_linked;
}

function shouldVetoUnplacedDomIcon(candidate) {
  return DOM_SOURCES.has(candidate.source) && !candidate.evidence?.home_linked && !['header', 'nav'].includes(candidate.evidence?.dom_region);
}

function hasDeclaredIconAlternative(candidates, candidate) {
  return candidates.some(other => other.candidate_id !== candidate.candidate_id && DECLARED_ICON_SOURCES.has(other.source) &&
    other.predicted_roles?.includes('icon') && Number(other.role_scores?.icon) >= 49);
}

function excludedIconReason(candidate, candidates, profile) {
  if (['body-dom-icon-veto', 'conservative-icon-bundle'].includes(profile) && shouldVetoBodyDomIcon(candidate)) return 'unlinked body DOM asset withheld from icon role';
  if (profile === 'unplaced-dom-icon-veto' && shouldVetoUnplacedDomIcon(candidate)) return 'unplaced DOM asset withheld from icon role';
  if (profile === 'prefer-declared-icon-unplaced' && DOM_SOURCES.has(candidate.source) && !candidate.evidence?.home_linked && hasDeclaredIconAlternative(candidates, candidate)) return 'declared icon alternative available for unlinked DOM asset';
  if (['prefer-declared-icon', 'conservative-icon-bundle'].includes(profile) && DOM_SOURCES.has(candidate.source) && hasDeclaredIconAlternative(candidates, candidate)) return 'declared icon alternative available';
  return null;
}

const options = parseArgs(process.argv.slice(2));
const splitIds = new Set((await readJsonl(resolve(options.split))).map(row => row.entity_id));
const results = (await readJsonl(join(resolve(options.run), 'results.jsonl'))).filter(row => splitIds.has(row.entity_id));
const labels = await readJsonl(resolve(options.labels));
const labelByCandidate = new Map(labels.map(label => [`${label.entity_id}\0${label.candidate_id}`, values(label)]));
const exclusions = [];
const reranked = results.map(result => {
  const candidates = (result.candidates ?? []).map(candidate => {
    const reason = options.profile === 'control' ? null : excludedIconReason(candidate, result.candidates ?? [], options.profile);
    if (!reason) return candidate;
    exclusions.push({ entity_id: result.entity_id, name: result.name, website: result.website, candidate_id: candidate.candidate_id, role: 'icon', profile: options.profile, reason });
    return withholdRole(candidate, 'icon');
  });
  const ranked = rankCandidates(candidates, { companyName: result.name });
  return { ...result, selected_by_role: Object.fromEntries(['icon', 'wide', 'favicon'].map(role => [role, ranked.selectedByRole[role]?.candidate_id ?? null])), candidates: ranked.candidates };
});

const changes = [];
for (const before of results) {
  const after = reranked.find(row => row.entity_id === before.entity_id);
  for (const role of ['icon', 'wide']) {
    const beforeId = before.selected_by_role?.[role] ?? null, afterId = after.selected_by_role?.[role] ?? null;
    if (beforeId === afterId) continue;
    changes.push({ entity_id: before.entity_id, name: before.name, website: before.website, role, before_candidate_id: beforeId, after_candidate_id: afterId,
      before_identity: labelByCandidate.get(`${before.entity_id}\0${beforeId}`)?.identity ?? null,
      after_identity: labelByCandidate.get(`${before.entity_id}\0${afterId}`)?.identity ?? null });
  }
}

const output = resolve(options.output);
await mkdir(output, { recursive: true });
await writeFile(join(output, 'results.jsonl'), `${reranked.map(JSON.stringify).join('\n')}\n`);
await writeFile(join(output, 'exclusions.jsonl'), exclusions.length ? `${exclusions.map(JSON.stringify).join('\n')}\n` : '');
await writeFile(join(output, 'summary.json'), `${JSON.stringify({ schema_version: 1, profile: options.profile, entity_count: results.length, excluded_candidate_count: exclusions.length, changed_slot_count: changes.length, changes }, null, 2)}\n`);
process.stdout.write(`${options.profile}: ${changes.length} changed slots\n`);
