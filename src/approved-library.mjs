import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAssetPreferences } from './asset-model.mjs';
import { extractLogos, normalizeWebsite } from './extractor.mjs';
import { processSelectedAssets } from './post-process.mjs';
import { measureTinyImageSuitability } from './tiny-image-suitability.mjs';

const DEFAULT_MANIFEST_PATH = fileURLToPath(new URL('../brand-library/v2/manifest.json', import.meta.url));
const RUNTIME_MANIFEST_PATH = fileURLToPath(new URL('../brand-library/runtime/manifest.json', import.meta.url));
const APPROVED_LIBRARY_ROOT = fileURLToPath(new URL('../brand-library/', import.meta.url));
const MIME_TYPES = Object.freeze({
  avif: 'image/avif', gif: 'image/gif', ico: 'image/x-icon', jpeg: 'image/jpeg', jpg: 'image/jpeg',
  png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp',
});
const ROLE_NAMES = new Set(['icon', 'logo']);
const NON_WIDE_REPRESENTATIONS = new Set(['stacked_lockup', 'compact_wordmark']);
const manifestCache = new Map();
let defaultManifestPathPromise;

function defaultManifestPath() {
  defaultManifestPathPromise ??= access(DEFAULT_MANIFEST_PATH).then(
    () => DEFAULT_MANIFEST_PATH,
    () => access(RUNTIME_MANIFEST_PATH).then(() => RUNTIME_MANIFEST_PATH, () => null),
  );
  return defaultManifestPathPromise;
}

