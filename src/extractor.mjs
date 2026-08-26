import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { parseHomepage, resolveHttpUrl } from './discover-static.mjs';
import { discoverBrowserLogos } from './discover-browser.mjs';
import { normalizeStandaloneSvg } from './standalone-svg.mjs';
import { discoverOfficialBrandAssets, discoverSpaBundleAssets } from './discover-deep.mjs';
import { hasWideEvidence, rankCandidates, scoreCandidate, SOURCE_WEIGHT } from './rank.mjs';
import { measureTinyImageSuitability } from './tiny-image-suitability.mjs';
import { mapConcurrent } from './concurrency.mjs';
import { isPrivateIp } from './network-safety.mjs';
import { assertPublicUrl, fetchTimed, readLimited } from './http-client.mjs';
import { matchesAssetPreferences, matchesLogoPreferences, normalizeAssetPreferences } from './asset-model.mjs';
import { discoverWikimediaLogoCandidates, safeCommonsUrl } from './wikimedia-fallback.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const HOMEPAGE_FALLBACK_TIMEOUT_MS = 3_000;
const BLOCKED_HTTP_STATUSES = new Set([401, 403, 407, 418, 429, 444]);
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_CANDIDATES_TO_DOWNLOAD = 16;
const ROLE_QUEUE_CAPS = { icon: 6, wide: 8, favicon: 4 };
const FAVICON_SOURCES = new Set(['manifest', 'apple', 'mask-icon', 'ms-tile', 'html-icon', 'besticon', 'root-favicon', 'google-favicon', 'duckduckgo-favicon']);
const STRUCTURED_LOGO_SOURCES = new Set(['schema', 'og-logo', 'microdata']);
const DOM_IMAGE_SOURCES = new Set(['dom-img', 'dom-picture', 'noscript-img']);
const CONTENT_BOX_MAX_SAMPLES = 96;
const CONTENT_BOX_MIN_EDGE_PX = 24;
const JINA_READER_BASE_URL = 'https://r.jina.ai/';
const JINA_BRAND_CAPTURE_SCRIPT = String.raw`(() => {
  const selectors = [
    'header [class*="logo" i]', 'nav [class*="logo" i]',
    'header [id*="logo" i]', 'nav [id*="logo" i]',
    'header img[alt*="logo" i]', 'nav img[alt*="logo" i]',
    'header a[aria-label*="home" i]', 'nav a[aria-label*="home" i]',
    'header a[href="/"]', 'nav a[href="/"]',
  ];
  const candidates = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))]
    .map(element => {
      const rect = element.getBoundingClientRect();
      const semantic = [element.id, element.className, element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('alt')]
        .filter(Boolean).join(' ').slice(0, 500);
      const graphic = /^(IMG|SVG|PICTURE)$/.test(element.tagName) || Boolean(element.querySelector('img,svg,picture'));
      const explicitlyLogoMarked = /logo|wordmark|logomark/i.test(semantic);
      let score = 0;
      if (explicitlyLogoMarked) score += 100;
      if (/home/i.test(semantic)) score += 70;
      if (element.getAttribute('href') === '/') score += 55;
      if (graphic) score += 25;
      if (element.closest('header,nav')) score += 20;
      if (rect.width > 4 && rect.height > 4) score += 20;
      if (rect.width > innerWidth * .8 || rect.height > innerHeight * .4) score -= 80;
      if ((element.textContent || '').trim().length > 80) score -= 60;
      return { element, rect, score, graphic, explicitlyLogoMarked };
    })
    .filter(item => item.rect.width > 4 && item.rect.height > 4 && (item.graphic || item.explicitlyLogoMarked))
    .sort((a, b) => b.score - a.score || a.rect.width * a.rect.height - b.rect.width * b.rect.height);
  const chosen = candidates[0];
  if (!chosen || chosen.score < 40) return;
  const target = chosen.element;
  let ancestor = target;
  let background = 'rgb(255, 255, 255)';
  while (ancestor) {
    const color = getComputedStyle(ancestor).backgroundColor;
    if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') { background = color; break; }
    ancestor = ancestor.parentElement;
  }
  target.id = 'logo-yoink-jina-brand';
  for (const element of [target, ...target.querySelectorAll('*')]) {
    const classes = typeof element.className === 'string' ? element.className : '';
    element.style.setProperty('text-decoration', 'none', 'important');
    element.style.setProperty('animation', 'none', 'important');
    element.style.setProperty('transition', 'none', 'important');
    const font = classes.match(/font-\[['"]([^'"]+)/)?.[1];
    const weight = classes.match(/font-\[(\d{3})\]/)?.[1];
    const color = classes.match(/text-\[#([0-9a-f]{3,8})\]/i)?.[1];
    const gradientFrom = classes.match(/from-\[#([0-9a-f]{3,8})\]/i)?.[1];
    const gradientTo = classes.match(/to-\[#([0-9a-f]{3,8})\]/i)?.[1];
    if (font) element.style.setProperty('font-family', "'" + font + "', sans-serif", 'important');
    if (weight) element.style.setProperty('font-weight', weight, 'important');
    if (color) element.style.setProperty('color', '#' + color, 'important');
    if (gradientFrom && gradientTo) {
      element.style.setProperty('background-image', 'linear-gradient(to right, #' + gradientFrom + ', #' + gradientTo + ')', 'important');
      element.style.setProperty('background-clip', 'text', 'important');
      element.style.setProperty('-webkit-background-clip', 'text', 'important');
      element.style.setProperty('color', 'transparent', 'important');
    }
  }
  document.body.replaceChildren(target);
  document.documentElement.style.cssText = 'width:768px!important;height:384px!important;overflow:hidden!important';
  document.body.style.cssText = 'margin:0!important;width:768px!important;height:384px!important;display:flex!important;align-items:center!important;justify-content:center!important;overflow:hidden!important';
  document.documentElement.style.background = background;
  document.body.style.background = background;
  const rect = target.getBoundingClientRect();
  const scale = Math.max(1, Math.min(4, 620 / Math.max(rect.width, 1), 260 / Math.max(rect.height, 1)));
  target.style.setProperty('position', 'static', 'important');
  target.style.setProperty('margin', '0', 'important');
  target.style.setProperty('transform', 'scale(' + scale + ')', 'important');
  target.style.setProperty('transform-origin', 'center', 'important');
  const marker = document.createElement('i');
  marker.id = 'logo-yoink-jina-marker';
  marker.style.cssText = 'position:fixed!important;left:0!important;top:0!important;width:4px!important;height:4px!important;background:rgb(1,254,2)!important;z-index:2147483647!important';
  document.body.append(marker);
})()`;

export function normalizeWebsite(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Enter a company website.');
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) throw new Error('Only HTTP and HTTPS websites are supported.');
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS websites are supported.');
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || isPrivateIp(hostname)) throw new Error('Local and private-network addresses are not supported.');
  return { url, domain: hostname.replace(/^www\./, '') };
}

