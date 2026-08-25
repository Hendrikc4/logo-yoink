#!/usr/bin/env node

/**
 * Build frozen, browser-only visual review packets.
 *
 * The input is deliberately metadata-first.  The generator never embeds a
 * candidate's bytes, never renders SVG, and only links to local raster files
 * that are inside the supplied capture run.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  BRAND_MARK_DECISIONS,
  IDENTITY,
  LABEL_ID_VERSION,
  MAPPING_CONFIDENCE,
  MISSING_CAUSES,
  REGIONS,
  RANKER_SAFE_REVIEW_VERSION,
  REVIEW_VERSION,
  ROLES,
  THEMES,
  USABILITY,
  VISUAL_ROLES,
  labelIdFor,
  identityForBrandMarkDecision,
  stableReviewId,
  targetKeyFor,
} from '../../benchmark/lib/labels.mjs';
import { captureAbstention, isPacketLabelableCapture } from '../../benchmark/lib/content-eligibility.mjs';

export { labelIdFor, stableReviewId, targetKeyFor };

const SAFE_RASTER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico']);
const EMPTY = '';
const MAX_INPUT_FILE_BYTES = 32 * 1024 * 1024;
const MAX_JSONL_LINE_BYTES = 2 * 1024 * 1024;
const MAX_JSONL_ROWS = 100_000;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_ASSET_PIXELS = 16 * 1024 * 1024;
const MAX_ASSET_DIMENSION = 16_384;
const MAX_SNAPSHOT_CHARS = 12_000;

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('--')) throw new Error(`Unexpected argument: ${raw}`);
    const [rawKey, inline] = raw.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (rawKey === 'help' || rawKey === 'resume' || rawKey === 'overlap') {
      options[key] = inline === undefined ? true : inline !== 'false';
      continue;
    }
    const value = inline ?? argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${rawKey}`);
    options[key] = value;
    if (inline === undefined) index += 1;
  }
  return options;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_INPUT_FILE_BYTES) throw new Error(`file exceeds ${MAX_INPUT_FILE_BYTES} byte limit`);
    return JSON.parse(await readFile(path, 'utf8'));
  }
  catch (error) { throw new Error(`Invalid JSON in ${path}: ${error.message}`); }
}

async function readJsonl(path) {
  if (!existsSync(path)) return [];
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_INPUT_FILE_BYTES) throw new Error(`${path}: file exceeds ${MAX_INPUT_FILE_BYTES} byte limit`);
  const text = await readFile(path, 'utf8');
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    if (rows.length >= MAX_JSONL_ROWS) throw new Error(`${path}: row limit exceeded (${MAX_JSONL_ROWS})`);
    if (Buffer.byteLength(line) > MAX_JSONL_LINE_BYTES) throw new Error(`${path}:${index + 1}: line exceeds ${MAX_JSONL_LINE_BYTES} byte limit`);
    try { rows.push(JSON.parse(line)); }
    catch (error) { throw new Error(`Invalid JSONL in ${path}:${index + 1}: ${error.message}`); }
  }
  return rows;
}

async function readRecords(path) {
  if (!existsSync(path)) return [];
  if (/\.jsonl$/i.test(path)) return readJsonl(path);
  const parsed = await readJson(path, null);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.records)) return parsed.records;
  return readJsonl(path);
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function first(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function valueAt(record, ...keys) {
  for (const key of keys) {
    const bits = key.split('.');
    let value = record;
    for (const bit of bits) value = value?.[bit];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function idFor(record, fallback) {
  return String(first(record?.entity_id, record?.entityId, record?.id, fallback) ?? 'unknown');
}

function boundedText(value, limit = MAX_SNAPSHOT_CHARS) {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function draftStorageKey({ runKey = '', captureKey = '', passId = 'default', reviewerId = 'unassigned' } = {}) {
  return `logo-yoink.visual-review.v3.${stableReviewId([REVIEW_VERSION, runKey, captureKey, passId, reviewerId].join('\0'))}`;
}

function snapshotText(value, limit = MAX_SNAPSHOT_CHARS) {
  if (value === undefined || value === null || value === '') return '';
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > limit ? `${text.slice(0, limit)}\n… (truncated)` : text;
  } catch { return '[unserializable snapshot]'; }
}

function normalizeEntity(record, fallback) {
  return {
    ...record,
    entity_id: idFor(record, fallback),
    name: first(record.name, record.display_name, record.company_name, record.company, record.requested?.name, record.entity_id, fallback),
    website: first(record.website, record.requested_website, record.requested?.website, record.url, EMPTY),
    final_url: first(record.final_url, record.finalUrl, record.resolved_url, record.resolvedUrl, EMPTY),
    identity_status: first(record.identity_status, record.identityStatus, record.reachability?.identity_status, EMPTY),
    reachability: first(record.reachability, record.capture_status, record.status, EMPTY),
    capture_status: first(record.capture_status, record.status, EMPTY),
  };
}

function normalizeCandidate(record, entityId) {
  return {
    ...record,
    entity_id: idFor(record, entityId) === entityId ? entityId : first(record.entity_id, entityId),
    candidate_id: String(first(record.candidate_id, record.candidateId, record.id, `${entityId}-candidate`)),
    asset_path: first(record.asset_path, record.assetPath, record.preview_path, record.previewPath, EMPTY),
    source: first(record.source, record.source_type, record.provenance, EMPTY),
    format: first(record.format, record.content_type, record.contentType, EMPTY),
    width: first(record.width, record.intrinsic_width, record.intrinsicWidth, EMPTY),
    height: first(record.height, record.intrinsic_height, record.intrinsicHeight, EMPTY),
    role_scores: first(record.role_scores, record.roleScores, {}),
    score_reasons: first(record.score_reasons, record.scoreReasons, []),
    rejections: first(record.rejections, record.rejection_reasons, record.rejectionReasons, record.reject_reason, []),
    feature_snapshot: first(record.feature_snapshot, record.featureSnapshot, record.features, null),
    evidence_snapshot: first(record.evidence_snapshot, record.evidenceSnapshot, record.evidence, null),
  };
}

function normalizeInstance(record, entityId, index) {
  const visualId = String(first(record.visual_instance_id, record.visualInstanceId, record.instance_id, record.id, `${entityId}-visual-${index + 1}`));
  const rawVisualRole = first(record.visual_role, record.visualRole, EMPTY);
  const visualRole = VISUAL_ROLES.includes(String(rawVisualRole).toLowerCase().replaceAll('-', '_'))
    ? String(rawVisualRole).toLowerCase().replaceAll('-', '_')
    : EMPTY;
  return {
    ...record,
    entity_id: entityId,
    visual_instance_id: visualId,
    screenshot_path: first(record.screenshot_path, record.screenshotPath, record.screenshot, EMPTY),
    overlay_path: first(record.overlay_path, record.overlayPath, record.overlay, EMPTY),
    crop_path: first(record.crop_path, record.cropPath, record.crop, record.element_crop, EMPTY),
    candidate_id: first(record.candidate_id, record.candidateId, EMPTY),
    visual_role: visualRole,
    mapping_type: first(record.mapping_type, record.mappingType, record.mapping_confidence, EMPTY),
    feature_snapshot: first(record.feature_snapshot, record.featureSnapshot, record.features, null),
    evidence_snapshot: first(record.evidence_snapshot, record.evidenceSnapshot, record.evidence, null),
  };
}

function mediaPath(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return EMPTY;
  return first(value.path, value.file, value.file_path, value.filePath, value.screenshot_path, value.screenshotPath, EMPTY);
}

function captureViewEvidence(page, entityId) {
  const views = asArray(page?.views);
  const instances = [];
  const screenshots = [];
  for (const view of views) {
    const viewId = String(first(view.view, view.id, 'view'));
    for (const media of pathValues(view, ['top', 'full', 'overlay'])) screenshots.push({ ...media, label: `${viewId} ${media.label}` });
    const cropByInstance = new Map(asArray(view.crops).map(crop => [String(first(crop.instance_id, crop.visual_instance_id, '')), mediaPath(crop)]));
    const overlayPath = mediaPath(view.overlay);
    const topPath = mediaPath(view.top);
    for (const [index, raw] of asArray(view.instances).entries()) {
      const instanceId = String(first(raw.instance_id, raw.visual_instance_id, `${viewId}-visual-${index + 1}`));
      instances.push(normalizeInstance({ ...raw, instance_id: instanceId, view: viewId, screenshot_path: first(raw.screenshot_path, topPath, EMPTY), overlay_path: first(raw.overlay_path, overlayPath, EMPTY), crop_path: first(raw.crop_path, cropByInstance.get(instanceId), EMPTY) }, entityId, instances.length));
    }
  }
  return { instances, screenshots };
}

function pathValues(record, keys) {
  const result = [];
  function walk(value, label) {
    if (typeof value === 'string') { result.push({ path: value, label }); return; }
    if (Array.isArray(value)) { value.forEach(item => walk(item, label)); return; }
    if (!value || typeof value !== 'object') return;
    const direct = first(value.path, value.file, value.file_path, value.filePath, value.src, value.screenshot_path, value.screenshotPath);
    if (direct) { result.push({ path: direct, label: first(value.label, value.kind, value.view, label), ...value }); return; }
    for (const [nestedKey, nestedValue] of Object.entries(value)) walk(nestedValue, nestedKey || label);
  }
  for (const key of keys) {
    walk(valueAt(record, key), key);
  }
  return result;
}

function uniqueMedia(media) {
  const seen = new Set();
  return media.filter(item => {
    const key = `${item.path}\0${item.label}`;
    if (!item.path || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadCapturePages(runDirectory) {
  const capturesDirectory = join(runDirectory, 'captures');
  if (!existsSync(capturesDirectory)) return new Map();
  const pages = new Map();
  for (const entry of await readdir(capturesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pagePath = join(capturesDirectory, entry.name, 'page.json');
    const page = await readJson(pagePath, null);
    if (page) pages.set(String(first(page.entity_id, page.entityId, entry.name)), page);
  }
  return pages;
}

/** Load and normalize the immutable run into packet-friendly entity records. */
export async function loadBundle(runDirectory) {
  // Benchmark ownership metadata is authoritative when present. Worker-only
  // capture roots have capture-manifest.json instead of manifest.json.
  const manifest = await readJson(join(runDirectory, 'benchmark-manifest.json'), null)
    ?? await readJson(join(runDirectory, 'manifest.json'), null)
    ?? await readJson(join(runDirectory, 'capture-manifest.json'), {});
  const entityRecords = [...await readRecords(join(runDirectory, 'entities.jsonl')), ...await readRecords(join(runDirectory, 'captures.jsonl'))];
  const candidateRecords = await readRecords(join(runDirectory, 'candidates.jsonl'));
  const instanceRecords = await readRecords(join(runDirectory, 'visual-instances.jsonl'));
  const mappingRecords = await readRecords(join(runDirectory, 'mappings.jsonl'));
  const rejectionRecords = await readRecords(join(runDirectory, 'rejections.jsonl'));
  const capturePages = await loadCapturePages(runDirectory);
  for (const [entityId, page] of capturePages) {
    for (const mapping of asArray(page.mappings)) mappingRecords.push({ ...mapping, entity_id: first(mapping.entity_id, entityId), visual_instance_id: first(mapping.visual_instance_id, mapping.instance_id, '') });
    for (const rejection of asArray(page.rejection_rows ?? page.rejections)) rejectionRecords.push({ ...rejection, entity_id: first(rejection.entity_id, entityId) });
  }

  const entities = new Map();
  for (const record of entityRecords) {
    const entity = normalizeEntity(record);
    entities.set(entity.entity_id, entity);
  }
  for (const [entityId, page] of capturePages) {
    const current = entities.get(entityId) ?? normalizeEntity({ entity_id: entityId }, entityId);
    const pageFields = { entity_id: entityId };
    if (page.requested?.name) pageFields.name = page.requested.name;
    if (page.requested?.website) pageFields.website = page.requested.website;
    for (const key of ['final_url', 'identity_status', 'reachability', 'capture_status']) if (page[key] !== undefined && page[key] !== null && page[key] !== '') pageFields[key] = page[key];
    const pageEntity = normalizeEntity(pageFields, entityId);
    const pageKeys = new Set(Object.keys(pageFields));
    entities.set(entityId, { ...current, ...Object.fromEntries(Object.entries(pageEntity).filter(([key]) => pageKeys.has(key))), capture: page });
  }
  for (const record of candidateRecords) {
    const entityId = String(first(record.entity_id, record.entityId, 'unknown'));
    if (!entities.has(entityId)) entities.set(entityId, normalizeEntity({ entity_id: entityId }, entityId));
  }
  for (const record of instanceRecords) {
    const entityId = String(first(record.entity_id, record.entityId, 'unknown'));
    if (!entities.has(entityId)) entities.set(entityId, normalizeEntity({ entity_id: entityId }, entityId));
  }

  const candidatesByEntity = new Map();
  for (const record of candidateRecords) {
    const entityId = String(first(record.entity_id, record.entityId, 'unknown'));
    const list = candidatesByEntity.get(entityId) ?? [];
    list.push(normalizeCandidate(record, entityId));
    candidatesByEntity.set(entityId, list);
  }
  const rejectionById = new Map();
  for (const record of rejectionRecords) {
    const rejectionId = String(first(record.rejection_id, record.id, `${record.entity_id ?? 'unknown'}:${record.candidate_id ?? ''}:${record.reason ?? ''}`));
    if (!rejectionById.has(rejectionId)) rejectionById.set(rejectionId, record);
  }
  const rejectionsByEntity = new Map();
  const rejectionsByCandidate = new Map();
  for (const record of rejectionById.values()) {
    const entityId = String(first(record.entity_id, 'unknown'));
    const entityList = rejectionsByEntity.get(entityId) ?? [];
    entityList.push(record);
    rejectionsByEntity.set(entityId, entityList);
    if (record.candidate_id) {
      const key = String(record.candidate_id);
      const candidateList = rejectionsByCandidate.get(key) ?? [];
      candidateList.push(record);
      rejectionsByCandidate.set(key, candidateList);
    }
  }
  for (const candidates of candidatesByEntity.values()) for (const candidate of candidates) {
    const persisted = rejectionsByCandidate.get(candidate.candidate_id) ?? [];
    if (persisted.length) candidate.rejections = [...asArray(candidate.rejections), ...persisted];
  }
  const instancesByEntity = new Map();
  for (const [entityId, entity] of entities) {
    const list = instanceRecords.filter(record => String(first(record.entity_id, record.entityId, '')) === entityId);
    const embedded = asArray(entity.capture?.visual_instances ?? entity.capture?.visualInstances ?? entity.visual_instances ?? entity.visualInstances);
    const captureEvidence = captureViewEvidence(entity.capture, entityId);
    const source = list.length || embedded.length ? [...list, ...embedded].map((record, index) => normalizeInstance(record, entityId, index)) : captureEvidence.instances;
    instancesByEntity.set(entityId, source);
    entity.capture_evidence = captureEvidence;
  }
  const mappingsByInstance = new Map();
  for (const mapping of mappingRecords) {
    const id = String(first(mapping.visual_instance_id, mapping.visualInstanceId, mapping.instance_id, ''));
    if (id) mappingsByInstance.set(id, mapping);
  }

  const packets = [...entities.values()].map(entity => {
    const capturedCandidates = candidatesByEntity.get(entity.entity_id) ?? [];
    const packetLabelable = isPacketLabelableCapture(entity);
    const candidates = packetLabelable ? capturedCandidates : [];
    const excludedCandidates = packetLabelable ? [] : capturedCandidates;
    const candidateAbstention = !packetLabelable && excludedCandidates.length ? captureAbstention(entity) : null;
    const capturedInstances = (instancesByEntity.get(entity.entity_id) ?? []).map(instance => ({
      ...instance,
      mapping: mappingsByInstance.get(instance.visual_instance_id) ?? null,
      candidate_id: first(instance.candidate_id, mappingsByInstance.get(instance.visual_instance_id)?.candidate_id, ''),
      mapping_id: first(instance.mapping_id, mappingsByInstance.get(instance.visual_instance_id)?.mapping_id, EMPTY),
      mapping_type: first(instance.mapping_type, mappingsByInstance.get(instance.visual_instance_id)?.mapping_confidence, mappingsByInstance.get(instance.visual_instance_id)?.mapping?.type, mappingsByInstance.get(instance.visual_instance_id)?.type, EMPTY),
    }));
    const instances = packetLabelable ? capturedInstances : [];
    const capture = entity.capture ?? {};
    const screenshots = uniqueMedia([
      ...pathValues(capture, ['screenshots', 'screenshot_paths', 'screenshotPaths', 'desktop_light_top', 'desktop_light_full', 'desktop_dark_top', 'mobile_light_top', 'top_screenshot']),
      ...pathValues(entity, ['screenshots', 'screenshot_paths', 'screenshotPaths']),
    ]);
    return {
      ...entity,
      capture,
      candidates,
      captured_candidate_count: capturedCandidates.length,
      excluded_candidate_count: excludedCandidates.length,
      candidate_abstention: candidateAbstention,
      captured_visual_instance_count: capturedInstances.length,
      visual_instances: instances,
      mappings: mappingRecords.filter(mapping => String(first(mapping.entity_id, mapping.entityId, '')) === entity.entity_id),
      rejections: rejectionsByEntity.get(entity.entity_id) ?? [],
      screenshots: uniqueMedia([...(entity.capture_evidence?.screenshots ?? []), ...screenshots]),
    };
  });
  packets.sort((left, right) => left.entity_id.localeCompare(right.entity_id));
  return { manifest, packets };
}

