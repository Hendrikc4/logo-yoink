#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RANKING_VERSION } from '../../src/rank.mjs';
import { validatePacket } from '../review/visual-label-sheets.mjs';
import { summarizeResults } from './benchmark.mjs';
import { adaptSelectedRoleLabels } from './selected-role-scoring-adapter.mjs';

const ROLES = ['icon', 'wide'];
const CONCRETE_SAFETY = new Set(['correct_brand', 'wrong_brand', 'related_brand', 'not_logo', 'unjudgeable']);

function key(entityId, candidateId, role = '') {
  return `${entityId}\0${candidateId}\0${role}`;
}

function candidateKey(entityId, candidateId) {
  return key(entityId, candidateId);
}

function values(label) {
  return label?.values && typeof label.values === 'object' && !Array.isArray(label.values) ? label.values : label ?? {};
}

function isCanonicalCandidateLabel(label) {
  return label?.label_kind === 'candidate' && label?.record_type === 'label' && Boolean(label.entity_id && label.candidate_id);
}

async function readJsonl(path) {
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${path}:${index + 1}: ${error.message}`); }
  });
}

async function artifact(path) {
  const absolute = resolve(path);
  const bytes = await readFile(absolute);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function exactAssignments(results, assignments, cohort) {
  const expected = assignments.map(row => row.entity_id);
  const actual = results.map(row => row.entity_id);
  if (new Set(expected).size !== expected.length) throw new Error(`${cohort}: duplicate assignment entity_id`);
  if (new Set(actual).size !== actual.length) throw new Error(`${cohort}: duplicate result entity_id`);
  const actualSet = new Set(actual);
  if (expected.length !== actual.length || expected.some(id => !actualSet.has(id))) throw new Error(`${cohort}: results do not exactly match assignments`);
}

async function rerankProvenance(runPath, resultsArtifact, cohort) {
  const manifestPath = join(resolve(runPath), 'rerank.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schema_version !== 'logo-yoink-frozen-rerank-v1') throw new Error(`${cohort}: unsupported or missing rerank provenance`);
  if (manifest.output_results_sha256 !== resultsArtifact.sha256) throw new Error(`${cohort}: rerank output hash does not match results`);
  if (manifest.result_count == null || !Number.isInteger(manifest.result_count)) throw new Error(`${cohort}: rerank result_count is invalid`);
  if (typeof manifest.source_run !== 'string' || resolve(manifest.source_run) !== manifest.source_run) throw new Error(`${cohort}: rerank source_run must be absolute`);
  const sourceResultsPath = join(manifest.source_run, 'results.jsonl');
  const [sourceResultsArtifact, sourceResults, outputResults] = await Promise.all([
    artifact(sourceResultsPath), readJsonl(sourceResultsPath), readJsonl(join(resolve(runPath), 'results.jsonl')),
  ]);
  if (manifest.source_results_sha256 !== sourceResultsArtifact.sha256) throw new Error(`${cohort}: rerank source hash does not match source results`);
  const outputByEntity = new Map(outputResults.map(result => [result.entity_id, result]));
  const recomputedChanges = Object.fromEntries(ROLES.map(role => [role, sourceResults.reduce((count, result) =>
    count + (result.selected_by_role?.[role] !== outputByEntity.get(result.entity_id)?.selected_by_role?.[role] ? 1 : 0), 0)]));
  if (sourceResults.length !== outputResults.length || outputByEntity.size !== outputResults.length ||
    ROLES.some(role => recomputedChanges[role] !== manifest.changed_selected_slots_by_role?.[role]) ||
    Object.values(recomputedChanges).reduce((total, count) => total + count, 0) !== manifest.changed_selected_slots) {
    throw new Error(`${cohort}: rerank selection-change provenance does not match source and output results`);
  }
  return {
    path: manifestPath,
    sha256: (await artifact(manifestPath)).sha256,
    source_run: manifest.source_run,
    source_results_sha256: sourceResultsArtifact.sha256,
    output_results_sha256: manifest.output_results_sha256,
    ranking_version: manifest.ranking_version,
    changed_selected_slots: manifest.changed_selected_slots,
    changed_selected_slots_by_role: manifest.changed_selected_slots_by_role,
    result_count: manifest.result_count,
  };
}

export function auditCohort({ cohort, results, labels, assignments, artifacts, rerank }) {
  exactAssignments(results, assignments, cohort);
  if (rerank.result_count !== results.length) throw new Error(`${cohort}: rerank result_count does not match results`);

  const candidateByKey = new Map();
  for (const result of results) {
    for (const candidate of result.candidates ?? []) {
      const id = candidateKey(result.entity_id, candidate.candidate_id);
      if (candidateByKey.has(id)) throw new Error(`${cohort}: duplicate candidate ${id}`);
      candidateByKey.set(id, { result, candidate });
    }
  }

  const canonicalLabels = labels.filter(isCanonicalCandidateLabel);
  const selectedLabels = labels.filter(label => !isCanonicalCandidateLabel(label) && label.entity_id && label.candidate_id && (label.review_role ?? label.role));
  const canonicalByKey = new Map();
  for (const label of canonicalLabels) {
    const id = candidateKey(label.entity_id, label.candidate_id);
    if (!candidateByKey.has(id)) throw new Error(`${cohort}: canonical label references missing candidate ${id}`);
    if (canonicalByKey.has(id)) throw new Error(`${cohort}: duplicate canonical candidate label ${id}`);
    canonicalByKey.set(id, label);
  }
  const selectedByKey = new Map();
  for (const label of selectedLabels) {
    const role = label.review_role ?? label.role;
    const id = key(label.entity_id, label.candidate_id, role);
    if (!candidateByKey.has(candidateKey(label.entity_id, label.candidate_id))) throw new Error(`${cohort}: selected label references missing candidate ${id}`);
    if (selectedByKey.has(id)) throw new Error(`${cohort}: duplicate selected-role label ${id}`);
    selectedByKey.set(id, label);
  }

  const selectedSlots = [];
  const missingSelectedSlots = [];
  for (const result of results) for (const role of ROLES) {
    const candidateId = result.selected_by_role?.[role];
    if (!candidateId) continue;
    const id = candidateKey(result.entity_id, candidateId);
    if (!candidateByKey.has(id)) throw new Error(`${cohort}: selection references missing candidate ${id}`);
    const canonical = canonicalByKey.get(id);
    const exactSelected = selectedByKey.get(key(result.entity_id, candidateId, role));
    const covered = Boolean(canonical || exactSelected);
    const slot = {
      entity_id: result.entity_id,
      company_name: result.name ?? null,
      website: result.website ?? null,
      role,
      candidate_id: candidateId,
      canonical_candidate_label: Boolean(canonical),
      exact_selected_role_label: Boolean(exactSelected),
      other_role_label: !exactSelected && selectedLabels.some(label => label.entity_id === result.entity_id && label.candidate_id === candidateId),
    };
    selectedSlots.push(slot);
    if (!covered) missingSelectedSlots.push(slot);
  }

  const missingCandidateKeys = [...candidateByKey.keys()].filter(id => !canonicalByKey.has(id));
  const labelsWithFingerprint = canonicalLabels.filter(label => /^sha256:[a-f0-9]{64}$/.test(label.provenance?.packet_fingerprint ?? '')).length;
  const labelsWithConcreteSafety = canonicalLabels.filter(label => CONCRETE_SAFETY.has(values(label).safety_class)).length;
  const negativeLabels = canonicalLabels.filter(label => values(label).identity === 'wrong');
  const negativesWithSafetyProvenance = negativeLabels.filter(label => {
    const safety = label.provenance?.safety_adjudication;
    return safety?.prompt_version === 'visual-label-safety-v1-exhaustive-negatives' &&
      /^sha256:[a-f0-9]{64}$/.test(safety.packet_fingerprint ?? '') &&
      safety.packet_fingerprint === label.provenance?.packet_fingerprint;
  }).length;
  const canonicalComplete = canonicalLabels.length === candidateByKey.size && missingCandidateKeys.length === 0;
  const fingerprintComplete = canonicalComplete && labelsWithFingerprint === canonicalLabels.length;
  const safetyComplete = canonicalComplete && labelsWithConcreteSafety === canonicalLabels.length && negativesWithSafetyProvenance === negativeLabels.length;
  let adapterComplete = false;
  let scoringRecordCount = 0;
  let qualifiedScore = null;
  if (canonicalComplete) {
    const scoring = adaptSelectedRoleLabels(results, canonicalLabels);
    adapterComplete = selectedSlots.every(slot => scoring.some(label => label.entity_id === slot.entity_id && label.candidate_id === slot.candidate_id && label.review_role === slot.role && typeof label.correct === 'boolean'));
    scoringRecordCount = scoring.length;
    const summary = summarizeResults(results, { cohort }, scoring);
    qualifiedScore = {
      value: summary.benchmarkScore.value,
      status: summary.benchmarkScore.status,
      selected_roles: summary.benchmarkScore.labels.selected_roles,
      selected_roles_labeled: summary.benchmarkScore.labels.selected_roles_labeled,
      role_components: summary.benchmarkScore.role_components,
      wrong_brand_domains: summary.benchmarkScore.safety.wrong_brand_domains,
    };
  }

  const selectedScoreComplete = missingSelectedSlots.length === 0 && (canonicalLabels.length ? canonicalComplete && adapterComplete : true);
  const exhaustiveSurfaceQualified = canonicalComplete && fingerprintComplete && safetyComplete && adapterComplete;
  const runtimeRankingReplayQualified = exhaustiveSurfaceQualified && rerank.ranking_version === RANKING_VERSION;
  const selectedCandidatesWithoutAnyLabel = new Set(missingSelectedSlots
    .filter(slot => !slot.canonical_candidate_label && !slot.exact_selected_role_label && !slot.other_role_label)
    .map(slot => candidateKey(slot.entity_id, slot.candidate_id))).size;
  return {
    cohort,
    artifacts: { ...artifacts, rerank },
    counts: {
      assigned_entities: results.length,
      captured_candidates: candidateByKey.size,
      canonical_candidate_labels: canonicalLabels.length,
      legacy_selected_role_labels: selectedLabels.length,
      selected_icon_wide_slots: selectedSlots.length,
      selected_slots_labeled: selectedSlots.length - missingSelectedSlots.length,
      missing_selected_role_slots: missingSelectedSlots.length,
      selected_candidates_without_any_label: selectedCandidatesWithoutAnyLabel,
      canonical_candidates_unlabeled: missingCandidateKeys.length,
      fingerprint_bound_candidate_labels: labelsWithFingerprint,
      concrete_safety_candidate_labels: labelsWithConcreteSafety,
      reviewed_negative_candidate_labels: negativeLabels.length,
      fingerprint_bound_negative_safety_labels: negativesWithSafetyProvenance,
      derived_scoring_records: scoringRecordCount,
    },
    missing_selected_slots: missingSelectedSlots,
    qualified_score: qualifiedScore,
    qualification: {
      selected_slot_snapshot_score: {
        qualified: selectedScoreComplete,
        scope: 'Exact selected icon/wide slots only; candidate coverage is not implied unless the exhaustive surface also qualifies.',
      },
      exact_snapshot_exhaustive_surface: {
        qualified: exhaustiveSurfaceQualified,
        requirements: { canonical_candidate_complete: canonicalComplete, fingerprint_complete: fingerprintComplete, safety_complete: safetyComplete, selected_role_adapter_complete: adapterComplete },
      },
      current_ranking_runtime_on_frozen_capture: {
        qualified: runtimeRankingReplayQualified,
        captured_ranking_version: rerank.ranking_version,
        current_runtime_ranking_version: RANKING_VERSION,
        scope: 'Ranking behavior on the exact hashed frozen candidates; extraction and website state are not recaptured.',
      },
      current_end_to_end_runtime: {
        qualified: false,
        reason: 'The audit reuses frozen capture bytes and therefore does not qualify current extraction, reachability, or live website state.',
      },
    },
  };
}

export function selectedLabelGapDiagnostic(results, labels) {
  const exact = new Set(labels.filter(label => label.entity_id && label.candidate_id && (label.review_role ?? label.role))
    .map(label => key(label.entity_id, label.candidate_id, label.review_role ?? label.role)));
  const any = new Set(labels.filter(label => label.entity_id && label.candidate_id)
    .map(label => candidateKey(label.entity_id, label.candidate_id)));
  let selectedSlots = 0;
  let missingRoleSlots = 0;
  const candidatesWithoutAnyLabel = new Set();
  for (const result of results) for (const role of ROLES) {
    const candidateId = result.selected_by_role?.[role];
    if (!candidateId) continue;
    selectedSlots++;
    if (!exact.has(key(result.entity_id, candidateId, role))) missingRoleSlots++;
    if (!any.has(candidateKey(result.entity_id, candidateId))) candidatesWithoutAnyLabel.add(candidateKey(result.entity_id, candidateId));
  }
  return {
    selected_icon_wide_slots: selectedSlots,
    missing_selected_role_slots: missingRoleSlots,
    selected_candidates_without_any_label: candidatesWithoutAnyLabel.size,
  };
}

async function loadCohort(cohort, run, labelsPath, assignmentsPath) {
  const resultsPath = join(resolve(run), 'results.jsonl');
  const [results, labels, assignments, runArtifact, labelsArtifact, assignmentsArtifact] = await Promise.all([
    readJsonl(resultsPath), readJsonl(resolve(labelsPath)), readJsonl(resolve(assignmentsPath)),
    artifact(resultsPath), artifact(labelsPath), artifact(assignmentsPath),
  ]);
  const rerank = await rerankProvenance(run, runArtifact, cohort);
  return auditCohort({ cohort, results, labels, assignments, artifacts: { run: runArtifact, labels: labelsArtifact, assignments: assignmentsArtifact }, rerank });
}

export async function buildRankingQualificationReport(options) {
  const [original, additional] = await Promise.all([
    loadCohort('original-500', options.originalRun, options.originalLabels, options.originalAssignments),
    loadCohort('major-brands-300', options.additionalRun, options.additionalLabels, options.additionalAssignments),
  ]);
  let documentedGapReconciliation;
  if (options.originalReferenceRun) {
    const referencePath = join(resolve(options.originalReferenceRun), 'results.jsonl');
    const [referenceResults, originalLabels, referenceArtifact] = await Promise.all([
      readJsonl(referencePath), readJsonl(resolve(options.originalLabels)), artifact(referencePath),
    ]);
    documentedGapReconciliation = {
      reference_run: referenceArtifact,
      reference: selectedLabelGapDiagnostic(referenceResults, originalLabels),
      current_ranking_v8_replay: {
        selected_icon_wide_slots: original.counts.selected_icon_wide_slots,
        missing_selected_role_slots: original.counts.missing_selected_role_slots,
        selected_candidates_without_any_label: original.counts.selected_candidates_without_any_label,
      },
      conclusion: 'The documented 44 count is reproduced only as selected candidates with no label in the retained ranking-v5 reference. The current ranking-v8 frozen replay has a larger role-slot and candidate-level gap.',
    };
  }
  let reviewPreparation;
  if (options.originalReviewPacket) {
    const packetPath = resolve(options.originalReviewPacket);
    const index = await validatePacket(packetPath);
    reviewPreparation = {
      status: 'prepared_not_adjudicated',
      path: packetPath,
      index: await artifact(join(packetPath, 'index.json')),
      response_template: await artifact(join(packetPath, 'responses-template.jsonl')),
      prompt: await artifact(join(packetPath, 'prompt.md')),
      sheet_count: index.sheet_count,
      entity_count: index.entity_count,
      visual_candidate_count: index.visual_candidate_count,
      candidate_count: index.candidate_count,
      candidate_ids_sha256: index.candidate_ids_sha256,
      source_artifacts: index.source_artifacts,
      limitation: 'This proves a blinded, fingerprint-bound review surface exists. It is not a label artifact and confers no qualification until every response and the exhaustive negative-safety pass validate.',
    };
  }
  return {
    schema_version: 'logo-yoink-cross-cohort-ranking-qualification-v1',
    generated_at: new Date().toISOString(),
    current_runtime_ranking_version: RANKING_VERSION,
    holdout_policy: 'Diagnostic only. The audit has no tuning profile and does not use split or evaluation labels to choose ranking behavior.',
    cohorts: { [original.cohort]: original, [additional.cohort]: additional },
    ...(documentedGapReconciliation ? { documented_gap_reconciliation: documentedGapReconciliation } : {}),
    ...(reviewPreparation ? { original_500_review_preparation: reviewPreparation } : {}),
    cross_cohort_qualification: {
      exact_snapshot_exhaustive_surface: [original, additional].every(cohort => cohort.qualification.exact_snapshot_exhaustive_surface.qualified),
      current_ranking_runtime_on_frozen_captures: [original, additional].every(cohort => cohort.qualification.current_ranking_runtime_on_frozen_capture.qualified),
      current_end_to_end_runtime: false,
    },
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const raw = argv[index];
    if (raw === '--help') options.help = true;
    else if (raw.startsWith('--')) {
      const key = raw.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${raw}`);
      options[key] = value;
    } else throw new Error(`Unexpected argument: ${raw}`);
  }
  return options;
}

function help() {
  return 'Usage: node scripts/benchmark/ranking-qualification-report.mjs --original-run RUN --original-labels LABELS --original-assignments ASSIGNMENTS --additional-run RUN --additional-labels LABELS --additional-assignments ASSIGNMENTS --output REPORT.json';
}

async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, path);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { process.stdout.write(`${help()}\n`); return; }
  for (const field of ['originalRun', 'originalLabels', 'originalAssignments', 'additionalRun', 'additionalLabels', 'additionalAssignments', 'output']) if (!options[field]) throw new Error(help());
  const report = await buildRankingQualificationReport(options);
  await writeAtomic(resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${resolve(options.output)}\ncross-cohort ranking-v${report.current_runtime_ranking_version} frozen-capture-qualified=${report.cross_cohort_qualification.current_ranking_runtime_on_frozen_captures}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(`ranking qualification: ${error.message}\n`);
  process.exitCode = 1;
});