function homepageAttemptPlan(normalized, timeoutMs) {
  const fallbackTimeoutMs = Math.min(timeoutMs, HOMEPAGE_FALLBACK_TIMEOUT_MS);
  const alternateHostname = normalized.url.hostname.toLowerCase() === normalized.domain
    ? `www.${normalized.domain}`
    : normalized.domain;
  const raw = [
    { url: normalized.url.href, stage: 'primary', timeoutMs },
    { url: `https://${alternateHostname}/`, stage: 'alternate_https_host', timeoutMs: fallbackTimeoutMs },
    { url: `http://${normalized.domain}/`, stage: 'http_compatibility', timeoutMs: fallbackTimeoutMs },
  ];
  return [...new Map(raw.map(item => [item.url, item])).values()];
}

function homepageFailureKind({ status, error } = {}) {
  if (BLOCKED_HTTP_STATUSES.has(Number(status))) return 'blocked_interstitial';
  const message = String(error?.message ?? error ?? '').toLowerCase();
  if (error?.name === 'AbortError' || /timed out|timeout/.test(message)) return 'timeout';
  if (/enotfound|eai_again|dns/.test(message)) return 'dns';
  if (/certificate|cert_|tls|ssl|self[- ]signed|hostname.*match/.test(message)) return 'tls';
  if (/too many redirects/.test(message)) return 'redirect';
  if (status) return 'http_status';
  return 'transport';
}

function aggregateHomepageFailure(reachability) {
  const attempted = reachability.filter(item => !item.skipped);
  const kinds = attempted.map(item => item.failureKind);
  if (kinds.some(kind => kind === 'blocked_interstitial')) return 'blocked_interstitial';
  if (kinds.length && kinds.every(kind => kind === 'dns' || kind === 'tls')) return 'dns_tls_failure';
  if (kinds.filter(kind => kind === 'timeout').length >= 2) return 'timeout';
  if (kinds.some(kind => kind === 'redirect')) return 'redirect';
  return kinds.at(-1) ?? 'unknown';
}

function extractionFailure(message, { network, reachability, failureStage, failureClass }) {
  const error = new Error(message);
  error.reachabilityCategory = ({ blocked_interstitial: 'blocked_interstitial', dns_tls_failure: 'dns_tls_failure', parked_for_sale: 'parked_for_sale' })[failureClass];
  error.diagnostics = {
    failureStage,
    failureClass,
    timeoutSource: reachability.filter(item => item.failureKind === 'timeout').map(item => item.stage),
    reachability,
    requests: network.requests,
    bytesDownloaded: network.bytesDownloaded,
    downloadedBytes: network.bytesDownloaded,
  };
  return error;
}

function applyBlockedRecoverySafety(items, enabled) {
  if (!enabled) return items;
  for (const item of items) {
    const proof = item.evidence ?? {};
    const verified = FAVICON_SOURCES.has(item.source) || STRUCTURED_LOGO_SOURCES.has(item.source) ||
      proof.positive_token || proof.home_linked || proof.deep_official;
    if (!verified) item.evidence = { ...proof, eligible_roles: [] };
  }
  return items;
}