async function safeLocalAsset(runDirectory, pathValue) {
  if (!pathValue || typeof pathValue !== 'string' || /^(?:data|https?):/i.test(pathValue)) return null;
  const runRoot = await realpath(runDirectory);
  const absolute = resolve(runDirectory, pathValue);
  if (!existsSync(absolute)) return null;
  const actual = await realpath(absolute).catch(() => null);
  if (!actual || (actual !== runRoot && !actual.startsWith(`${runRoot}${sep}`))) return null;
  if (!SAFE_RASTER_EXTENSIONS.has(extname(actual).toLowerCase())) return null;
  return actual;
}

async function createAssetResolver(runDirectory, packetRoot) {
  const runRoot = await realpath(runDirectory);
  const assetDirectory = join(packetRoot, 'assets');
  await mkdir(assetDirectory, { recursive: true });
  const packetRootReal = await realpath(packetRoot);
  const assetDirectoryReal = await realpath(assetDirectory);
  if (assetDirectoryReal !== packetRootReal && !assetDirectoryReal.startsWith(`${packetRootReal}${sep}`)) throw new Error('Packet asset directory escapes packet root.');
  const cache = new Map();
  return async pathValue => {
    const source = await safeLocalAsset(runRoot, pathValue);
    if (!source) return null;
    if (cache.has(source)) return cache.get(source);
    const promise = (async () => {
      const info = await stat(source);
      if (!info.isFile() || info.size > MAX_ASSET_BYTES) return null;
      const bytes = await readFile(source);
      if (bytes.length > MAX_ASSET_BYTES) return null;
      let metadata;
      try { metadata = await sharp(bytes, { limitInputPixels: MAX_ASSET_PIXELS }).metadata(); } catch { return null; }
      const width = Number(metadata.width), height = Number(metadata.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > MAX_ASSET_DIMENSION || height > MAX_ASSET_DIMENSION || width * height > MAX_ASSET_PIXELS) return null;
      const digest = createHash('sha256').update(bytes).digest('hex');
      const extension = extname(source).toLowerCase();
      const destination = join(assetDirectoryReal, `${digest}${extension}`);
      const destinationAbsolute = resolve(destination);
      if (relative(assetDirectoryReal, destinationAbsolute).startsWith('..')) return null;
      if (existsSync(destination)) {
        const destinationReal = await realpath(destination).catch(() => null);
        if (!destinationReal || (destinationReal !== packetRootReal && !destinationReal.startsWith(`${packetRootReal}${sep}`))) return null;
        const existing = await readFile(destination);
        if (!existing.equals(bytes)) return null;
      } else {
        await writeFile(destination, bytes, { flag: 'wx' }).catch(error => {
          if (error?.code !== 'EEXIST') throw error;
        });
      }
      return { path: destination, width, height, bytes: bytes.length };
    })().catch(() => null);
    cache.set(source, promise);
    return promise;
  };
}

