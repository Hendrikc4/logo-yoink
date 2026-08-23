#!/usr/bin/env node

/** Canonical visual-benchmark label contract and pilot-row migration helpers. */

// Label IDs stay on the v2 namespace so the canonical pilot rows retain their
// IDs. The review workflow can evolve independently without rewriting history.
export const LABEL_ID_VERSION = 'visual-review-packet-v2';
export const REVIEW_VERSION = 'visual-review-packet-v3-positive-first';
export const RANKER_SAFE_REVIEW_VERSION = 'visual-review-packet-v4-ranker-safe';
export const LABEL_KINDS = ['entity', 'candidate', 'visual_instance', 'missing_role', 'review_attestation'];
export const ROLES = ['icon', 'wide', 'favicon', 'stacked', 'other'];
export const VISUAL_ROLES = ['symbol', 'wordmark', 'horizontal_lockup', 'stacked_lockup', 'favicon', 'social_card', 'badge', 'partner_logo', 'ui_control', 'content_image', 'other'];
export const IDENTITY = ['correct', 'wrong', 'ambiguous'];
export const BRAND_MARK_DECISIONS = ['yes', 'no', 'unclear'];
export const USABILITY = ['good', 'conditional', 'unusable'];
export const MAPPING_CONFIDENCE = ['exact', 'derived', 'suggested', 'unmapped'];
export const MISSING_CAUSES = ['no_graphic_asset_exists', 'icon_only_or_stacked_only', 'asset_visible_not_discovered', 'discovered_not_validated', 'removed_by_url_or_byte_dedupe', 'excluded_by_budget', 'rejected_by_identity_or_evidence', 'rejected_by_shape_or_quality', 'ranked_below_worse_candidate', 'theme_serialization_failure', 'page_blocked_or_incomplete', 'identity_unsafe_or_ambiguous', 'not_missing'];
export const REGIONS = ['header', 'nav', 'body', 'footer', 'metadata', 'browser_chrome', 'unknown', 'other'];
export const THEMES = ['light', 'dark', 'both', 'unknown'];

const valueKeys = {
  entity: new Set(['identity_status', 'graphic_logo_present', 'text_only_brand_present', 'confidence', 'note']),
  candidate: new Set(['identity', 'roles', 'best_for_role', 'usability_light', 'usability_dark', 'provenance_quality', 'quality_defects', 'reject_reason', 'confidence', 'note']),
  visual_instance: new Set(['identity', 'visual_role', 'region', 'theme', 'visibility', 'first_party', 'mapping_confidence', 'confidence', 'note']),
  missing_role: new Set(['missing_cause', 'confidence', 'note']),
  review_attestation: new Set(['visual_evidence_reviewed', 'review_workflow', 'visual_instance_count']),
};

const aliases = new Map([
  ['identity-status', 'identity_status'], ['graphic-logo-present', 'graphic_logo_present'], ['text-only-brand-present', 'text_only_brand_present'],
  ['identity_correctness', 'identity'], ['identity-correctness', 'identity'], ['applicable_roles', 'roles'], ['applicable-roles', 'roles'], ['notes', 'note'],
  ['best-role', 'best_role'], ['best-for-role', 'best_for_role'], ['usability-light', 'usability_light'], ['usability-dark', 'usability_dark'],
  ['provenance-quality', 'provenance_quality'], ['quality-defects', 'quality_defects'], ['reject-reason', 'reject_reason'],
  ['visual-role', 'visual_role'], ['first-party', 'first_party'], ['mapping-confidence', 'mapping_confidence'], ['missing-cause', 'missing_cause'],
  ['horizontal-lockup', 'horizontal_lockup'], ['stacked-lockup', 'stacked_lockup'], ['social-card', 'social_card'], ['partner-logo', 'partner_logo'],
  ['ui-control', 'ui_control'], ['content-image', 'content_image'], ['browser-chrome', 'browser_chrome'],
  ['icon-or-stacked-only', 'icon_only_or_stacked_only'], ['removed-by-dedupe', 'removed_by_url_or_byte_dedupe'],
  ['excluded-by-budget', 'excluded_by_budget'], ['rejected-identity-or-evidence', 'rejected_by_identity_or_evidence'],
  ['rejected-shape-or-quality', 'rejected_by_shape_or_quality'],
  ['icon_or_stacked_only', 'icon_only_or_stacked_only'], ['removed_by_dedupe', 'removed_by_url_or_byte_dedupe'],
  ['rejected_identity_or_evidence', 'rejected_by_identity_or_evidence'], ['rejected_shape_or_quality', 'rejected_by_shape_or_quality'],
]);