async function fetchJinaHomepage(targetUrl, { apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, diagnostics, fetchImpl = fetch, validateUrl = assertPublicUrl } = {}) {
  if (!apiKey) throw new Error('Jina API key is not configured.');
  await validateUrl(targetUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (diagnostics) diagnostics.requests += 1;
    return await fetchImpl(`${JINA_READER_BASE_URL}${targetUrl}`, {
      signal: controller.signal,
      headers: {
        accept: 'text/html',
        authorization: `Bearer ${apiKey}`,
        'x-respond-with': 'html',
        'x-engine': 'browser',
        'x-base': 'final',
        'x-timeout': String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJinaBrandScreenshot(targetUrl, { apiKey, timeoutMs = 30_000, diagnostics, fetchImpl = fetch, validateUrl = assertPublicUrl } = {}) {
  if (!apiKey) throw new Error('Jina API key is not configured.');
  await validateUrl(targetUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (diagnostics) diagnostics.requests += 1;
    return await fetchImpl(JINA_READER_BASE_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        accept: 'image/png', authorization: `Bearer ${apiKey}`, 'content-type': 'application/json',
        'x-respond-with': 'screenshot', 'x-engine': 'browser', 'x-respond-timing': 'media-idle',
        'x-timeout': String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      },
      body: JSON.stringify({ url: targetUrl, viewport: { width: 768, height: 384 }, injectPageScript: JINA_BRAND_CAPTURE_SCRIPT }),
    });
  } finally { clearTimeout(timer); }
}

async function brandScreenshotCandidate(targetUrl, bytes, provider, { fullCanvas = false } = {}) {
  let pipeline = sharp(bytes, { limitInputPixels: 64 * 1024 * 1024 });
  if (fullCanvas) {
    const { data: pixels, info: rawInfo } = await pipeline.clone().raw().toBuffer({ resolveWithObject: true });
    const markerOffset = (rawInfo.width + 1) * rawInfo.channels;
    const marker = [...pixels.subarray(markerOffset, markerOffset + 3)];
    if (marker[0] > 20 || marker[1] < 220 || marker[2] > 30) throw new Error('Jina did not render the verified logo target.');
    if (rawInfo.width <= 8 || rawInfo.height <= 8) throw new Error('Jina screenshot canvas was too small.');
    pipeline = pipeline.extract({ left: 4, top: 4, width: rawInfo.width - 8, height: rawInfo.height - 8 });
  }
  const { data, info } = await pipeline.trim({ threshold: 10 }).png().toBuffer({ resolveWithObject: true });
  if (info.width < 24 || info.height < 12 || info.width * info.height < 500) throw new Error('Jina screenshot did not contain a usable logo element.');
  const ratio = info.width / info.height;
  const dataUrl = `data:image/png;base64,${data.toString('base64')}`;
  return {
    ...candidate(`${targetUrl}#jina-brand-screenshot`, 'jina-screenshot', `${info.width}x${info.height}`, 'image/png', {
      source_page: targetUrl,
      evidence: { element: 'jina-brand-screenshot', dom_region: 'header', home_linked: true, positive_token: true, eligible_roles: ratio >= 1.8 ? ['wide'] : ['icon'] },
    }),
    observed: { format: 'png', mimeType: 'image/png', width: info.width, height: info.height, byte_hash: createHash('sha256').update(data).digest('hex') },
    format: 'png', mimeType: 'image/png', width: info.width, height: info.height,
    resolvedUrl: `${targetUrl}#jina-brand-screenshot`, resolved_url: `${targetUrl}#jina-brand-screenshot`,
    bytes: data.length, squareish: ratio >= 0.72 && ratio <= 1.4, scalable: false,
    highResolution: Math.min(info.width, info.height) >= 128,
    provenance: { retrieved_at: new Date().toISOString(), http_status: 200, provider }, dataUrl,
  };
}

async function remoteJinaBrandCandidate(targetUrl, { apiKey, timeoutMs, diagnostics } = {}) {
  const response = await fetchJinaBrandScreenshot(targetUrl, { apiKey, timeoutMs, diagnostics });
  if (!response.ok) throw new Error(`Jina screenshot returned HTTP ${response.status}.`);
  const { bytes } = await readLimited(response, MAX_IMAGE_BYTES, { diagnostics, timeoutMs });
  if (!imageMetadata(bytes, response.headers.get('content-type'))) throw new Error('Jina screenshot did not return a supported image.');
  return brandScreenshotCandidate(targetUrl, bytes, 'jina-reader-screenshot', { fullCanvas: true });
}

async function jinaBrandCandidate(targetUrl, html, { timeoutMs = 12_000 } = {}) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  let bytes;
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', viewport: { width: 768, height: 384 } });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.route('**/*', route => route.abort());
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const isolated = await page.evaluate(script => {
      (0, eval)(script);
      return Boolean(document.querySelector('#logo-yoink-jina-brand'));
    }, JINA_BRAND_CAPTURE_SCRIPT);
    if (!isolated) throw new Error('Jina HTML did not expose a likely home-linked brand element.');
    bytes = await page.locator('#logo-yoink-jina-brand').screenshot({ type: 'png', animations: 'disabled', timeout: timeoutMs });
    await context.close();
  } finally {
    await browser.close();
  }
  return brandScreenshotCandidate(targetUrl, bytes, 'jina-reader-html-local-render');
}

function candidate(url, source, sizes = '', type = '', extra = {}) {
  return { url, source, source_page: extra.source_page ?? null, sizes: String(sizes ?? ''), type: String(type ?? ''), purpose: String(extra.purpose ?? ''), declared: extra.declared ?? {}, evidence: extra.evidence ?? {} };
}
function declaredPixels(item) {
  if (/svg/i.test(`${item.type ?? ''} ${item.url}`)) return 1e12;
  if (String(item.sizes).toLowerCase() === 'any') return 1e11;
  const rendered = Number(item.declared?.width) * Number(item.declared?.height);
  return Math.max(Number.isFinite(rendered) ? rendered : 0, ...[...String(item.sizes ?? '').matchAll(/(\d+)x(\d+)/gi)].map(match => Number(match[1]) * Number(match[2])));
}

function discoveryPriority(item, { renderedDimensions = true } = {}) {
  const proof = item.evidence ?? {};
  let score = (SOURCE_WEIGHT[item.source] ?? 0) * 10;
  if (proof.positive_token) score += 90;
  if (proof.home_linked) score += 80;
  if (proof.dom_region === 'header' || proof.dom_region === 'nav') score += 55;
  if (proof.negative_context || proof.banner) score -= 200;
  if (item.source === 'social-banner') score -= 300;
  const pixels = renderedDimensions ? declaredPixels(item) : Math.max(0, ...[...String(item.sizes ?? '').matchAll(/(\d+)x(\d+)/gi)].map(match => Number(match[1]) * Number(match[2])));
  score += Math.min(40, Math.log2(Math.max(1, pixels)) * 2);
  return score;
}

function dedupeUrls(items) {
  const deduped = new Map();
  for (const item of items) {
    const prior = deduped.get(item.url);
    if (!prior || discoveryPriority(item) > discoveryPriority(prior)) deduped.set(item.url, item);
  }
  return [...deduped.values()];
}

function provisionalQueue(item) {
  const proof = item.evidence ?? {};
  if (proof.negative_context || proof.banner || item.source === 'social-banner') return null;
  if (DOM_IMAGE_SOURCES.has(item.source) && !proof.positive_token && !proof.home_linked &&
      !['header', 'nav'].includes(proof.dom_region)) return null;
  const ratio = [...String(item.sizes ?? '').matchAll(/(\d+)x(\d+)/gi)]
    .map(match => Number(match[1]) / Number(match[2])).find(Number.isFinite);
  if (ratio !== undefined && ratio >= 1.8) return 'wide';
  if (FAVICON_SOURCES.has(item.source)) return 'favicon';
  if (STRUCTURED_LOGO_SOURCES.has(item.source)) return 'wide';
  return 'icon';
}

function selectRoleAware(items, totalBudget = MAX_CANDIDATES_TO_DOWNLOAD) {
  const sorted = [...items].sort((a, b) => discoveryPriority(b) - discoveryPriority(a) || declaredPixels(b) - declaredPixels(a));
  const counts = { icon: 0, wide: 0, favicon: 0 };
  const chosen = [], deferred = [];
  for (const item of sorted) {
    const queue = provisionalQueue(item);
    if (queue && counts[queue] < ROLE_QUEUE_CAPS[queue] && chosen.length < totalBudget) {
      counts[queue] += 1;
      chosen.push(item);
    } else deferred.push(item);
  }
  for (const item of deferred) {
    if (chosen.length >= totalBudget) break;
    if (provisionalQueue(item)) chosen.push(item);
  }
  return { chosen, queueCounts: counts };
}

async function manifestCandidates(url, timeoutMs, diagnostics) {
  try {
    const response = await fetchTimed(url, { timeoutMs, accept: 'application/manifest+json,application/json', diagnostics });
    if (!response.ok) return [];
    const { bytes } = await readLimited(response, 512 * 1024, { diagnostics });
    const manifest = JSON.parse(bytes.toString('utf8'));
    return (Array.isArray(manifest.icons) ? manifest.icons : []).flatMap((icon, index) => {
      const resolved = resolveHttpUrl(icon?.src, response.url);
      return resolved ? [candidate(resolved, 'manifest', icon.sizes, icon.type, { purpose: icon.purpose ?? 'any', source_page: url, evidence: { element: 'manifest', discovery_order: index, manifest_purpose: icon.purpose ?? 'any' } })] : [];
    });
  } catch { return []; }
}

async function besticonCandidates(domain, endpoint, timeoutMs, diagnostics) {
  if (!endpoint) return [];
  try {
    const url = new URL('/allicons.json', endpoint); url.searchParams.set('url', domain); url.searchParams.set('formats', 'png,ico,gif,jpg,svg');
    const response = await fetchTimed(url, { timeoutMs, accept: 'application/json', diagnostics, allowPrivate: true });
    if (!response.ok) return [];
    const { bytes } = await readLimited(response, 1024 * 1024, { diagnostics });
    const payload = JSON.parse(bytes.toString('utf8'));
    return (Array.isArray(payload.icons) ? payload.icons : []).flatMap((icon, index) => !icon?.error && icon?.url ? [{ ...candidate(icon.url, 'besticon', `${icon.width ?? 0}x${icon.height ?? 0}`, `image/${icon.format ?? ''}`, { source_page: endpoint, evidence: { element: 'besticon', discovery_order: index } }), discoveredWidth: icon.width, discoveredHeight: icon.height }] : []);
  } catch { return []; }
}

function cachedFaviconSources(domain) {
  return [
    candidate(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`, 'google-favicon', '256x256', 'image/png', { evidence: { element: 'cached-favicon', provider: 'google' } }),
    candidate(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`, 'duckduckgo-favicon', '', 'image/x-icon', { evidence: { element: 'cached-favicon', provider: 'duckduckgo' } }),
  ];
}

async function cachedFaviconCandidate(domain, timeoutMs, diagnostics, maxImageBytes = MAX_IMAGE_BYTES) {
  for (const item of cachedFaviconSources(domain)) {
    const validated = await validateCandidate(item, timeoutMs, diagnostics, maxImageBytes);
    if (validated) return validated;
  }
  return null;
}

function parseAttributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  return result;
}
function imageMetadata(bytes, contentType) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { format: 'png', mimeType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.length >= 10 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) { let width = 0, height = 0; for (let index = 0, count = bytes.readUInt16LE(4); index < count && 21 + index * 16 < bytes.length; index++) { width = Math.max(width, bytes[6 + index * 16] || 256); height = Math.max(height, bytes[7 + index * 16] || 256); } return { format: 'ico', mimeType: 'image/x-icon', width, height }; }
  if (bytes.length >= 10 && bytes.subarray(0, 3).toString('ascii') === 'GIF') return { format: 'gif', mimeType: 'image/gif', width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) { let offset = 2; while (offset + 8 < bytes.length) { if (bytes[offset] !== 0xff) { offset++; continue; } const marker = bytes[offset + 1], length = bytes.readUInt16BE(offset + 2); if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return { format: 'jpg', mimeType: 'image/jpeg', width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }; if (length < 2) break; offset += length + 2; } }
  const prefix = bytes.subarray(0, Math.min(bytes.length, 64 * 1024)).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(?:<\?xml\b[^>]*>\s*)?(?:<!--[^]*?-->\s*)*<svg\b/i.test(prefix) && !/<(?:script|foreignObject)\b|\bon\w+\s*=|<!DOCTYPE|<!ENTITY|@import\b/i.test(prefix)) {
    const a = parseAttributes(prefix.match(/<svg\b[^>]*>/i)?.[0] ?? ''), viewBox = String(a.viewbox ?? '').split(/[\s,]+/).map(Number);
    const absolute = value => /^\s*\d+(?:\.\d+)?(?:px)?\s*$/i.test(String(value ?? '')) ? Number.parseFloat(value) : null;
    let width = absolute(a.width), height = absolute(a.height);
    const validViewBox = viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0;
    if (validViewBox) {
      const ratio = viewBox[2] / viewBox[3];
      if (width == null && height != null) width = height * ratio;
      else if (height == null && width != null) height = width / ratio;
      else if (width == null && height == null) [width, height] = [viewBox[2], viewBox[3]];
    }
    return { format: 'svg', mimeType: 'image/svg+xml', width: width || null, height: height || null };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { format: 'webp', mimeType: 'image/webp', width: null, height: null };
  if (bytes.length >= 12 && bytes.subarray(4, 12).toString('ascii').includes('ftypavif')) return { format: 'avif', mimeType: 'image/avif', width: null, height: null };
  return null;
}

async function validateCandidate(item, timeoutMs, diagnostics, maxImageBytes = MAX_IMAGE_BYTES, requestOptions = {}) {
  try {
    const response = await fetchTimed(item.url, { timeoutMs, accept: 'image/*,*/*;q=0.6', diagnostics, ...requestOptions });
    if (!response.ok) return null;
    if (item.source === 'wikimedia-commons' && !safeCommonsUrl(response.url, 'upload.wikimedia.org', '/wikipedia/commons/')) return null;
    const read = await readLimited(response, maxImageBytes, { diagnostics, timeoutMs });
    let bytes = read.bytes;
    let metadata = imageMetadata(bytes, response.headers.get('content-type'));
    if (metadata?.format === 'svg') {
      bytes = normalizeStandaloneSvg(bytes, { inheritedColor: item.evidence?.inherited_color });
      metadata = bytes && imageMetadata(bytes, 'image/svg+xml');
      if (!metadata || !await isRenderableSvg(bytes)) return null;
    }
    if (metadata && ['webp', 'avif'].includes(metadata.format)) {
      const decoded = await sharp(bytes, { limitInputPixels: 64 * 1024 * 1024 }).metadata();
      metadata = { ...metadata, width: decoded.width ?? null, height: decoded.height ?? null };
    }
    if (!metadata || !bytes.length) return null;
    const width = metadata.width ?? item.declared?.width ?? item.discoveredWidth ?? null, height = metadata.height ?? item.declared?.height ?? item.discoveredHeight ?? null;
    const ratio = width && height ? width / height : null, squareish = ratio !== null && ratio >= 0.72 && ratio <= 1.4, scalable = metadata.format === 'svg', highResolution = scalable || Boolean(width && height && Math.min(width, height) >= 128);
    const background = await imageBackground(bytes, metadata.format);
    return { ...item, background, observed: { ...metadata, width, height, byte_hash: createHash('sha256').update(bytes).digest('hex') }, ...metadata, width, height, resolvedUrl: response.url, resolved_url: response.url, bytes: bytes.length, squareish, scalable, highResolution, provenance: { ...item.provenance, retrieved_asset_url: response.url, retrieved_at: new Date().toISOString(), http_status: response.status }, dataUrl: `data:${metadata.mimeType};base64,${bytes.toString('base64')}` };
  } catch { return null; }
}
async function validateCandidateBytes(item, bytes, { resolvedUrl = item.url, status = 200, contentType = '' } = {}) {
  try {
    const { rawBytes: _rawBytes, ...cleanItem } = item;
    let metadata = imageMetadata(bytes, contentType);
    if (metadata?.format === 'svg') {
      bytes = normalizeStandaloneSvg(bytes, { inheritedColor: item.evidence?.inherited_color });
      metadata = bytes && imageMetadata(bytes, 'image/svg+xml');
      if (!metadata || !await isRenderableSvg(bytes)) return null;
    }
    if (metadata && ['webp', 'avif'].includes(metadata.format)) {
      const decoded = await sharp(bytes, { limitInputPixels: 64 * 1024 * 1024 }).metadata();
      metadata = { ...metadata, width: decoded.width ?? null, height: decoded.height ?? null };
    }
    if (!metadata || !bytes.length) return null;
    const width = metadata.width ?? item.declared?.width ?? null, height = metadata.height ?? item.declared?.height ?? null;
    const ratio = width && height ? width / height : null, squareish = ratio !== null && ratio >= 0.72 && ratio <= 1.4;
    const scalable = metadata.format === 'svg', highResolution = scalable || Boolean(width && height && Math.min(width, height) >= 128);
    const background = await imageBackground(bytes, metadata.format);
    return { ...cleanItem, background, observed: { ...metadata, width, height, byte_hash: createHash('sha256').update(bytes).digest('hex') }, ...metadata, width, height, resolvedUrl, resolved_url: resolvedUrl, bytes: bytes.length, squareish, scalable, highResolution, provenance: { ...item.provenance, retrieved_asset_url: resolvedUrl, retrieved_at: new Date().toISOString(), http_status: status, source_chain: item.provenance_chain ?? item.provenance?.source_chain ?? [] }, dataUrl: `data:${metadata.mimeType};base64,${bytes.toString('base64')}` };
  } catch { return null; }
}

async function isRenderableSvg(bytes) {
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 64 * 1024 * 1024 })
      .ensureAlpha().resize(64, 64, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    if (!(info.width > 0 && info.height > 0 && info.channels >= 4)) return false;
    for (let offset = info.channels - 1; offset < data.length; offset += info.channels) if (data[offset] > 0) return true;
    return false;
  } catch { return false; }
}

