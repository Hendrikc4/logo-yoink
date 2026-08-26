import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCohort, selectedLabelGapDiagnostic } from '../scripts/benchmark/ranking-qualification-report.mjs';
import { RANKING_VERSION } from '../src/rank.mjs';

const results = [{
  entity_id: 'acme', name: 'Acme', website: 'acme.example',
  selected_by_role: { icon: 'icon', wide: 'wide' },
  candidates: [
    { candidate_id: 'icon', predicted_roles: ['icon'] },
    { candidate_id: 'wide', predicted_roles: ['wide'] },
  ],
}];
const assignments = [{ entity_id: 'acme', benchmark_split: 'development' }];
const artifacts = { run: { sha256: 'a' }, labels: { sha256: 'b' }, assignments: { sha256: 'c' } };
const rerank = { ranking_version: RANKING_VERSION, result_count: 1 };

function canonical(candidateId, roles, safetyClass = 'correct_brand') {
  return {
    schema_version: 'visual-benchmark-v1', record_type: 'label', label_kind: 'candidate',
    label_id: `label-${candidateId}`, entity_id: 'acme', candidate_id: candidateId,
    values: {
      identity: 'correct', roles, safety_class: safetyClass,
      usability_light: 'good', usability_dark: 'good', best_for_role: {},
    },
    provenance: { packet_fingerprint: `sha256:${'a'.repeat(64)}` },
  };
}

function wrongWithSafetyProvenance(candidateId) {
  const label = canonical(candidateId, [], 'not_logo');
  label.values.identity = 'wrong';
  label.values.usability_light = 'unusable';
  label.values.usability_dark = 'unusable';
  label.provenance.safety_adjudication = {
    prompt_version: 'visual-label-safety-v1-exhaustive-negatives',
    packet_fingerprint: label.provenance.packet_fingerprint,
  };
  return label;
}

test('separates missing selected candidates from role-slot gaps for selected-only labels', () => {
  const report = auditCohort({
    cohort: 'synthetic', results, assignments, artifacts, rerank,
    labels: [{ entity_id: 'acme', candidate_id: 'icon', role: 'wide', identity: 'correct' }],
  });
  assert.equal(report.counts.missing_selected_role_slots, 2);
  assert.equal(report.counts.selected_candidates_without_any_label, 1);
  assert.equal(report.missing_selected_slots.find(slot => slot.candidate_id === 'icon').other_role_label, true);
  assert.equal(report.qualification.selected_slot_snapshot_score.qualified, false);
  assert.equal(report.qualification.exact_snapshot_exhaustive_surface.qualified, false);
});

test('reports candidate-level and role-slot gaps separately', () => {
  assert.deepEqual(selectedLabelGapDiagnostic(results, [
    { entity_id: 'acme', candidate_id: 'icon', role: 'wide' },
  ]), {
    selected_icon_wide_slots: 2,
    missing_selected_role_slots: 2,
    selected_candidates_without_any_label: 1,
  });
});

test('qualifies a fingerprint-bound exhaustive surface through the selected-role adapter', () => {
  const report = auditCohort({
    cohort: 'synthetic', results, assignments, artifacts, rerank,
    labels: [canonical('icon', ['icon']), canonical('wide', ['wide'])],
  });
  assert.equal(report.counts.canonical_candidates_unlabeled, 0);
  assert.equal(report.counts.derived_scoring_records, 4);
  assert.equal(report.qualification.selected_slot_snapshot_score.qualified, true);
  assert.equal(report.qualification.exact_snapshot_exhaustive_surface.qualified, true);
  assert.equal(report.qualification.current_ranking_runtime_on_frozen_capture.qualified, true);
  assert.equal(report.qualification.current_end_to_end_runtime.qualified, false);
});

test('rejects current-ranking qualification when replay provenance names another version', () => {
  const report = auditCohort({
    cohort: 'synthetic', results, assignments, artifacts, rerank: { ...rerank, ranking_version: RANKING_VERSION - 1 },
    labels: [canonical('icon', ['icon']), canonical('wide', ['wide'])],
  });
  assert.equal(report.qualification.exact_snapshot_exhaustive_surface.qualified, true);
  assert.equal(report.qualification.current_ranking_runtime_on_frozen_capture.qualified, false);
});

test('requires fingerprint-bound second-pass provenance for canonical negatives', () => {
  const incomplete = auditCohort({
    cohort: 'synthetic', results, assignments, artifacts, rerank,
    labels: [canonical('icon', ['icon']), { ...wrongWithSafetyProvenance('wide'), provenance: { packet_fingerprint: `sha256:${'a'.repeat(64)}` } }],
  });
  assert.equal(incomplete.qualification.exact_snapshot_exhaustive_surface.qualified, false);

  const complete = auditCohort({
    cohort: 'synthetic', results, assignments, artifacts, rerank,
    labels: [canonical('icon', ['icon']), wrongWithSafetyProvenance('wide')],
  });
  assert.equal(complete.counts.fingerprint_bound_negative_safety_labels, 1);
  assert.equal(complete.qualification.exact_snapshot_exhaustive_surface.qualified, true);
});
