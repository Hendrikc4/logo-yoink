import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { extractLogos as defaultExtractLogos } from './extractor.mjs';

export const CAPTURE_VERSION = 'visual-capture-v1';
export const SCHEMA_VERSION = 'visual-benchmark-v1';
export const DEFAULT_VIEWS = Object.freeze([
  { id: 'desktop-light', viewport: { width: 1440, height: 1000 }, theme: 'light' },
  { id: 'desktop-dark', viewport: { width: 1440, height: 1000 }, theme: 'dark' },
  { id: 'mobile-light', viewport: { width: 390, height: 844 }, theme: 'light' },
]);

export const HARD_LIMITS = Object.freeze({
  views: 3,
  viewportWidth: 3_000,
  viewportHeight: 3_000,
  viewportPixels: 4_000_000,
  instances: 240,
  crops: 96,
  inlineSvgs: 24,
  inlineSvgBytes: 256 * 1024,
  rasterPixels: 64 * 1024 * 1024,
  fullHeight: 12_000,
});

const DEFAULTS = Object.freeze({
  timeoutMs: 15_000,
  hydrationMs: 700,
  maxRequests: 100,
  maxTransferBytes: 10 * 1024 * 1024,
  maxScreenshotBytes: 24 * 1024 * 1024,
  maxFullHeight: 6_000,
  maxTiles: 8,
  maxInstances: 120,
  maxCrops: 96,
  maxInlineSvgs: 24,
  maxInlineSvgBytes: 256 * 1024,
  rasterizeSvgPreviews: false,
  maxCropPixels: 2_000_000,
});

const PRIVATE_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function normaliseTarget(input) {
  const raw = typeof input === 'string' ? input : input?.url ?? input?.website;
  if (!raw) throw new Error('A website URL is required.');
  if (/^[a-z][a-z\d+.-]*:/i.test(String(raw)) && !/^https?:\/\//i.test(String(raw))) throw new Error('Only HTTP(S) website URLs are allowed.');
  const candidate = /^https?:\/\//i.test(String(raw)) ? String(raw) : `https://${raw}`;
  let url;
  try { url = new URL(candidate); } catch { throw new Error('Invalid website URL.'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only HTTP(S) website URLs are allowed.');
  if (url.username || url.password) throw new Error('Website URLs must not contain credentials.');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Website URLs must use the default HTTP(S) port.');
  if (isPrivateHostname(url.hostname) || isPrivateIp(url.hostname)) throw new Error('Website URL targets a private-network address.');
  url.hash = '';
  return { url: url.href, domain: url.hostname.toLowerCase().replace(/^www\./, ''), company: input?.company ?? input?.name ?? null };
}

function isPrivateIp(hostname) {
  const value = String(hostname ?? '').replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const family = isIP(value);
  if (family === 6) {
    if (value === '::' || value === '::1' || /^(?:fc|fd|fe[89ab])/i.test(value) || /^2001:db8:/i.test(value)) return true;
    const mapped = value.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i);
    if (mapped) {
      const number = Number.parseInt(mapped[1], 16) * 65536 + Number.parseInt(mapped[2], 16);
      return isPrivateIp(`${number >>> 24}.${number >>> 16 & 255}.${number >>> 8 & 255}.${number & 255}`);
    }
    return false;
  }
  if (family !== 4) return false;
  const parts = value.split('.').map(Number), [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && ((b === 0 && [0, 2].includes(c)) || (b === 88 && c === 99) || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) || a >= 224;
}

function isPrivateHostname(hostname) {
  const value = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  return PRIVATE_HOSTNAMES.has(value) || value.endsWith('.localhost') || value.endsWith('.local');
}

function safeDiagnosticText(value) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s)]+/gi, match => {
      try { const url = new URL(match); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; } catch { return '[url]'; }
    })
    .replace(/\b(password|token|secret|key)\s*[=:]\s*([^\s&]+)/gi, (_, key) => `${key}=[redacted]`);
}

function safeSegment(value) {
  const original = String(value ?? '');
  const base = original.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!base) throw new Error('Worker/task identifier must not be empty.');
  return base === original ? base : `${base}-${sha256(original).slice(0, 10)}`;
}

export async function isSafeHttpUrl(value, options = {}) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || isPrivateIp(url.hostname) || isPrivateHostname(url.hostname)) return false;
  if (options.lookup === false) return true;
  const lookup = options.lookup ?? dnsLookup;
  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    return (Array.isArray(addresses) ? addresses : [addresses]).every(address => !isPrivateIp(address.address ?? address));
  } catch { return false; }
}

export function shardFor(entityId, shardCount) {
  const count = Number(shardCount);
  if (!Number.isInteger(count) || count < 1) throw new Error('shardCount must be a positive integer.');
  return Number.parseInt(sha256(String(entityId)).slice(0, 8), 16) % count;
}

export function safeEntityPath(root, entityId) {
  const original = String(entityId ?? '');
  const safeBase = original.replace(/[^a-zA-Z0-9._-]/g, '_');
  const safe = safeBase === original ? safeBase : `${safeBase}-${sha256(original).slice(0, 10)}`;
  if (!safe || safe === '.' || safe === '..') throw new Error('Invalid entity ID.');
  const rootPath = resolve(root);
  const path = resolve(rootPath, 'captures', safe);
  if (relative(rootPath, path).startsWith('..')) throw new Error('Artifact path escapes capture root.');
  return path;
}

export function contentTypeExtension(contentType = '', url = '') {
  const mime = String(contentType).split(';')[0].trim().toLowerCase();
  if (mime === 'image/svg+xml') return 'svg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/avif') return 'avif';
  const ext = basename(new URL(url, 'https://invalid.example').pathname).split('.').pop()?.toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext ?? '') ? ext : 'bin';
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, path);
}

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function optionsWithDefaults(options) {
  const merged = { ...DEFAULTS, ...options };
  for (const key of ['timeoutMs', 'hydrationMs', 'maxRequests', 'maxTransferBytes', 'maxScreenshotBytes', 'maxFullHeight', 'maxTiles', 'maxInstances', 'maxCropPixels']) merged[key] = finitePositive(merged[key], DEFAULTS[key]);
  merged.maxFullHeight = Math.min(merged.maxFullHeight, HARD_LIMITS.fullHeight);
  merged.maxCropPixels = Math.min(merged.maxCropPixels, HARD_LIMITS.rasterPixels);
  merged.maxInstances = Math.min(Math.floor(merged.maxInstances), HARD_LIMITS.instances);
  merged.maxCrops = Math.min(Math.floor(finitePositive(merged.maxCrops, DEFAULTS.maxCrops)), HARD_LIMITS.crops);
  merged.maxInlineSvgs = Math.min(Math.floor(finitePositive(merged.maxInlineSvgs, DEFAULTS.maxInlineSvgs)), HARD_LIMITS.inlineSvgs);
  merged.maxInlineSvgBytes = Math.min(Math.floor(finitePositive(merged.maxInlineSvgBytes, DEFAULTS.maxInlineSvgBytes)), HARD_LIMITS.inlineSvgBytes);
  merged.views = normalizeViews(options.views ?? DEFAULT_VIEWS, merged);
  merged.outputRoot = resolve(options.outputRoot ?? '.');
  merged.configHash = sha256(canonicalJson({
    capture_version: CAPTURE_VERSION, views: merged.views, timeoutMs: merged.timeoutMs, hydrationMs: merged.hydrationMs,
    maxRequests: merged.maxRequests, maxTransferBytes: merged.maxTransferBytes, maxFullHeight: merged.maxFullHeight,
    maxTiles: merged.maxTiles, maxInstances: merged.maxInstances, maxCrops: merged.maxCrops,
    maxInlineSvgs: merged.maxInlineSvgs, maxInlineSvgBytes: merged.maxInlineSvgBytes, rasterizeSvgPreviews: Boolean(merged.rasterizeSvgPreviews),
  }));
  return merged;
}