async function imageBackground(bytes, format) {
  if (format === 'jpeg') return 'opaque';
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 64 * 1024 * 1024 })
      .ensureAlpha()
      .resize(64, 64, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let offset = info.channels - 1; offset < data.length; offset += info.channels) {
      if (data[offset] < 250) return 'transparent';
    }
    return 'opaque';
  } catch { return 'unknown'; }
}
function dataUrlBytes(value) {
  const match = /^data:[^;,]+(;base64)?,([\s\S]*)$/.exec(String(value ?? ''));
  if (!match) return null;
  try { return match[1] ? Buffer.from(match[2], 'base64') : Buffer.from(decodeURIComponent(match[2]), 'utf8'); } catch { return null; }
}

async function measureContentBox(bytes, { width: sourceWidth, height: sourceHeight } = {}) {
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 64 * 1024 * 1024 })
      .ensureAlpha()
      .resize(CONTENT_BOX_MAX_SAMPLES, CONTENT_BOX_MAX_SAMPLES, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    if (width < 2 || height < 2 || channels < 4) return null;
    const at = (x, y) => (y * width + x) * channels;
    const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
    const opaqueCorner = corners.find(offset => data[offset + 3] >= 224);
    const isBackground = offset => data[offset + 3] < 32 || (opaqueCorner !== undefined &&
      Math.abs(data[offset] - data[opaqueCorner]) + Math.abs(data[offset + 1] - data[opaqueCorner + 1]) + Math.abs(data[offset + 2] - data[opaqueCorner + 2]) <= 30);
    let top = 0, bottom = height - 1, left = 0, right = width - 1;
    const rowHasContent = y => { for (let x = 0; x < width; x++) if (!isBackground(at(x, y))) return true; return false; };
    const columnHasContent = x => { for (let y = top; y <= bottom; y++) if (!isBackground(at(x, y))) return true; return false; };
    while (top <= bottom && !rowHasContent(top)) top++;
    while (bottom >= top && !rowHasContent(bottom)) bottom--;
    if (bottom < top) return null;
    while (left <= right && !columnHasContent(left)) left++;
    while (right >= left && !columnHasContent(right)) right--;
    if (right < left) return null;
    const scaleWidth = sourceWidth && sourceWidth > 0 ? sourceWidth / width : 1;
    const scaleHeight = sourceHeight && sourceHeight > 0 ? sourceHeight / height : 1;
    return { width: Math.round((right - left + 1) * scaleWidth), height: Math.round((bottom - top + 1) * scaleHeight) };
  } catch { return null; }
}

