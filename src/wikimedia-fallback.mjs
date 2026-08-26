import { getDomain, getDomainWithoutSuffix } from 'tldts';
import { assertPublicUrl, fetchTimed, readLimited } from './http-client.mjs';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SEARCH_RESULTS = 10;
const MAX_ENTITY_CANDIDATES = 12;
const DEFAULT_CACHE = new Map();
const DEFAULT_PENDING = new Map();
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
let defaultCacheBytes = 0;

function cleanDomainInput(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    return new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
}

export function registrableDomain(value) {
  const hostname = cleanDomainInput(value);
  return hostname ? getDomain(hostname, { allowPrivateDomains: true }) : null;
}

function statementValue(statement) {
  return statement?.mainsnak?.snaktype === 'value' ? statement.mainsnak?.datavalue?.value : null;
}

function timeValue(qualifiers, property) {
  const values = qualifiers?.[property];
  if (!Array.isArray(values) || values.length !== 1 || values[0]?.snaktype !== 'value') return null;
  const data = values[0]?.datavalue?.value;
  const match = typeof data?.time === 'string' && data.time.match(/^\+(\d{4})-(\d{2})-(\d{2})T/);
  if (!match || !Number.isInteger(data.precision) || data.precision < 9 || data.precision > 11) return null;
  const year = Number(match[1]);
  const month = data.precision >= 10 ? Number(match[2]) : 1;
  const day = data.precision >= 11 ? Number(match[3]) : 1;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  const earliest = new Date(Date.UTC(year, month - 1, day));
  const latest = data.precision === 9
    ? new Date(Date.UTC(year + 1, 0, 1) - 1)
    : data.precision === 10
      ? new Date(Date.UTC(year, month, 1) - 1)
      : new Date(Date.UTC(year, month - 1, day + 1) - 1);
  return { earliest, latest };
}

export function currentLogoClaimDisposition(statement, now = new Date()) {
  if (!statement || statement.rank === 'deprecated' || typeof statementValue(statement) !== 'string') return 'invalid';
  const qualifiers = statement.qualifiers ?? {};
  if (qualifiers.P1534?.length) return 'ended';
  const start = timeValue(qualifiers, 'P580');
  const end = timeValue(qualifiers, 'P582');
  if (qualifiers.P580 && !start || qualifiers.P582 && !end) return 'invalid';
  if (start && start.earliest > now) return 'future';
  if (end && end.latest <= now) return 'ended';
  // A point-in-time-only logo assertion describes a historical observation, not a current mark.
  if (qualifiers.P585?.length && !start && !end) return 'historical_point_in_time';
  return 'current';
}

export function selectCurrentLogoClaims(statements, now = new Date()) {
  const current = (Array.isArray(statements) ? statements : [])
    .filter(statement => currentLogoClaimDisposition(statement, now) === 'current');
  const preferred = current.filter(statement => statement.rank === 'preferred');
  const ranked = preferred.length ? preferred : current.filter(statement => statement.rank === 'normal');
  const byFile = new Map();
  for (const statement of ranked) {
    const filename = statementValue(statement)?.trim();
    if (!filename) continue;
    const key = filename.replace(/^File:/i, '').replace(/_/g, ' ').trim().toLowerCase();
    const record = byFile.get(key) ?? { filename: filename.replace(/^File:/i, '').trim(), statements: [], rank: statement.rank };
    record.statements.push(statement.id ?? null);
    byFile.set(key, record);
  }
  if (byFile.size !== 1) return { claims: [], ambiguous: byFile.size > 1, currentFileCount: byFile.size };
  return { claims: [...byFile.values()], ambiguous: false, currentFileCount: 1 };
}