async function hrefFor(assetResolver, outputDirectory, pathValue) {
  const asset = await assetResolver(pathValue);
  if (!asset) return null;
  const pageDirectory = await realpath(outputDirectory).catch(() => resolve(outputDirectory));
  return relative(pageDirectory, asset.path).split(sep).join('/');
}

export const internals = { safeLocalAsset, createAssetResolver, candidateAssetPath };

function safeExternalHref(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '#';
  } catch { return '#'; }
}

function mediaFigure(media, href, alt) {
  if (!href) return `<div class="placeholder" role="img" aria-label="No safe raster preview available">No safe raster preview<br><small>${escapeHtml(media?.path ?? 'not captured')}</small></div>`;
  return `<img loading="lazy" src="${escapeHtml(href)}" data-source-name="${escapeHtml(basename(String(media?.path ?? '')))}" alt="${escapeHtml(alt)}">`;
}

function scoreText(candidate) {
  const scores = candidate.role_scores ?? {};
  const entries = Object.entries(scores).map(([role, score]) => `${role}: ${score}`).join(' · ');
  return entries || (candidate.score === undefined ? 'not scored' : String(candidate.score));
}

function rejectionText(candidate) {
  const reasons = candidate.rejections;
  if (Array.isArray(reasons)) return reasons.join('; ') || 'none recorded';
  if (reasons && typeof reasons === 'object') return Object.entries(reasons).map(([key, value]) => `${key}: ${value}`).join('; ');
  return String(reasons || 'none recorded');
}

function selectControl(field, values, label, attributes = '') {
  return `<label>${escapeHtml(label)}<select class="review-control" data-field="${escapeHtml(field)}" ${attributes}><option value=""></option>${values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}</select></label>`;
}

function textControl(field, label, multiline = false) {
  return `<label>${escapeHtml(label)}${multiline ? `<textarea class="review-control" data-field="${escapeHtml(field)}" rows="2"></textarea>` : `<input class="review-control" data-field="${escapeHtml(field)}" type="text" value="">`}</label>`;
}

function identitySummary(entity) {
  return `<dl class="summary"><dt>Captured identity</dt><dd>${escapeHtml(entity.identity_status || 'not classified')}</dd><dt>Reachability</dt><dd>${escapeHtml(entity.reachability || 'not classified')}</dd><dt>Final URL</dt><dd>${escapeHtml(entity.final_url || 'not recorded')}</dd></dl>`;
}

function snapshotDetails(features, evidence) {
  const featureText = snapshotText(features);
  const evidenceText = snapshotText(evidence);
  if (!featureText && !evidenceText) return '';
  return `<details class="evidence-snapshot"><summary>Persisted feature/evidence snapshot</summary>${featureText ? `<h4>Features</h4><pre>${escapeHtml(featureText)}</pre>` : ''}${evidenceText ? `<h4>Evidence</h4><pre>${escapeHtml(evidenceText)}</pre>` : ''}</details>`;
}