async function attachContentBoxes(items, enabled, companyName, stats) {
  if (!enabled) return;
  for (const item of items) {
    if (item.contentBoxChecked || !item.dataUrl) continue;
    item.contentBoxChecked = true;
    const ratio = item.width && item.height ? item.width / item.height : null;
    if (ratio == null || ratio >= 1.8 || FAVICON_SOURCES.has(item.source) || !hasWideEvidence(item, companyName)) continue;
    const bytes = dataUrlBytes(item.dataUrl);
    const box = bytes ? await measureContentBox(bytes, { width: item.width, height: item.height }) : null;
    if (!box) continue;
    const contentRatio = box.width / box.height;
    if (Math.min(box.width, box.height) < CONTENT_BOX_MIN_EDGE_PX || contentRatio < 1.8 || contentRatio > 12) continue;
    item.contentBox = box;
    stats.boxes += 1;
  }
}

async function attachTinySuitability(items) {
  await mapConcurrent(items, 4, async item => {
    if (item.tinySuitabilityChecked || !item.dataUrl) return;
    item.tinySuitabilityChecked = true;
    const ratio = item.width && item.height ? item.width / item.height : null;
    if (!FAVICON_SOURCES.has(item.source) || (ratio != null && (ratio < 0.72 || ratio > 1.4))) return;
    const bytes = dataUrlBytes(item.dataUrl);
    if (bytes) item.tinySuitability = await measureTinyImageSuitability(bytes) ?? { score: 0 };
  });
}

function dedupeBytes(items) {
  const deduped = new Map();
  for (const item of items) {
    const key = item.observed.byte_hash, prior = deduped.get(key);
    if (!prior) deduped.set(key, item);
    else { const stronger = (SOURCE_WEIGHT[item.source] ?? 0) > (SOURCE_WEIGHT[prior.source] ?? 0) ? item : prior; stronger.evidence = { ...stronger.evidence, duplicate_sources: [...new Set([...(prior.evidence?.duplicate_sources ?? []), prior.source, item.source])], duplicate_urls: [...new Set([...(prior.evidence?.duplicate_urls ?? []), prior.url, item.url])] }; deduped.set(key, stronger); }
  }
  return [...deduped.values()];
}

function browserCandidateDisposition(item, homepage, eligibleRoles = ['icon', 'wide'], { headerRetention = true } = {}) {
  const proofs = Array.isArray(item.evidence) ? item.evidence : [item.evidence].filter(Boolean);
  const proof = proofs[0] ?? {};
  const semantic = [proof.alt, proof.ariaLabel, proof.title, proof.id, proof.className].filter(Boolean).join(' ');
  const uiControl = /(?:^|[-_\s])(hamburger|menu-toggle|toggle-menu|close|search|chevron|arrow|whatsapp|tasks?|translate|language-switcher|button-icon)(?:$|[-_\s])|(?:^|[-_\s])fa-(?:language|magnifying-glass|search|bars|xmark|close|chevron-(?:left|right|up|down)|arrow-(?:left|right|up|down)|whatsapp)(?:$|[-_\s])/i.test(semantic);
  const positive = /logo|brand|wordmark/i.test(semantic);
  const width = Number(proof.renderedBox?.width), height = Number(proof.renderedBox?.height);
  const ratio = width > 0 && height > 0 ? width / height : null;
  const strongWidePlacement = ratio >= 1.8 && ratio <= 12 && (proof.homeLinked || ['header', 'nav'].includes(proof.domRegion));
  if (uiControl || (!positive && !proof.homeLinked && !(headerRetention && strongWidePlacement))) return { candidate: null, stage: 'semantic_filter', reason: uiControl ? 'ui-control' : 'weak-text-without-strong-placement-shape' };
  const url = item.kind === 'inline-svg'
    ? `data:image/svg+xml;base64,${Buffer.from(item.inlineSvg).toString('base64')}`
    : resolveHttpUrl(item.url, homepage);
  if (!url) return { candidate: null, stage: 'invalid_url', reason: 'unresolvable-or-null-like-url' };
  return { stage: 'retained', reason: positive ? 'positive-semantic' : proof.homeLinked ? 'home-linked' : 'visible-wide-header', candidate: candidate(url, item.source, '', item.kind === 'inline-svg' ? 'image/svg+xml' : '', {
    source_page: homepage,
    declared: proof.renderedBox ? { width: proof.renderedBox.width, height: proof.renderedBox.height, theme: proof.theme } : {},
    evidence: {
      dom_region: proof.domRegion ?? 'document',
      home_linked: Boolean(proof.homeLinked),
      alt: proof.alt ?? '',
      aria_label: proof.ariaLabel ?? '',
      semantic_text: semantic,
      positive_token: positive,
      negative_context: uiControl,
      eligible_roles: eligibleRoles,
      themes: [...new Set(proofs.map(value => value?.theme).filter(Boolean))],
      rendered: true,
    },
  }) };
}

