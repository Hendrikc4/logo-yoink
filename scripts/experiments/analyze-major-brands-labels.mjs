#!/usr/bin/env node

/** Produce a label-grounded role-loss taxonomy for a frozen benchmark replay. */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROLES = ['icon', 'wide'];
const REACHABLE = new Set(['live_html', 'live_non_html', 'redirected_off_domain', 'live_first_party', 'related_rebrand']);

async function readJsonl(path) {
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`${path}:${index + 1}: ${error.message}`); }
  });
}

function values(label) {
  return label?.values && typeof label.values === 'object' && !Array.isArray(label.values) ? label.values : label ?? {};
}

function candidateKey(entityId, candidateId) {
  return `${entityId}\0${candidateId}`;
}

function isUsable(label) {
  const item = values(label);
  return ['good', 'conditional'].includes(item.usability_light) || ['good', 'conditional'].includes(item.usability_dark);
}

function supportsRole(label, role) {
  const item = values(label);
  return item.identity === 'correct' && Array.isArray(item.roles) && item.roles.includes(role) && isUsable(label);
}

function canonicalFaviconFallback(result, candidate, label, role) {
  if (role !== 'icon' || values(label).identity !== 'correct' || !values(label).roles?.includes('favicon')) return false;
  if (candidate.predicted_roles?.includes('icon') || !candidate.predicted_roles?.includes('favicon')) return false;
  return !result.candidates.some(item => item.predicted_roles?.includes('icon'));
}

function selectedCorrect(result, candidate, label, role) {
  return supportsRole(label, role) || canonicalFaviconFallback(result, candidate, label, role);
}

function selectedFailureKind(label, role) {
  const item = values(label);
  if (!label) return 'missing_label';
  if (item.identity === 'ambiguous') return 'ambiguous_identity';
  if (item.identity !== 'correct') return item.safety_class ?? 'identity_negative';
  if (!item.roles?.includes(role)) return 'role_mismatch';
  if (!isUsable(label)) return 'visually_unusable';
  return 'unknown';
}

export function analyzeRoleLosses(results, labels, { entityIds } = {}) {
  const allowed = entityIds ? new Set(entityIds) : null;
  const labelByCandidate = new Map(labels.map(label => [candidateKey(label.entity_id, label.candidate_id), label]));
  const rows = [];
  for (const result of results) {
    if (allowed && !allowed.has(result.entity_id)) continue;
    for (const role of ROLES) {
      if (!REACHABLE.has(result.reachability)) {
        rows.push({ entity_id: result.entity_id, name: result.name, website: result.website, role, outcome: 'capture_failure', reachability: result.reachability });
        continue;
      }
      const candidates = (result.candidates ?? []).map(candidate => ({ candidate, label: labelByCandidate.get(candidateKey(result.entity_id, candidate.candidate_id)) }));
      const correct = candidates.filter(item => supportsRole(item.label, role));
      const eligibleCorrect = correct.filter(item => item.candidate.predicted_roles?.includes(role));
      const selectedId = result.selected_by_role?.[role] ?? null;
      const selected = candidates.find(item => item.candidate.candidate_id === selectedId) ?? null;
      const correctSelection = selected ? selectedCorrect(result, selected.candidate, selected.label, role) : false;
      let outcome;
      if (correctSelection) outcome = 'selected_correct';
      else if (eligibleCorrect.length) outcome = selectedId ? 'ranking_miss' : 'selection_miss';
      else if (correct.length) outcome = 'eligibility_miss';
      else outcome = 'no_captured_candidate';
      rows.push({
        entity_id: result.entity_id,
        name: result.name,
        website: result.website,
        role,
        outcome,
        reachability: result.reachability,
        selected_candidate_id: selectedId,
        selected_failure_kind: !selectedId || correctSelection ? null : selectedFailureKind(selected?.label, role),
        selected_safety_class: selected ? values(selected.label).safety_class ?? null : null,
        correct_candidate_count: correct.length,
        eligible_correct_candidate_count: eligibleCorrect.length,
        correct_candidates: correct.map(({ candidate, label }) => ({
          candidate_id: candidate.candidate_id,
          source: candidate.source,
          predicted_roles: candidate.predicted_roles ?? [],
          role_score: candidate.role_scores?.[role] ?? null,
          best_for_role: Boolean(values(label).best_for_role?.[role]),
          asset_path: candidate.asset_path ?? null,
        })),
      });
    }
  }
  const outcomes = {};
  const selectedFailures = {};
  for (const row of rows) {
    outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
    if (row.selected_failure_kind) selectedFailures[row.selected_failure_kind] = (selectedFailures[row.selected_failure_kind] ?? 0) + 1;
  }
  return { rows, summary: { entities: new Set(rows.map(row => row.entity_id)).size, role_slots: rows.length, outcomes, selected_failures: selectedFailures } };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help') options.help = true;
    else if (token.startsWith('--')) options[token.slice(2)] = argv[++index];
    else throw new Error(`Unexpected argument: ${token}`);
  }
  return options;
}

function help() {
  return 'Usage: node scripts/experiments/analyze-major-brands-labels.mjs --run RUN --labels LABELS --output DIR [--split entities.jsonl]';
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { process.stdout.write(`${help()}\n`); return; }
  if (!options.run || !options.labels || !options.output) throw new Error(help());
  const results = await readJsonl(join(resolve(options.run), 'results.jsonl'));
  const labels = await readJsonl(resolve(options.labels));
  const entityIds = options.split ? (await readJsonl(resolve(options.split))).map(row => row.entity_id) : undefined;
  const analysis = analyzeRoleLosses(results, labels, { entityIds });
  const output = resolve(options.output);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'role-losses.jsonl'), `${analysis.rows.map(JSON.stringify).join('\n')}\n`);
  await writeFile(join(output, 'summary.json'), `${JSON.stringify(analysis.summary, null, 2)}\n`);
  process.stdout.write(`${output}\n${JSON.stringify(analysis.summary)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  process.stderr.write(`analyze-major-brands-labels: ${error.message}\n`);
  process.exitCode = 1;
});