function normalizedDomain(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

async function readManifest(path) {
  let pending = manifestCache.get(path);
  if (!pending) {
    pending = readFile(path, 'utf8').then(JSON.parse);
    manifestCache.set(path, pending);
  }
  return pending;
}

function manifestIndex(manifest) {
  const index = new Map();
  const add = (domain, match) => {
    const existing = index.get(domain);
    index.set(domain, existing && existing.brand.id !== match.brand.id ? null : match);
  };
  for (const brand of manifest.brands ?? []) {
    const canonical = normalizedDomain(brand.domain);
    if (canonical) add(canonical, { brand, matchedBy: 'domain', matchedDomain: brand.domain });
    for (const alias of brand.aliases ?? []) {
      const normalized = normalizedDomain(alias);
      if (normalized) add(normalized, { brand, matchedBy: 'alias', matchedDomain: alias });
    }
  }
  return index;
}

function requestedRoles(options) {
  const requested = options.roles ?? (options.role == null ? null : [options.role]);
  if (requested == null) return ['icon', 'logo'];
  if (!Array.isArray(requested) || requested.some(role => !ROLE_NAMES.has(role === 'wide' ? 'logo' : role))) {
    throw new TypeError('roles must contain only "icon" and/or "logo".');
  }
  return [...new Set(requested.map(role => role === 'wide' ? 'logo' : role))];
}

function representations(preference) {
  if (preference?.representation == null) return null;
  return new Set(Array.isArray(preference.representation) ? preference.representation : [preference.representation]);
}

function exactPreferenceMatch(asset, preference, role) {
  if (!asset) return false;
  if (preference.theme !== 'any' && ![preference.theme, 'any'].includes(asset.variant?.theme)) return false;
  if (preference.color !== 'any' && asset.variant?.color !== preference.color) return false;
  if (preference.background !== 'any' && asset.variant?.background !== preference.background) return false;
  const wantedRepresentations = representations(preference);
  if (role === 'logo' && wantedRepresentations && !wantedRepresentations.has(asset.representation)) return false;
  return true;
}

function safeAssetPath(manifestPath, assetPath, libraryRoot = APPROVED_LIBRARY_ROOT) {
  if (typeof assetPath !== 'string' || !assetPath || isAbsolute(assetPath)) throw new Error('Approved asset has an invalid path.');
  const absolute = resolve(dirname(manifestPath), assetPath);
  const boundary = relative(resolve(libraryRoot), absolute);
  if (boundary.startsWith('..') || isAbsolute(boundary)) throw new Error('Approved asset path escapes the brand library.');
  return absolute;
}

function preferenceStatus(asset, preference, role) {
  if (!asset) return 'unmatched';
  return exactPreferenceMatch(asset, preference, role) ? 'exact' : 'fallback';
}

function legacyWideAsset(asset) {
  return asset && !NON_WIDE_REPRESENTATIONS.has(asset.representation) ? asset : null;
}

async function materializeAsset({ asset, brand, manifest, manifestPath, role, libraryRoot }) {
  const absolutePath = safeAssetPath(manifestPath, asset.path, libraryRoot);
  const bytes = await readFile(absolutePath);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  if (asset.contentHash && contentHash !== asset.contentHash) {
    throw new Error(`Approved asset hash mismatch for ${brand.id}/${role}.`);
  }
  const format = String(asset.format ?? '').toLowerCase();
  const mimeType = MIME_TYPES[format] ?? 'application/octet-stream';
  const suitability = await measureTinyImageSuitability(bytes);
  const background = suitability?.canvas_background ?? 'unknown';
  const supportedThemes = ['light', 'dark'].filter(value => {
    if (background === 'transparent') return Number(suitability?.surface_contrast?.[value]) >= 0.08;
    if (background === 'opaque') return Number(suitability?.contrast) >= 0.08;
    return false;
  });
  const theme = asset.theme === 'light' || asset.theme === 'dark'
    ? asset.theme
    : supportedThemes.length === 2 ? 'any' : supportedThemes[0] ?? 'unknown';
  const familyId = `approved-library-${brand.id}-${role}`;
  const sourceUrl = asset.sourceUrl ?? brand.officialHomepage;
  return {
    url: sourceUrl,
    resolvedUrl: sourceUrl,
    resolved_url: sourceUrl,
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    format,
    mimeType,
    width: asset.width ?? null,
    height: asset.height ?? null,
    bytes: bytes.length,
    source: 'approved-library',
    sourceKind: asset.sourceKind ?? null,
    sourcePage: asset.discoveryPage ?? brand.officialHomepage,
    source_page: asset.discoveryPage ?? brand.officialHomepage,
    role,
    theme: asset.theme ?? 'any',
    representation: asset.representation ?? (role === 'icon' ? 'symbol' : 'unspecified'),
    background,
    variant: { theme, color: asset.color ?? 'unknown', background },
    scalable: format === 'svg',
    squareish: Boolean(asset.width && asset.height && asset.width / asset.height >= 0.72 && asset.width / asset.height <= 1.4),
    highResolution: format === 'svg' || Math.max(Number(asset.width) || 0, Number(asset.height) || 0) >= 180,
    observed: { format, mimeType, width: asset.width ?? null, height: asset.height ?? null, byte_hash: contentHash },
    tinySuitability: suitability,
    evidence: {
      approved_library: true,
      verification_status: asset.verificationStatus,
      eligible_roles: [role],
      theme: asset.theme ?? 'any',
    },
    predicted_roles: role === 'icon' ? ['icon', 'favicon'] : ['logo'],
    role_scores: role === 'icon' ? { icon: 100, favicon: 100, wide: 0 } : { icon: 0, favicon: 0, wide: 100 },
    confidence_band: 'high',
    certainty: 'approved',
    family_id: familyId,
    content_hash: contentHash,
    provenanceChain: asset.provenanceChain ?? [],
    provenance_chain: asset.provenanceChain ?? [],
    provenance: {
      library_id: manifest.libraryId,
      brand_id: brand.id,
      approved_asset_path: asset.path,
      content_hash: contentHash,
      source_url: sourceUrl,
      discovery_page: asset.discoveryPage ?? brand.officialHomepage,
      source_kind: asset.sourceKind ?? null,
      source_chain: asset.provenanceChain ?? [],
      verification_status: asset.verificationStatus,
      last_confirmed_current_at: asset.lastConfirmedCurrentAt ?? null,
    },
  };
}

async function approvedBrandResult(match, normalized, options, dependencies) {
  const manifest = dependencies.manifest ?? await readManifest(dependencies.manifestPath);
  const preferences = normalizeAssetPreferences(options.preferences);
  const roles = requestedRoles(options);
  const assets = { icon: null, logo: null };
  const assetVariants = { icon: [], logo: [] };
  const candidates = [];
  const assetFamilies = [];

  for (const role of roles) {
    const records = [match.brand.assets?.[role], ...(match.brand.variants?.[role] ?? [])].filter(Boolean);
    const materialized = await Promise.all(records.map(asset => materializeAsset({
      asset, brand: match.brand, manifest, manifestPath: dependencies.manifestPath, role, libraryRoot: dependencies.libraryRoot,
    })));
    if (!materialized.length) continue;
    const preference = preferences[role];
    const exact = materialized.find(asset => exactPreferenceMatch(asset, preference, role));
    const selected = exact ?? (preference.strict ? null : materialized[0]);
    assets[role] = selected;
    assetVariants[role] = selected ? [selected, ...materialized.filter(asset => asset !== selected)] : materialized;
    const start = candidates.length;
    candidates.push(...materialized);
    assetFamilies.push({
      id: materialized[0].family_id,
      candidateIndexes: materialized.map((_, index) => start + index),
      representativeIndex: start,
      variantCount: materialized.length,
      roles: [role === 'logo' ? 'logo' : 'icon'],
      bestByRole: role === 'logo'
        ? { logo: start, wide: legacyWideAsset(materialized[0]) ? start : null, icon: null, favicon: null }
        : { icon: start, favicon: start, logo: null, wide: null },
    });
  }

  const preferenceMatch = Object.fromEntries(['icon', 'logo'].map(role => [role,
    roles.includes(role) ? preferenceStatus(assets[role], preferences[role], role) : 'unmatched']));
  return {
    input: normalized.url.href,
    domain: normalized.domain,
    homepage: match.brand.officialHomepage ?? `https://${match.brand.domain}/`,
    icon: assets.icon,
    logo: assets.logo,
    preferences,
    preferenceMatch,
    assets,
    assetVariants,
    variantPolicy: { source: 'approved-library' },
    selected: assets.icon ?? assets.logo ?? null,
    selectedByRole: { icon: assets.icon, logo: assets.logo, wide: legacyWideAsset(assets.logo), favicon: assets.icon },
    assetFamilies,
    candidates,
    diagnostics: {
      homepageUnavailable: false,
      requests: 0,
      staticRequests: 0,
      bytesDownloaded: 0,
      downloadedBytes: 0,
      durationMs: 0,
      library: {
        enabled: true,
        hit: true,
        libraryId: manifest.libraryId,
        brandId: match.brand.id,
        matchedBy: match.matchedBy,
        matchedDomain: match.matchedDomain,
        requestedRoles: roles,
        approvedRoles: roles.filter(role => Boolean(match.brand.assets?.[role])),
      },
    },
  };
}

function combineFamilies(libraryResult, liveResult, candidates) {
  const libraryKeys = new Set(libraryResult.candidates.map(asset => asset.content_hash));
  const liveCandidates = (liveResult?.candidates ?? []).filter(asset => !libraryKeys.has(asset.observed?.byte_hash ?? asset.content_hash));
  const liveOffset = libraryResult.candidates.length;
  candidates.push(...liveCandidates);
  const liveIndex = new Map(liveCandidates.map((asset, index) => [asset, liveOffset + index]));
  const liveFamilies = (liveResult?.assetFamilies ?? []).flatMap(family => {
    const indexes = (family.candidateIndexes ?? []).map(index => liveIndex.get(liveResult.candidates?.[index])).filter(Number.isInteger);
    return indexes.length ? [{ ...family, id: `live-${family.id}`, candidateIndexes: indexes, representativeIndex: indexes[0] }] : [];
  });
  return [...libraryResult.assetFamilies, ...liveFamilies];
}

function liveRoleAsset(liveResult, role) {
  return liveResult?.assets?.[role] ?? liveResult?.selectedByRole?.[role === 'logo' ? 'wide' : role] ?? null;
}

function livePreferenceStatus(liveResult, liveAsset, role, preference) {
  if (!liveAsset) return 'unmatched';
  const reported = liveResult?.preferenceMatch?.[role] ?? 'fallback';
  const wantedRepresentations = representations(preference);
  if (role === 'logo' && wantedRepresentations && !wantedRepresentations.has(liveAsset.representation)) return 'fallback';
  return reported;
}

async function mergeWithLive(libraryResult, liveResult, options, fallbackRoles, liveFailure = null) {
  const preferences = libraryResult.preferences;
  const assets = { ...libraryResult.assets };
  const assetVariants = { icon: [...libraryResult.assetVariants.icon], logo: [...libraryResult.assetVariants.logo] };
  const preferenceMatch = { ...libraryResult.preferenceMatch };
  for (const role of fallbackRoles) {
    const liveAsset = liveRoleAsset(liveResult, role);
    const liveMatch = livePreferenceStatus(liveResult, liveAsset, role, preferences[role]);
    if (liveAsset && (liveMatch === 'exact' || !assets[role] && !preferences[role].strict)) {
      assets[role] = liveAsset;
      preferenceMatch[role] = liveMatch;
    }
    const variants = liveResult?.assetVariants?.[role] ?? (liveAsset ? [liveAsset] : []);
    assetVariants[role] = [...assetVariants[role], ...variants.filter(asset => !assetVariants[role].includes(asset))];
  }
  const candidates = [...libraryResult.candidates];
  const assetFamilies = combineFamilies(libraryResult, liveResult, candidates);
  const processingRequested = options.removeBackground === true || options.backgroundRemoval === true || options.upscale != null || options.upscaleFactor != null;
  const processedAssets = processingRequested ? await processSelectedAssets(assets, options) : null;
  const liveDiagnostics = liveResult?.diagnostics ?? {};
  return {
    ...(liveResult ?? libraryResult),
    input: libraryResult.input,
    domain: libraryResult.domain,
    homepage: liveResult?.homepage ?? libraryResult.homepage,
    icon: assets.icon,
    logo: assets.logo,
    preferences,
    preferenceMatch,
    assets,
    ...(processedAssets ? { processedAssets } : {}),
    assetVariants,
    selected: assets.icon ?? assets.logo ?? null,
    selectedByRole: {
      ...(liveResult?.selectedByRole ?? {}),
      icon: assets.icon,
      logo: assets.logo,
      wide: legacyWideAsset(assets.logo),
      favicon: liveResult?.selectedByRole?.favicon ?? assets.icon,
    },
    candidates,
    assetFamilies,
    diagnostics: {
      ...libraryResult.diagnostics,
      ...liveDiagnostics,
      library: {
        ...libraryResult.diagnostics.library,
        selectedRoles: ['icon', 'logo'].filter(role => assets[role] && assets[role] === libraryResult.assets[role]),
        liveFallback: {
          requestedRoles: fallbackRoles,
          status: liveFailure ? 'error' : liveResult ? 'complete' : 'not-needed',
          ...(liveFailure?.diagnostics?.failureClass ? { failureClass: liveFailure.diagnostics.failureClass } : {}),
        },
      },
    },
  };
}

/**
 * Prefer exact-domain, reviewed library artwork and use live discovery only for
 * uncovered requested roles or preferences. `extractLogos` remains the direct
 * low-level live-discovery API; pass `{ library: false }` to bypass this wrapper.
 */
export async function extractLogosWithLibrary(website, options = {}, dependencies = {}) {
  const liveExtract = dependencies.liveExtract ?? extractLogos;
  if (options.library === false || options.approvedLibrary === false) return liveExtract(website, options);
  const normalized = normalizeWebsite(website);
  const manifestPath = dependencies.manifestPath ?? await defaultManifestPath();
  if (!manifestPath && !dependencies.manifest) return liveExtract(website, options);
  let manifest;
  try {
    manifest = dependencies.manifest ?? await readManifest(manifestPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return liveExtract(website, options);
    throw error;
  }
  const match = manifestIndex(manifest).get(normalized.domain);
  if (!match) return liveExtract(website, options);

  const context = {
    ...dependencies,
    manifest,
    manifestPath,
    libraryRoot: dependencies.libraryRoot ?? (manifestPath === RUNTIME_MANIFEST_PATH ? dirname(manifestPath) : APPROVED_LIBRARY_ROOT),
  };
  const libraryResult = await approvedBrandResult(match, normalized, options, context);
  libraryResult.input = website;
  const roles = requestedRoles(options);
  const fallbackRoles = roles.filter(role => libraryResult.preferenceMatch[role] !== 'exact');
  if (!fallbackRoles.length) return mergeWithLive(libraryResult, null, options, []);

  try {
    const liveResult = await liveExtract(website, {
      ...options,
      removeBackground: false,
      backgroundRemoval: false,
      upscale: null,
      upscaleFactor: null,
    });
    return mergeWithLive(libraryResult, liveResult, options, fallbackRoles);
  } catch (error) {
    const hasApprovedSelection = roles.some(role => libraryResult.assets[role]);
    if (!hasApprovedSelection) throw error;
    return mergeWithLive(libraryResult, null, options, fallbackRoles, error);
  }
}

export const approvedLibraryInternals = Object.freeze({ normalizedDomain, requestedRoles, exactPreferenceMatch, manifestIndex });