function fromBrowserCandidate(item, homepage, eligibleRoles = ['icon', 'wide']) {
  return browserCandidateDisposition(item, homepage, eligibleRoles).candidate;
}

function selectBrowserCandidates(items, budget = 8, reserve = 2, { headerRetention = true } = {}) {
  const sorted = [...items].sort((a, b) => discoveryPriority(b, { renderedDimensions: headerRetention }) - discoveryPriority(a, { renderedDimensions: headerRetention }));
  const reservable = item => {
    const width = Number(item.declared?.width), height = Number(item.declared?.height);
    const ratio = width > 0 && height > 0 ? width / height : null;
    return ratio >= 1.8 && ratio <= 12 && (item.evidence?.home_linked || ['header', 'nav'].includes(item.evidence?.dom_region));
  };
  const reserved = headerRetention ? sorted.filter(reservable).slice(0, Math.min(reserve, budget)) : [];
  const chosen = [...reserved];
  for (const item of sorted) if (chosen.length < budget && !chosen.includes(item)) chosen.push(item);
  return { chosen, deferred: sorted.filter(item => !chosen.includes(item)), reserved };
}

export function needsRenderedWideFallback(ranked, preferences) {
  return !matchesLogoPreferences(ranked.selectedByRole.wide, preferences);
}

export function missingWikimediaRoles(ranked, preferences) {
  return [
    ...(!matchesAssetPreferences(ranked.selectedByRole.icon, preferences, 'icon') ? ['icon'] : []),
    ...(!matchesLogoPreferences(ranked.selectedByRole.wide, preferences) ? ['wide'] : []),
  ];
}