function stableReviewId(value) {
  let hash = 2166136261;
  for (const character of String(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export { stableReviewId };

export function targetKeyFor({ labelKind = '', entityId = '', visualInstanceId = '', candidateId = '', role = '' } = {}) {
  const targetRole = labelKind === 'missing_role' ? role : '';
  const targetVisual = labelKind === 'visual_instance' ? visualInstanceId : '';
  const targetCandidate = labelKind === 'candidate' ? candidateId : '';
  return `target-${stableReviewId(['target', labelKind, entityId, targetVisual, targetCandidate, targetRole].join('\0'))}`;
}

export function labelIdFor({ runKey = '', captureKey = '', passId = 'default', reviewerId = 'unassigned', targetKey = '' } = {}) {
  return `label-${stableReviewId(['label', LABEL_ID_VERSION, runKey, captureKey, passId, reviewerId, targetKey].join('\0'))}`;
}

export function identityForBrandMarkDecision(value, context = 'brand-mark decision') {
  const normalized = String(value ?? '').toLowerCase();
  const identity = { yes: 'correct', no: 'wrong', unclear: 'ambiguous' }[normalized];
  if (!identity) throw new Error(`${context}: expected yes, no, or unclear`);
  return identity;
}

function canonicalValueKey(key) {
  if (aliases.has(key)) return aliases.get(key);
  return key;
}

function canonicalChoice(value, list, field, context) {
  if (value === undefined || value === null || value === '') return value;
  const normalized = aliases.get(value) ?? aliases.get(String(value).toLowerCase()) ?? value;
  if (!list.includes(normalized)) throw new Error(`${context}: invalid ${field} ${JSON.stringify(value)}`);
  return normalized;
}

function canonicalBoolean(value, field, context) {
  if (value === true || value === false) return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw new Error(`${context}: ${field} must be boolean`);
}

function normalizeBestForRole(value, context) {
  if (value === undefined || value === null || value === '') return undefined;
  const output = Object.fromEntries(ROLES.map(role => [role, false]));
  if (Array.isArray(value)) {
    for (const role of value) output[canonicalChoice(role, ROLES, 'best_for_role', context)] = true;
  } else if (typeof value === 'object') {
    for (const [role, selected] of Object.entries(value)) output[canonicalChoice(role, ROLES, 'best_for_role', context)] = canonicalBoolean(selected, `best_for_role.${role}`, context);
  } else throw new Error(`${context}: best_for_role must be an array or object`);
  return output;
}

const EVIDENCE_LIMIT_DEFECT = /no[_ -]?verified[_ -]?raster[_ -]?preview|preview unavailable|evidence limit|not enough evidence/i;

export function isRankerSafeWorkflow(labelOrVersion) {
  const version = typeof labelOrVersion === 'string' ? labelOrVersion : labelOrVersion?.provenance?.prompt_version;
  return version === RANKER_SAFE_REVIEW_VERSION;
}

export function normalizeRankerSafeCandidateValues(values, context = 'candidate') {
  const output = { ...values };
  const roles = Array.isArray(output.roles) ? [...new Set(output.roles)].sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b)) : [];
  const best = output.best_for_role && typeof output.best_for_role === 'object' && !Array.isArray(output.best_for_role)
    ? normalizeBestForRole(output.best_for_role, context)
    : normalizeBestForRole([], context);
  output.roles = roles;
  output.best_for_role = best;
  const defects = Array.isArray(output.quality_defects) ? output.quality_defects : [];
  if (defects.some(value => EVIDENCE_LIMIT_DEFECT.test(String(value)))) throw new Error(`${context}: quality_defects cannot contain evidence-limit or preview-availability text`);
  if (output.identity === 'wrong') {
    output.roles = [];
    output.best_for_role = Object.fromEntries(ROLES.map(role => [role, false]));
    output.usability_light = 'unusable';
    output.usability_dark = 'unusable';
  } else if (output.identity === 'ambiguous') {
    output.best_for_role = Object.fromEntries(ROLES.map(role => [role, false]));
  }
  if (output.usability_light === 'unusable' && output.usability_dark === 'unusable') output.best_for_role = Object.fromEntries(ROLES.map(role => [role, false]));
  return output;
}

export function validateRankerSafeCandidateValues(values, context) {
  if (!values || typeof values !== 'object' || !Array.isArray(values.roles) || !values.best_for_role || typeof values.best_for_role !== 'object' || Array.isArray(values.best_for_role)) throw new Error(`${context}: ranker-safe candidate requires roles and best_for_role`);
  const best = normalizeBestForRole(values.best_for_role, context);
  if (JSON.stringify(best) !== JSON.stringify(values.best_for_role)) throw new Error(`${context}: ranker-safe best_for_role must contain all five roles`);
  if (new Set(values.roles).size !== values.roles.length || values.roles.some(role => !ROLES.includes(role)) || JSON.stringify(values.roles) !== JSON.stringify([...values.roles].sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b)))) throw new Error(`${context}: ranker-safe roles must be canonical, deduplicated, and in role order`);
  const defects = Array.isArray(values.quality_defects) ? values.quality_defects : [];
  if (defects.some(value => EVIDENCE_LIMIT_DEFECT.test(String(value)))) throw new Error(`${context}: quality_defects cannot contain evidence-limit or preview-availability text`);
  const bestRoles = ROLES.filter(role => values.best_for_role[role]);
  if (values.identity === 'wrong' && (values.roles.length || bestRoles.length || values.usability_light !== 'unusable' || values.usability_dark !== 'unusable')) throw new Error(`${context}: wrong identity must be an unusable, role-less ranker negative`);
  if (values.identity === 'ambiguous' && bestRoles.length) throw new Error(`${context}: ambiguous identity cannot have best roles`);
  if (values.usability_light === 'unusable' && values.usability_dark === 'unusable' && bestRoles.length) throw new Error(`${context}: both unusable themes cannot have best roles`);
  for (const role of bestRoles) {
    if (!values.roles.includes(role) || values.identity !== 'correct' || !['good', 'conditional'].includes(values.usability_light) && !['good', 'conditional'].includes(values.usability_dark)) throw new Error(`${context}: best role ${role} requires correct identity, role eligibility, and usable theme evidence`);
  }
  return true;
}

