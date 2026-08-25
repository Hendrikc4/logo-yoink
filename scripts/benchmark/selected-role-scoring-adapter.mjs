#!/usr/bin/env node

/**
 * Derive explicit, role-scoped scoring judgments from exhaustive candidate labels.
 *
 * Candidate labels describe identity and applicable roles. They intentionally do
 * not say "false for icon" when a candidate is a correct wide logo, so this
 * adapter adds that review_role-level judgment only for persisted selections.
 * It never changes the source candidate label or promotes a role mismatch to a
 * wrong-brand identity.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SELECTED_ROLES = ['icon', 'wide'];

function key(entityId, candidateId, role = '') {
  return `${entityId}\0${candidateId}\0${role}`;
}

function candidateKey(entityId, candidateId) {
  return `${entityId}\0${candidateId}`;
}

function labelValues(label) {
  return label?.values && typeof label.values === 'object' && !Array.isArray(label.values) ? label.values : label ?? {};
}

function labelRoles(label) {
  const values = labelValues(label);
  const roles = values.roles ?? label.roles ?? label.role ?? [];
  return [...new Set((Array.isArray(roles) ? roles : [roles]).filter(Boolean))];
}

function labelIdentity(label) {
  return labelValues(label).identity ?? label.identity ?? null;
}

function usability(label) {
  const values = labelValues(label);
  return {
    light: values.usability_light ?? label.usability?.light ?? label.usability_light ?? label.usability ?? null,
    dark: values.usability_dark ?? label.usability?.dark ?? label.usability_dark ?? label.usability ?? null,
  };
}

function sourceLabelId(label) {
  return label.label_id ?? label.source_label_id ?? null;
}

function sourcePromptVersion(label) {
  return label.provenance?.prompt_version ?? label.source_prompt_version ?? null;
}

function sourceRecord(label, { entityId, candidateId, roles, reviewRole, correct, reason } = {}) {
  return {
    entity_id: entityId,
    candidate_id: candidateId,
    roles,
    identity: labelIdentity(label),
    usability: usability(label),
    source_label_id: sourceLabelId(label),
    source_prompt_version: sourcePromptVersion(label),
    ...(reviewRole ? {
      review_role: reviewRole,
      correct,
      adjudication_reason: reason,
    } : {}),
  };
}

function isCanonicalIconFallback(result, candidate, label, role) {
  if (role !== 'icon') return false;
  if (candidate.predicted_roles?.includes('icon')) return false;
  if (!candidate.predicted_roles?.includes('favicon')) return false;
  if (result.candidates.some(item => item.predicted_roles?.includes('icon'))) return false;
  return labelRoles(label).includes('favicon') && labelIdentity(label) === 'correct';
}

function slotAdjudication(result, candidate, label, role) {
  const sourceRoles = labelRoles(label);
  const fallback = isCanonicalIconFallback(result, candidate, label, role);
  const roleMatch = labelIdentity(label) === 'correct' && sourceRoles.includes(role);
  const correct = fallback || roleMatch;
  const reason = fallback
    ? 'canonical_icon_favicon_fallback'
    : roleMatch
      ? 'reviewed_role_match'
      : labelIdentity(label) === 'wrong' || labelIdentity(label) === 'ambiguous'
        ? 'reviewed_identity_not_correct'
        : 'reviewed_without_selected_role';
  return sourceRecord(label, {
    entityId: result.entity_id,
    candidateId: candidate.candidate_id,
    roles: [role],
    reviewRole: role,
    correct,
    reason,
  });
}

/**
 * Convert exhaustive canonical/flat candidate labels into scorer input.
 * Every selected icon/wide slot gets exactly one explicit `correct` judgment.
 */
export function adaptSelectedRoleLabels(results, labelRecords, { roles = SELECTED_ROLES } = {}) {
  if (!Array.isArray(results) || !Array.isArray(labelRecords)) throw new Error('results and labelRecords must be arrays');
  const candidateByKey = new Map();
  for (const result of results) {
    for (const candidate of result.candidates ?? []) {
      const candidateKeyValue = candidateKey(result.entity_id, candidate.candidate_id);
      if (candidateByKey.has(candidateKeyValue)) throw new Error(`Duplicate candidate ${candidateKeyValue}`);
      candidateByKey.set(candidateKeyValue, { result, candidate });
    }
  }

  const labelByCandidate = new Map();
  for (const label of labelRecords) {
    const entityId = label.entity_id;
    const candidateId = label.candidate_id ?? label.candidateId;
    if (!entityId || !candidateId) throw new Error('Every candidate label requires entity_id and candidate_id');
    const candidateKeyValue = candidateKey(entityId, candidateId);
    if (!candidateByKey.has(candidateKeyValue)) throw new Error(`Label references missing candidate ${candidateKeyValue}`);
    if (labelByCandidate.has(candidateKeyValue)) throw new Error(`Duplicate candidate label ${candidateKeyValue}`);
    labelByCandidate.set(candidateKeyValue, label);
  }
  for (const candidateKeyValue of candidateByKey.keys()) {
    if (!labelByCandidate.has(candidateKeyValue)) throw new Error(`Missing candidate label ${candidateKeyValue}`);
  }

  const selectedRolesByCandidate = new Map();
  const slots = [];
  for (const result of results) {
    for (const role of roles) {
      const candidateId = result.selected_by_role?.[role];
      if (!candidateId) continue;
      const selected = candidateByKey.get(candidateKey(result.entity_id, candidateId));
      if (!selected) throw new Error(`Selection references missing candidate ${result.entity_id}\0${candidateId}`);
      const label = labelByCandidate.get(candidateKey(result.entity_id, candidateId));
      const candidateRoles = selectedRolesByCandidate.get(candidateKey(result.entity_id, candidateId)) ?? new Set();
      candidateRoles.add(role);
      selectedRolesByCandidate.set(candidateKey(result.entity_id, candidateId), candidateRoles);
      slots.push(slotAdjudication(result, selected.candidate, label, role));
    }
  }

  const output = [];
  for (const [candidateKeyValue, label] of labelByCandidate) {
    const [entityId, candidateId] = candidateKeyValue.split('\0');
    const selectedRoles = selectedRolesByCandidate.get(candidateKeyValue) ?? new Set();
    const remainingRoles = labelRoles(label).filter(role => !selectedRoles.has(role));
    output.push(sourceRecord(label, { entityId, candidateId, roles: remainingRoles }));
  }
  output.push(...slots);
  return output;
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
  return `Selected-role scoring adapter\n\nUsage:\n  node scripts/benchmark/selected-role-scoring-adapter.mjs --run runs/a --labels labels.jsonl --output scoring-labels.jsonl`;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { process.stdout.write(`${help()}\n`); return; }
  if (!options.run || !options.labels || !options.output) throw new Error(help());
  const runDirectory = resolve(options.run);
  const resultsPath = extname(runDirectory) === '.jsonl' ? runDirectory : join(runDirectory, 'results.jsonl');
  const outputPath = resolve(options.output);
  const rows = adaptSelectedRoleLabels(await readJsonl(resultsPath), await readJsonl(resolve(options.labels)));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
  process.stdout.write(`${outputPath}\n${rows.length} scoring records\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  process.stderr.write(`selected-role-scoring-adapter: ${error.message}\n`);
  process.exitCode = 1;
});
