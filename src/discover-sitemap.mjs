import { gunzipSync } from 'node:zlib';
import { DomUtils, parseDocument } from 'htmlparser2';
import { getDomain } from 'tldts';
import { parseHomepage, resolveHttpUrl } from './discover-static.mjs';
import { assertPublicUrl } from './http-client.mjs';

export const DEFAULT_SITEMAP_LIMITS = Object.freeze({
  maxRobotsBytes: 128 * 1024,
  maxSitemapDocuments: 3,
  maxSitemapCompressedBytes: 256 * 1024,
  maxSitemapUncompressedBytes: 1024 * 1024,
  maxUrlsConsidered: 5_000,
  maxPages: 1,
  maxPageBytes: 1024 * 1024,
  maxCandidates: 4,
  maxRequests: 16,
  maxTotalBytes: 8 * 1024 * 1024,
  maxDurationMs: 20_000,
  maxRedirects: 3,
  timeoutMs: 4_000,
});

const STRONG_PAGE = /(?:^|[-_/])(?:brand(?:ing)?[-_/](?:asset|center|guideline|resource|toolkit)|press[-_/]kit|media[-_/]kit|logo[-_/](?:asset|download|file|kit)|visual[-_/]identity)(?:s)?(?:$|[-_/])/i;
const NEWSROOM_INFORMATION = /(?:^|[-_/])(?:newsroom|press|media)(?:[-_/](?:information|resource|asset|download|about|contact))(?:$|[-_/])/i;
const NEGATIVE_SITEMAP = /(?:^|[-_/])(?:image|video|product|category|tag|author|event|job)(?:s)?(?:[-_.]|$)/i;
const POSITIVE_SITEMAP = /(?:^|[-_/])(?:page|newsroom|press|media|brand|corporate)(?:s)?(?:[-_.]|$)/i;
const AUTHORITATIVE_SOURCES = new Set(['schema', 'og-logo', 'microdata']);
const EXCLUDED_SOURCES = new Set(['social-banner', 'html-icon', 'apple', 'mask-icon', 'ms-tile']);

function localName(node) {
  return String(node?.name ?? '').toLowerCase().split(':').at(-1);
}

function elementChildren(node) {
  return (node?.children ?? []).filter(DomUtils.isTag);
}

function directText(node, name) {
  const child = elementChildren(node).find(item => localName(item) === name);
  return child ? DomUtils.textContent(child).trim() : '';
}

function registrableDomain(value) {
  try {
    return getDomain(new URL(value).hostname, { allowPrivateDomains: true }) ?? null;
  } catch {
    return null;
  }
}

export function sameRegistrableDomain(value, reference) {
  const expected = String(reference).includes('://') ? registrableDomain(reference) : reference;
  return Boolean(expected && registrableDomain(value) === expected);
}

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function safeDecodePathname(value) {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

export function parseRobotsSitemaps(text, robotsUrl, { maxSitemaps = 8 } = {}) {
  const found = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S.*?)\s*(?:#.*)?$/i.exec(line);
    const url = match && resolveHttpUrl(match[1], robotsUrl);
    if (url && !found.includes(url)) found.push(url);
    if (found.length >= maxSitemaps) break;
  }
  return found;
}

export function decodeSitemap(bytes, headers = new Headers(), limits = DEFAULT_SITEMAP_LIMITS) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes ?? '');
  const gzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (gzip && bytes.length > limits.maxSitemapCompressedBytes) throw new Error('Compressed sitemap exceeds its byte limit.');
  let output;
  try {
    output = gzip ? gunzipSync(bytes, { maxOutputLength: limits.maxSitemapUncompressedBytes }) : bytes;
  } catch (error) {
    throw new Error(`Invalid or oversized gzip sitemap: ${error.message}`);
  }
  if (output.length > limits.maxSitemapUncompressedBytes) throw new Error('Sitemap exceeds its uncompressed byte limit.');
  const text = output.toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (!text || /^(?:<!doctype\s+html|<html\b)/i.test(text)) throw new Error('Sitemap response is HTML, not XML.');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DTD and entity declarations are not supported in sitemaps.');
  return {
    text,
    compressedBytes: gzip ? bytes.length : 0,
    uncompressedBytes: output.length,
    transportEncoding: headers.get?.('content-encoding') ?? null,
  };
}