function officialWebsiteEvidence(entity, requestedDomain, now = new Date()) {
  const evidence = [];
  const current = (entity?.claims?.P856 ?? []).filter(statement => currentLogoClaimDisposition(statement, now) === 'current');
  const preferred = current.filter(statement => statement.rank === 'preferred');
  const ranked = preferred.length ? preferred : current.filter(statement => statement.rank === 'normal');
  for (const statement of ranked) {
    const value = statementValue(statement);
    if (typeof value !== 'string') continue;
    let url;
    try { url = new URL(value); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    const domain = registrableDomain(url.href);
    if (domain !== requestedDomain) continue;
    const relativeHost = url.hostname.toLowerCase().slice(0, -(requestedDomain.length + 1));
    const hostScope = url.hostname.toLowerCase() === requestedDomain
      ? 'apex'
      : relativeHost === 'www'
        ? 'www'
        : /^(?:corporate|company|about)$/.test(relativeHost)
          ? 'corporate'
          : /^[a-z]{2,3}(?:-[a-z]{2})?$/.test(relativeHost)
            ? 'language'
            : null;
    // A shared registrable domain is not enough when the statement points at an arbitrary
    // product subdomain (for example a wiki, store, or developer product). Only the apex,
    // conventional www/corporate hosts, and language hosts establish organization identity.
    if (!hostScope) continue;
    const segments = url.pathname.split('/').filter(Boolean);
    const pathScope = segments.length === 0
      ? 'root'
      : segments.length === 1 && /^[a-z]{2,3}(?:-[a-z]{2})?$/i.test(segments[0])
        ? 'language'
        : segments.length === 1 && /^(?:about|about-us|company|corporate)$/i.test(segments[0])
          ? 'corporate'
          : null;
    // A root/locale/corporate landing page identifies the site. A product path on an apex or
    // www host does not: apple.com/music and google.com/maps are separate entities that happen
    // to share the organization's registrable domain.
    if (!pathScope || url.search || url.hash) continue;
    evidence.push({
      property_id: 'P856',
      statement_id: statement.id ?? null,
      url: url.href,
      registrable_domain: domain,
      rank: statement.rank ?? 'normal',
      match: 'exact_registrable_domain',
      host_scope: hostScope,
      path_scope: pathScope,
    });
  }
  return evidence;
}

export function safeCommonsUrl(value, expectedHost, pathPrefix = '/') {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      url.hostname.toLowerCase() === expectedHost && url.pathname.startsWith(pathPrefix) ? url.href : null;
  } catch {
    return null;
  }
}

function metadataValue(metadata, key) {
  const value = metadata?.[key]?.value;
  return typeof value === 'string' ? value : null;
}

function licenseMetadata(info) {
  const metadata = info?.extmetadata;
  return {
    license_short_name: metadataValue(metadata, 'LicenseShortName'),
    license_url: metadataValue(metadata, 'LicenseUrl'),
    usage_terms: metadataValue(metadata, 'UsageTerms'),
    attribution_required: metadataValue(metadata, 'AttributionRequired'),
    artist: metadataValue(metadata, 'Artist'),
    credit: metadataValue(metadata, 'Credit'),
    copyrighted: metadataValue(metadata, 'Copyrighted'),
    restrictions: metadataValue(metadata, 'Restrictions'),
    trademark_notice: 'Commons copyright/license metadata does not waive trademark restrictions.',
  };
}

function hasSufficientLicense(metadata) {
  return Boolean(metadata?.license_short_name && (metadata.license_url || metadata.usage_terms));
}

function cached(cache, key, nowMs) {
  const item = cache?.get?.(key);
  if (!item) return null;
  if (item.expiresAt <= nowMs) {
    if (cache === DEFAULT_CACHE) defaultCacheBytes -= item.bytes ?? 0;
    cache.delete?.(key);
    return null;
  }
  return structuredClone(item.value);
}

function storeCache(cache, key, value, nowMs, ttlMs, bytes) {
  if (!cache?.set) return;
  if (cache === DEFAULT_CACHE) {
    defaultCacheBytes -= cache.get(key)?.bytes ?? 0;
    defaultCacheBytes += bytes;
  }
  cache.set(key, { expiresAt: nowMs + ttlMs, value: structuredClone(value), bytes });
  while (cache === DEFAULT_CACHE && defaultCacheBytes > MAX_CACHE_BYTES && cache.size) {
    const oldest = cache.keys().next().value;
    defaultCacheBytes -= cache.get(oldest)?.bytes ?? 0;
    cache.delete(oldest);
  }
}

function apiUrl(base, parameters) {
  const url = new URL(base);
  for (const [key, value] of Object.entries({ action: 'query', format: 'json', formatversion: '2', maxlag: 5, ...parameters })) {
    url.searchParams.set(key, String(value));
  }
  return url.href;
}

function retryDelay(response) {
  const seconds = Number(response?.headers?.get?.('retry-after'));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(1_000, seconds * 1_000) : 250;
}

async function requestJsonUncached(url, options) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = options.deadlineAt - performance.now();
    if (remaining <= 0) throw Object.assign(new Error('Wikimedia fallback timed out.'), { name: 'AbortError' });
    const response = await fetchTimed(url, {
      timeoutMs: Math.max(1, Math.min(options.timeoutMs, remaining)),
      accept: 'application/json',
      diagnostics: options.network,
      fetchImpl: options.fetchImpl,
      validateUrl: options.validateUrl,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const retryable = response.status === 429 || response.status === 503;
      if (retryable && attempt === 0) {
        options.stats.retries += 1;
        await options.delay(retryDelay(response));
        continue;
      }
      const error = new Error(`Wikimedia API returned HTTP ${response.status}.`);
      error.status = response.status;
      error.code = retryable ? 'rate_limited' : 'http_error';
      throw error;
    }
    const { bytes } = await readLimited(response, MAX_JSON_BYTES, { diagnostics: options.network, timeoutMs: Math.max(1, Math.min(options.timeoutMs, remaining)) });
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object') throw new Error('Wikimedia API returned malformed JSON.');
    if (value.error) {
      const retryable = ['maxlag', 'ratelimited'].includes(String(value.error.code));
      if (retryable && attempt === 0) {
        options.stats.retries += 1;
        await options.delay(250);
        continue;
      }
      const error = new Error(`Wikimedia API error: ${value.error.code ?? 'unknown'}.`);
      error.code = retryable ? 'rate_limited' : 'api_error';
      throw error;
    }
    return { value, bytes: bytes.length };
  }
  throw new Error('Wikimedia API retry budget exhausted.');
}