export async function extractLogos(website, options = {}) {
  const preferences = normalizeAssetPreferences(options.preferences);
  const startedAt = performance.now(), timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS, normalized = normalizeWebsite(website), network = { requests: 0, bytesDownloaded: 0 };
  const maxImageBytes = Number.isFinite(options.maxImageBytes) ? Math.max(128 * 1024, Math.min(MAX_IMAGE_BYTES, options.maxImageBytes)) : MAX_IMAGE_BYTES;
  const attempts = homepageAttemptPlan(normalized, timeoutMs);
  let homepage = null, html = '', htmlTruncated = false, jinaHomepageUsed = false; const reachability = [];
  const dnsFailedHosts = new Set();
  let consecutiveTimeouts = 0;
  for (const attempt of attempts) {
    const hostname = new URL(attempt.url).hostname.toLowerCase();
    if (dnsFailedHosts.has(hostname)) {
      reachability.push({ url: attempt.url, stage: attempt.stage, ok: false, skipped: 'dns-host-known-unreachable', failureKind: 'dns' });
      continue;
    }
    try {
      const response = await fetchTimed(attempt.url, { timeoutMs: attempt.timeoutMs, accept: 'text/html,application/xhtml+xml', diagnostics: network });
      if (!response.ok) {
        const failureKind = homepageFailureKind({ status: response.status });
        reachability.push({ url: attempt.url, stage: attempt.stage, ok: false, status: response.status, failureKind });
        consecutiveTimeouts = 0;
        await response.body?.cancel().catch(() => {});
        continue;
      }
      homepage = response.url;
      const read = await readLimited(response, MAX_HTML_BYTES, { truncate: true, diagnostics: network, timeoutMs: attempt.timeoutMs });
      html = read.bytes.toString('utf8'); htmlTruncated = read.truncated;
      reachability.push({ url: attempt.url, stage: attempt.stage, ok: true, status: response.status, finalUrl: response.url });
      break;
    } catch (error) {
      const failureKind = homepageFailureKind({ error });
      reachability.push({ url: attempt.url, stage: attempt.stage, ok: false, error: failureKind === 'timeout' ? 'timeout' : error.message, failureKind });
      if (failureKind === 'dns') dnsFailedHosts.add(hostname);
      consecutiveTimeouts = failureKind === 'timeout' ? consecutiveTimeouts + 1 : 0;
      if (consecutiveTimeouts >= 2) break;
    }
  }
  const jinaApiKey = Object.hasOwn(options, 'jinaApiKey') ? options.jinaApiKey : process.env.JINA_API_KEY?.trim();
  if (!homepage && jinaApiKey) {
    const target = attempts.find(item => {
      const outcome = reachability.find(value => value.url === item.url);
      return outcome && outcome.status !== 404 && !outcome.skipped;
    })?.url ?? attempts[0].url;
    try {
      const response = await fetchJinaHomepage(target, { apiKey: jinaApiKey, timeoutMs: Math.max(timeoutMs, 20_000), diagnostics: network });
      if (!response.ok) {
        reachability.push({ url: target, via: 'jina', ok: false, status: response.status });
      } else {
        const read = await readLimited(response, MAX_HTML_BYTES, { truncate: true, diagnostics: network, timeoutMs: Math.max(timeoutMs, 20_000) });
        homepage = target;
        html = read.bytes.toString('utf8');
        htmlTruncated = read.truncated;
        jinaHomepageUsed = true;
        reachability.push({ url: target, via: 'jina', ok: true, status: response.status, finalUrl: target });
      }
    } catch (error) {
      reachability.push({ url: target, via: 'jina', ok: false, error: error.name === 'AbortError' ? 'timeout' : error.message });
    }
  }
  if (!homepage) {
    const failureClass = aggregateHomepageFailure(reachability);
    throw extractionFailure(`Could not reach the website. ${reachability.map(item => `${item.url}${item.via ? ` via ${item.via}` : ''}: ${item.skipped ?? item.error ?? `HTTP ${item.status}`}`).join(' | ')}`, {
      network, reachability, failureStage: 'homepage_acquisition', failureClass,
    });
  }
  const namecheapInterstitial = !/(?:^|\.)namecheap\.com$/i.test(normalized.domain) && /alt=["']Namecheap Logo["']/i.test(html);
  const vercelInterstitial = !/(?:^|\.)vercel\.com$/i.test(normalized.domain) && /Vercel Security Checkpoint/i.test(html);
  if (/sedoparking|domain (?:name )?is for sale|buy this domain|hugedomains|afternic|parking-page\.shtml/i.test(html) || namecheapInterstitial) {
    throw extractionFailure('Website appears parked or for sale.', { network, reachability, failureStage: 'homepage_content', failureClass: 'parked_for_sale' });
  }
  if (vercelInterstitial) {
    throw extractionFailure('Website appears blocked by a security interstitial.', { network, reachability, failureStage: 'homepage_content', failureClass: 'blocked_interstitial' });
  }
  const parsed = parseHomepage(html, homepage, { companyName: options.companyName, collectDeepLinks: Boolean(options.deepWide) });
  const blockedRecovery = reachability.some(item => item.failureKind === 'blocked_interstitial') &&
    reachability.some(item => item.ok && item.stage !== 'primary');
  const jinaRecoverableLogoMarkup = parsed.candidates.some(item =>
    ['dom-img', 'dom-picture', 'noscript-img', 'inline-svg'].includes(item.source) &&
    (item.evidence?.positive_token || item.evidence?.home_linked));
  const [manifest, besticon] = await Promise.all([Promise.all(parsed.manifests.slice(0, 2).map(url => manifestCandidates(url, timeoutMs, network))).then(groups => groups.flat()), besticonCandidates(normalized.domain, options.besticonUrl, timeoutMs, network)]);
  const root = new URL(homepage); root.pathname = '/favicon.ico'; root.search = ''; root.hash = ''; const rootPng = new URL(root); rootPng.pathname = '/favicon.png';
  const all = [...parsed.candidates, ...manifest, ...besticon, candidate(root.href, 'root-favicon', '', 'image/x-icon', { source_page: homepage }), candidate(rootPng.href, 'root-favicon', '', 'image/png', { source_page: homepage })];
  const rankedUnique = dedupeUrls(all)
    .sort((a, b) => discoveryPriority(b) - discoveryPriority(a) || declaredPixels(b) - declaredPixels(a));
  const budget = options.maxCandidates ?? MAX_CANDIDATES_TO_DOWNLOAD;
  const queueSelection = options.roleAwareBudget ? selectRoleAware(rankedUnique, budget) : null;
  const unique = queueSelection?.chosen ?? rankedUnique.slice(0, budget);
  const validatedRaw = (await mapConcurrent(unique, 6, item => validateCandidate(item, timeoutMs, network, maxImageBytes))).filter(Boolean);
  let validated = dedupeBytes(validatedRaw);
  const rankValidated = () => rankCandidates(applyBlockedRecoverySafety(validated, blockedRecovery), { companyName: options.companyName, preferences });
  const contentStats = { boxes: 0 };
  await attachContentBoxes(validated, options.contentBoundingWide, options.companyName, contentStats);
  await attachTinySuitability(validated);
  let ranked = rankValidated();
  let cachedFavicon = null;
  if (!ranked.selectedByRole.icon && options.cachedFavicon !== false) {
    cachedFavicon = await cachedFaviconCandidate(normalized.domain, timeoutMs, network, maxImageBytes);
    if (cachedFavicon) {
      validated = dedupeBytes([...validated, cachedFavicon]);
      await attachTinySuitability(validated);
      ranked = rankValidated();
    }
  }

  const deepDiagnostics = { enabled: Boolean(options.deepWide), official: null, spaBundle: null };
  if (options.deepWide && (options.forceDeepWide || needsRenderedWideFallback(ranked, preferences))) {
    const deepCompanyName = options.companyName || normalized.domain.split('.')[0];
    const fetchResource = async (url, request = {}) => {
      const response = await fetchTimed(url, { timeoutMs, accept: request.accept ?? '*/*', diagnostics: network, headers: request.headers });
      if (request.detectArchive && /(?:application|multipart)\/(?:zip|x-zip-compressed)/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel().catch(() => {});
        return { ok: response.ok, status: response.status, url: response.url, headers: response.headers, bytes: Buffer.alloc(0) };
      }
      const read = await readLimited(response, request.maxBytes ?? MAX_HTML_BYTES, { diagnostics: network, timeoutMs });
      return { ok: response.ok, status: response.status, url: response.url, headers: response.headers, bytes: read.bytes };
    };
    const official = await discoverOfficialBrandAssets({ homepage, parsed, companyName: deepCompanyName, fetchResource, maxPages: options.deepWidePages ?? 2 });
    deepDiagnostics.official = official.diagnostics;
    const direct = official.candidates.filter(item => !item.rawBytes);
    const archive = (await Promise.all(official.candidates.filter(item => item.rawBytes).map(item => validateCandidateBytes(item, item.rawBytes)))).filter(Boolean);
    const extraDirect = (await mapConcurrent(direct, 3, item => validateCandidate(item, timeoutMs, network, maxImageBytes))).filter(Boolean);
    validated = dedupeBytes([...validated, ...archive, ...extraDirect]);
    await attachTinySuitability(validated);
    ranked = rankValidated();
    if (options.spaBundles && needsRenderedWideFallback(ranked, preferences)) {
      const spa = await discoverSpaBundleAssets({ homepage, parsed, companyName: deepCompanyName, fetchResource });
      deepDiagnostics.spaBundle = spa.diagnostics;
      const spaExtra = (await mapConcurrent(spa.candidates, 2, item => validateCandidate(item, timeoutMs, network, maxImageBytes))).filter(Boolean);
      validated = dedupeBytes([...validated, ...spaExtra]);
      await attachTinySuitability(validated);
      ranked = rankValidated();
    }
  }

  const expandedPages = [];
  if (options.expandedPages > 0 && needsRenderedWideFallback(ranked, preferences)) {
    for (const pageUrl of parsed.brandPages.slice(0, Math.min(2, options.expandedPages))) {
      try {
        const response = await fetchTimed(pageUrl, { timeoutMs, accept: 'text/html,application/xhtml+xml', diagnostics: network });
        if (!response.ok) continue;
        const read = await readLimited(response, MAX_HTML_BYTES, { truncate: true, diagnostics: network });
        const page = parseHomepage(read.bytes.toString('utf8'), response.url, { companyName: options.companyName });
        expandedPages.push(response.url);
        const known = new Set(validated.map(item => item.url));
        const additions = dedupeUrls(page.candidates.filter(item => !known.has(item.url)))
          .sort((a, b) => discoveryPriority(b) - discoveryPriority(a)).slice(0, 8);
        const extra = (await mapConcurrent(additions, 4, item => validateCandidate(item, timeoutMs, network, maxImageBytes))).filter(Boolean);
        validated = dedupeBytes([...validated, ...extra]);
        await attachContentBoxes(validated, options.contentBoundingWide, options.companyName, contentStats);
        await attachTinySuitability(validated);
        ranked = rankValidated();
        if (!needsRenderedWideFallback(ranked, preferences)) break;
      } catch { /* Secondary pages are a bounded fallback, never a fatal path. */ }
    }
  }

  let browserDiagnostics = null;
  if (options.browser && !jinaHomepageUsed && needsRenderedWideFallback(ranked, preferences)) {
    const missingRoles = ['icon', 'wide'].filter(role => !ranked.selectedByRole[role]);
    if (!missingRoles.includes('wide')) missingRoles.push('wide');
    const rendered = await discoverBrowserLogos({ url: homepage, domain: normalized.domain, company: options.companyName }, {
      browser: options.browserInstance,
      darkMode: true,
      timeoutMs: Math.min(12_000, timeoutMs),
      userAgent: options.userAgent,
      launchOptions: options.browserLaunchOptions,
    });
    browserDiagnostics = rendered.diagnostics;
    const known = new Set(validated.map(item => item.url));
    const browserConverted = rendered.candidates.map(item => fromBrowserCandidate(item, homepage, missingRoles)).filter(item => item && !known.has(item.url));
    const browserItems = selectBrowserCandidates(browserConverted, 8, 2).chosen;
    const extra = (await mapConcurrent(browserItems, 4, item => validateCandidate(item, timeoutMs, network, maxImageBytes))).filter(Boolean);
    validated = dedupeBytes([...validated, ...extra]);
    await attachContentBoxes(validated, options.contentBoundingWide, options.companyName, contentStats);
    await attachTinySuitability(validated);
    ranked = rankValidated();
  }

  let jinaScreenshot = null;
  if (jinaApiKey && jinaRecoverableLogoMarkup && !ranked.selectedByRole.icon && !ranked.selectedByRole.wide) {
    try {
      let screenshot;
      let mode = 'remote';
      try {
        screenshot = await remoteJinaBrandCandidate(homepage, { apiKey: jinaApiKey, timeoutMs: Math.max(timeoutMs, 30_000), diagnostics: network });
      } catch {
        mode = 'local-html';
        screenshot = await jinaBrandCandidate(homepage, html, { timeoutMs: Math.max(timeoutMs, 12_000) });
      }
      validated = dedupeBytes([...validated, screenshot]);
      await attachContentBoxes(validated, options.contentBoundingWide, options.companyName, contentStats);
      await attachTinySuitability(validated);
      ranked = rankValidated();
      jinaScreenshot = { status: 'ok', mode, width: screenshot.width, height: screenshot.height };
    } catch (error) {
      jinaScreenshot = { status: 'error', error: error.name === 'AbortError' ? 'timeout' : error.message };
    }
  }

  let wikimediaDiagnostics = { enabled: Boolean(options.wikimediaFallback), status: 'disabled' };
  if (options.wikimediaFallback) {
    const missingRoles = missingWikimediaRoles(ranked, preferences);
    if (missingRoles.length) {
      const fallbackStarted = performance.now();
      const fallbackRequestsBefore = network.requests;
      const fallbackBytesBefore = network.bytesDownloaded;
      const resolver = options.wikimediaResolver ?? discoverWikimediaLogoCandidates;
      const discovered = await resolver({ domain: normalized.domain, missingRoles }, {
        timeoutMs: Math.min(timeoutMs, options.wikimediaTimeoutMs ?? 5_000),
        diagnostics: network,
        fetchImpl: options.wikimediaFetch,
        validateUrl: options.wikimediaValidateUrl,
        cache: options.wikimediaCache,
        cacheTtlMs: options.wikimediaCacheTtlMs,
        now: options.wikimediaNow,
      });
      wikimediaDiagnostics = { enabled: true, ...discovered.diagnostics, requestedRoles: missingRoles };
      const additions = (await mapConcurrent((discovered.candidates ?? []).slice(0, 2), 2,
        item => validateCandidate(item, Math.min(timeoutMs, options.wikimediaTimeoutMs ?? 5_000), network, maxImageBytes, {
          fetchImpl: options.wikimediaFetch,
          validateUrl: options.wikimediaValidateUrl,
        }))).filter(Boolean);
      if (additions.length) {
        const before = Object.fromEntries(['icon', 'wide'].map(role => [role, ranked.selectedByRole[role]]));
        validated = dedupeBytes([...validated, ...additions]);
        await attachContentBoxes(validated, options.contentBoundingWide, options.companyName, contentStats);
        await attachTinySuitability(validated);
        const treatment = rankValidated();
        const displaced = ['icon', 'wide'].filter(role => !missingRoles.includes(role) &&
          (treatment.selectedByRole[role]?.observed?.byte_hash ?? null) !== (before[role]?.observed?.byte_hash ?? null));
        if (!displaced.length) ranked = treatment;
        const admittedRoles = displaced.length ? [] : missingRoles.filter(role => ranked.selectedByRole[role]?.source === 'wikimedia-commons');
        wikimediaDiagnostics = { ...wikimediaDiagnostics, validated: additions.length, admitted: admittedRoles.length, admittedRoles, displacedRoles: displaced };
      }
      wikimediaDiagnostics = { ...wikimediaDiagnostics,
        requests: network.requests - fallbackRequestsBefore,
        downloadedBytes: network.bytesDownloaded - fallbackBytesBefore,
        durationMs: Math.round(performance.now() - fallbackStarted),
      };
    } else wikimediaDiagnostics = { enabled: true, status: 'not_needed', requestedRoles: [] };
  }

  const totalRequests = network.requests + (browserDiagnostics?.requests ?? 0);
  const totalBytes = network.bytesDownloaded + (browserDiagnostics?.declaredTransferBytes ?? 0);
  return { input: website, domain: normalized.domain, homepage, preferences: ranked.preferences, assets: ranked.assets, assetVariants: ranked.assetVariants, variantPolicy: ranked.variantPolicy, selected: ranked.selected, selectedByRole: ranked.selectedByRole, assetFamilies: ranked.assetFamilies, candidates: ranked.candidates, diagnostics: { discovered: all.length, uniqueConsidered: unique.length, roleQueues: queueSelection ? { reserved: ROLE_QUEUE_CAPS, used: queueSelection.queueCounts } : null, contentBounding: { enabled: Boolean(options.contentBoundingWide), ...contentStats }, validated: ranked.candidates.length, families: ranked.assetFamilies.length, duplicatesByHash: validatedRaw.length - dedupeBytes(validatedRaw).length, historicalSquareHighProxy: Boolean(ranked.selected?.squareish && ranked.selected?.highResolution), selectedWideProxy: Boolean(ranked.selectedByRole.wide && ranked.selectedByRole.wide.width / ranked.selectedByRole.wide.height >= 2.2), manifests: parsed.manifests.length, besticonEnabled: Boolean(options.besticonUrl), cachedFavicon: cachedFavicon ? { source: cachedFavicon.source, resolvedUrl: cachedFavicon.resolvedUrl } : null, wikimedia: wikimediaDiagnostics, htmlTruncated, expandedPages, browserUsed: browserDiagnostics?.status === 'ok', browser: browserDiagnostics, jina: { homepageUsed: jinaHomepageUsed, screenshot: jinaScreenshot }, staticRequests: network.requests, requests: totalRequests, bytesDownloaded: totalBytes, downloadedBytes: totalBytes, reachability, durationMs: Math.round(performance.now() - startedAt) } };
}

// The old internal helper represented icon-oriented ranking; retain that test/debug contract.
export const internals = {
  imageMetadata, parseAttributes, parseHomepage, readLimited, provisionalQueue,
  selectRoleAware, measureContentBox, attachContentBoxes, attachTinySuitability, dedupeBytes,
  fromBrowserCandidate, browserCandidateDisposition, selectBrowserCandidates, needsRenderedWideFallback, discoveryPriority, validateCandidate, validateCandidateBytes, isRenderableSvg, imageBackground, fetchJinaHomepage, fetchJinaBrandScreenshot, jinaBrandCandidate, cachedFaviconSources,
  missingWikimediaRoles,
  homepageAttemptPlan, homepageFailureKind, aggregateHomepageFailure,
  applyBlockedRecoverySafety,
  scoreCandidate: item => scoreCandidate(item).role_scores.icon,
};