export function parseSitemapXml(text, baseUrl) {
  const rootMatch = String(text).match(/^\s*(?:<\?xml\b[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<((?:[a-z_][\w.-]*:)?)(urlset|sitemapindex)\b/i);
  if (!rootMatch) throw new Error('Sitemap root must be urlset or sitemapindex.');
  const qualifiedRoot = `${rootMatch[1]}${rootMatch[2]}`;
  const escapedRoot = qualifiedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`</${escapedRoot}\\s*>\\s*(?:<!--[\\s\\S]*?-->\\s*)*$`, 'i').test(text)) {
    throw new Error('Malformed or truncated sitemap XML.');
  }
  const paired = rootMatch[2].toLowerCase() === 'urlset' ? ['url', 'loc'] : ['sitemap', 'loc'];
  for (const name of paired) {
    const open = [...String(text).matchAll(new RegExp(`<\\s*(?:[a-z_][\\w.-]*:)?${name}\\b[^>]*>`, 'gi'))]
      .filter(match => !/\/\s*>$/.test(match[0])).length;
    const close = [...String(text).matchAll(new RegExp(`<\\s*\/\\s*(?:[a-z_][\\w.-]*:)?${name}\\s*>`, 'gi'))].length;
    if (open !== close) throw new Error('Malformed or truncated sitemap XML.');
  }
  let document;
  try {
    document = parseDocument(text, { xmlMode: true, decodeEntities: true });
  } catch (error) {
    throw new Error(`Malformed sitemap XML: ${error.message}`);
  }
  const roots = (document.children ?? []).filter(DomUtils.isTag);
  if (roots.length !== 1 || !['urlset', 'sitemapindex'].includes(localName(roots[0]))) {
    throw new Error('Sitemap root must be urlset or sitemapindex.');
  }
  const type = localName(roots[0]);
  const itemName = type === 'urlset' ? 'url' : 'sitemap';
  const entries = [];
  for (const node of elementChildren(roots[0])) {
    if (localName(node) !== itemName) continue;
    const url = resolveHttpUrl(directText(node, 'loc'), baseUrl);
    if (!url) continue;
    entries.push({ url, lastmod: directText(node, 'lastmod') || null });
  }
  return { type, entries };
}

export function scoreSitemapPageUrl(value, { lastmod = null, now = new Date(), maxAgeDays = null } = {}) {
  let url;
  try { url = new URL(value); } catch { return { score: -Infinity, reasons: ['invalid-url'], lastModified: null, stale: false }; }
  const path = safeDecodePathname(url.pathname).toLowerCase().replace(/\.[a-z0-9]{1,8}$/i, '');
  const segments = path.split('/').filter(Boolean);
  const reasons = [];
  let score = 0;
  const focusedSegment = segments.some(item => ['brand', 'branding', 'logo', 'logos'].includes(item));
  const shallowStyleGuide = segments.length <= 4 && segments.some(item => /^(?:brand[-_])?style[-_]guide$/.test(item));
  if (STRONG_PAGE.test(path) || focusedSegment || shallowStyleGuide) {
    score += 100; reasons.push('strong-brand-page');
    if (segments.length > 3 && !focusedSegment) { score -= 30; reasons.push('deep-strong-page'); }
  }
  else if (NEWSROOM_INFORMATION.test(path)) { score += 80; reasons.push('newsroom-information'); }
  else {
    const weak = segments.find(item => /^(?:newsroom|press|media|company|about|corporate)$/.test(item));
    if (weak) {
      const token = weak;
      score += ['newsroom', 'press', 'media'].includes(token) ? 55 : 25;
      reasons.push(`weak-${token}`);
      const position = segments.indexOf(token);
      if (['newsroom', 'press', 'media'].includes(token) && (position > 1 || segments.length - position - 1 > 0)) {
        score -= 40; reasons.push('deep-news-article');
      } else if (['newsroom', 'press', 'media'].includes(token)) {
        score += 25; reasons.push('focused-news-landing');
      }
    }
  }
  if (segments.some(item => /^(?:article|author|blog|careers?|jobs?|events?|legal|privacy|products?|customers?|partners?|support|store|shop|docs?|documentation|developers?|api)$/.test(item)) &&
      !(STRONG_PAGE.test(path) || focusedSegment || shallowStyleGuide)) {
    score -= 45; reasons.push('negative-page-class');
  }
  if (/\/(?:19|20)\d{2}\/(?:0?[1-9]|1[0-2])(?:\/|$)/.test(path) && !STRONG_PAGE.test(path)) {
    score -= 30; reasons.push('dated-article-path');
  }
  if (url.search) { score -= 5; reasons.push('query-string'); }
  const lastModified = safeDate(lastmod);
  const ageDays = lastModified ? Math.max(0, (now.getTime() - lastModified.getTime()) / 86_400_000) : null;
  const stale = Number.isFinite(maxAgeDays) && ageDays !== null && ageDays > maxAgeDays;
  if (lastModified && ageDays <= 730) { score += 5; reasons.push('recent-lastmod'); }
  if (stale) { score -= 20; reasons.push('stale-lastmod'); }
  return { score, reasons, lastModified: lastModified?.toISOString() ?? null, stale };
}

