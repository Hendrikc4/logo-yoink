import { createHash } from 'node:crypto';
import { resolveTxt as systemResolveTxt } from 'node:dns/promises';
import { domainToASCII } from 'node:url';

const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_CACHE_TTL_MS = 15 * 60_000;
const DEFAULT_CACHE_MAX_ENTRIES = 512;
const MAX_RECORD_CHARS = 4_096;
const assertionCache = new Map();

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedDomain(value) {
  const domain = domainToASCII(String(value ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, ''));
  if (!domain || domain.length > 253 || !domain.includes('.') || domain.split('.').some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) {
    throw new Error('BIMI requires a valid public domain name.');
  }
  return domain;
}

export function bimiQueryDomains(domain, { organizationalDomain } = {}) {
  const exact = normalizedDomain(domain).replace(/^www\./, '');
  if (!organizationalDomain) return [exact];
  const organization = normalizedDomain(organizationalDomain).replace(/^www\./, '');
  if (exact !== organization && !exact.endsWith(`.${organization}`)) {
    throw new Error('The organizational domain must contain the requested domain.');
  }
  // Do not guess registrable boundaries. Callers may provide a PSL-derived parent explicitly.
  return [...new Set([exact, organization])];
}

function joinTxtChunks(answer) {
  if (Array.isArray(answer)) return answer.map(chunk => String(chunk)).join('');
  return String(answer ?? '');
}

export function parseBimiRecord(rawRecord) {
  const raw = String(rawRecord ?? '');
  if (!raw || raw.length > MAX_RECORD_CHARS) return { ok: false, reason: 'malformed_record' };
  const tags = new Map();
  for (const segment of raw.split(';')) {
    if (!segment.trim()) continue;
    const match = segment.match(/^\s*([a-z][a-z0-9_-]*)\s*=\s*(.*?)\s*$/i);
    if (!match) return { ok: false, reason: 'malformed_record' };
    const key = match[1].toLowerCase();
    if (tags.has(key)) return { ok: false, reason: 'duplicate_tag' };
    tags.set(key, match[2]);
  }
  if (String(tags.get('v') ?? '').toUpperCase() !== 'BIMI1') return { ok: false, reason: 'not_bimi1' };
  if (!tags.has('l')) return { ok: false, reason: 'missing_logo_location' };
  const logoUrl = String(tags.get('l') ?? '').trim();
  if (!logoUrl) return { ok: false, reason: 'empty_logo_location' };
  let logo;
  try { logo = new URL(logoUrl); } catch { return { ok: false, reason: 'invalid_logo_url' }; }
  if (logo.protocol !== 'https:' || logo.username || logo.password || logo.port) return { ok: false, reason: 'unsafe_logo_url' };

  const authorityValue = tags.has('a') ? String(tags.get('a') ?? '').trim() : null;
  let authorityUrl = null;
  let authorityPointer = authorityValue === null ? 'absent' : authorityValue ? 'present_unverified' : 'empty';
  if (authorityValue) {
    try {
      const parsed = new URL(authorityValue);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port) authorityUrl = parsed.href;
      else authorityPointer = 'invalid';
    } catch { authorityPointer = 'invalid'; }
  }
  return {
    ok: true,
    logoUrl: logo.href,
    authorityUrl,
    authorityPointer,
    evidenceDocumentPresent: Boolean(authorityUrl),
    certificateValidation: 'not_performed',
    recordDigest: sha256(raw),
  };
}

function timeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new DOMException('BIMI DNS lookup timed out.', 'AbortError')), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