function candidateAssetPath(candidate) {
  const source = String(candidate?.asset_path ?? '');
  const format = String(candidate?.format ?? '').toLowerCase();
  return (/\.svg$/i.test(source) || format.includes('svg')) ? candidate?.preview_path : first(candidate?.asset_path, candidate?.preview_path, EMPTY);
}

async function candidatePreview(candidate, assetResolver, outputDirectory, label = '') {
  const sourcePath = candidateAssetPath(candidate);
  const href = await hrefFor(assetResolver, outputDirectory, sourcePath);
  const alt = `${label || 'candidate'} safe raster preview`;
  return href ? `<div class="candidate-preview light">${mediaFigure({ path: sourcePath }, href, alt)}</div><div class="candidate-preview dark">${mediaFigure({ path: sourcePath }, href, alt)}</div>` : `<div class="candidate-preview no-preview">${mediaFigure({ path: sourcePath || candidate.asset_path }, null, alt)}</div>`;
}

async function renderEntity(entity, assetResolver, outputDirectory, packetHref, reviewContext) {
  const screenshotHtml = [];
  for (const media of entity.screenshots) {
    const href = await hrefFor(assetResolver, outputDirectory, media.path);
    screenshotHtml.push(`<figure class="screenshot"><figcaption>${escapeHtml(media.label || 'capture')}</figcaption>${mediaFigure(media, href, `${entity.name} ${media.label || 'screenshot'}`)}</figure>`);
  }
  const overlayMedia = entity.visual_instances.map(instance => instance.overlay_path).filter(Boolean).map(path => ({ path, label: 'numbered overlay' }));
  for (const media of uniqueMedia(overlayMedia)) {
    const href = await hrefFor(assetResolver, outputDirectory, media.path);
    screenshotHtml.push(`<figure class="screenshot overlay"><figcaption>${escapeHtml(media.label)}</figcaption>${mediaFigure(media, href, `${entity.name} numbered overlay`)}</figure>`);
  }

  const candidateCards = entity.candidates.length ? await Promise.all(entity.candidates.map(async candidate => `<article class="candidate-card" data-candidate-id="${escapeHtml(candidate.candidate_id)}"><div class="candidate-previews">${await candidatePreview(candidate, assetResolver, outputDirectory, candidate.candidate_id)}</div><div class="capture-meta"><b>${escapeHtml(candidate.candidate_id)}</b><span>source: ${escapeHtml(candidate.source || 'not recorded')}</span><span>dimensions: ${escapeHtml(candidate.width || '?')} × ${escapeHtml(candidate.height || '?')}</span><span>format: ${escapeHtml(candidate.format || 'not recorded')}</span><span>scores: ${escapeHtml(scoreText(candidate))}</span><span>score reasons: ${escapeHtml(Array.isArray(candidate.score_reasons) ? candidate.score_reasons.join('; ') || 'none recorded' : candidate.score_reasons || 'none recorded')}</span><span>rejections: ${escapeHtml(rejectionText(candidate))}</span>${snapshotDetails(candidate.feature_snapshot, candidate.evidence_snapshot)}</div><form class="candidate-form" data-record-type="candidate" data-entity-id="${escapeHtml(entity.entity_id)}" data-candidate-id="${escapeHtml(candidate.candidate_id)}">${selectControl('identity', IDENTITY, 'Candidate identity')}${selectControl('roles', ROLES, 'Candidate roles', 'multiple size="5"')}${selectControl('best_for_role', ROLES, 'Best for role', 'multiple size="5"')}${selectControl('usability_light', USABILITY, 'Light usability')}${selectControl('usability_dark', USABILITY, 'Dark usability')}${selectControl('provenance_quality', ['visible_exact_use', 'structured_first_party', 'inferred_first_party', 'unsupported'], 'Provenance')}${textControl('quality_defects', 'Quality defects (comma-separated)')}${textControl('reject_reason', 'Reviewer reject reason')}${textControl('confidence', 'Confidence')}${textControl('note', 'Note', true)}</form></article>`)) : [entity.candidate_abstention ? `<div class="placeholder">Explicit abstention: ${escapeHtml(entity.candidate_abstention)}. ${entity.captured_candidate_count} raw candidate record(s) remain auditable but are not labelable target-company content.</div>` : '<div class="placeholder">No candidate records captured</div>'];

  const instanceCards = await Promise.all(entity.visual_instances.map(async instance => {
    const cropHref = await hrefFor(assetResolver, outputDirectory, instance.crop_path);
    const instanceScreenshotHref = await hrefFor(assetResolver, outputDirectory, instance.screenshot_path);
    const mapped = entity.candidates.find(candidate => candidate.candidate_id === instance.candidate_id);
    const exactMapped = instance.mapping_type === 'exact' && mapped && instance.mapping_id;
    const captured = [
      ['role', instance.visual_role], ['region', instance.region], ['theme', instance.theme],
      ['visibility', first(instance.visibility, instance.visible === true ? 'good' : '')], ['mapping', instance.mapping_type],
    ].filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => `<span>${escapeHtml(key)}: ${escapeHtml(value)}</span>`).join('');
    const decisionName = `brand-${stableReviewId(instance.visual_instance_id)}`;
    const decision = exactMapped
      ? `<div class="derived-decision"><b>Identity inherited from candidate</b><p>This export uses the same reviewer's <code>${escapeHtml(instance.candidate_id)}</code> identity. No second identity judgment is collected.</p><output data-derived-identity>Waiting for candidate identity.</output></div>`
      : `<fieldset class="brand-decision"><legend>Is this a visible logo/brand mark of ${escapeHtml(entity.name)}?</legend>${BRAND_MARK_DECISIONS.map(value => `<label><input type="radio" name="${escapeHtml(decisionName)}" data-brand-decision value="${escapeHtml(value)}"><span>${value === 'yes' ? 'Yes' : value === 'no' ? 'No' : 'Genuinely unclear'}</span></label>`).join('')}</fieldset>`;
    const html = `<article class="instance-card ${exactMapped ? 'exact-mapped' : 'needs-decision'}" data-instance-id="${escapeHtml(instance.visual_instance_id)}"><div class="instance-images"><figure><figcaption>Rendered context</figcaption>${mediaFigure({ path: instance.screenshot_path }, instanceScreenshotHref, `${entity.name} rendered instance`)}</figure><figure><figcaption>Element crop</figcaption>${mediaFigure({ path: instance.crop_path }, cropHref, `${entity.name} element crop`)}</figure><div><b>Mapping</b><p>${escapeHtml(instance.candidate_id || 'unmapped')} · ${escapeHtml(instance.mapping_type || 'not classified')}</p>${mapped ? `<div class="mapped-preview">${await candidatePreview(mapped, assetResolver, outputDirectory, 'mapped candidate')}</div>` : '<div class="placeholder compact">No mapped candidate</div>'}</div></div><div class="capture-meta"><b>${escapeHtml(instance.visual_instance_id)}</b>${captured || '<span>No capture classification recorded</span>'}</div>${snapshotDetails(instance.feature_snapshot, instance.evidence_snapshot)}<form class="instance-form" data-record-type="visual-instance" data-identity-mode="${exactMapped ? 'inherited-exact' : 'brand-decision'}" data-entity-id="${escapeHtml(entity.entity_id)}" data-visual-instance-id="${escapeHtml(instance.visual_instance_id)}" data-candidate-id="${escapeHtml(instance.candidate_id)}" data-mapping-id="${escapeHtml(instance.mapping_id || '')}">${decision}<details class="override-fields"><summary>Override captured fields (optional)</summary><div>${selectControl('visual_role', VISUAL_ROLES, 'Visual role override')}${selectControl('region', REGIONS, 'Region override')}${selectControl('theme', THEMES, 'Theme override')}${selectControl('visibility', USABILITY, 'Visibility override')}${selectControl('mapping_confidence', MAPPING_CONFIDENCE, 'Mapping-confidence override')}${textControl('note', 'Override note', true)}</div></details></form></article>`;
    return { exactMapped, html };
  }));

  const missingControls = ROLES.map(role => `<form class="missing-form" data-record-type="missing-role" data-entity-id="${escapeHtml(entity.entity_id)}" data-role="${escapeHtml(role)}"><b>${escapeHtml(role)}</b>${selectControl('missing_cause', MISSING_CAUSES, 'Missing cause')}${textControl('confidence', 'Confidence')}${textControl('note', 'Note', true)}</form>`).join('');
  const captureVersion = first(entity.capture?.capture_version, entity.capture?.schema_version, 'visual-capture-unknown');
  const rejections = asArray(entity.rejections);
  const rejectionEvidence = rejections.length ? `<section><h2>Rejection evidence <small>(${rejections.length})</small></h2><div class="capture-meta">${rejections.map(rejection => `<div><b>${escapeHtml(rejection.stage || 'other')}</b>: ${escapeHtml(boundedText(rejection.reason || rejection.message || JSON.stringify(rejection), 2000))}${rejection.candidate_id ? ` · candidate ${escapeHtml(rejection.candidate_id)}` : ''}</div>`).join('')}</div></section>` : '';

  const needsDecision = instanceCards.filter(card => !card.exactMapped).map(card => card.html).join('');
  const inherited = instanceCards.filter(card => card.exactMapped).map(card => card.html).join('');
  const guidance = `<section class="guidance"><h2>Positive-first review guide</h2><ol><li>Scan the screenshots and numbered overlays for visible ${escapeHtml(entity.name)} marks.</li><li>Classify candidate identity. Exact-mapped instances inherit that candidate identity in this same reviewer/pass.</li><li>For non-exact observations, mark requested-company logos <b>Yes</b> and truly uncertain evidence <b>Genuinely unclear</b>. After attestation, any unselected non-exact detector observations serialize as <b>No</b>.</li><li>Inspect crops when the overlay is insufficient, then attest that the entity visual evidence was reviewed.</li></ol><p><b>No versus unclear:</b> decorations, UI controls, backgrounds, content imagery, and foreign, customer, or partner marks are <b>No</b>. Use <b>Genuinely unclear</b> only when the frozen pixels cannot establish whether a plausible mark belongs to the requested company.</p><p><b>Shape:</b> a padded square canvas whose visible content is symbol-left/text-right is a <b>wide horizontal lockup</b>, not a stacked mark.</p></section>`;
  const rankerSafeGuidance = reviewContext.workflowVersion === RANKER_SAFE_REVIEW_VERSION ? '<section class="guidance ranker-safe-guidance"><h2>Ranker-safe candidate rules</h2><p>Wrong identity means no roles, all five best-for-role values false, and unusable light and dark themes. Ambiguous identity and candidates unusable on both themes cannot be best for any role. Every selected best role must be in the candidate roles, have correct identity, and have a usable theme. Do not enter evidence-limit text such as <code>no_verified_raster_preview</code> in quality defects. For each missing role, choose <code>not_missing</code> only when a same-scope correct candidate covers that role and is usable; discovered candidates unusable on both themes require <code>rejected_by_shape_or_quality</code>.</p></section>' : '';
  const attestation = `${rankerSafeGuidance}<form class="attestation-form" data-record-type="review-attestation" data-entity-id="${escapeHtml(entity.entity_id)}" data-instance-count="${entity.visual_instances.length}"><label><input class="review-control" data-field="visual_evidence_reviewed" type="checkbox" value="true"><span>I attest that I reviewed this entity's screenshots, overlays, and uncertain crops. Every visible requested-company mark is selected as Yes or Genuinely unclear; remaining non-exact observations are No.</span></label></form>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(entity.name)} · visual review</title>${styles()}</head><body><header><a href="${escapeHtml(packetHref)}">All entities</a><strong>${escapeHtml(entity.name)}</strong><span class="header-id">${escapeHtml(entity.entity_id)}</span><label class="reviewer-meta">Reviewer ID<input data-reviewer-field="id" type="text" value="${escapeHtml(reviewContext.reviewerId || '')}"></label><label class="reviewer-meta">Reviewer kind<input data-reviewer-field="kind" type="text" value="${escapeHtml(reviewContext.reviewerKind || '')}"></label><label class="reviewer-meta">Review pass<input data-reviewer-field="pass" type="text" value="${escapeHtml(reviewContext.passId || 'default')}"></label><button type="button" data-action="save">Save draft</button><button type="button" data-action="export">Export attested JSONL</button><output data-status>Draft empty; no labels selected.</output></header><main data-run-id="${escapeHtml(reviewContext.runKey)}" data-capture-key="${escapeHtml(reviewContext.captureKey)}" data-capture-version="${escapeHtml(captureVersion)}" data-pass-id="${escapeHtml(reviewContext.passId || 'default')}" data-review-version="${escapeHtml(reviewContext.workflowVersion || REVIEW_VERSION)}" data-entity-id="${escapeHtml(entity.entity_id)}"><section class="entity-header"><h1>${escapeHtml(entity.name)}</h1><p><a rel="noreferrer" href="${escapeHtml(safeExternalHref(entity.website))}">${escapeHtml(entity.website || 'website not recorded')}</a></p>${identitySummary(entity)}<form class="entity-form" data-record-type="entity" data-entity-id="${escapeHtml(entity.entity_id)}">${selectControl('identity_status', ['current', 'related_rebrand', 'wrong_site', 'ambiguous', 'unreachable'], 'Reviewed identity')}${selectControl('graphic_logo_present', ['true', 'false', 'ambiguous'], 'Graphic logo present')}${selectControl('text_only_brand_present', ['true', 'false', 'ambiguous'], 'Text-only brand present')}${textControl('confidence', 'Confidence')}${textControl('note', 'Note', true)}</form></section>${guidance}<section><h2>Captured screenshots and overlays</h2><div class="screenshots">${screenshotHtml.join('') || '<div class="placeholder">No screenshot recorded</div>'}</div></section><section><h2>Candidate assets <small>(${entity.candidates.length})</small></h2><p class="instruction">Candidate identity is authoritative for every exact-mapped visual instance in this review scope. Roles and the complete five-role best-for-role map stay separate. Previews are verified local rasters; raw SVG is never rendered.</p><div class="candidates">${candidateCards.join('')}</div></section><section><h2>Non-exact observations needing review <small>(${instanceCards.filter(card => !card.exactMapped).length})</small><p class="instruction">Select Yes and Genuinely unclear first. You may explicitly choose No; otherwise attestation finalizes unselected observations as No.</p><div class="instances">${needsDecision || '<div class="placeholder">No non-exact observations</div>'}</div></section><section><h2>Exact-mapped instances with inherited identity <small>(${instanceCards.filter(card => card.exactMapped).length})</small><p class="instruction">These remain exhaustive and auditable, but do not ask for a contradictory second identity judgment. Optional capture-field overrides are available on each record.</p><div class="instances">${inherited || '<div class="placeholder">No exact-mapped instances</div>'}</div></section>${attestation}${rejectionEvidence}<section><h2>Missing role cause</h2><p class="instruction">Choose a cause only when the role is actually missing after reviewing the frozen evidence.</p><div class="missing-grid">${missingControls}</div></section></main>${pageScript(reviewContext.workflowVersion || REVIEW_VERSION)}</body></html>`;
}