async function requestJson(url, options) {
  const nowMs = options.now().getTime();
  const hit = cached(options.cache, url, nowMs);
  if (hit) { options.stats.cacheHits += 1; return hit; }
  const pendingKey = `${options.cacheScope}\0${url}`;
  let pending = options.pending.get(pendingKey);
  if (!pending) {
    pending = requestJsonUncached(url, options).then(result => {
      storeCache(options.cache, url, result.value, nowMs, options.cacheTtlMs, result.bytes);
      return result.value;
    }).finally(() => options.pending.delete(pendingKey));
    options.pending.set(pendingKey, pending);
  } else options.stats.coalescedRequests += 1;
  return structuredClone(await pending);
}

function searchTerms(domain) {
  const label = getDomainWithoutSuffix(domain, { allowPrivateDomains: true });
  return [...new Set([domain, label].filter(Boolean))].slice(0, 2);
}

function searchIds(payload) {
  return (Array.isArray(payload?.search) ? payload.search : [])
    .map(item => item?.id)
    .filter(id => /^Q\d+$/.test(String(id)));
}

function pagesFromCommons(payload) {
  return Array.isArray(payload?.query?.pages) ? payload.query.pages : [];
}

export async function discoverWikimediaLogoCandidates({ domain, missingRoles }, options = {}) {
  const requestedDomain = registrableDomain(domain);
  const roles = [...new Set((missingRoles ?? []).filter(role => role === 'icon' || role === 'wide'))];
  const stats = { status: 'skipped', requestedDomain, missingRoles: roles, searchTerms: [], candidateEntityIds: [], cacheHits: 0, retries: 0, coalescedRequests: 0 };
  if (!requestedDomain || !roles.length) return { candidates: [], diagnostics: stats };

  const injectedTransport = Boolean(options.fetchImpl || options.validateUrl);
  const timeoutMs = Math.max(250, Math.min(10_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const runtime = {
    fetchImpl: options.fetchImpl ?? fetch,
    validateUrl: options.validateUrl ?? assertPublicUrl,
    timeoutMs,
    deadlineAt: performance.now() + timeoutMs,
    now: options.now ?? (() => new Date()),
    cache: options.cache ?? (injectedTransport ? new Map() : DEFAULT_CACHE),
    pending: options.pending ?? (injectedTransport ? new Map() : DEFAULT_PENDING),
    cacheScope: options.cacheScope ?? (injectedTransport ? 'injected' : 'default'),
    cacheTtlMs: Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
    network: options.diagnostics,
    stats,
    delay: options.delay ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))),
  };

  try {
    stats.status = 'searching';
    stats.searchTerms = searchTerms(requestedDomain);
    const searches = [];
    for (const term of stats.searchTerms) {
      searches.push(await requestJson(apiUrl(WIKIDATA_API, {
        action: 'wbsearchentities', search: term, language: 'en', uselang: 'en', type: 'item', limit: MAX_SEARCH_RESULTS,
      }), runtime));
    }
    const ids = [...new Set(searches.flatMap(searchIds))].slice(0, MAX_ENTITY_CANDIDATES);
    stats.candidateEntityIds = ids;
    if (!ids.length) return { candidates: [], diagnostics: { ...stats, status: 'no_search_candidates' } };

    const entitiesPayload = await requestJson(apiUrl(WIKIDATA_API, {
      action: 'wbgetentities', ids: ids.join('|'), props: 'claims',
    }), runtime);
    const entities = entitiesPayload?.entities;
    if (!entities || typeof entities !== 'object' || Array.isArray(entities)) throw new Error('Wikidata entity response was malformed.');
    const matches = [];
    for (const id of ids) {
      const entity = entities[id];
      const websites = officialWebsiteEvidence(entity, requestedDomain, runtime.now());
      if (!websites.length) continue;
      const logoSelection = selectCurrentLogoClaims(entity?.claims?.P154, runtime.now());
      if (logoSelection.ambiguous) {
        matches.push({ id, websites, ambiguousLogoClaims: true, claims: [] });
      } else if (logoSelection.claims.length) {
        matches.push({ id, websites, ambiguousLogoClaims: false, claims: logoSelection.claims });
      }
    }
    stats.domainMatchedEntityIds = matches.map(match => match.id);
    if (matches.some(match => match.ambiguousLogoClaims)) {
      return { candidates: [], diagnostics: { ...stats, status: 'ambiguous_logo_claims' } };
    }
    const viable = matches.filter(match => match.claims.length);
    if (viable.length !== 1) {
      return { candidates: [], diagnostics: { ...stats, status: viable.length ? 'ambiguous_entities' : 'no_verified_current_logo' } };
    }

    const chosen = viable[0];
    const titles = chosen.claims.map(claim => `File:${claim.filename}`).join('|');
    const commons = await requestJson(apiUrl(COMMONS_API, {
      prop: 'imageinfo', titles, redirects: 1, iiprop: 'url|mime|size|timestamp|extmetadata', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|UsageTerms|AttributionRequired|Artist|Credit|Copyrighted|Restrictions',
    }), runtime);
    const normalizeTitle = value => String(value ?? '').replace(/^File:/i, '').replace(/_/g, ' ').trim().toLowerCase();
    const redirects = new Map((commons?.query?.redirects ?? []).map(item => [normalizeTitle(item?.from), normalizeTitle(item?.to)]));
    const byNormalizedTitle = new Map(pagesFromCommons(commons).map(page => [normalizeTitle(page?.title), page]));
    const retrievedAt = runtime.now().toISOString();
    const candidates = [];
    for (const claim of chosen.claims) {
      const key = normalizeTitle(claim.filename);
      const canonicalKey = redirects.get(key) ?? key;
      const page = byNormalizedTitle.get(canonicalKey);
      const info = page?.imageinfo?.[0];
      const assetUrl = safeCommonsUrl(info?.url, 'upload.wikimedia.org', '/wikipedia/commons/');
      const descriptionUrl = safeCommonsUrl(info?.descriptionurl, 'commons.wikimedia.org', '/wiki/File:');
      const license = licenseMetadata(info);
      if (!assetUrl || !descriptionUrl || !hasSufficientLicense(license)) continue;
      const ratio = Number(info?.width) / Number(info?.height);
      const eligibleRoles = roles.filter(role => role !== 'icon' || !Number.isFinite(ratio) || (ratio >= 0.72 && ratio <= 1.4));
      if (!eligibleRoles.length) continue;
      candidates.push({
        url: assetUrl,
        source: 'wikimedia-commons',
        source_page: descriptionUrl,
        sizes: info.width && info.height ? `${info.width}x${info.height}` : '',
        type: info.mime ?? '',
        declared: { width: info.width ?? null, height: info.height ?? null },
        evidence: {
          element: 'wikidata-logo-claim', positive_token: true, eligible_roles: eligibleRoles,
          identity_basis: 'wikidata_p856_exact_registrable_domain', wikidata_identity_verified: true, wikidata_entity_id: chosen.id,
          wikidata_property_id: 'P154', wikidata_statement_ids: claim.statements,
          wikidata_claim_rank: claim.rank, official_website_evidence: chosen.websites,
          commons_filename: claim.filename, commons_canonical_filename: page?.title?.replace(/^File:/i, '') ?? claim.filename, commons_description_url: descriptionUrl,
          semantic_text: claim.filename,
        },
        provenance: {
          provider: 'wikidata-wikimedia-commons', wikidata_entity_id: chosen.id,
          wikidata_statement_ids: claim.statements, official_website_evidence: chosen.websites,
          commons_filename: claim.filename, commons_canonical_filename: page?.title?.replace(/^File:/i, '') ?? claim.filename,
          commons_redirect: redirects.has(key) ? { from: claim.filename, to: page?.title?.replace(/^File:/i, '') ?? null } : null,
          commons_page_id: page?.pageid ?? null, commons_description_url: descriptionUrl,
          retrieved_asset_url: assetUrl, commons_timestamp: info.timestamp ?? null,
          commons_api_retrieved_at: retrievedAt, license,
        },
      });
    }
    return { candidates, diagnostics: { ...stats, status: candidates.length ? 'ok' : 'unsafe_or_missing_commons_file', entityId: chosen.id, files: candidates.length } };
  } catch (error) {
    return {
      candidates: [],
      diagnostics: { ...stats, status: error?.name === 'AbortError' ? 'timeout' : error?.code === 'rate_limited' ? 'rate_limited' : 'error', error: String(error?.message ?? error) },
    };
  }
}

export const internals = { apiUrl, officialWebsiteEvidence, safeCommonsUrl, searchTerms, searchIds, licenseMetadata };