export async function lookupBimiAssertion(domain, {
  organizationalDomain,
  resolveTxt = systemResolveTxt,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cache = assertionCache,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  now = () => Date.now(),
  cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES,
} = {}) {
  const queryDomains = bimiQueryDomains(domain, { organizationalDomain });
  const attempts = [];
  for (const queryDomain of queryDomains) {
    const selector = 'default';
    const queryName = `${selector}._bimi.${queryDomain}`;
    const cacheKey = queryName.toLowerCase();
    const cached = cache?.get(cacheKey);
    if (cached && cached.expiresAt > now()) {
      attempts.push({ ...cached.value, cached: true });
      if (cached.value.status === 'accepted') return { ...cached.value, cached: true, dnsRequests: 0, attempts };
      continue;
    }
    let outcome;
    try {
      const answers = await timeout(Promise.resolve(resolveTxt(queryName)), Math.max(1, timeoutMs));
      const records = (Array.isArray(answers) ? answers : []).map(joinTxtChunks);
      const bimiRecords = records.filter(record => /^\s*v\s*=\s*BIMI1\b/i.test(record));
      if (bimiRecords.length !== 1) {
        outcome = { status: bimiRecords.length > 1 ? 'ambiguous_records' : 'not_found', queryName, queryDomain, selector, dnsRequests: 1 };
      } else {
        const parsed = parseBimiRecord(bimiRecords[0]);
        outcome = parsed.ok
          ? { status: 'accepted', queryName, queryDomain, selector, dnsRequests: 1, ...parsed }
          : { status: 'invalid_record', reason: parsed.reason, queryName, queryDomain, selector, dnsRequests: 1 };
      }
    } catch (error) {
      const noRecord = ['ENODATA', 'ENOTFOUND', 'NXDOMAIN', 'NOTFOUND'].includes(String(error?.code ?? '').toUpperCase());
      outcome = { status: error?.name === 'AbortError' ? 'timeout' : noRecord ? 'not_found' : 'resolver_error', error: error?.code ?? error?.name ?? 'error', queryName, queryDomain, selector, dnsRequests: 1 };
    }
    if (cache) {
      if (!cache.has(cacheKey) && cache.size >= Math.max(1, cacheMaxEntries)) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, { expiresAt: now() + Math.max(0, cacheTtlMs), value: outcome });
    }
    attempts.push(outcome);
    if (outcome.status === 'accepted') return { ...outcome, attempts };
  }
  const final = attempts.at(-1) ?? { status: 'not_found', dnsRequests: 0 };
  return { ...final, attempts, dnsRequests: attempts.filter(item => !item.cached).reduce((sum, item) => sum + (item.dnsRequests ?? 0), 0) };
}

export function bimiCandidate(assertion, { discoveredAt = new Date().toISOString() } = {}) {
  if (assertion?.status !== 'accepted') return null;
  return {
    url: assertion.logoUrl,
    source: 'bimi',
    source_page: null,
    sizes: 'any',
    type: 'image/svg+xml',
    purpose: 'any',
    declared: {},
    evidence: {
      element: 'bimi-assertion',
      eligible_roles: ['icon', 'favicon'],
      domain_controlled_assertion: true,
      certificate_verified: false,
    },
    provenance: {
      discovered_at: discoveredAt,
      bimi_selector: assertion.selector,
      bimi_query_domain: assertion.queryDomain,
      bimi_query_name: assertion.queryName,
      bimi_record_sha256: assertion.recordDigest,
      bimi_logo_url: assertion.logoUrl,
      bimi_evidence_document_url: assertion.authorityUrl,
      bimi_evidence_document_present: assertion.evidenceDocumentPresent,
      bimi_authority_pointer: assertion.authorityPointer,
      bimi_certificate_validation: assertion.certificateValidation,
      trademark_or_license_verified: false,
    },
  };
}

export function isSafeBimiSvg(bytes) {
  const markup = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes ?? '');
  if (!/^\s*(?:<\?xml\b[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(markup)) return false;
  if (/<(?:script|foreignObject|iframe|object|embed|audio|video)\b|\bon[a-z]+\s*=|<!DOCTYPE|<!ENTITY|@import\b/i.test(markup)) return false;
  if (/<(?:animate|animateMotion|animateTransform|set)\b/i.test(markup)) return false;
  for (const match of markup.matchAll(/(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi)) {
    if (!String(match[2]).trim().startsWith('#')) return false;
  }
  for (const match of markup.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    if (!String(match[2]).trim().startsWith('#')) return false;
  }
  return true;
}

export const internals = { joinTxtChunks, normalizedDomain, assertionCache };