function normalizeViews(views, config) {
  const input = Array.isArray(views) ? views : DEFAULT_VIEWS;
  const normalized = [];
  for (const view of input.slice(0, HARD_LIMITS.views)) {
    const requestedWidth = Math.max(1, Math.floor(Number(view?.viewport?.width) || 1));
    const requestedHeight = Math.max(1, Math.floor(Number(view?.viewport?.height) || 1));
    let width = Math.min(requestedWidth, HARD_LIMITS.viewportWidth);
    let height = Math.min(requestedHeight, HARD_LIMITS.viewportHeight);
    const pixels = width * height;
    if (pixels > HARD_LIMITS.viewportPixels) {
      const scale = Math.sqrt(HARD_LIMITS.viewportPixels / pixels);
      width = Math.max(1, Math.floor(width * scale));
      height = Math.max(1, Math.floor(height * scale));
    }
    if (width !== requestedWidth || height !== requestedHeight) config.budgetTruncated = true;
    normalized.push({ id: String(view?.id ?? `view-${normalized.length + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_'), viewport: { width, height }, theme: ['light', 'dark'].includes(view?.theme) ? view.theme : 'light' });
  }
  if (input.length > HARD_LIMITS.views) config.budgetTruncated = true;
  return normalized.length ? normalized : DEFAULT_VIEWS;
}

function artifactName(viewId, kind, index = null) {
  const suffix = index == null ? '' : `-${String(index).padStart(3, '0')}`;
  return `${viewId}-${kind}${suffix}.png`;
}

function provenance(config, extra = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    capture_version: CAPTURE_VERSION,
    extractor_revision: config.extractorRevision ?? null,
    ranker_revision: config.rankerRevision ?? null,
    task_id: config.taskId ?? null,
    model: config.model ?? null,
    prompt_version: config.promptVersion ?? null,
    captured_at: extra.captured_at ?? config.capturedAt ?? null,
    ...extra,
  };
}

const REJECTION_STAGES = new Set(['discovery', 'parse', 'download_budget', 'validation', 'deduplication', 'generic_asset', 'role_eligibility', 'rank_threshold', 'identity_filter', 'shape_quality', 'theme_serialization', 'mapping', 'other']);
function rejectionReason(stage, reason) {
  return { stage: REJECTION_STAGES.has(stage) ? stage : 'other', reason: safeDiagnosticText(reason).slice(0, 500) || 'unspecified rejection' };
}

function sourceType(item) {
  const source = String(item?.source ?? item?.source_type ?? '').toLowerCase();
  if (source.includes('picture')) return 'picture';
  if (source.includes('inline') || source === 'schema' || source === 'og-logo' || source === 'microdata') return source === 'inline-svg' || source.includes('inline') ? 'inline_svg' : 'structured_data';
  if (source.includes('background')) return 'css_background';
  if (source.includes('mask')) return 'css_mask';
  if (source.includes('favicon') || source === 'manifest' || source === 'apple' || source === 'mask-icon' || source === 'ms-tile' || source === 'html-icon' || source === 'besticon') return source === 'manifest' ? 'manifest' : 'favicon';
  if (source.includes('img') || source.includes('image')) return 'img';
  if (source.includes('text')) return 'text_only';
  return 'other';
}

function visualRole(instance) {
  if (instance?.kind === 'text') return 'other';
  if (instance?.kind === 'mask') return 'symbol';
  const ratio = instance?.box?.width > 0 && instance?.box?.height > 0 ? instance.box.width / instance.box.height : null;
  if (instance?.kind === 'favicon' || (instance?.source && /favicon/i.test(instance.source))) return 'favicon';
  if (ratio != null && ratio >= 1.8) return 'horizontal_lockup';
  if (ratio != null && ratio >= 0.72 && ratio <= 1.4) return 'symbol';
  return 'other';
}

function visualRegion(value) {
  return new Set(['header', 'nav', 'body', 'footer', 'metadata', 'browser_chrome', 'unknown']).has(value) ? value : 'unknown';
}

function visibilityFor(instance) {
  if (instance?.visible === false || instance?.box?.width < 2 || instance?.box?.height < 2) return 'unusable';
  return instance?.theme === 'dark' || instance?.theme === 'light' ? 'good' : 'conditional';
}

function classifyIdentity(staticResult, finalUrl, requestedUrl) {
  const errors = (staticResult?.diagnostics?.errors ?? []).join(' ');
  if (/parked|for sale|sedoparking|hugedomains|afternic/i.test(errors)) return { identity: 'wrong_site', reachability: 'parked_or_for_sale' };
  if (/checkpoint|captcha|interstitial|security check/i.test(errors)) return { identity: 'unreachable', reachability: 'blocked_interstitial' };
  if (!finalUrl) return { identity: 'unreachable', reachability: 'dns_tls_failure' };
  const reachability = classifyReachability(requestedUrl, finalUrl, true);
  return { identity: reachability === 'redirected_off_domain' ? 'ambiguous' : 'current', reachability };
}

function normalizeStaticStatus(staticResult) {
  const status = String(staticResult?.diagnostics?.status ?? '').toLowerCase();
  if (status === 'error' || status === 'failure') return 'failure';
  if (status === 'unavailable') return 'unavailable';
  return staticResult ? 'success' : 'not_run';
}

function clampBox(box, dimensions) {
  const width = Math.max(0, Number(dimensions?.width) || 0), height = Math.max(0, Number(dimensions?.height) || 0);
  const x = Math.max(0, Math.min(width, Number(box?.x) || 0)), y = Math.max(0, Math.min(height, Number(box?.y) || 0));
  return { x, y, width: Math.max(0, Math.min(width - x, Number(box?.width) || 0)), height: Math.max(0, Math.min(height - y, Number(box?.height) || 0)) };
}

function localClip(box, scrollY, viewport) {
  const width = Math.max(0, Number(viewport?.width) || 0), height = Math.max(0, Number(viewport?.height) || 0);
  const x = Math.max(0, Math.min(width, Number(box?.x) || 0));
  const y = Math.max(0, Math.min(height, (Number(box?.y) || 0) - scrollY));
  return { x, y, width: Math.max(0, Math.min(width - x, Number(box?.width) || 0)), height: Math.max(0, Math.min(height - y, Number(box?.height) || 0)) };
}

function dataUrlBytes(value) {
  const match = /^data:[^;,]+(;base64)?,([\s\S]*)$/i.exec(String(value ?? ''));
  if (!match) return null;
  try { return match[1] ? Buffer.from(match[2], 'base64') : Buffer.from(decodeURIComponent(match[2]), 'utf8'); } catch { return null; }
}

function candidateId(entityId, item, index = 0) {
  const identity = item?.observed?.byte_hash ?? item?.content_hash ?? item?.resolvedUrl ?? item?.resolved_url ?? item?.url ?? item?.inline_svg_hash ?? `${item?.source ?? 'other'}:${index}`;
  return `candidate-${sha256(`${entityId}\0${identity}`).slice(0, 24)}`;
}

function publicUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.href;
  } catch { return null; }
}

function sanitizeCssUrls(value) {
  return String(value ?? '').replace(/url\(([^)]*)\)/gi, (_, raw) => {
    const unquoted = String(raw).trim().replace(/^['"]|['"]$/g, '');
    const safe = publicUrl(unquoted);
    return safe ? `url(${safe})` : 'url()';
  });
}

function candidateFeatureSnapshot(candidate, artifacts) {
  const width = Number(candidate?.width) || null, height = Number(candidate?.height) || null;
  const ratio = width && height ? Math.round((width / height) * 10_000) / 10_000 : null;
  const pixels = width && height ? width * height : null;
  return {
    snapshot_version: 'candidate-features-v1', source_type: sourceType(candidate), source: candidate?.source ?? null,
    width, height, aspect_ratio: ratio, pixel_count: pixels, raster_oversized: Boolean(pixels && pixels > HARD_LIMITS.rasterPixels),
    scalable: Boolean(candidate?.scalable || String(candidate?.format ?? '').toLowerCase() === 'svg'),
    content_hash: artifacts.contentHash, rendered: Boolean(candidate?.evidence?.rendered),
    dom_region: candidate?.evidence?.dom_region ?? null, home_linked: Boolean(candidate?.evidence?.home_linked),
    positive_token: Boolean(candidate?.evidence?.positive_token), negative_context: Boolean(candidate?.evidence?.negative_context),
    themes: candidate?.evidence?.themes ?? [],
  };
}

function stableVisualKey(entityId, view, instance) {
  const locator = instance?.locator ?? {};
  return `${entityId}\0${instance?.kind ?? 'other'}\0${instance?.url ?? `svg:${instance?.inline_svg_hash ?? ''}`}\0${instance?.region ?? 'unknown'}\0${Math.round(instance?.box?.x ?? 0)}\0${Math.round(instance?.box?.y ?? 0)}\0${Math.round(instance?.box?.width ?? 0)}\0${Math.round(instance?.box?.height ?? 0)}\0${locator.id ?? ''}\0${locator.class_name ?? ''}`;
}

async function appendJsonl(path, rows, idField, { replaceEntityIds = [] } = {}) {
  if (!rows.length && !replaceEntityIds.length) return;
  let existing = [];
  if (existsSync(path)) {
    const text = await readFile(path, 'utf8');
    existing = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  }
  const replace = new Set(replaceEntityIds);
  const seen = new Map(existing.filter(row => !replace.has(row.entity_id)).map(row => [row[idField], row]));
  for (const row of rows) {
    const prior = seen.get(row[idField]);
    if (prior && canonicalJson(prior) !== canonicalJson(row)) throw new Error(`Conflicting ${row.record_type} ${row[idField]} in ${path}.`);
    seen.set(row[idField], row);
  }
  await atomicWrite(path, `${[...seen.values()].map(row => JSON.stringify(row)).join('\n')}\n`);
}

async function writeCandidateArtifacts(candidate, candidateIdValue, outputRoot, config = {}) {
  const bytes = dataUrlBytes(candidate?.dataUrl);
  if (!bytes || !candidateIdValue) return { assetPath: null, previewPath: null, contentHash: candidate?.observed?.byte_hash ?? candidate?.content_hash ?? null, bytes: null };
  const declaredPixels = Number(candidate?.width) > 0 && Number(candidate?.height) > 0 ? Number(candidate.width) * Number(candidate.height) : null;
  const isSvg = String(candidate?.format ?? candidate?.mimeType ?? '').toLowerCase().includes('svg');
  if (!isSvg && declaredPixels && declaredPixels > HARD_LIMITS.rasterPixels) return { assetPath: null, previewPath: null, contentHash: candidate?.observed?.byte_hash ?? sha256(bytes), bytes: bytes.length, rasterOversized: true };
  const contentHash = candidate?.observed?.byte_hash ?? sha256(bytes);
  const extension = isSvg ? 'svg' : String(candidate?.format ?? 'bin').replace(/^image\//, '').replace('jpeg', 'jpg').toLowerCase() || 'bin';
  const assetAbsolute = join(outputRoot, 'assets', `${contentHash}.${/^[a-z0-9]{1,5}$/.test(extension) ? extension : 'bin'}`);
  await mkdir(dirname(assetAbsolute), { recursive: true });
  if (!existsSync(assetAbsolute)) await writeFile(assetAbsolute, bytes);
  let previewPath = null;
  if (extension === 'svg' && config.rasterizeSvgPreviews === true && candidate?.trustedSvg === true) {
    try {
      const previewAbsolute = join(outputRoot, 'assets', `${contentHash}-preview.png`);
      if (!existsSync(previewAbsolute)) await sharp(bytes, { limitInputPixels: 16 * 1024 * 1024 }).png().toFile(previewAbsolute);
      previewPath = relative(outputRoot, previewAbsolute);
    } catch { /* invalid/unsupported SVG remains available as metadata only */ }
  }
  return { assetPath: relative(outputRoot, assetAbsolute), previewPath, contentHash, bytes: bytes.length };
}

async function runStaticPass(target, entity, browser, config) {
  const extract = config.extractLogos ?? defaultExtractLogos;
  try {
    const result = await extract(target.url, {
      companyName: entity.name ?? entity.company_name ?? null,
      timeoutMs: Math.min(config.timeoutMs, 12_000),
      maxCandidates: config.maxCandidates ?? 16,
      roleAwareBudget: true,
      contentBoundingWide: true,
      browser: Boolean(browser),
      browserInstance: browser,
      userAgent: config.userAgent,
    });
    return { ...result, candidates: Array.isArray(result?.candidates) ? result.candidates : [], diagnostics: { ...(result?.diagnostics ?? {}), status: result?.diagnostics?.status ?? 'success' } };
  } catch (error) {
    return { candidates: [], diagnostics: { status: 'error', errors: [safeDiagnosticText(error?.message ?? error)], requests: 0, bytesDownloaded: 0 } };
  }
}

async function buildEvidenceRows(entity, target, finalUrl, staticResult, views, config, diagnostics) {
  const candidateRows = [], candidateByUrl = new Map(), candidateByHash = new Map(), rejections = [];
  const candidates = staticResult?.candidates ?? [];
  for (const [index, candidate] of candidates.entries()) {
    const id = candidateId(entity.entity_id, candidate, index);
    let artifacts;
    try { artifacts = await writeCandidateArtifacts(candidate, id, config.outputRoot, config); }
    catch (error) {
      diagnostics.artifactFailures.push({ artifact: `candidate:${id}`, kind: 'asset', reason: safeDiagnosticText(error?.message ?? error) });
      artifacts = { assetPath: null, previewPath: null, contentHash: candidate?.observed?.byte_hash ?? candidate?.content_hash ?? null, bytes: null };
    }
    const resolvedUrl = publicUrl(candidate?.resolvedUrl ?? candidate?.resolved_url);
    const sourceUrl = publicUrl(candidate?.source_page ?? candidate?.url);
    const row = {
      schema_version: SCHEMA_VERSION, record_type: 'candidate', candidate_id: id, entity_id: entity.entity_id,
      source_type: sourceType(candidate), source: candidate?.source ?? null,
      source_url: sourceUrl, resolved_url: resolvedUrl, content_hash: artifacts.contentHash,
      asset_path: artifacts.assetPath, preview_path: artifacts.previewPath,
      format: candidate?.format ?? candidate?.mimeType ?? null, width: candidate?.width ?? null, height: candidate?.height ?? null,
      role_scores: candidate?.role_scores ?? {}, predicted_roles: candidate?.predicted_roles ?? [], score: candidate?.score ?? null,
      score_reasons: Array.isArray(candidate?.score_reasons) ? candidate.score_reasons : candidate?.score_reasons ? [candidate.score_reasons] : [],
      rejections: Array.isArray(candidate?.rejections ?? candidate?.rejection_reasons) ? (candidate.rejections ?? candidate.rejection_reasons) : (candidate?.rejections ?? candidate?.rejection_reasons ? [candidate.rejections ?? candidate.rejection_reasons] : []),
      provenance_quality: candidate?.evidence?.rendered ? 'visible_exact_use' : 'inferred_first_party',
      feature_snapshot_version: 'candidate-features-v1', feature_snapshot: candidateFeatureSnapshot(candidate, artifacts),
      provenance: provenance(config),
    };
    candidateRows.push(row);
    for (const url of [publicUrl(candidate?.url), resolvedUrl].filter(Boolean)) candidateByUrl.set(url, id);
    if (artifacts.contentHash) candidateByHash.set(artifacts.contentHash, id);
    for (const reason of row.rejections) {
      const parsed = typeof reason === 'object' ? reason : rejectionReason('other', reason);
      rejections.push({ schema_version: SCHEMA_VERSION, record_type: 'rejection', rejection_id: `rejection-${sha256(`${entity.entity_id}\0${id}\0${JSON.stringify(parsed)}`).slice(0, 24)}`, entity_id: entity.entity_id, candidate_id: id, ...rejectionReason(parsed.stage ?? 'other', parsed.reason ?? parsed.message ?? parsed), provenance: provenance(config) });
    }
    if (row.feature_snapshot.raster_oversized || artifacts.rasterOversized) rejections.push({
      schema_version: SCHEMA_VERSION, record_type: 'rejection', rejection_id: `rejection-${sha256(`${entity.entity_id}\0${id}\0raster-pixels`).slice(0, 24)}`,
      entity_id: entity.entity_id, candidate_id: id, ...rejectionReason('shape_quality', 'raster candidate exceeds pixel safety cap'), provenance: provenance(config),
    });
  }
  const visualRows = [], mappingRows = [];
  const seenVisuals = new Set();
  for (const view of views) for (const instance of view.instances ?? []) {
    const visualKey = `${instance.kind}|${instance.url ?? `svg:${instance.inline_svg_hash ?? ''}`}|${instance.region}|${Math.round(instance.box.x)}|${Math.round(instance.box.y)}|${Math.round(instance.box.width)}|${Math.round(instance.box.height)}`;
    if (seenVisuals.has(visualKey)) continue;
    seenVisuals.add(visualKey);
    const visualId = `visual-${sha256(stableVisualKey(entity.entity_id, view, instance)).slice(0, 24)}`;
    const exactCandidate = instance.url ? candidateByUrl.get(instance.url) : null;
    const hashCandidate = instance.inline_svg_hash ? candidateByHash.get(instance.inline_svg_hash) : null;
    const mappedCandidate = exactCandidate ?? hashCandidate ?? null;
    const mappingConfidence = exactCandidate ? 'exact' : hashCandidate ? 'derived' : 'unmapped';
    const visualRow = {
      schema_version: SCHEMA_VERSION, record_type: 'visual_instance', visual_instance_id: visualId, entity_id: entity.entity_id,
      view: view.view, visual_role: visualRole(instance), region: visualRegion(instance.region), theme: view.theme,
      visibility: visibilityFor(instance), instance_box: instance.box, candidate_id: mappedCandidate,
      source: instance.source, source_url: publicUrl(instance.url), screenshot_path: view.top?.path ?? null,
      overlay_path: view.overlay?.path ?? null, crop_path: (view.crops ?? []).find(crop => crop.instance_id === instance.instance_id)?.path ?? null,
      locator: instance.locator, rendered_dimensions: { width: instance.box.width, height: instance.box.height }, evidence: instance.evidence,
      provenance: provenance(config),
    };
    visualRows.push(visualRow);
    mappingRows.push({
      schema_version: SCHEMA_VERSION, record_type: 'mapping', mapping_id: `mapping-${sha256(`${entity.entity_id}\0${visualId}`).slice(0, 24)}`,
      entity_id: entity.entity_id, visual_instance_id: visualId, candidate_id: mappedCandidate, mapping_confidence: mappingConfidence,
      unmapped_reason: mappedCandidate ? null : instance.kind === 'text' ? 'text-only-brand-treatment' : instance.url || instance.inline_svg_hash ? 'candidate-not-retained' : 'no-source-url',
      provenance: provenance(config),
    });
    if (!mappedCandidate && (instance.url || instance.inline_svg_hash)) rejections.push({
      schema_version: SCHEMA_VERSION, record_type: 'rejection', rejection_id: `rejection-${sha256(`${entity.entity_id}\0mapping\0${visualId}`).slice(0, 24)}`,
      entity_id: entity.entity_id, candidate_id: null, ...rejectionReason('mapping', 'visible instance was not retained as a candidate'), provenance: provenance(config),
    });
  }
  for (const item of staticResult?.diagnostics?.errors ?? []) rejections.push({
    schema_version: SCHEMA_VERSION, record_type: 'rejection', rejection_id: `rejection-${sha256(`${entity.entity_id}\0diagnostic\0${item}`).slice(0, 24)}`,
    entity_id: entity.entity_id, candidate_id: null, ...rejectionReason('other', item), provenance: provenance(config),
  });
  for (const failure of diagnostics.artifactFailures ?? []) rejections.push({
    schema_version: SCHEMA_VERSION, record_type: 'rejection', rejection_id: `rejection-${sha256(`${entity.entity_id}\0artifact\0${failure.artifact}\0${failure.reason}`).slice(0, 24)}`,
    entity_id: entity.entity_id, candidate_id: null, ...rejectionReason('other', `${failure.kind ?? 'artifact'} ${failure.artifact}: ${failure.reason}`), provenance: provenance(config),
  });
  const requestedUrl = target.url;
  const classification = classifyIdentity(staticResult, finalUrl, requestedUrl);
  const captureRow = {
    schema_version: SCHEMA_VERSION, record_type: 'entity_capture', entity_id: entity.entity_id,
    company_name: String(entity.name ?? entity.company_name ?? entity.entity_id), requested_website: publicUrl(entity.website ?? requestedUrl) ?? publicUrl(requestedUrl),
    capture_status: diagnostics.resourceLimitHit || diagnostics.budgetTruncated || (diagnostics.artifactFailures?.length ?? 0) > 0 ? 'incomplete' : 'success', identity_status: classification.identity, reachability: classification.reachability,
    static_pass_status: normalizeStaticStatus(staticResult), resource_status: diagnostics.resourceLimitHit || diagnostics.budgetTruncated ? 'truncated' : 'complete',
    final_url: publicUrl(finalUrl), captured_at: new Date().toISOString(), artifact_path: relative(config.outputRoot, safeEntityPath(config.outputRoot, entity.entity_id)),
    candidate_count: candidateRows.length, visual_instance_count: visualRows.length, diagnostics, provenance: provenance(config),
  };
  return { captureRow, candidateRows, visualRows, mappingRows, rejections };
}

async function screenshot(page, path, options, diagnostics, screenshotOptions = {}) {
  if (typeof page.screenshot !== 'function') return null;
  try {
    const bytes = await page.screenshot({ type: 'png', animations: 'disabled', timeout: options.timeoutMs, ...screenshotOptions });
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? '');
    diagnostics.screenshots += 1;
    diagnostics.screenshotBytes += buffer.length;
    if (diagnostics.screenshotBytes > options.maxScreenshotBytes) {
      diagnostics.resourceLimitHit = true;
      diagnostics.warnings.push('screenshot-byte-budget-exceeded');
      diagnostics.artifactFailures.push({ artifact: relative(options.outputRoot, path), kind: 'screenshot', reason: 'screenshot-byte-budget-exceeded' });
      return null;
    }
    await atomicWrite(path, buffer);
    return { path: relative(options.outputRoot, path), sha256: sha256(buffer), bytes: buffer.length };
  } catch (error) {
    const reason = safeDiagnosticText(error?.message ?? error).slice(0, 300) || 'screenshot-failed';
    diagnostics.warnings.push(`screenshot:${reason}`);
    diagnostics.artifactFailures.push({ artifact: relative(options.outputRoot, path), kind: 'screenshot', reason });
    return null;
  }
}

async function inspectInstances(page, view, options, prefix = '') {
  if (typeof page.evaluate !== 'function') return [];
  const result = await page.evaluate(inspectPage, { view, maxInstances: options.maxInstances, maxInlineSvgs: options.maxInlineSvgs, maxInlineSvgBytes: options.maxInlineSvgBytes });
  return Array.isArray(result) ? result.slice(0, options.maxInstances).map((item, index) => normaliseInstance(item, view, `${prefix}${index}`)) : [];
}

function normaliseInstance(item, view, index) {
  const box = item?.box ?? item?.renderedBox ?? {};
  const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const boundedBox = { x: numeric(box.x), y: numeric(box.y), width: Math.max(0, numeric(box.width)), height: Math.max(0, numeric(box.height)) };
  let safeUrl = null;
  try {
    const parsed = new URL(item?.url ?? '');
    if (/^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password) safeUrl = publicUrl(parsed.href);
  } catch { /* an inline or CSS-only instance has no URL */ }
  return {
    instance_id: `${view.id}-instance-${String(Number.isFinite(Number(index)) ? Number(index) + 1 : index).padStart(3, '0')}`,
    view: view.id,
    theme: view.theme,
    kind: item?.kind ?? 'other',
    source: item?.source ?? null,
    url: safeUrl,
    box: boundedBox,
    visible: item?.visible !== false,
    region: item?.region ?? 'document',
    current_source: publicUrl(item?.currentSource),
    background_image: sanitizeCssUrls(item?.backgroundImage),
    mask_image: sanitizeCssUrls(item?.maskImage),
    pseudo: item?.pseudo ?? null,
    alt: item?.alt ?? '',
    aria_label: item?.ariaLabel ?? '',
    title: item?.title ?? '',
    class_name: item?.className ?? '',
    id: item?.id ?? '',
    anchor_href: publicUrl(item?.anchorHref),
    home_linked: Boolean(item?.homeLinked),
    inline_svg_hash: item?.inlineSvg ? sha256(item.inlineSvg) : null,
    inline_svg_bytes: item?.inlineSvg ? Buffer.byteLength(item.inlineSvg) : null,
    locator: { kind: item?.kind ?? 'other', id: item?.id ?? '', class_name: item?.className ?? '', region: item?.region ?? 'document', anchor_href: publicUrl(item?.anchorHref), source_url: safeUrl },
    evidence: { ...(item?.evidence ?? {}), asset_hash: item?.inlineSvg ? sha256(item.inlineSvg) : null, rendered_box: boundedBox },
  };
}

async function installBudget(page, budget, options) {
  const hostChecks = new Map();
  page.on?.('response', response => {
    const headers = response.headers?.() ?? {};
    const length = Number(headers['content-length'] ?? 0);
    if (Number.isFinite(length) && length > 0) budget.declaredBytes += length;
    if (budget.requests > options.maxRequests || budget.declaredBytes > options.maxTransferBytes) budget.limitHit = true;
    budget.responses.push({ url: publicUrl(response.url?.()), status: response.status?.() ?? null, content_type: headers['content-type'] ?? null, declared_bytes: length || null });
  });
  await page.route?.('**/*', async route => {
    budget.requests += 1;
    const request = route.request?.();
    const url = request?.url?.();
    const type = request?.resourceType?.() ?? '';
    const safe = await isSafeHttpUrl(url, { lookup: options.lookup });
    const over = budget.requests > options.maxRequests || budget.declaredBytes > options.maxTransferBytes;
    if (!safe || over || type === 'media' || type === 'font') {
      budget.blocked += 1;
      if (over) budget.limitHit = true;
      await route.abort?.();
    } else await route.continue?.();
  });
}

async function boundedWait(page, options) {
  if (!options.hydrationMs) return;
  try { await page.waitForLoadState?.('networkidle', { timeout: Math.min(options.hydrationMs, options.timeoutMs) }); }
  catch { await page.waitForTimeout?.(options.hydrationMs); }
}

async function captureView(page, view, entityDirectory, options, diagnostics) {
  await page.setViewportSize?.(view.viewport);
  await page.emulateMedia?.({ colorScheme: view.theme, reducedMotion: 'reduce' });
  const instances = [];
  const inspectWithBudget = async prefix => {
    const remaining = Math.max(0, options.maxInstances - diagnostics.instanceCount);
    if (!remaining) { diagnostics.budgetTruncated = true; diagnostics.truncation_reasons.push('instance-budget'); return []; }
    const found = await inspectInstances(page, view, { ...options, maxInstances: remaining }, prefix);
    diagnostics.instanceCount += found.length;
    return found;
  };
  await page.evaluate?.(restorePage, null).catch?.(() => {});
  // A viewport screenshot is already bounded by Playwright. Supplying a clip
  // here is both redundant and prone to failure on pages with tiny viewports.
  const top = await screenshot(page, join(entityDirectory, artifactName(view.id, 'top')), options, diagnostics, { fullPage: false });
  const topInstances = await inspectWithBudget('top-');
  instances.push(...topInstances);

  const dimensions = await page.evaluate?.(() => ({ width: document.documentElement?.scrollWidth || innerWidth, height: document.documentElement?.scrollHeight || innerHeight })) ?? view.viewport;
  const totalHeight = Math.min(Math.max(view.viewport.height, Number(dimensions.height) || view.viewport.height), options.maxFullHeight);
  const tiles = Math.min(options.maxTiles, Math.max(1, Math.ceil(totalHeight / view.viewport.height)));
  const full = [];
  for (let tile = 0; tile < tiles; tile++) {
    const y = Math.min(tile * view.viewport.height, Math.max(0, totalHeight - view.viewport.height));
    await page.evaluate?.(scrollToY, y).catch?.(() => {});
    await page.waitForTimeout?.(50);
    const tileHeight = Math.min(view.viewport.height, totalHeight - y);
    const artifact = tileHeight > 0 ? await screenshot(page, join(entityDirectory, artifactName(view.id, 'full', tile + 1)), options, diagnostics, { clip: { x: 0, y: 0, width: view.viewport.width, height: tileHeight } }) : null;
    if (artifact) full.push({ ...artifact, y, width: view.viewport.width, height: Math.min(view.viewport.height, totalHeight - y) });
    instances.push(...await inspectWithBudget(`tile-${tile + 1}-`));
  }
  await page.evaluate?.(scrollToY, 0).catch?.(() => {});
  const uniqueInstances = [];
  const seenInstances = new Set();
  for (const instance of instances) {
    const key = `${instance.theme}|${instance.kind}|${instance.url ?? `svg:${instance.inline_svg_hash ?? ''}`}|${Math.round(instance.box.x)}|${Math.round(instance.box.y)}|${Math.round(instance.box.width)}|${Math.round(instance.box.height)}`;
    if (seenInstances.has(key)) continue;
    seenInstances.add(key); uniqueInstances.push(instance);
  }
  instances.length = 0; instances.push(...uniqueInstances);
  const overlay = await page.evaluate?.(addOverlay, instances).catch?.(() => false);
  const overlayArtifact = overlay === false ? null : await screenshot(page, join(entityDirectory, artifactName(view.id, 'overlay')), options, diagnostics, { fullPage: false });
  await page.evaluate?.(removeOverlay, null).catch?.(() => {});

  const crops = [];
  for (const [index, instance] of instances.entries()) {
    if (diagnostics.cropCount >= options.maxCrops) { diagnostics.budgetTruncated = true; diagnostics.truncation_reasons.push('crop-budget'); break; }
    const box = clampBox(instance.box, dimensions);
    instance.box = box;
    if (box.width < 1 || box.height < 1 || box.width * box.height > options.maxCropPixels) continue;
    const maxScrollY = Math.max(0, totalHeight - view.viewport.height);
    const scrollY = Math.min(maxScrollY, Math.max(0, box.y));
    await page.evaluate?.(scrollToY, scrollY).catch?.(() => {});
    await page.waitForTimeout?.(25);
    const clip = localClip(box, scrollY, view.viewport);
    const crop = clip.width > 0 && clip.height > 0
      ? await screenshot(page, join(entityDirectory, 'element-crops', artifactName(view.id, 'crop', index + 1)), options, diagnostics, { clip })
      : null;
    if (crop) { crops.push({ instance_id: instance.instance_id, ...crop }); diagnostics.cropCount += 1; }
  }
  await page.evaluate?.(scrollToY, 0).catch?.(() => {});
  return { view: view.id, viewport: view.viewport, theme: view.theme, top, full, overlay: overlayArtifact, instances, crops, document: dimensions };
}

export async function captureEntity(input, options = {}) {
  const config = optionsWithDefaults(options);
  const startedAt = Date.now();
  const entity = { ...input, entity_id: input?.entity_id ?? input?.id ?? null };
  let target;
  try { target = normaliseTarget(input); } catch (error) {
    const record = failureRecord(entity, error, startedAt);
    if (config.outputRoot && entity.entity_id) {
      await atomicWrite(join(safeEntityPath(config.outputRoot, entity.entity_id), 'page.json'), `${JSON.stringify(record, null, 2)}\n`).catch(() => {});
    }
    return record;
  }
  const entityDirectory = safeEntityPath(config.outputRoot ?? '.', entity.entity_id ?? sha256(target.url).slice(0, 16));
  const existingPath = join(entityDirectory, 'page.json');
  if (config.resume && existsSync(existingPath)) {
    try {
      const prior = JSON.parse(await readFile(existingPath, 'utf8'));
      if (prior.capture_version === CAPTURE_VERSION && prior.complete === true) return { ...prior, resumed: true };
    } catch { /* recapture a corrupt checkpoint */ }
  } else if (existsSync(existingPath) && config.refuseOverwrite !== false) {
    throw new Error(`Capture already exists for ${entity.entity_id}; pass resume to reuse it.`);
  }

  const diagnostics = { requests: 0, declared_bytes: 0, blocked_requests: 0, responses: [], screenshots: 0, screenshotBytes: 0, instanceCount: 0, cropCount: 0, budgetTruncated: Boolean(config.budgetTruncated), truncation_reasons: [], resourceLimitHit: false, warnings: [], artifactFailures: [], errors: [] };
  let browser = config.browser ?? null;
  let ownsBrowser = false;
  let page = null;
  try {
    if (!browser) {
      const playwright = config.playwright ?? await import('playwright');
      const chromium = playwright.chromium ?? playwright.default?.chromium;
      browser = await chromium.launch({ headless: true, ...(config.launchOptions ?? {}) });
      ownsBrowser = true;
    }
    page = await browser.newPage?.({ viewport: DEFAULT_VIEWS[0].viewport, serviceWorkers: 'block', userAgent: config.userAgent ?? 'LogoYoinkVisualBenchmark/1.0' });
    page?.setDefaultTimeout?.(config.timeoutMs);
    page?.setDefaultNavigationTimeout?.(config.timeoutMs);
    const budget = { requests: 0, declaredBytes: 0, blocked: 0, limitHit: false, responses: [] };
    await installBudget(page, budget, config);
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
    await boundedWait(page, config);
    const finalUrl = page.url?.() ?? target.url;
    const html = typeof page.content === 'function' ? await page.content() : '';
    const staticResult = await runStaticPass(target, entity, browser, config);
    const views = [];
    for (const view of config.views) views.push(await captureView(page, view, entityDirectory, config, diagnostics));
    diagnostics.requests = budget.requests;
    diagnostics.declared_bytes = budget.declaredBytes;
    diagnostics.blocked_requests = budget.blocked;
    diagnostics.resourceLimitHit = diagnostics.resourceLimitHit || budget.limitHit;
    if (budget.limitHit) { diagnostics.budgetTruncated = true; diagnostics.truncation_reasons.push('network-budget'); }
    diagnostics.responses = budget.responses.slice(0, config.maxRequests);
    const evidence = await buildEvidenceRows(entity, target, finalUrl, staticResult, views, config, diagnostics);
    const record = {
      schema_version: SCHEMA_VERSION, capture_version: CAPTURE_VERSION, complete: evidence.captureRow.capture_status === 'success', record_type: 'page_capture',
      entity_id: entity.entity_id, requested: { name: entity.name ?? null, website: publicUrl(entity.website ?? input?.url) },
      requested_url: publicUrl(target.url), final_url: publicUrl(finalUrl), reachability: evidence.captureRow.reachability,
      captured_at: new Date().toISOString(), browser: { engine: 'chromium', version: browser.version?.() ?? null },
      html: { sha256: sha256(html), bytes: Buffer.byteLength(html) }, diagnostics, views,
      capture_row: evidence.captureRow, candidate_rows: evidence.candidateRows, visual_instance_rows: evidence.visualRows,
      mapping_rows: evidence.mappingRows, rejection_rows: evidence.rejections,
    };
    await atomicWrite(existingPath, `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } catch (error) {
    diagnostics.errors.push(safeDiagnosticText(error?.message ?? String(error)));
    const record = failureRecord(entity, error, startedAt, { ...diagnostics, final_url: page?.url?.() ?? target.url });
    await atomicWrite(existingPath, `${JSON.stringify(record, null, 2)}\n`).catch(() => {});
    return record;
  } finally {
    await page?.close?.().catch?.(() => {});
    if (ownsBrowser) await browser?.close?.().catch?.(() => {});
  }
}

function classifyReachability(requested, finalUrl, page) {
  if (!finalUrl) return 'dns_tls_failure';
  try {
    const a = new URL(requested), b = new URL(finalUrl);
    const canonicalHost = host => host.toLowerCase().replace(/^www\./, '');
    if (canonicalHost(a.hostname) !== canonicalHost(b.hostname)) return 'redirected_off_domain';
    return page ? 'live_first_party' : 'incomplete_blank';
  } catch { return 'incomplete_blank'; }
}

function classifyFailure(error) {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  const networkFailure = /(?:dns|enotfound|name_not_resolved|cert|certificate|tls|ssl|connection(?: reset| refused| closed)?|err_socket|eai_again|eai_fail)/i.test(message);
  return networkFailure ? { identity: 'unreachable', reachability: 'dns_tls_failure' } : { identity: 'unreachable', reachability: 'incomplete_blank' };
}

function failureRecord(entity, error, startedAt, diagnostics = {}) {
  const message = safeDiagnosticText(error?.message ?? error);
  const classification = classifyFailure(error);
  const sanitizedErrors = [...new Set([message, ...(Array.isArray(diagnostics.errors) ? diagnostics.errors : [])].map(safeDiagnosticText))];
  const safeDiagnostics = { ...diagnostics, errors: sanitizedErrors, final_url: publicUrl(diagnostics.final_url) };
  const captureRow = {
    schema_version: SCHEMA_VERSION, record_type: 'entity_capture', entity_id: entity.entity_id ?? null,
    company_name: String(entity.name ?? entity.company_name ?? entity.entity_id ?? 'unknown'), requested_website: publicUrl(entity.website) ?? '',
    capture_status: 'failure', identity_status: classification.identity, reachability: classification.reachability, final_url: null,
    static_pass_status: 'not_run', failure_stage: classification.reachability === 'dns_tls_failure' ? 'navigation' : 'artifact_or_navigation',
    captured_at: new Date().toISOString(), provenance: provenance(diagnostics),
  };
  const rejection = entity.entity_id ? { schema_version: SCHEMA_VERSION, record_type: 'rejection', rejection_id: `rejection-${sha256(`${entity.entity_id}\0capture\0${message}`).slice(0, 24)}`, entity_id: entity.entity_id, candidate_id: null, ...rejectionReason('other', message), provenance: provenance(diagnostics) } : null;
  return { schema_version: SCHEMA_VERSION, capture_version: CAPTURE_VERSION, complete: false, record_type: 'page_capture', entity_id: entity.entity_id ?? null, requested: { name: entity.name ?? null, website: publicUrl(entity.website) }, reachability: classification.reachability, captured_at: new Date().toISOString(), diagnostics: { status: 'error', failure_stage: captureRow.failure_stage, duration_ms: Date.now() - startedAt, ...safeDiagnostics }, capture_row: captureRow, candidate_rows: [], visual_instance_rows: [], mapping_rows: [], rejection_rows: rejection ? [rejection] : [] };
}

export async function captureShard(fixture, options = {}) {
  const config = optionsWithDefaults(options);
  const companies = Array.isArray(fixture) ? fixture : fixture?.fixture_companies;
  if (!Array.isArray(companies)) throw new Error('Fixture must contain fixture_companies.');
  const assignmentRoot = resolve(config.assignmentRoot ?? config.outputRoot);
  const workerSegment = config.workerId ?? config.taskId ? safeSegment(config.workerId ?? config.taskId) : '';
  const root = config.workerOutputRoot
    ? resolve(config.workerOutputRoot)
    : workerSegment
      ? join(config.outputRoot, 'workers', workerSegment)
      : config.outputRoot;
  const workerConfig = { ...config, outputRoot: root };
  let assignmentManifest = null;
  let assignmentManifestText = null;
  const assignmentManifestPath = config.assignmentManifest ?? (existsSync(join(assignmentRoot, 'benchmark-manifest.json')) ? join(assignmentRoot, 'benchmark-manifest.json') : join(assignmentRoot, 'manifest.json'));
  if (existsSync(assignmentManifestPath)) {
    assignmentManifestText = await readFile(assignmentManifestPath, 'utf8');
    assignmentManifest = JSON.parse(assignmentManifestText);
    if (assignmentManifest.schema_version !== SCHEMA_VERSION) throw new Error('Assignment manifest has an incompatible schema_version.');
  }
  const shardCount = Number(config.shardCount ?? assignmentManifest?.counts?.shards ?? 1), shardIndex = Number(config.shardIndex ?? 0);
  if (!Number.isInteger(shardCount) || shardCount < 1 || !Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) throw new Error('Invalid shard index/count.');
  const companyById = new Map(companies.map(company => [company.entity_id, company]));
  const selected = assignmentManifest
    ? (assignmentManifest.entities ?? []).filter(assignment => assignment.capture_shard === shardIndex).map(assignment => ({ ...(companyById.get(assignment.entity_id) ?? {}), ...assignment }))
    : companies.filter(company => shardFor(company.entity_id, shardCount) === shardIndex);
  const records = [];
  for (const company of selected) records.push(await captureEntity(company, { ...workerConfig, resume: config.resume !== false, refuseOverwrite: false }));
  const aggregateRows = records.flatMap(record => ({
    captures: record.capture_row ? [record.capture_row] : [],
    candidates: record.candidate_rows ?? [],
    visualInstances: record.visual_instance_rows ?? [],
    mappings: record.mapping_rows ?? [],
    rejections: record.rejection_rows ?? [],
  }));
  const replacedEntities = selected.map(company => company.entity_id);
  await appendJsonl(join(root, 'captures.jsonl'), aggregateRows.flatMap(rows => rows.captures), 'entity_id', { replaceEntityIds: replacedEntities });
  await appendJsonl(join(root, 'candidates.jsonl'), aggregateRows.flatMap(rows => rows.candidates), 'candidate_id', { replaceEntityIds: replacedEntities });
  await appendJsonl(join(root, 'visual-instances.jsonl'), aggregateRows.flatMap(rows => rows.visualInstances), 'visual_instance_id', { replaceEntityIds: replacedEntities });
  await appendJsonl(join(root, 'mappings.jsonl'), aggregateRows.flatMap(rows => rows.mappings), 'mapping_id', { replaceEntityIds: replacedEntities });
  await appendJsonl(join(root, 'rejections.jsonl'), aggregateRows.flatMap(rows => rows.rejections), 'rejection_id', { replaceEntityIds: replacedEntities });
  const captureManifestPath = join(root, 'capture-manifest.json');
  if (existsSync(captureManifestPath) && !config.resume) throw new Error(`Refusing to overwrite ${captureManifestPath}; pass --resume to continue.`);
  const browserVersions = [...new Set(records.map(record => record.browser?.version).filter(Boolean))];
  const budgetState = {
    requests: records.reduce((sum, record) => sum + Number(record.diagnostics?.requests ?? 0), 0),
    declared_bytes: records.reduce((sum, record) => sum + Number(record.diagnostics?.declared_bytes ?? 0), 0),
    truncated_entities: records.filter(record => record.capture_row?.resource_status === 'truncated' || record.diagnostics?.budgetTruncated).length,
    incomplete_entities: records.filter(record => !record.complete).length,
  };
  const ownedEntityIds = selected.map(company => company.entity_id);
  const ownedShards = [{ shard_id: shardIndex, entity_ids: ownedEntityIds, entity_count: ownedEntityIds.length }];
  const captureManifest = {
    schema_version: SCHEMA_VERSION, record_type: 'capture_manifest', benchmark_version: 1, capture_version: CAPTURE_VERSION,
    assignment_manifest: assignmentManifest ? relative(root, assignmentManifestPath) : null,
    assignment_manifest_digest: assignmentManifestText ? sha256(assignmentManifestText) : null,
    fixture: config.fixturePath ?? null, created_at: new Date().toISOString(), generated_at: new Date().toISOString(),
    config_hash: config.configHash, worker_id: config.workerId ?? null, task_id: config.taskId ?? null,
    shard_count: shardCount, shard_index: shardIndex, owned_shards: ownedShards,
    entity_count: selected.length, assigned_count: selected.length, entity_ids: selected.map(company => company.entity_id),
    completed_entity_ids: records.filter(record => record.complete).map(record => record.entity_id),
    browser_version: browserVersions.length === 1 ? browserVersions[0] : browserVersions,
    budget_state: budgetState,
    aggregate_files: { captures: 'captures.jsonl', candidates: 'candidates.jsonl', visual_instances: 'visual-instances.jsonl', mappings: 'mappings.jsonl', rejections: 'rejections.jsonl' },
    config: { views: config.views, timeoutMs: config.timeoutMs, hydrationMs: config.hydrationMs, maxRequests: config.maxRequests, maxTransferBytes: config.maxTransferBytes, maxFullHeight: config.maxFullHeight, maxTiles: config.maxTiles, maxInstances: config.maxInstances, maxCrops: config.maxCrops, maxInlineSvgs: config.maxInlineSvgs, rasterizeSvgPreviews: config.rasterizeSvgPreviews },
    provenance: provenance(config, { captured_at: new Date().toISOString() }),
  };
  await atomicWrite(captureManifestPath, `${JSON.stringify(captureManifest, null, 2)}\n`);
  return { manifest: captureManifestPath, shard: null, outputRoot: root, assigned: selected.length, records };
}

// This function executes inside the page. It only serializes metadata and a
// sanitized hash of inline SVG; review artifacts are screenshots of the page,
// never a direct render of untrusted SVG bytes.
export function inspectPage({ view, maxInstances = 120, maxInlineSvgs = 24, maxInlineSvgBytes = 256 * 1024 } = {}) {
  const clean = value => String(value ?? '').trim();
  const http = value => { try { const url = new URL(value, document.baseURI); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } };
  const visible = (element, rect, style) => rect.width >= 2 && rect.height >= 2 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  const region = element => element.closest('header') ? 'header' : element.closest('nav') ? 'nav' : element.closest('[role="banner"]') ? 'banner' : element.closest('footer') ? 'footer' : 'document';
  const link = element => { const anchor = element.closest?.('a[href]'); const href = anchor ? http(anchor.href) : null; if (!href) return { anchorHref: null, homeLinked: false }; const target = new URL(href), current = new URL(location.href); const path = target.pathname.replace(/\/+$/, '') || '/'; const localizedRoot = /^\/[a-z]{2}(?:-[A-Z]{2})?$/.test(path); return { anchorHref: href, homeLinked: target.hostname.replace(/^www\./, '') === current.hostname.replace(/^www\./, '') && (path === '/' || localizedRoot) }; };
  const base = (element, rect, style, kind, source) => ({ kind, source, box: { x: rect.x, y: rect.y + scrollY, width: rect.width, height: rect.height }, visible: true, region: region(element), currentSource: element.currentSrc || null, url: http(element.currentSrc || element.src || element.getAttribute?.('data-src')), alt: clean(element.getAttribute?.('alt')), ariaLabel: clean(element.getAttribute?.('aria-label')), title: clean(element.getAttribute?.('title')), id: clean(element.id), className: clean(typeof element.className === 'string' ? element.className : element.getAttribute?.('class')), backgroundImage: style.backgroundImage !== 'none' ? style.backgroundImage : null, maskImage: style.maskImage !== 'none' ? style.maskImage : null, ...link(element), evidence: { viewport: view.viewport, theme: view.theme, computed_color: clean(style.color), background_color: clean(style.backgroundColor) } });
  const output = [];
  let inlineSvgWork = 0;
  const roots = [...document.querySelectorAll('img, svg, [style*="background" i], [style*="mask" i], [class*="logo" i], [id*="logo" i]')];
  for (const element of roots) {
    if (output.length >= maxInstances) break;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    if (!visible(element, rect, style)) continue;
    const tag = element.tagName.toLowerCase();
    if (tag === 'img') output.push(base(element, rect, style, 'img', 'browser-img'));
    else if (tag === 'svg') {
      if (inlineSvgWork >= maxInlineSvgs) {
        output.push({ ...base(element, rect, style, 'svg', 'browser-inline-svg'), inlineSvgSkipped: true });
        continue;
      }
      const svg = element.cloneNode(true);
      svg.querySelectorAll('script,foreignObject').forEach(node => node.remove());
      svg.querySelectorAll('*').forEach(node => [...node.attributes].forEach(attribute => { if (/^on/i.test(attribute.name) || /^(?:href|xlink:href)$/i.test(attribute.name) && !attribute.value.startsWith('#')) node.removeAttribute(attribute.name); }));
      inlineSvgWork += 1;
      const inlineSvg = new XMLSerializer().serializeToString(svg);
      if (inlineSvg.length > maxInlineSvgBytes) output.push({ ...base(element, rect, style, 'svg', 'browser-inline-svg'), inlineSvgSkipped: true });
      else output.push({ ...base(element, rect, style, 'svg', 'browser-inline-svg'), inlineSvg });
    } else {
      const background = style.backgroundImage !== 'none' ? style.backgroundImage : style.maskImage !== 'none' ? style.maskImage : '';
      const match = background.match(/url\(["']?([^"')]+)["']?\)/i);
      output.push({ ...base(element, rect, style, style.maskImage !== 'none' ? 'mask' : 'background', 'browser-css'), url: match ? http(match[1]) : null });
    }
  }
  // Pseudo-elements commonly carry responsive/brand marks without an <img>.
  // Their box is conservatively the host element's box; the stylesheet value
  // and pseudo marker let the mapper distinguish this derived observation.
  for (const element of roots) {
    if (output.length >= maxInstances) break;
    const rect = element.getBoundingClientRect();
    for (const pseudo of ['::before', '::after']) {
      if (output.length >= maxInstances) break;
      const style = getComputedStyle(element, pseudo);
      const image = style.backgroundImage !== 'none' ? style.backgroundImage : style.maskImage !== 'none' ? style.maskImage : '';
      const match = image.match(/url\(["']?([^"')]+)["']?\)/i);
      if (!match || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0 || rect.width < 2 || rect.height < 2) continue;
      output.push({ ...base(element, rect, style, style.maskImage !== 'none' ? 'mask' : 'background', 'browser-css-pseudo'), url: http(match[1]), pseudo });
    }
  }
  return output;
}

function scrollToY(y) { window.scrollTo(0, y); }
function restorePage() { document.querySelectorAll('[data-logo-yoink-overlay]').forEach(node => node.remove()); }
function addOverlay(instances) {
  const layer = document.createElement('div'); layer.dataset.logoYoinkOverlay = 'true'; layer.style.cssText = 'position:absolute;z-index:2147483647;left:0;top:0;pointer-events:none';
  for (const [index, item] of (instances ?? []).entries()) { const box = item.box; const label = document.createElement('span'); label.textContent = String(index + 1); label.style.cssText = `position:absolute;left:${box.x}px;top:${box.y}px;background:#d00;color:#fff;font:700 12px sans-serif;padding:2px 4px`; layer.append(label); }
  document.body.append(layer); return true;
}
function removeOverlay() { document.querySelectorAll('[data-logo-yoink-overlay]').forEach(node => node.remove()); }

export const internals = { isPrivateIp, installBudget, inspectInstances, normaliseInstance, artifactName, classifyReachability, classifyFailure, normalizeViews, publicUrl, safeDiagnosticText, stableVisualKey, failureRecord };