function sitemapDocumentPriority(value) {
  let path = '';
  try { path = safeDecodePathname(new URL(value).pathname).toLowerCase(); } catch { return -Infinity; }
  return (POSITIVE_SITEMAP.test(path) ? 50 : 0) - (NEGATIVE_SITEMAP.test(path) ? 80 : 0) - (/\.gz$/i.test(path) ? 1 : 0);
}

function candidatePriority(item) {
  const proof = item.evidence ?? {};
  return (AUTHORITATIVE_SOURCES.has(item.source) ? 100 : 0) + (proof.home_linked ? 80 : 0) +
    (['header', 'nav'].includes(proof.dom_region) ? 60 : 0) + (proof.positive_token ? 40 : 0);
}

function uniqueCandidatesByPriority(items, limit) {
  if (limit <= 0) return [];
  const seen = new Set();
  const output = [];
  for (const item of items.sort((a, b) => candidatePriority(b) - candidatePriority(a) || a.url.localeCompare(b.url))) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    output.push(item);
    if (output.length >= limit) break;
  }
  return output;
}

function companyIdentityAgreement(value, companyName) {
  const companyWords = String(companyName ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const meaningful = companyWords.filter(word => !['and', 'inc', 'llc', 'ltd', 'corp', 'corporation', 'company', 'co', 'group', 'holdings'].includes(word));
  const haystack = String(value ?? '').replace(/https?:\/\/[^\s"'<>]+/gi, match => {
    try { return new URL(match).pathname; } catch { return ''; }
  }).toLowerCase();
  const haystackWords = new Set(haystack.match(/[a-z0-9]+/g) ?? []);
  if (meaningful.length && meaningful.every(word => haystackWords.has(word))) return true;
  const acronym = meaningful.map(word => word[0]).join('');
  const distinctiveAcronym = acronym.length >= 3 || acronym.length === 2 && /&/.test(String(companyName ?? ''));
  return distinctiveAcronym && new RegExp(`(?:^|[^a-z0-9])${acronym}(?:[^a-z0-9]|logo|wordmark|lockup)`, 'i').test(haystack);
}

function exactCompanyLogoEvidence(item, companyName) {
  const proof = item.evidence ?? {};
  let pathname = '';
  if (!String(item.url).startsWith('data:')) {
    try { pathname = new URL(item.url).pathname; } catch { pathname = ''; }
  }
  const semantic = `${pathname} ${proof.alt ?? ''} ${proof.aria_label ?? ''} ${proof.semantic_text ?? ''}`;
  return /logo|wordmark|lockup/i.test(semantic) && companyIdentityAgreement(semantic, companyName);
}

function exactCompanyLogoLabelEvidence(item, companyName) {
  const proof = item.evidence ?? {};
  const label = `${proof.alt ?? ''} ${proof.aria_label ?? ''}`.trim();
  return /logo|wordmark|lockup/i.test(label) && companyIdentityAgreement(label, companyName);
}

function eligiblePageCandidates(parsed, page, sitemapEntry, expectedDomain, { assetHostPolicy, companyName, maxCandidates }) {
  const output = [];
  for (const item of parsed.candidates) {
    const proof = item.evidence ?? {};
    const exactIdentity = exactCompanyLogoEvidence(item, companyName);
    const exactLabelIdentity = exactCompanyLogoLabelEvidence(item, companyName);
    if (EXCLUDED_SOURCES.has(item.source) || proof.negative_context || proof.banner) continue;
    if (sitemapEntry.score < 55 && !exactIdentity) continue;
    if (!(AUTHORITATIVE_SOURCES.has(item.source) || proof.home_linked || proof.positive_token && ['header', 'nav'].includes(proof.dom_region) ||
      proof.positive_token && exactIdentity)) continue;
    const crossDomain = !String(item.url).startsWith('data:') && !sameRegistrableDomain(item.url, expectedDomain);
    if (crossDomain && (assetHostPolicy === 'same-registrable' || !exactLabelIdentity)) continue;
    output.push({
      ...item,
      source_page: page,
      evidence: {
        ...proof,
        eligible_roles: ['wide'],
        sitemap_official_page: true,
        sitemap_page_url: page,
        sitemap_page_score: sitemapEntry.score,
        ...(sitemapEntry.score < 55 ? { sitemap_low_intent_identity_gate: true } : {}),
        sitemap_source_document: sitemapEntry.sitemapDocument,
        sitemap_asset_host_policy: assetHostPolicy,
        ...(crossDomain ? { sitemap_cross_domain_asset: true } : {}),
        ...((crossDomain ? exactLabelIdentity : exactIdentity) ? { sitemap_exact_identity: true } : {}),
      },
      provenance_chain: [
        { kind: 'homepage', url: sitemapEntry.homepage },
        { kind: 'sitemap', url: sitemapEntry.sitemapDocument },
        { kind: 'sitemap-official-page', url: page, score: sitemapEntry.score },
        { kind: 'page-asset', url: item.url },
      ],
    });
  }
  return uniqueCandidatesByPriority(output, maxCandidates);
}

function mergeLimits(options) {
  const limits = { ...DEFAULT_SITEMAP_LIMITS, ...(options.limits ?? {}) };
  for (const key of Object.keys(DEFAULT_SITEMAP_LIMITS)) {
    if (!Number.isInteger(limits[key]) || limits[key] < 0) throw new Error(`Invalid sitemap limit: ${key}.`);
  }
  if (limits.maxRedirects > 5) throw new Error('Invalid sitemap limit: maxRedirects.');
  return limits;
}

export async function discoverSitemapBrandAssets({ homepage, companyName = '', fetchResource, validateUrl }, options = {}) {
  const startedAt = performance.now();
  const limits = mergeLimits(options);
  const seedMode = options.seedMode ?? 'robots-and-conventional';
  if (!['robots-only', 'conventional-only', 'robots-and-conventional'].includes(seedMode)) throw new Error('Invalid sitemap seed mode.');
  const assetHostPolicy = options.assetHostPolicy ?? 'same-registrable';
  if (!['same-registrable', 'official-page'].includes(assetHostPolicy)) throw new Error('Invalid sitemap asset-host policy.');
  const expectedDomain = registrableDomain(homepage);
  if (!expectedDomain) throw new Error('Homepage has no registrable domain.');
  const origin = new URL(homepage).origin;
  const validatePublicUrl = validateUrl ?? assertPublicUrl;
  const validateOfficialUrl = async value => {
    const validated = await validatePublicUrl(value);
    const checked = validated instanceof URL ? validated : new URL(value);
    if (!sameRegistrableDomain(checked.href, expectedDomain)) throw new Error('Sitemap request left the official registrable domain.');
    return checked;
  };
  const diagnostics = {
    status: 'no_sitemap', seedMode, assetHostPolicy, expectedDomain,
    requests: 0, bytesDownloaded: 0, networkDurationMs: 0,
    robots: { attempted: false, declared: 0, accepted: 0, error: null },
    sitemapDocumentsAttempted: 0, sitemapDocumentsParsed: 0,
    sitemapCompressedBytes: 0, sitemapUncompressedBytes: 0,
    urlsConsidered: 0, urlsEligible: 0, urlLimitHit: false,
    pagesAttempted: 0, pagesFetched: 0, candidatesDiscovered: 0,
    documents: [], pages: [], errors: [],
    limits,
  };
  const request = async (url, requestOptions) => {
    if (performance.now() - startedAt >= limits.maxDurationMs) throw new Error('Sitemap discovery wall-clock budget exceeded.');
    const remainingRequests = limits.maxRequests - diagnostics.requests;
    if (remainingRequests <= 0) throw new Error('Sitemap discovery request budget exceeded.');
    const remainingBytes = limits.maxTotalBytes - diagnostics.bytesDownloaded;
    if (remainingBytes <= 0) throw new Error('Sitemap discovery total byte budget exceeded.');
    const remainingTime = Math.max(1, limits.maxDurationMs - Math.round(performance.now() - startedAt));
    await validateOfficialUrl(url);
    try {
      const response = await fetchResource(url, {
        ...requestOptions,
        maxBytes: Math.min(requestOptions.maxBytes ?? remainingBytes, remainingBytes),
        timeoutMs: Math.min(limits.timeoutMs, remainingTime),
        maxRedirects: Math.min(limits.maxRedirects, remainingRequests - 1),
        validateUrl: validateOfficialUrl,
      });
      diagnostics.requests += response.requestCount ?? 1;
      diagnostics.bytesDownloaded += response.downloadedBytes ?? response.bytes?.length ?? 0;
      diagnostics.networkDurationMs += response.durationMs ?? 0;
      return response;
    } catch (error) {
      const metrics = error.resourceMetrics;
      diagnostics.requests += metrics?.requestCount ?? 0;
      diagnostics.bytesDownloaded += metrics?.downloadedBytes ?? 0;
      diagnostics.networkDurationMs += metrics?.durationMs ?? 0;
      throw error;
    }
  };

  const seeds = [];
  const seedUrls = new Set();
  const addSeed = (url, kind) => {
    if (!seedUrls.has(url)) { seedUrls.add(url); seeds.push({ url, kind }); }
  };
  if (seedMode !== 'conventional-only') {
    diagnostics.robots.attempted = true;
    const robotsUrl = new URL('/robots.txt', origin).href;
    try {
      const response = await request(robotsUrl, { maxBytes: limits.maxRobotsBytes, accept: 'text/plain,*/*;q=0.2' });
      if (response.ok && sameRegistrableDomain(response.url, expectedDomain)) {
        const text = response.bytes.toString('utf8');
        if (/^(?:\s*<!doctype\s+html|\s*<html\b)/i.test(text)) throw new Error('robots.txt returned HTML.');
        const declared = parseRobotsSitemaps(text, response.url);
        diagnostics.robots.declared = declared.length;
        for (const url of declared) if (sameRegistrableDomain(url, expectedDomain)) addSeed(url, 'robots');
        diagnostics.robots.accepted = seeds.filter(item => item.kind === 'robots').length;
      }
    } catch (error) {
      diagnostics.robots.error = error.message;
      diagnostics.errors.push({ stage: 'robots', url: robotsUrl, error: error.message });
    }
  }
  if (seedMode !== 'robots-only') {
    for (const path of ['/sitemap.xml', '/sitemap_index.xml']) {
      const url = new URL(path, origin).href;
      addSeed(url, 'conventional');
    }
  }

  const queued = [...seeds];
  const visited = new Set();
  const pageMap = new Map();
  const seedPriority = { robots: 2, index: 1, conventional: 0 };
  while (queued.length && diagnostics.sitemapDocumentsAttempted < limits.maxSitemapDocuments && diagnostics.urlsConsidered < limits.maxUrlsConsidered) {
    queued.sort((a, b) => seedPriority[b.kind] - seedPriority[a.kind] ||
      sitemapDocumentPriority(b.url) - sitemapDocumentPriority(a.url) || a.url.localeCompare(b.url));
    const current = queued.shift();
    if (visited.has(current.url)) continue;
    visited.add(current.url);
    if (!sameRegistrableDomain(current.url, expectedDomain)) continue;
    diagnostics.sitemapDocumentsAttempted += 1;
    try {
      const response = await request(current.url, {
        maxBytes: /\.gz(?:$|[?#])/i.test(current.url) ? limits.maxSitemapCompressedBytes : limits.maxSitemapUncompressedBytes,
        accept: 'application/xml,text/xml,application/gzip,*/*;q=0.2',
        headers: { 'accept-encoding': 'identity' },
      });
      if (!response.ok || !sameRegistrableDomain(response.url, expectedDomain)) throw new Error(`Sitemap returned HTTP ${response.status}.`);
      visited.add(response.url);
      const decoded = decodeSitemap(response.bytes, response.headers, limits);
      const parsed = parseSitemapXml(decoded.text, response.url);
      diagnostics.sitemapDocumentsParsed += 1;
      diagnostics.sitemapCompressedBytes += decoded.compressedBytes;
      diagnostics.sitemapUncompressedBytes += decoded.uncompressedBytes;
      diagnostics.documents.push({ url: current.url, finalUrl: response.url, type: parsed.type, entries: parsed.entries.length, compressedBytes: decoded.compressedBytes, uncompressedBytes: decoded.uncompressedBytes });
      for (const entry of parsed.entries) {
        if (diagnostics.urlsConsidered >= limits.maxUrlsConsidered) { diagnostics.urlLimitHit = true; break; }
        diagnostics.urlsConsidered += 1;
        if (!sameRegistrableDomain(entry.url, expectedDomain)) continue;
        if (parsed.type === 'sitemapindex') {
          if (!visited.has(entry.url) && !queued.some(item => item.url === entry.url)) queued.push({ url: entry.url, kind: 'index' });
          continue;
        }
        const scored = scoreSitemapPageUrl(entry.url, { lastmod: entry.lastmod, now: options.now ?? new Date(), maxAgeDays: options.maxAgeDays ?? null });
        if (scored.score < (options.minPageScore ?? 55) || options.rejectStale === true && scored.stale) continue;
        const prior = pageMap.get(entry.url);
        const candidate = { ...entry, ...scored, sitemapDocument: response.url, homepage };
        if (!prior || candidate.score > prior.score) pageMap.set(entry.url, candidate);
      }
    } catch (error) {
      diagnostics.documents.push({ url: current.url, error: error.message });
      diagnostics.errors.push({ stage: 'sitemap', url: current.url, error: error.message });
    }
  }
  if (diagnostics.urlsConsidered >= limits.maxUrlsConsidered && queued.length) diagnostics.urlLimitHit = true;

  const rankedPages = [...pageMap.values()].sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  diagnostics.urlsEligible = rankedPages.length;
  const candidates = [];
  for (const entry of rankedPages.slice(0, limits.maxPages)) {
    diagnostics.pagesAttempted += 1;
    try {
      const response = await request(entry.url, {
        maxBytes: limits.maxPageBytes,
        accept: 'text/html,application/xhtml+xml',
      });
      if (!response.ok || !sameRegistrableDomain(response.url, expectedDomain)) throw new Error(`Official page returned HTTP ${response.status}.`);
      const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
      const prefix = response.bytes.subarray(0, 512).toString('utf8').trimStart();
      if (!/html|xhtml/.test(contentType) && !/^(?:<!doctype\s+html|<html\b)/i.test(prefix)) throw new Error('Official page did not return HTML.');
      const parsed = parseHomepage(response.bytes.toString('utf8'), response.url, { companyName });
      const additions = eligiblePageCandidates(parsed, response.url, entry, expectedDomain, { assetHostPolicy, companyName, maxCandidates: limits.maxCandidates });
      candidates.push(...additions);
      diagnostics.pagesFetched += 1;
      diagnostics.pages.push({
        url: entry.url,
        finalUrl: response.url,
        score: entry.score,
        reasons: entry.reasons,
        candidates: additions.length,
      });
    } catch (error) {
      diagnostics.pages.push({ url: entry.url, score: entry.score, error: error.message });
      diagnostics.errors.push({ stage: 'page', url: entry.url, error: error.message });
    }
  }
  const unique = uniqueCandidatesByPriority(candidates, limits.maxCandidates);
  diagnostics.candidatesDiscovered = unique.length;
  diagnostics.status = unique.length ? 'candidates' : diagnostics.sitemapDocumentsParsed ? 'no_candidates' : 'no_sitemap';
  diagnostics.durationMs = Math.round(performance.now() - startedAt);
  return { candidates: unique, diagnostics };
}

export const internals = { candidatePriority, eligiblePageCandidates, exactCompanyLogoEvidence, registrableDomain, sameRegistrableDomain, sitemapDocumentPriority, uniqueCandidatesByPriority };