function styles() {
  return `<style>
:root{font:14px/1.4 system-ui,sans-serif;color:#17202a;background:#eef1f5}*{box-sizing:border-box}body{margin:0}header{position:sticky;top:0;z-index:3;display:flex;gap:14px;align-items:center;padding:12px 20px;background:#121923;color:#fff}header a{color:#b9d8ff}header strong{font-size:16px}.header-id{color:#aab5c4;font:12px ui-monospace,monospace}header button{margin-left:auto}header button+button{margin-left:-8px}output{color:#b9f2c6;font-size:12px;margin-left:4px}main{max-width:1600px;margin:auto;padding:20px}.entity-header,section{background:#fff;border:1px solid #d6dce3;border-radius:10px;padding:18px;margin-bottom:18px}h1,h2{margin:0 0 10px}h2{font-size:19px}h2 small{font-weight:400;color:#697586}.summary{display:grid;grid-template-columns:max-content 1fr;gap:3px 15px;margin:14px 0}.summary dt{color:#647184}.summary dd{margin:0;overflow-wrap:anywhere}.guidance{border-color:#8eb3db;background:#f5faff}.guidance li+li{margin-top:5px}.screenshots{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}.screenshot{margin:0;border:1px solid #d8dee6;background:#f7f9fb}.screenshot figcaption,figure figcaption{padding:6px 9px;color:#596779;font-size:12px;font-weight:600}.screenshot img{display:block;width:100%;max-height:440px;object-fit:contain;object-position:top center;background:#fff}.screenshot.overlay img{max-height:600px}.instances,.candidates{display:grid;gap:14px}.instance-card,.candidate-card{border:1px solid #d8dee6;border-radius:8px;padding:12px;background:#fbfcfd}.instance-card.needs-decision{border-left:4px solid #3578bd}.instance-card.exact-mapped{border-left:4px solid #87a096}.instance-images{display:grid;grid-template-columns:minmax(180px,1fr) minmax(220px,1fr);gap:13px}.instance-images figure{margin:0;border:1px solid #d8dee6}.instance-images figure>img{display:block;width:100%;height:150px;object-fit:contain;background:#fff}.mapped-preview{display:grid;grid-template-columns:1fr 1fr;gap:5px}.candidate-previews{display:grid;grid-template-columns:1fr 1fr;min-height:120px;border:1px solid #cbd3dc}.candidate-preview{display:grid;place-items:center;min-height:120px;padding:8px;overflow:hidden}.candidate-preview.dark,.mapped-preview .dark{background:#151a22}.candidate-preview.light,.mapped-preview .light{background:#fff}.candidate-preview img{max-width:100%;max-height:130px;object-fit:contain}.capture-meta{display:grid;gap:3px;margin:10px 0;color:#465568;font-size:12px;overflow-wrap:anywhere}.capture-meta b{color:#17202a;font:13px ui-monospace,monospace}.candidate-form,.entity-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px}.instance-form{display:grid;gap:10px}.entity-form{max-width:950px}.brand-decision{display:flex;gap:8px;flex-wrap:wrap;margin:0;padding:9px;border:1px solid #afbdcb;border-radius:7px}.brand-decision legend{font-weight:700}.brand-decision label{display:flex;align-items:center;gap:6px;padding:7px 10px;border:1px solid #c7d0da;border-radius:6px;background:#fff;cursor:pointer}.brand-decision input,.attestation-form input{width:auto}.derived-decision{padding:9px;border-radius:7px;background:#edf5f0}.derived-decision p{margin:4px 0}.derived-decision output{display:block;margin:3px 0;color:#386047}.override-fields{padding:8px;background:#f0f3f6;border-radius:5px}.override-fields>div{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:8px}.attestation-form{border:2px solid #3578bd;border-radius:10px;padding:16px;background:#f5faff;margin-bottom:18px}.attestation-form label{display:flex;align-items:flex-start;gap:9px;font-size:14px;color:#17202a}.missing-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.missing-form{display:grid;gap:6px;border:1px solid #d8dee6;padding:10px;border-radius:7px}label{display:grid;gap:2px;color:#566476;font-size:12px}input,select,textarea{width:100%;font:inherit;border:1px solid #bfc8d2;border-radius:4px;padding:5px;background:#fff;color:#17202a}textarea{resize:vertical}.placeholder{display:grid;place-items:center;min-height:120px;padding:12px;text-align:center;color:#657386;background:repeating-linear-gradient(135deg,#f4f6f8,#f4f6f8 10px,#e9edf1 10px,#e9edf1 20px);overflow-wrap:anywhere}.placeholder.compact{min-height:70px}.instruction{color:#596779}.empty{padding:15px;color:#657386}.evidence-snapshot{margin:8px 0;padding:8px;background:#f0f3f6;border-radius:5px}.evidence-snapshot pre{max-height:260px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.evidence-snapshot h4{margin:5px 0}@media(max-width:700px){header{flex-wrap:wrap}header button{margin-left:0}.instance-images{grid-template-columns:1fr}.candidate-previews{grid-template-columns:1fr}}
</style>`;
}

