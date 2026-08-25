#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { measureTinyImageSuitability } from '../src/tiny-image-suitability.mjs';
import { faviconRankScore } from '../src/rank.mjs';

const ROLES = ['icon', 'wide', 'favicon'];
const DEFAULT_ROOT = 'runs/visual-benchmark-v1-500-v1/merged';
const DEFAULT_LABELS = `${DEFAULT_ROOT}/label-sheets-v3/candidate-labels-500-v1-adjudicated.jsonl`;
const DEFAULT_BASELINE = `${DEFAULT_ROOT}/label-sheets-v3/baseline-current-system-v1.json`;
const DEFAULT_BASELINE_SELECTIONS = `${DEFAULT_ROOT}/label-sheets-v3/baseline-current-system-selections.jsonl`;

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, labels: DEFAULT_LABELS, splits: ['development', 'validation'], profiles: [] };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--root') options.root = argv[++index];
    else if (argument === '--labels') options.labels = argv[++index];
    else if (argument === '--output') options.output = argv[++index];
    else if (argument === '--selections-output') options.selectionsOutput = argv[++index];
    else if (argument === '--splits') options.splits = argv[++index].split(',').filter(Boolean);
    else if (argument === '--profiles') options.profiles = argv[++index].split(',').filter(Boolean);
    else if (argument === '--baseline-check') { options.baselineCheck = true; options.splits = ['development', 'validation', 'evaluation']; }
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function jsonLines(path) {
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${path}:${index + 1}: ${error.message}`); }
  });
}

function ratio(numerator, denominator) { return denominator ? numerator / denominator : null; }
function themeValue(value) { return ({ good: 1, conditional: 0.5, unusable: 0 })[String(value ?? '').toLowerCase()] ?? 0; }
function bothThemes(label) { return label?.values?.usability_light === 'good' && label?.values?.usability_dark === 'good'; }
function anyTheme(label) { return Math.max(themeValue(label?.values?.usability_light), themeValue(label?.values?.usability_dark)) > 0; }
function roleCorrect(label, role) { return label?.values?.identity === 'correct' && label.values.roles?.includes(role); }

function roleMetrics(entities, candidatesByEntity, labelsByCandidate, selections, role) {
  let available = 0, bestAvailable = 0, selected = 0, identityCorrect = 0, roleCorrectCount = 0;
  let wrongIdentity = 0, ambiguousIdentity = 0, bestSelected = 0, usableAny = 0, usableBoth = 0;
  for (const entity of entities) {
    const candidates = candidatesByEntity.get(entity.entity_id) ?? [];
    const labels = candidates.map(candidate => labelsByCandidate.get(`${entity.entity_id}\0${candidate.candidate_id}`)).filter(Boolean);
    if (labels.some(label => roleCorrect(label, role))) available++;
    if (labels.some(label => roleCorrect(label, role) && label.values.best_for_role?.[role])) bestAvailable++;
    const selection = selections.get(`${entity.entity_id}\0${role}`);
    if (!selection) continue;
    selected++;
    const label = labelsByCandidate.get(`${entity.entity_id}\0${selection.candidate_id}`);
    if (!label) continue;
    if (label.values.identity === 'correct') identityCorrect++;
    else if (label.values.identity === 'wrong') wrongIdentity++;
    else if (label.values.identity === 'ambiguous') ambiguousIdentity++;
    if (!roleCorrect(label, role)) continue;
    roleCorrectCount++;
    if (label.values.best_for_role?.[role]) bestSelected++;
    if (anyTheme(label)) usableAny++;
    if (bothThemes(label)) usableBoth++;
  }
  return {
    ground_truth_available_entities: available,
    ground_truth_best_entities: bestAvailable,
    selected,
    answer_rate: ratio(selected, entities.length),
    identity_correct: identityCorrect,
    role_correct: roleCorrectCount,
    wrong_identity: wrongIdentity,
    ambiguous_identity: ambiguousIdentity,
    best_selected: bestSelected,
    usable_on_any_theme: usableAny,
    usable_on_both_themes: usableBoth,
    identity_precision: ratio(identityCorrect, selected),
    role_precision: ratio(roleCorrectCount, selected),
    discovery_recall: ratio(available, entities.length),
    conditional_rank_recall: ratio(roleCorrectCount, available),
    end_to_end_recall: ratio(roleCorrectCount, entities.length),
    best_hit_rate: ratio(bestSelected, bestAvailable),
  };
}

function populationMetrics(entities, candidatesByEntity, labelsByCandidate, selections) {
  const roles = Object.fromEntries(ROLES.map(role => [role, roleMetrics(entities, candidatesByEntity, labelsByCandidate, selections, role)]));
  let correctDomains = 0, wrongDomains = 0;
  for (const entity of entities) {
    let correct = false, wrong = false;
    // Preserve the frozen aggregate's historical behavior: despite its legacy
    // field name, it unions role-correct answers across all three output roles.
    for (const role of ROLES) {
      const selection = selections.get(`${entity.entity_id}\0${role}`);
      const label = selection && labelsByCandidate.get(`${entity.entity_id}\0${selection.candidate_id}`);
      correct ||= roleCorrect(label, role);
      if (role !== 'favicon') wrong ||= label?.values?.identity === 'wrong';
    }
    if (correct) correctDomains++;
    if (wrong) wrongDomains++;
  }
  const withCandidates = entities.filter(entity => (candidatesByEntity.get(entity.entity_id) ?? []).length > 0).length;
  const withAnyPositive = entities.filter(entity => (candidatesByEntity.get(entity.entity_id) ?? []).some(candidate => {
    const label = candidate && labelsByCandidate.get(`${entity.entity_id}\0${candidate.candidate_id}`);
    return label?.values?.identity === 'correct' && label.values.roles?.length;
  })).length;
  return { entities: entities.length, with_candidates: withCandidates, with_any_positive: withAnyPositive, roles, correct_icon_or_wide_domains: correctDomains, wrong_brand_icon_or_wide_domains: wrongDomains };
}

function qualitySubtotal(metrics, entities, labelsByCandidate, selections) {
  const denominator = entities.length;
  let usability = 0;
  for (const entity of entities) for (const role of ['icon', 'wide']) {
    const selection = selections.get(`${entity.entity_id}\0${role}`);
    const label = selection && labelsByCandidate.get(`${entity.entity_id}\0${selection.candidate_id}`);
    if (roleCorrect(label, role)) usability += (themeValue(label.values.usability_light) + themeValue(label.values.usability_dark)) / 2;
  }
  const candidateSetCoverage = 15 * ratio(metrics.roles.icon.ground_truth_available_entities, denominator) + 15 * ratio(metrics.roles.wide.ground_truth_available_entities, denominator);
  const top1RoleCorrectness = 15 * ratio(metrics.roles.icon.role_correct, denominator) + 15 * ratio(metrics.roles.wide.role_correct, denominator);
  const visualUsability = 10 * ratio(usability, denominator);
  const wrongBrandSafety = 10 * Math.max(0, 1 - ratio(metrics.wrong_brand_icon_or_wide_domains, denominator) / 0.1);
  const total = candidateSetCoverage + top1RoleCorrectness + visualUsability + wrongBrandSafety;
  return { candidate_set_coverage: candidateSetCoverage, top1_role_correctness: top1RoleCorrectness, visual_usability: visualUsability, wrong_brand_safety: wrongBrandSafety, total, maximum: 90, normalized_percent: total / 90 * 100 };
}

function storedSelections(entities, candidatesByEntity) {
  const selections = new Map();
  for (const entity of entities) for (const role of ROLES) {
    const candidate = (candidatesByEntity.get(entity.entity_id) ?? [])
      .filter(item => item.predicted_roles?.includes(role))
      .sort((left, right) => (right.role_scores?.[role] ?? 0) - (left.role_scores?.[role] ?? 0))[0];
    if (candidate) selections.set(`${entity.entity_id}\0${role}`, candidate);
  }
  return selections;
}

function companyAgreementSnapshot(candidate, companyName) {
  const words = String(companyName ?? '').toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|company|co)\b\.?/g, ' ').match(/[a-z0-9]+/g) ?? [];
  let path = '';
  try { path = decodeURIComponent(new URL(candidate.resolved_url ?? candidate.source_url).pathname).toLowerCase(); } catch { /* No path evidence. */ }
  return words.some(word => word.length >= 3 && path.includes(word));
}

function hasBothThemeEvidence(candidate) {
  const themes = new Set(candidate.feature_snapshot?.themes ?? []);
  return themes.has('light') && themes.has('dark');
}

function sameHostname(candidate) {
  try { return new URL(candidate.resolved_url).hostname.replace(/^www\./, '') === new URL(candidate.source_url).hostname.replace(/^www\./, ''); }
  catch { return false; }
}

function recoverableWide(candidate) {
  const snapshot = candidate.feature_snapshot ?? {};
  const ratio = candidate.width && candidate.height ? candidate.width / candidate.height : null;
  return ratio >= 1.8 && ratio <= 12 && sameHostname(candidate) && snapshot.positive_token && ['header', 'nav'].includes(snapshot.dom_region) &&
    candidate.score_reasons?.some(reason => reason.includes('generic exclusion (foreign named logo)'));
}
const RESCORED_REASON_LINES = ['square shape', 'non-square icon', 'wide shape', 'non-wide shape', 'favicon source', 'non-favicon source'];
const FAVICON_FAMILY_SOURCES = ['manifest', 'apple', 'mask-icon', 'ms-tile', 'html-icon', 'besticon', 'google-favicon', 'duckduckgo-favicon', 'root-favicon'];

function candidateUrl(candidate) { return String(candidate.resolved_url ?? candidate.source_url ?? ''); }
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; } }
function candidateRatio(candidate) { return candidate.width && candidate.height ? candidate.width / candidate.height : null; }

// Rebuild the pre-exclusion confidence from stored reason lines. Shape and source lines are
// stripped so rescues re-apply them from measured geometry instead of double-counting.
function recomputeConfidence(candidate, { keepExclusion = true } = {}) {
  let confidence = 0;
  for (const reason of candidate.score_reasons ?? []) {
    const match = reason.match(/\s([+-]\d+)$/);
    if (!match || RESCORED_REASON_LINES.some(line => reason.startsWith(line))) continue;
    if (!keepExclusion && reason.includes('generic exclusion')) continue;
    confidence += Number(match[1]);
  }
  return confidence;
}

function rescoredWide(confidence, candidate) {
  const ratio = candidateRatio(candidate);
  const faviconSource = FAVICON_FAMILY_SOURCES.includes(candidate.source);
  return confidence + (ratio != null && ratio >= 1.8 && ratio <= 12 ? 30 : -18) + (faviconSource ? -18 : 0);
}

function companyWordsOf(name) {
  return [...String(name ?? '').toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|company|co)\b\.?/g, ' ').match(/[a-z0-9]+/g) ?? []].filter(word => word.length >= 4);
}

function firstPartyHosted(candidate, companyName) {
  const assetHost = hostOf(candidateUrl(candidate));
  if (!assetHost) return true;
  if (assetHost === hostOf(candidate.source_url ?? '')) return true;
  const tokens = new Set(assetHost.match(/[a-z0-9]+/g) ?? []);
  const words = companyWordsOf(companyName);
  if (words.some(word => [...tokens].some(token => token.includes(word) || word.includes(token)))) return true;
  if (/cdn|static|asset|content|media|image|img|user|files|blob|storage|optimole|builder|uploads/.test(assetHost)) return true;
  try {
    const path = decodeURIComponent(new URL(candidateUrl(candidate)).pathname).toLowerCase();
    if (words.some(word => path.includes(word))) return true;
  } catch { /* data and inline candidates are first-party by construction. */ }
  return false;
}

// Selection profile tuned on the development split and confirmed on validation
// (docs/selection-v2-experiment-2026-08-24.md): padded-wordmark icon demotion, favicon-size
// preference, rendered-SVG twin preference, relaxed wide shape under strong first-party
// evidence, same-origin foreign-named-logo rescue, small favicon-family icon fallback,
// and off-host abstention when every asset lives on an unrelated third-party host.
function selectionV2(entitiesIn, candidatesByEntity) {
  const selections = new Map();
  for (const entity of entitiesIn) {
    const list = candidatesByEntity.get(entity.entity_id) ?? [];
    for (const role of ROLES) {
      if (!list.length) continue;
      if (list.every(candidate => !firstPartyHosted(candidate, entity.name))) { selections.set(`${entity.entity_id}\0${role}`, null); continue; }

      let pool = list.filter(item => item.predicted_roles?.includes(role));
      const adjusted = new Map();
      const rescored = new Set();
      const effective = item => rescored.has(item.candidate_id) ? (adjusted.get(item.candidate_id) ?? 0) : (item.role_scores?.[role] ?? 0) + (adjusted.get(item.candidate_id) ?? 0);

      if (role === 'icon' && pool.length === 0) {
        pool = list.filter(item => FAVICON_FAMILY_SOURCES.includes(item.source) &&
          Math.min(item.width ?? 99, item.height ?? 99) >= 14);
      }
      if (role === 'icon') {
        for (const item of list) {
          if (item.predicted_roles?.includes('icon') || item.source !== 'browser-inline-svg' ||
            !(item.feature_snapshot?.home_linked && ['header', 'nav'].includes(item.feature_snapshot?.dom_region))) continue;
          const edge = Math.min(item.width ?? 99, item.height ?? 99);
          const ratio = candidateRatio(item);
          if (edge < 20 || edge >= 32 || (ratio != null && (ratio < 0.72 || ratio > 1.4))) continue;
          pool.push(item);
        }
        for (const item of pool) {
          if ((item.score_reasons ?? []).some(reason => reason.includes('wide shape (content box)'))) adjusted.set(item.candidate_id, (adjusted.get(item.candidate_id) ?? 0) - 40);
          const edge = Math.min(item.width ?? Infinity, item.height ?? Infinity);
          if (FAVICON_FAMILY_SOURCES.includes(item.source)) adjusted.set(item.candidate_id, (adjusted.get(item.candidate_id) ?? 0) + (edge >= 180 ? 8 : edge >= 96 ? 4 : 0));
        }
        // A serialized static SVG can render blank outside its page; when a rendered
        // browser twin of the same geometry exists, prefer the rendered one.
        for (const item of [...pool]) {
          if (item.source !== 'inline-svg' || rescored.has(item.candidate_id)) continue;
          const near = (a, b) => Math.abs(a - b) <= Math.max(4, 0.12 * Math.max(a, b));
          const twin = list.find(other => other.source === 'browser-inline-svg' &&
            !(other.score_reasons ?? []).some(reason => reason.startsWith('generic exclusion')) &&
            near(other.width ?? 0, item.width ?? 0) && near(other.height ?? 0, item.height ?? 0));
          if (!twin) continue;
          const staticScore = item.role_scores?.[role] ?? 0;
          if (!pool.includes(twin)) { pool.push(twin); adjusted.set(twin.candidate_id, Math.max(twin.role_scores?.[role] ?? 0, staticScore)); rescored.add(twin.candidate_id); }
          adjusted.set(item.candidate_id, (adjusted.get(item.candidate_id) ?? 0) - 25);
        }
      }
      // Same-origin header/nav marks mislabelled as foreign named logos get one re-scored chance.
      for (const item of list) {
        if (!(item.score_reasons ?? []).some(reason => reason.includes('foreign named logo'))) continue;
        const snapshot = item.feature_snapshot ?? {};
        if (!snapshot.positive_token || !['header', 'nav'].includes(snapshot.dom_region)) continue;
        if (hostOf(candidateUrl(item)) !== hostOf(item.source_url ?? '')) continue;
        const confidence = recomputeConfidence(item, { keepExclusion: false });
        const ratio = candidateRatio(item);
        if (role === 'wide') {
          if (ratio == null || ratio < 1.8) continue;
          const score = rescoredWide(confidence, item);
          if (score >= 35) { pool.push(item); adjusted.set(item.candidate_id, score); rescored.add(item.candidate_id); }
        } else if (role === 'icon') {
          const square = ratio != null && ratio >= 0.72 && ratio <= 1.4;
          const score = confidence + (square ? 28 : -12);
          if (score >= 35 && square) { pool.push(item); adjusted.set(item.candidate_id, score); rescored.add(item.candidate_id); }
        }
      }
      if (role === 'wide') {
        for (const item of list) {
          if (item.predicted_roles?.includes('wide')) continue;
          const ratio = candidateRatio(item);
          if (ratio == null || ratio < 1.45 || ratio > 12 || (item.width ?? 0) < 120 || (item.height ?? 0) < 36) continue;
          const snapshot = item.feature_snapshot ?? {};
          const strong = snapshot.home_linked || ['header', 'nav'].includes(snapshot.dom_region) || ['schema', 'og-logo', 'microdata'].includes(item.source);
          if (!strong || (item.score_reasons ?? []).some(reason => reason.startsWith('generic exclusion'))) continue;
          const score = rescoredWide(recomputeConfidence(item), item);
          if (score < 35) continue;
          pool.push(item); adjusted.set(item.candidate_id, score); rescored.add(item.candidate_id);
        }
      }

      pool.sort((left, right) => effective(right) - effective(left));
      if (pool[0]) selections.set(`${entity.entity_id}\0${role}`, pool[0]);
    }
  }
  return selections;
}



function experimentalSelections(entities, candidatesByEntity, profiles) {
  const enabled = new Set(profiles);
  if (enabled.has('selection-v2')) {
    const merged = storedSelections(entities, candidatesByEntity);
    for (const [key, value] of selectionV2(entities, candidatesByEntity)) {
      if (value === null) merged.delete(key);
      else merged.set(key, value);
    }
    return merged;
  }
  const selections = new Map();
  for (const entity of entities) for (const role of ROLES) {
    const candidates = (candidatesByEntity.get(entity.entity_id) ?? []).filter(item => item.predicted_roles?.includes(role) || (role === 'wide' && enabled.has('wide-header-recovery-v1') && recoverableWide(item)));
    const ranked = candidates.map((candidate, index) => ({ candidate, index, effective: (candidate.role_scores?.[role] ?? 0) + (role === 'wide' && recoverableWide(candidate) ? 100 : 0) }));
    if (role === 'favicon' && enabled.has('favicon-tiny-v1')) for (const item of ranked) item.effective = faviconRankScore(item.candidate);
    if (role === 'icon' && enabled.has('icon-evidence-v1')) for (const item of ranked) {
      const candidate = item.candidate, snapshot = candidate.feature_snapshot ?? {};
      const faviconFamily = ['manifest', 'apple', 'mask-icon', 'ms-tile', 'html-icon', 'besticon', 'google-favicon', 'duckduckgo-favicon', 'root-favicon'].includes(candidate.source);
      const visibleEvidence = snapshot.home_linked || (snapshot.positive_token && ['header', 'nav'].includes(snapshot.dom_region));
      if (faviconFamily && !visibleEvidence && !companyAgreementSnapshot(candidate, entity.name)) item.effective -= 10;
    }
    ranked.sort((left, right) => {
      if (role === 'wide' && enabled.has('wide-theme-v1') && Math.abs(right.effective - left.effective) <= 4) {
        const themeDifference = Number(hasBothThemeEvidence(right.candidate)) - Number(hasBothThemeEvidence(left.candidate));
        if (themeDifference) return themeDifference;
      }
      return right.effective - left.effective || left.index - right.index;
    });
    if (ranked[0]) selections.set(`${entity.entity_id}\0${role}`, ranked[0].candidate);
  }
  return selections;
}

async function attachFrozenTinySuitability(candidates, root) {
  let cursor = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor++];
      const ratio = candidate.width && candidate.height ? candidate.width / candidate.height : null;
      if (!candidate.predicted_roles?.includes('favicon') || !candidate.asset_path || (ratio != null && (ratio < 0.72 || ratio > 1.4))) continue;
      candidate.tinySuitability = await measureTinyImageSuitability(resolve(root, candidate.asset_path)) ?? { score: 0 };
    }
  }));
}

function selectionRows(entities, selections, labelsByCandidate) {
  return entities.flatMap(entity => ROLES.map(role => {
    const candidate = selections.get(`${entity.entity_id}\0${role}`);
    const label = candidate && labelsByCandidate.get(`${entity.entity_id}\0${candidate.candidate_id}`);
    const correct = roleCorrect(label, role);
    const outcome = !candidate ? 'no_selection' : correct ? 'correct_role' : label?.values?.identity === 'correct' ? 'correct_brand_wrong_role' : label?.values?.identity === 'ambiguous' ? 'ambiguous' : 'wrong';
    return { entity_id: entity.entity_id, company_name: entity.name, benchmark_split: entity.benchmark_split, role, candidate_id: candidate?.candidate_id ?? null, role_score: candidate?.role_scores?.[role] ?? null, identity: label?.values?.identity ?? null, labeled_roles: label?.values?.roles ?? [], role_correct: correct, best: Boolean(label?.values?.best_for_role?.[role]), usability_light: label?.values?.usability_light ?? null, usability_dark: label?.values?.usability_dark ?? null, outcome };
  }));
}

function comparableBaseline(value) {
  const withoutAnswerRate = population => ({ ...population, roles: Object.fromEntries(Object.entries(population.roles).map(([role, metrics]) => {
    const { answer_rate, ...baselineMetrics } = metrics;
    return [role, baselineMetrics];
  })) });
  return {
    population: value.population,
    overall: withoutAnswerRate(value.overall),
    splits: Object.fromEntries(Object.entries(value.splits).map(([split, metrics]) => [split, withoutAnswerRate(metrics)])),
    quality_subtotal: value.quality_subtotal,
  };
}

function equivalentMetrics(actual, expected) {
  if (typeof actual === 'number' && typeof expected === 'number') return Math.abs(actual - expected) < 1e-12;
  if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') return actual === expected;
  const actualKeys = Object.keys(actual), expectedKeys = Object.keys(expected);
  return actualKeys.length === expectedKeys.length && actualKeys.every(key => Object.hasOwn(expected, key) && equivalentMetrics(actual[key], expected[key]));
}

export async function replay(options = {}) {
  const root = resolve(options.root ?? DEFAULT_ROOT);
  const labelsPath = resolve(options.labels ?? DEFAULT_LABELS);
  const selectedSplits = options.splits ?? ['development', 'validation'];
  const [entitiesAll, captures, candidates, labels] = await Promise.all([
    jsonLines(resolve(root, 'entities.jsonl')), jsonLines(resolve(root, 'captures.jsonl')),
    jsonLines(resolve(root, 'candidates.jsonl')), jsonLines(labelsPath),
  ]);
  const captureByEntity = new Map(captures.map(row => [row.entity_id, row]));
  const entities = entitiesAll.filter(entity => selectedSplits.includes(entity.benchmark_split) && captureByEntity.get(entity.entity_id)?.identity_status === 'current');
  const candidatesByEntity = new Map();
  for (const candidate of candidates) {
    if (!candidatesByEntity.has(candidate.entity_id)) candidatesByEntity.set(candidate.entity_id, []);
    candidatesByEntity.get(candidate.entity_id).push(candidate);
  }
  const labelsByCandidate = new Map(labels.map(label => [`${label.entity_id}\0${label.candidate_id}`, label]));
  const profiles = options.profiles ?? [];
  if (profiles.includes('favicon-tiny-v1')) await attachFrozenTinySuitability(candidates, root);
  const selections = profiles.length ? experimentalSelections(entities, candidatesByEntity, profiles) : storedSelections(entities, candidatesByEntity);
  const overall = populationMetrics(entities, candidatesByEntity, labelsByCandidate, selections);
  const splits = Object.fromEntries(selectedSplits.map(split => {
    const splitEntities = entities.filter(entity => entity.benchmark_split === split);
    return [split, populationMetrics(splitEntities, candidatesByEntity, labelsByCandidate, selections)];
  }));
  const labelsSha = createHash('sha256').update(await readFile(labelsPath)).digest('hex');
  const result = {
    schema_version: 'logo-yoink-offline-replay-v1',
    methodology: { selection: profiles.length ? 'offline experimental role-specific reordering of stored eligible candidates' : 'highest stored role_score among candidates whose stored predicted_roles contains the requested role', profiles, splits: selectedSplits },
    artifacts: { capture_root: options.root ?? DEFAULT_ROOT, labels: options.labels ?? DEFAULT_LABELS, labels_sha256: labelsSha },
    population: { assigned: entitiesAll.filter(entity => selectedSplits.includes(entity.benchmark_split)).length, current_identity: entities.length, excluded_abstention: entitiesAll.filter(entity => selectedSplits.includes(entity.benchmark_split)).length - entities.length, current_zero_candidates: entities.filter(entity => !(candidatesByEntity.get(entity.entity_id) ?? []).length).length, labeled_candidate_records: labels.length },
    overall, splits, quality_subtotal: qualitySubtotal(overall, entities, labelsByCandidate, selections),
  };
  return { result, selections: selectionRows(entities, selections, labelsByCandidate) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/visual-benchmark-replay.mjs [--baseline-check] [--splits development,validation] [--profiles selection-v2,favicon-tiny-v1,icon-evidence-v1,wide-theme-v1,wide-header-recovery-v1] [--output FILE] [--selections-output FILE]');
    return;
  }
  const replayed = await replay(options);
  if (options.baselineCheck) {
    const expected = JSON.parse(await readFile(resolve(DEFAULT_BASELINE), 'utf8'));
    const actualComparable = comparableBaseline(replayed.result);
    const expectedComparable = comparableBaseline(expected);
    if (!equivalentMetrics(actualComparable, expectedComparable)) {
      throw new Error('Offline replay does not reproduce the frozen baseline metrics exactly.');
    }
    if (replayed.result.artifacts.labels_sha256 !== expected.artifacts.labels_sha256) throw new Error('Frozen label SHA-256 does not match the baseline manifest.');
    const expectedSelections = await jsonLines(resolve(DEFAULT_BASELINE_SELECTIONS));
    const actualBySlot = new Map(replayed.selections.map(row => [`${row.entity_id}\0${row.role}`, row.candidate_id]));
    if (expectedSelections.length !== replayed.selections.length || expectedSelections.some(row => actualBySlot.get(`${row.entity_id}\0${row.role}`) !== row.candidate_id)) {
      throw new Error('Offline replay does not reproduce every frozen selection slot exactly.');
    }
    console.error(`Verified frozen baseline exactly: ${replayed.result.quality_subtotal.total.toFixed(2)}/${replayed.result.quality_subtotal.maximum}`);
  }
  const output = `${JSON.stringify(replayed.result, null, 2)}\n`;
  if (options.output) await writeFile(resolve(options.output), output);
  else process.stdout.write(output);
  if (options.selectionsOutput) await writeFile(resolve(options.selectionsOutput), `${replayed.selections.map(row => JSON.stringify(row)).join('\n')}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