export function normalizeLabelRecord(row, { runKey, captureKey, passId, reviewerId, reviewerKind, workflowVersion } = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('label row must be an object');
  const context = row.label_id ? `label ${row.label_id}` : 'label';
  const labelKind = row.label_kind ?? row.labelKind ?? row.kind;
  if (!LABEL_KINDS.includes(labelKind)) throw new Error(`${context}: invalid label_kind ${JSON.stringify(labelKind)}`);
  const entityId = String(row.entity_id ?? row.entityId ?? '');
  if (!entityId) throw new Error(`${context}: entity_id is required`);
  const sourceValues = { ...(row.values && typeof row.values === 'object' && !Array.isArray(row.values) ? row.values : {}) };
  const candidateId = row.candidate_id ?? row.candidateId ?? (row.target_type === 'candidate' ? row.target_id : sourceValues.candidate_id);
  const visualInstanceId = row.visual_instance_id ?? row.visualInstanceId ?? (row.target_type === 'visual_instance' ? row.target_id : sourceValues.visual_instance_id);
  const identityDerivation = row.identity_derivation ?? row.identityDerivation;
  for (const [key, value] of Object.entries(row)) {
    if (!['values', 'schema_version', 'record_type', 'label_id', 'target_key', 'targetKey', 'target_type', 'target_id', 'label_kind', 'labelKind', 'kind', 'entity_id', 'entityId', 'candidate_id', 'candidateId', 'visual_instance_id', 'visualInstanceId', 'identity_derivation', 'identityDerivation', 'role', 'reviewer_id', 'reviewerId', 'reviewer_kind', 'reviewerKind', 'reviewed_at', 'reviewedAt', 'review_pass', 'pass_id', 'passId', 'run_key', 'runKey', 'capture_key', 'captureKey', 'provenance', 'confidence'].includes(key)) {
      const canonical = canonicalValueKey(key);
      if (canonical !== key && Object.prototype.hasOwnProperty.call(sourceValues, canonical)) throw new Error(`${context}: duplicate semantic key ${key}/${canonical}`);
      if (canonical === key && key.includes('-')) throw new Error(`${context}: unknown hyphenated semantic key ${key}`);
      if (Object.prototype.hasOwnProperty.call(sourceValues, key)) throw new Error(`${context}: duplicate semantic key ${key}`);
      sourceValues[key] = value;
    }
  }
  const values = {};
  const droppedMetadata = new Set(['display_name', 'candidate_id', 'visual_instance_id', 'instance_box', 'screenshot_path', 'crop_path', 'overlay_path', 'missing']);
  for (const [rawKey, rawValue] of Object.entries(sourceValues)) {
    const key = canonicalValueKey(rawKey);
    if (droppedMetadata.has(key)) continue;
    if (key === 'cause') {
      if (Object.prototype.hasOwnProperty.call(values, 'missing_cause')) throw new Error(`${context}: duplicate semantic key cause/missing_cause`);
      if (rawValue !== undefined && rawValue !== null) values.missing_cause = rawValue;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(values, key)) throw new Error(`${context}: duplicate semantic key ${rawKey}/${key}`);
    if (rawKey.includes('-') && sourceValues[key] !== undefined && rawKey !== key) { /* legacy alias is accepted once during migration */ }
    values[key] = rawValue;
  }
  if (row.confidence !== undefined && values.confidence === undefined) values.confidence = row.confidence;
  const brandMarkDecision = values.requested_company_brand_mark ?? values.brand_mark_decision;
  if (brandMarkDecision !== undefined) {
    if (values.identity !== undefined) throw new Error(`${context}: duplicate semantic identity/brand-mark decision`);
    values.identity = identityForBrandMarkDecision(brandMarkDecision, context);
  }
  delete values.requested_company_brand_mark;
  delete values.brand_mark_decision;
  const legacyBestRole = values.best_role;
  if (values.best_for_role !== undefined) values.best_for_role = normalizeBestForRole(values.best_for_role, context);
  else if (legacyBestRole !== undefined) values.best_for_role = normalizeBestForRole([legacyBestRole], context);
  else if (labelKind === 'candidate') values.best_for_role = normalizeBestForRole([], context);
  delete values.best_role;
  if (values.missing_cause == null && labelKind === 'missing_role' && sourceValues.missing === false) values.missing_cause = 'not_missing';
  if (values.roles !== undefined && !Array.isArray(values.roles)) values.roles = [values.roles];
  if (Array.isArray(values.roles)) values.roles = [...new Set(values.roles.map(role => canonicalChoice(role, ROLES, 'roles', context)))].sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b));
  if (values.quality_defects !== undefined && !Array.isArray(values.quality_defects)) values.quality_defects = values.quality_defects === '' || values.quality_defects === 'none' ? [] : [String(values.quality_defects)];
  if (values.best_for_role && values.roles === undefined) values.roles = ROLES.filter(role => values.best_for_role[role]);
  if (values.identity !== undefined) values.identity = canonicalChoice(values.identity, IDENTITY, 'identity', context);
  if (values.identity_status !== undefined) values.identity_status = canonicalChoice(values.identity_status, ['current', 'related_rebrand', 'wrong_site', 'ambiguous', 'unreachable'], 'identity_status', context);
  if (values.visual_role !== undefined) values.visual_role = canonicalChoice(values.visual_role, VISUAL_ROLES, 'visual_role', context);
  if (values.region !== undefined) values.region = canonicalChoice(values.region, REGIONS, 'region', context);
  if (values.theme !== undefined) values.theme = canonicalChoice(values.theme, THEMES, 'theme', context);
  if (values.visibility !== undefined) values.visibility = canonicalChoice(values.visibility, USABILITY, 'visibility', context);
  if (values.mapping_confidence !== undefined) values.mapping_confidence = canonicalChoice(values.mapping_confidence, MAPPING_CONFIDENCE, 'mapping_confidence', context);
  if (values.missing_cause !== undefined) values.missing_cause = canonicalChoice(values.missing_cause, MISSING_CAUSES, 'missing_cause', context);
  if (values.usability_light !== undefined) values.usability_light = canonicalChoice(values.usability_light, USABILITY, 'usability_light', context);
  if (values.usability_dark !== undefined) values.usability_dark = canonicalChoice(values.usability_dark, USABILITY, 'usability_dark', context);
  if (values.provenance_quality !== undefined) values.provenance_quality = canonicalChoice(values.provenance_quality, ['visible_exact_use', 'structured_first_party', 'inferred_first_party', 'unsupported'], 'provenance_quality', context);
  if (values.visual_evidence_reviewed !== undefined) values.visual_evidence_reviewed = canonicalBoolean(values.visual_evidence_reviewed, 'visual_evidence_reviewed', context);
  if (values.review_workflow !== undefined) values.review_workflow = canonicalChoice(values.review_workflow, ['positive_first'], 'review_workflow', context);
  if (values.visual_instance_count !== undefined && (!Number.isInteger(values.visual_instance_count) || values.visual_instance_count < 0)) throw new Error(`${context}: visual_instance_count must be a non-negative integer`);
  if (labelKind === 'candidate' && (workflowVersion === RANKER_SAFE_REVIEW_VERSION || row.provenance?.prompt_version === RANKER_SAFE_REVIEW_VERSION)) Object.assign(values, normalizeRankerSafeCandidateValues(values, context));
  const rawRole = row.role ?? values.role ?? (labelKind === 'visual_instance' ? values.visual_role : undefined);
  const role = rawRole === undefined ? undefined : canonicalChoice(rawRole, labelKind === 'visual_instance' ? VISUAL_ROLES : ROLES, 'role', context);
  if (values.role !== undefined) delete values.role;
  const normalizedRunKey = String(runKey ?? row.run_key ?? row.runKey ?? row.provenance?.run_key ?? 'run');
  const normalizedCaptureKey = String(captureKey ?? row.capture_key ?? row.captureKey ?? row.provenance?.capture_key ?? 'capture');
  const normalizedPassId = String(passId ?? row.review_pass ?? row.pass_id ?? row.passId ?? 'default');
  const normalizedReviewerId = String(reviewerId ?? row.reviewer_id ?? row.reviewerId ?? 'unassigned');
  const normalizedTarget = targetKeyFor({ labelKind, entityId, visualInstanceId: visualInstanceId ?? '', candidateId: candidateId ?? '', role: role ?? '' });
  return {
    schema_version: 'visual-benchmark-v1', record_type: 'label',
    label_id: labelIdFor({ runKey: normalizedRunKey, captureKey: normalizedCaptureKey, passId: normalizedPassId, reviewerId: normalizedReviewerId, targetKey: normalizedTarget }),
    target_key: normalizedTarget, label_kind: labelKind, entity_id: entityId,
    ...(candidateId ? { candidate_id: String(candidateId) } : {}),
    ...(visualInstanceId ? { visual_instance_id: String(visualInstanceId) } : {}),
    ...(identityDerivation ? { identity_derivation: identityDerivation } : {}),
    ...(role ? { role } : {}),
    values, reviewer_id: normalizedReviewerId, reviewer_kind: String(reviewerKind ?? row.reviewer_kind ?? row.reviewerKind ?? 'unassigned'),
    review_pass: normalizedPassId, run_key: normalizedRunKey, capture_key: normalizedCaptureKey,
    reviewed_at: String(row.reviewed_at ?? row.reviewedAt ?? new Date().toISOString()),
    provenance: row.provenance ?? { schema_version: 'visual-benchmark-v1', capture_version: normalizedCaptureKey, task_id: null },
  };
}