function canonicalBrowserKeys(workflowVersion) {
  return [
  `const LABEL_ID_VERSION = ${JSON.stringify(LABEL_ID_VERSION)};`,
  `const REVIEW_VERSION = ${JSON.stringify(REVIEW_VERSION)};`,
  `const RANKER_SAFE_REVIEW_VERSION = ${JSON.stringify(RANKER_SAFE_REVIEW_VERSION)};`,
  `const WORKFLOW_VERSION = ${JSON.stringify(workflowVersion)};`,
  `const ROLES = ${JSON.stringify(ROLES)};`,
  `const stableReviewId = ${stableReviewId.toString()};`,
  `const targetKeyFor = ${targetKeyFor.toString()};`,
  `const labelIdFor = ${labelIdFor.toString()};`,
  `const identityForBrandMarkDecision = ${identityForBrandMarkDecision.toString()};`,
  ].join('\n');
}

function pageScript(workflowVersion = REVIEW_VERSION) {
  return `<script>
(() => {
  ${canonicalBrowserKeys(workflowVersion)}
  const root = document.querySelector('main[data-run-id]');
  const status = document.querySelector('[data-status]');
  const reviewer = field => document.querySelector('[data-reviewer-field="' + field + '"]')?.value.trim() || 'unassigned';
  const runKey = () => root?.dataset.runId || 'run';
  const captureKey = () => root?.dataset.captureKey || 'capture';
  const passId = () => reviewer('pass');
  const reviewerId = () => reviewer('id');
  const storageKey = () => 'logo-yoink.visual-review.' + stableReviewId([WORKFLOW_VERSION, runKey(), captureKey(), passId(), reviewerId()].join('\0'));
  function present(value) { return Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Object.keys(value).length > 0 : value !== ''; }
  function controlValue(control) {
    if (control.type === 'checkbox') return control.checked ? true : '';
    if (!control.multiple) return control.value || '';
    return [...control.selectedOptions].map(option => option.value).filter(Boolean);
  }
  function rankerSafeCandidate(values, context) {
    const roles = Array.isArray(values.roles) ? [...new Set(values.roles)].sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b)) : [];
    const selected = values.best_for_role && typeof values.best_for_role === 'object' && !Array.isArray(values.best_for_role) ? values.best_for_role : {};
    values.roles = roles;
    values.best_for_role = Object.fromEntries(ROLES.map(role => [role, Boolean(selected[role])]));
    const defects = Array.isArray(values.quality_defects) ? values.quality_defects : [];
    if (defects.some(value => /no[_ -]?verified[_ -]?raster[_ -]?preview|preview unavailable|evidence limit|not enough evidence/i.test(String(value)))) throw new Error(context + ': quality defects cannot describe evidence limits');
    if (values.identity === 'wrong') { values.roles = []; values.best_for_role = Object.fromEntries(ROLES.map(role => [role, false])); values.usability_light = 'unusable'; values.usability_dark = 'unusable'; }
    else if (values.identity === 'ambiguous') values.best_for_role = Object.fromEntries(ROLES.map(role => [role, false]));
    if (values.usability_light === 'unusable' && values.usability_dark === 'unusable') values.best_for_role = Object.fromEntries(ROLES.map(role => [role, false]));
    for (const role of ROLES.filter(role => values.best_for_role[role])) if (!values.roles.includes(role) || values.identity !== 'correct' || !['good', 'conditional'].includes(values.usability_light) && !['good', 'conditional'].includes(values.usability_dark)) throw new Error(context + ': best role ' + role + ' is not ranker-safe');
    return values;
  }
  function enforceRankerSafe(rows) {
    if (WORKFLOW_VERSION !== RANKER_SAFE_REVIEW_VERSION) return rows;
    const candidates = rows.filter(row => row.label_kind === 'candidate');
    const scope = row => [row.entity_id, row.reviewer_id, row.review_pass, row.run_key, row.capture_key].join('\0');
    for (const missing of rows.filter(row => row.label_kind === 'missing_role')) {
      const role = missing.role;
      const candidatesInScope = candidates.filter(row => scope(row) === scope(missing));
      if (missing.values.missing_cause === 'not_missing' && !candidatesInScope.some(row => row.values.identity === 'correct' && row.values.roles.includes(role) && ['good', 'conditional'].includes(row.values.usability_light) || row.values.identity === 'correct' && row.values.roles.includes(role) && ['good', 'conditional'].includes(row.values.usability_dark))) throw new Error('missing_role ' + role + ' requires a same-scope correct usable candidate');
      if (candidatesInScope.some(row => row.values.identity === 'correct' && row.values.roles.includes(role) && row.values.usability_light === 'unusable' && row.values.usability_dark === 'unusable') && missing.values.missing_cause === 'no_graphic_asset_exists') throw new Error('missing_role ' + role + ' must use rejected_by_shape_or_quality when discovered candidates are unusable');
    }
    return rows;
  }
  function record(form, { finalize = false } = {}) {
    const type = form.dataset.recordType;
    const labelKind = type === 'visual-instance' ? 'visual_instance' : type === 'missing-role' ? 'missing_role' : type === 'review-attestation' ? 'review_attestation' : type;
    let values = Object.fromEntries([...form.querySelectorAll('[data-field]')].map(control => [control.dataset.field, controlValue(control)]).filter(([, value]) => present(value)));
    if (type === 'review-attestation') {
      if (values.visual_evidence_reviewed !== true) return null;
      values = { visual_evidence_reviewed: true, review_workflow: 'positive_first', visual_instance_count: Number(form.dataset.instanceCount || 0) };
    }
    if (type === 'candidate') {
      const best = [...form.querySelector('[data-field="best_for_role"]')?.selectedOptions || []].map(option => option.value).filter(Boolean);
      if (Object.keys(values).length || best.length) values.best_for_role = Object.fromEntries(ROLES.map(role => [role, best.includes(role)]));
      if (typeof values.quality_defects === 'string') values.quality_defects = values.quality_defects.split(',').map(value => value.trim()).filter(Boolean);
      if (WORKFLOW_VERSION === RANKER_SAFE_REVIEW_VERSION) values = rankerSafeCandidate(values, 'candidate ' + (form.dataset.candidateId || 'unknown'));
    }
    const entityId = form.dataset.entityId || '';
    const visualInstanceId = form.dataset.visualInstanceId || '';
    const candidateId = form.dataset.candidateId || '';
    const role = form.dataset.role || '';
    let identityDerivation = null;
    if (type === 'visual-instance' && form.dataset.identityMode === 'inherited-exact') {
      const candidateForm = root.querySelector('form[data-record-type="candidate"][data-candidate-id="' + CSS.escape(candidateId) + '"]');
      const identity = candidateForm?.querySelector('[data-field="identity"]')?.value || '';
      if (!identity) return null;
      values.identity = identity;
      const candidateTarget = targetKeyFor({ labelKind: 'candidate', entityId, candidateId });
      identityDerivation = { type: 'exact_candidate_mapping', mapping_id: form.dataset.mappingId || '', candidate_id: candidateId, candidate_label_id: labelIdFor({ runKey: runKey(), captureKey: captureKey(), passId: passId(), reviewerId: reviewerId(), targetKey: candidateTarget }) };
    } else if (type === 'visual-instance') {
      const decision = form.querySelector('[data-brand-decision]:checked')?.value || '';
      if (decision) values.identity = identityForBrandMarkDecision(decision);
      else if (finalize) values.identity = identityForBrandMarkDecision('no');
    }
    if (!Object.keys(values).length) return null;
    const targetKey = targetKeyFor({ labelKind, entityId, visualInstanceId, candidateId, role });
    const row = { schema_version: 'visual-benchmark-v1', record_type: 'label', label_id: labelIdFor({ runKey: runKey(), captureKey: captureKey(), passId: passId(), reviewerId: reviewerId(), targetKey }), target_key: targetKey, label_kind: labelKind, entity_id: entityId, values, reviewer_id: reviewerId(), reviewer_kind: reviewer('kind'), review_pass: passId(), run_key: runKey(), capture_key: captureKey(), reviewed_at: new Date().toISOString(), provenance: { schema_version: 'visual-benchmark-v1', capture_version: root?.dataset.captureVersion || captureKey(), task_id: null, model: null, prompt_version: WORKFLOW_VERSION } };
    if (candidateId) row.candidate_id = candidateId;
    if (visualInstanceId) row.visual_instance_id = visualInstanceId;
    if (identityDerivation) row.identity_derivation = identityDerivation;
    if (role) row.role = role;
    return row;
  }
  function records(options) { return [...root.querySelectorAll('form[data-record-type]')].map(form => record(form, options)).filter(Boolean); }
  function refreshDerivedIdentity() { for (const form of root.querySelectorAll('form[data-identity-mode="inherited-exact"]')) { const candidateId = form.dataset.candidateId || ''; const identity = root.querySelector('form[data-record-type="candidate"][data-candidate-id="' + CSS.escape(candidateId) + '"] [data-field="identity"]')?.value || ''; const output = form.querySelector('[data-derived-identity]'); if (output) output.textContent = identity ? 'Will inherit: ' + identity : 'Waiting for candidate identity.'; } }
  function save() { const lines = records({ finalize: false }).map(item => JSON.stringify(item)); try { localStorage.setItem(storageKey(), lines.join('\\n') + (lines.length ? '\\n' : '')); status.textContent = 'Draft saved; unselected observations remain unfinalized.'; } catch { status.textContent = 'Draft available for export; browser storage is unavailable.'; } }
  function download() {
    const attested = root.querySelector('form[data-record-type="review-attestation"] [data-field="visual_evidence_reviewed"]')?.checked;
    if (!attested) { status.textContent = 'Attest the entity visual review before export.'; return; }
    if (reviewerId() === 'unassigned' || reviewer('kind') === 'unassigned') { status.textContent = 'Reviewer ID and reviewer kind are required before export.'; return; }
    const missing = [...root.querySelectorAll('form[data-identity-mode="inherited-exact"]')].filter(form => !root.querySelector('form[data-record-type="candidate"][data-candidate-id="' + CSS.escape(form.dataset.candidateId || '') + '"] [data-field="identity"]')?.value);
    if (missing.length) { status.textContent = missing.length + ' exact-mapped instance(s) are waiting for candidate identity.'; return; }
    let finalized;
    try { finalized = enforceRankerSafe(records({ finalize: true })); } catch (error) { status.textContent = 'Cannot export: ' + error.message; return; }
    const visualCount = finalized.filter(item => item.label_kind === 'visual_instance').length;
    const expected = root.querySelectorAll('form[data-record-type="visual-instance"]').length;
    if (visualCount !== expected) { status.textContent = 'Cannot export: expected ' + expected + ' visual-instance rows, built ' + visualCount + '.'; return; }
    const lines = finalized.map(item => JSON.stringify(item)); const blob = new Blob([lines.join('\\n') + (lines.length ? '\\n' : '')], {type:'application/x-ndjson'}); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'visual-review-' + (root.dataset.runId || 'labels') + '.jsonl'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status.textContent = 'Attested positive-first JSONL exported.';
  }
  function restore() { try { const text = localStorage.getItem(storageKey()); if (!text || text.length > ${MAX_INPUT_FILE_BYTES}) return; const saved = text.split('\\n').filter(Boolean).slice(0, ${MAX_JSONL_ROWS}).map(JSON.parse); for (const item of saved) { const formType = item.label_kind === 'visual_instance' ? 'visual-instance' : item.label_kind === 'missing_role' ? 'missing-role' : item.label_kind === 'review_attestation' ? 'review-attestation' : item.label_kind; const selector = 'form[data-record-type="' + CSS.escape(formType || '') + '"][data-entity-id="' + CSS.escape(item.entity_id || '') + '"]'; const forms = [...root.querySelectorAll(selector)].filter(form => (!item.visual_instance_id || form.dataset.visualInstanceId === item.visual_instance_id) && (!item.candidate_id || form.dataset.candidateId === item.candidate_id) && (!item.role || !form.dataset.role || form.dataset.role === item.role)); const form = forms[0]; if (!form) continue; if (item.label_kind === 'visual_instance' && !item.identity_derivation) { const decision = { correct: 'yes', wrong: 'no', ambiguous: 'unclear' }[item.values?.identity]; const input = decision ? form.querySelector('[data-brand-decision][value="' + CSS.escape(decision) + '"]') : null; if (input) input.checked = true; } for (const control of form.querySelectorAll('[data-field]')) { const value = item.values?.[control.dataset.field]; if (control.type === 'checkbox') control.checked = value === true; else if (control.multiple) { const selected = control.dataset.field === 'best_for_role' ? Object.keys(value || {}).filter(role => value[role]) : Array.isArray(value) ? value : []; for (const option of control.options) option.selected = selected.includes(option.value); } else control.value = typeof value === 'string' ? value : ''; } } refreshDerivedIdentity(); status.textContent = 'Saved scoped draft restored; unselected observations remain unfinalized.'; } catch { status.textContent = 'Draft could not be restored; review fields are empty.'; } }
  root.addEventListener('input', () => { refreshDerivedIdentity(); save(); }); root.addEventListener('change', () => { refreshDerivedIdentity(); save(); }); document.querySelector('[data-action=save]')?.addEventListener('click', save); document.querySelector('[data-action=export]')?.addEventListener('click', download);
  restore();
})();
</script>`;
}

function safeSlug(value, used) {
  const base = String(value).replace(/[^a-z0-9._-]+/gi, '_').replace(/^\.+|\.+$/g, '') || 'entity';
  let slug = base;
  let number = 2;
  while (used.has(slug)) slug = `${base}-${number++}`;
  used.add(slug);
  return slug;
}

export async function buildReviewPacket({ runDirectory, outputDirectory, resume = false, entityId = null, overlapOnly = false, reviewerId = '', reviewerKind = '', passId = 'default', workflowVersion = REVIEW_VERSION }) {
  const run = resolve(runDirectory);
  const output = resolve(outputDirectory ?? join(run, 'review-packets'));
  await mkdir(output, { recursive: true });
  const indexPath = join(output, 'index.html');
  if (existsSync(indexPath) && !resume) throw new Error(`Refusing to overwrite completed packet directory: ${output} (use --resume)`);
  const { manifest, packets: allPackets } = await loadBundle(run);
  if (!manifest || typeof manifest !== 'object' || !(manifest.schema_version === 'visual-benchmark-v1' || first(manifest.version, manifest.capture_version, manifest.run_id))) {
    throw new Error(`Capture directory is not versioned: ${join(run, 'manifest.json')} must include version, capture_version, or run_id`);
  }
  if (entityId && overlapOnly) throw new Error('Use either --entity or --overlap, not both.');
  const overlap = new Set(manifest.overlap ?? manifest.entities?.filter(row => row.qa_overlap).map(row => row.entity_id) ?? []);
  const packets = entityId ? allPackets.filter(packet => packet.entity_id === String(entityId)) : overlapOnly ? allPackets.filter(packet => overlap.has(packet.entity_id)) : allPackets;
  if (entityId && !packets.length) throw new Error(`Unknown entity: ${entityId}`);
  if (overlapOnly && !packets.length) throw new Error('Benchmark manifest has no overlap entities.');
  const runKey = String(first(manifest.run_id, manifest.version, manifest.capture_version, basename(run)));
  const packetRoot = output;
  const assetResolver = await createAssetResolver(run, packetRoot);
  const entitiesDirectory = join(output, 'entities');
  await mkdir(entitiesDirectory, { recursive: true });
  const used = new Set();
  const links = [];
  for (const entity of packets) {
    const slug = safeSlug(entity.entity_id, used);
    const entityPath = join(entitiesDirectory, `${slug}.html`);
    const captureKey = String(first(entity.capture?.capture_id, entity.capture?.capture_version, entity.capture?.captured_at, 'capture-unknown'));
    const html = await renderEntity(entity, assetResolver, entitiesDirectory, '../index.html', { runKey, captureKey, reviewerId, reviewerKind, passId, workflowVersion });
    await writeFile(entityPath, html);
    links.push({ entity, href: `entities/${slug}.html` });
  }
  const manifestInfo = manifest.version ?? manifest.name ?? manifest.capture_version ?? manifest.run_id ?? basename(run);
  const indexHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visual review packet · ${escapeHtml(manifestInfo)}</title>${styles()}</head><body><header><strong>Visual review packet</strong><span class="header-id">${escapeHtml(manifestInfo)}</span><span>Review controls are empty by default.</span></header><main><section><h1>${escapeHtml(manifestInfo)}</h1><p>Frozen capture: <code>${escapeHtml(run)}</code></p><p>${links.length} entity packet(s). Open each packet to inspect screenshots, numbered overlays, element crops, candidate mappings, scores, and rejection diagnostics.</p><nav>${links.map(({ entity, href }) => `<p><a href="${escapeHtml(href)}">${escapeHtml(entity.name)}</a> <code>${escapeHtml(entity.entity_id)}</code> <span class="muted">${escapeHtml(entity.reachability || 'unclassified')}</span></p>`).join('') || '<p class="empty">No entities found.</p>'}</nav></section></main></body></html>`;
  await writeFile(indexPath, indexHtml);
  return { indexPath, entityCount: packets.length, entityPaths: links.map(({ href }) => join(output, href)) };
}

function help() {
  return `Visual logo review packet generator\n\n  node scripts/review/visual-review-packet.mjs --run runs/visual-benchmark-v1 [options]\n\nOptions:\n  --run DIR        Versioned capture directory (required)\n  --output DIR     Default: <run>/review-packets\n  --entity ID      Generate one entity packet\n  --overlap        Generate only manifest overlap entities\n  --reviewer ID    Prefill reviewer identity and scope labels/drafts\n  --pass ID        Review pass identifier used to scope labels/drafts\n  --resume         Permit replacing an existing packet\n  --help`;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { process.stdout.write(`${help()}\n`); return; }
    if (!options.run) throw new Error('--run is required.');
    const result = await buildReviewPacket({ runDirectory: options.run, outputDirectory: options.output, entityId: options.entity, overlapOnly: options.overlap, resume: options.resume, reviewerId: options.reviewer, reviewerKind: options.reviewerKind, passId: options.pass ?? 'default', workflowVersion: options.workflowVersion ?? REVIEW_VERSION });
    process.stdout.write(`${result.indexPath}\n`);
  } catch (error) {
    process.stderr.write(`visual-review-packet: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