export function validateCanonicalLabel(label, context = 'label') {
  if (!label || typeof label !== 'object' || Array.isArray(label)) throw new Error(`${context}: label must be an object`);
  if (!LABEL_KINDS.includes(label.label_kind)) throw new Error(`${context}: invalid label_kind ${JSON.stringify(label.label_kind)}`);
  const allowed = new Set(['schema_version', 'record_type', 'label_id', 'target_key', 'label_kind', 'entity_id', 'candidate_id', 'visual_instance_id', 'identity_derivation', 'role', 'values', 'reviewer_id', 'reviewer_kind', 'review_pass', 'run_key', 'capture_key', 'reviewed_at', 'provenance']);
  for (const key of Object.keys(label)) {
    if (key.includes('-')) throw new Error(`${context}: semantic keys must use snake_case (${key})`);
    if (!allowed.has(key)) throw new Error(`${context}: unknown semantic key ${key}`);
  }
  if (!label.target_key || !label.entity_id || !label.values || typeof label.values !== 'object' || Array.isArray(label.values)) throw new Error(`${context}: target_key, entity_id, and object values are required`);
  const expectedTarget = targetKeyFor({ labelKind: label.label_kind, entityId: label.entity_id, visualInstanceId: label.visual_instance_id ?? '', candidateId: label.candidate_id ?? '', role: label.role ?? '' });
  if (label.target_key !== expectedTarget) throw new Error(`${context}: target_key mismatch (expected ${expectedTarget})`);
  const expectedLabel = labelIdFor({ runKey: label.run_key ?? 'run', captureKey: label.capture_key ?? 'capture', passId: label.review_pass ?? 'default', reviewerId: label.reviewer_id ?? 'unassigned', targetKey: expectedTarget });
  if (label.label_id !== expectedLabel) throw new Error(`${context}: label_id mismatch (expected reviewer-scoped ${expectedLabel})`);
  const keys = valueKeys[label.label_kind];
  for (const key of Object.keys(label.values)) {
    if (key.includes('-') || !keys.has(key)) throw new Error(`${context}: unknown or non-canonical semantic value key ${key}`);
  }
  if (label.label_kind === 'candidate' && label.candidate_id == null) throw new Error(`${context}: candidate label requires candidate_id`);
  if (label.label_kind === 'visual_instance' && label.visual_instance_id == null) throw new Error(`${context}: visual_instance label requires visual_instance_id`);
  if (label.label_kind === 'missing_role' && !ROLES.includes(label.role)) throw new Error(`${context}: missing_role label requires a canonical role`);
  if (label.label_kind === 'visual_instance' && label.role !== undefined && !VISUAL_ROLES.includes(label.role)) throw new Error(`${context}: invalid visual role ${JSON.stringify(label.role)}`);
  if (label.label_kind === 'candidate' && label.role !== undefined && !ROLES.includes(label.role)) throw new Error(`${context}: invalid candidate role ${JSON.stringify(label.role)}`);
  if (label.label_kind === 'entity' && (label.candidate_id != null || label.visual_instance_id != null || label.role != null)) throw new Error(`${context}: entity labels cannot target candidate, visual_instance, or role`);
  if (label.label_kind === 'review_attestation') {
    if (label.candidate_id != null || label.visual_instance_id != null || label.role != null) throw new Error(`${context}: review attestation cannot target candidate, visual_instance, or role`);
    if (label.values.visual_evidence_reviewed !== true || label.values.review_workflow !== 'positive_first') throw new Error(`${context}: review attestation must affirm the positive-first visual evidence review`);
    if (!Number.isInteger(label.values.visual_instance_count) || label.values.visual_instance_count < 0) throw new Error(`${context}: review attestation requires a non-negative visual_instance_count`);
  }
  if (label.identity_derivation !== undefined) {
    if (label.label_kind !== 'visual_instance') throw new Error(`${context}: identity_derivation is valid only for visual_instance labels`);
    const derivation = label.identity_derivation;
    const derivationKeys = ['type', 'mapping_id', 'candidate_id', 'candidate_label_id'];
    if (!derivation || typeof derivation !== 'object' || Array.isArray(derivation) || Object.keys(derivation).some(key => !derivationKeys.includes(key)) || derivationKeys.some(key => typeof derivation[key] !== 'string' || !derivation[key])) throw new Error(`${context}: invalid identity_derivation`);
    if (derivation.type !== 'exact_candidate_mapping') throw new Error(`${context}: unsupported identity_derivation type`);
    if (label.candidate_id !== derivation.candidate_id) throw new Error(`${context}: identity_derivation candidate_id mismatch`);
    if (!/^label-[0-9a-f]{8}$/.test(derivation.candidate_label_id)) throw new Error(`${context}: invalid identity_derivation candidate_label_id`);
    if (!IDENTITY.includes(label.values.identity)) throw new Error(`${context}: derived visual identity is required`);
  }
  if (label.values.best_role !== undefined) throw new Error(`${context}: best_role is legacy-only; use best_for_role`);
  if (label.values.best_for_role !== undefined) {
    const normalized = normalizeBestForRole(label.values.best_for_role, context);
    if (JSON.stringify(normalized) !== JSON.stringify(label.values.best_for_role)) throw new Error(`${context}: best_for_role must contain every canonical role in canonical order`);
  }
  if (label.values.roles !== undefined) {
    if (!Array.isArray(label.values.roles) || label.values.roles.some(role => !ROLES.includes(role)) || new Set(label.values.roles).size !== label.values.roles.length || JSON.stringify(label.values.roles) !== JSON.stringify([...label.values.roles].sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b)))) throw new Error(`${context}: roles must be deduplicated and in canonical role order`);
  }
  const choiceChecks = {
    identity: IDENTITY, identity_status: ['current', 'related_rebrand', 'wrong_site', 'ambiguous', 'unreachable'],
    usability_light: USABILITY, usability_dark: USABILITY,
    visual_role: VISUAL_ROLES, region: REGIONS, theme: THEMES, visibility: USABILITY,
    first_party: ['yes', 'no', 'ambiguous'], mapping_confidence: MAPPING_CONFIDENCE,
    missing_cause: MISSING_CAUSES, provenance_quality: ['visible_exact_use', 'structured_first_party', 'inferred_first_party', 'unsupported'],
    graphic_logo_present: ['true', 'false', 'ambiguous'], text_only_brand_present: ['true', 'false', 'ambiguous'],
  };
  for (const [key, choices] of Object.entries(choiceChecks)) if (label.values[key] !== undefined && !choices.includes(label.values[key])) throw new Error(`${context}: invalid ${key} ${JSON.stringify(label.values[key])}`);
  if (label.values.confidence !== undefined && !['string', 'number'].includes(typeof label.values.confidence)) throw new Error(`${context}: confidence must be a string or number`);
  if (label.values.visual_evidence_reviewed !== undefined && typeof label.values.visual_evidence_reviewed !== 'boolean') throw new Error(`${context}: visual_evidence_reviewed must be boolean`);
  if (label.values.visual_instance_count !== undefined && (!Number.isInteger(label.values.visual_instance_count) || label.values.visual_instance_count < 0)) throw new Error(`${context}: visual_instance_count must be a non-negative integer`);
  if (label.values.quality_defects !== undefined && (!Array.isArray(label.values.quality_defects) || label.values.quality_defects.some(value => typeof value !== 'string'))) throw new Error(`${context}: quality_defects must be an array of strings`);
  for (const key of ['reject_reason', 'note']) if (label.values[key] !== undefined && label.values[key] !== null && typeof label.values[key] !== 'string') throw new Error(`${context}: ${key} must be a string or null`);
  if (label.label_kind === 'candidate' && isRankerSafeWorkflow(label)) validateRankerSafeCandidateValues(label.values, context);
  return true;
}
