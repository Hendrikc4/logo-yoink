import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import sharp from 'sharp';
import { parseHomepage, resolveHttpUrl } from './discover-static.mjs';
import { discoverBrowserLogos } from './discover-browser.mjs';
import { hasWideEvidence, rankCandidates, scoreCandidate, SOURCE_WEIGHT } from './rank.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_CANDIDATES_TO_DOWNLOAD = 16;
const ROLE_QUEUE_CAPS = { icon: 6, wide: 8, favicon: 4 };
const FAVICON_SOURCES = new Set(['manifest', 'apple', 'mask-icon', 'ms-tile', 'html-icon', 'besticon', 'root-favicon']);
const STRUCTURED_LOGO_SOURCES = new Set(['schema', 'og-logo', 'microdata']);
const DOM_IMAGE_SOURCES = new Set(['dom-img', 'dom-picture', 'noscript-img']);
const CONTENT_BOX_MAX_SAMPLES = 96;
const CONTENT_BOX_MIN_EDGE_PX = 24;

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

function isPrivateIp(hostname) {
  if (!isIP(hostname)) return false;
  if (hostname === '::' || hostname === '::1' || /^(fc|fd|fe[89ab])/i.test(hostname) || /^2001:db8:/i.test(hostname)) return true;
  const mapped = hostname.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i);
  if (mapped) {
    const number = Number.parseInt(mapped[1], 16) * 65536 + Number.parseInt(mapped[2], 16);
    return isPrivateIp(`${number >>> 24}.${number >>> 16 & 255}.${number >>> 8 & 255}.${number & 255}`);
  }
  const parts = hostname.split('.').map(Number);
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && ((parts[1] === 0 && [0, 2].includes(parts[2])) || (parts[1] === 88 && parts[2] === 99) || parts[1] === 168)) ||
    (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || (parts[1] === 51 && parts[2] === 100))) ||
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) || parts[0] >= 224;
}

async function assertPublicUrl(value) {
  const url = new URL(value);
  const expectedPort = url.protocol === 'http:' ? '80' : url.protocol === 'https:' ? '443' : null;
  if (!expectedPort || url.username || url.password || (url.port && url.port !== expectedPort)) throw new Error('Unsafe or unsupported URL.');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || isPrivateIp(hostname)) throw new Error('Local and private-network addresses are not supported.');
  if (!isIP(hostname)) {
    const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) throw new Error('Hostname resolves to a non-public address.');
  }
  return url;
}

async function fetchTimed(url, { timeoutMs, accept = '*/*', diagnostics, allowPrivate = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let current = String(url);
    if (current.startsWith('data:')) return await fetch(current, { signal: controller.signal });
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!allowPrivate) await assertPublicUrl(current);
      if (diagnostics) diagnostics.requests += 1;
      const response = await fetch(current, { redirect: 'manual', signal: controller.signal, headers: { accept, 'user-agent': 'Mozilla/5.0 (compatible; LogoYoink/0.2; +https://github.com/Hendrikc4/logo-yoink)' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location');
      if (!location) return response;
      current = new URL(location, current).href;
    }
    throw new Error('Too many redirects.');
  } catch (error) {
    controller.abort();
    throw error;
  } finally { clearTimeout(timer); }
}

async function readLimited(response, maxBytes, { truncate = false, diagnostics, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes && !truncate) throw new Error(`Response exceeds ${maxBytes} bytes.`);
  if (!response.body) return { bytes: Buffer.alloc(0), truncated: false };
  const reader = response.body.getReader(), chunks = [];
  let total = 0, truncated = false;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) { await reader.cancel(); throw new DOMException('Body read timed out.', 'AbortError'); }
    let timer;
    let read;
    try {
      read = await Promise.race([
        reader.read(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new DOMException('Body read timed out.', 'AbortError')), remaining); }),
      ]);
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally { clearTimeout(timer); }
    const { done, value } = read;
    if (done) break;
    if (total + value.length > maxBytes) {
      if (!truncate) { await reader.cancel(); throw new Error(`Response exceeds ${maxBytes} bytes.`); }
      chunks.push(Buffer.from(value.subarray(0, maxBytes - total))); total = maxBytes; truncated = true; await reader.cancel(); break;
    }
    total += value.length; chunks.push(Buffer.from(value));
  }
  const bytes = Buffer.concat(chunks);
  if (diagnostics) diagnostics.bytesDownloaded += bytes.length;
  return { bytes, truncated: truncated || declared > maxBytes };
}

function candidate(url, source, sizes = '', type = '', extra = {}) {
  return { url, source, source_page: extra.source_page ?? null, sizes: String(sizes ?? ''), type: String(type ?? ''), purpose: String(extra.purpose ?? ''), declared: extra.declared ?? {}, evidence: extra.evidence ?? {} };
}
function declaredPixels(item) {
  if (/svg/i.test(`${item.type ?? ''} ${item.url}`)) return 1e12;
  if (String(item.sizes).toLowerCase() === 'any') return 1e11;
  return Math.max(0, ...[...String(item.sizes ?? '').matchAll(/(\d+)x(\d+)/gi)].map(match => Number(match[1]) * Number(match[2])));
}

function discoveryPriority(item) {
  const proof = item.evidence ?? {};
  let score = (SOURCE_WEIGHT[item.source] ?? 0) * 10;
  if (proof.positive_token) score += 90;
  if (proof.home_linked) score += 80;
  if (proof.dom_region === 'header' || proof.dom_region === 'nav') score += 55;
  if (proof.negative_context || proof.banner) score -= 200;
  if (item.source === 'social-banner') score -= 300;
  score += Math.min(40, Math.log2(Math.max(1, declaredPixels(item))) * 2);
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
    const width = absolute(a.width) ?? (viewBox.length === 4 && viewBox.every(Number.isFinite) ? viewBox[2] : null);
    const height = absolute(a.height) ?? (viewBox.length === 4 && viewBox.every(Number.isFinite) ? viewBox[3] : null);
    return { format: 'svg', mimeType: 'image/svg+xml', width: width || null, height: height || null };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { format: 'webp', mimeType: 'image/webp', width: null, height: null };
  if (bytes.length >= 12 && bytes.subarray(4, 12).toString('ascii').includes('ftypavif')) return { format: 'avif', mimeType: 'image/avif', width: null, height: null };
  return null;
}

async function validateCandidate(item, timeoutMs, diagnostics) {
  try {
    const response = await fetchTimed(item.url, { timeoutMs, accept: 'image/*,*/*;q=0.6', diagnostics });
    if (!response.ok) return null;
    const { bytes } = await readLimited(response, MAX_IMAGE_BYTES, { diagnostics, timeoutMs });
    let metadata = imageMetadata(bytes, response.headers.get('content-type'));
    if (metadata && ['webp', 'avif'].includes(metadata.format)) {
      const decoded = await sharp(bytes, { limitInputPixels: 64 * 1024 * 1024 }).metadata();
      metadata = { ...metadata, width: decoded.width ?? null, height: decoded.height ?? null };
    }
    if (!metadata || !bytes.length) return null;
    const width = metadata.width ?? item.declared?.width ?? item.discoveredWidth ?? null, height = metadata.height ?? item.declared?.height ?? item.discoveredHeight ?? null;
    const ratio = width && height ? width / height : null, squareish = ratio !== null && ratio >= 0.72 && ratio <= 1.4, scalable = metadata.format === 'svg', highResolution = scalable || Boolean(width && height && Math.min(width, height) >= 128);
    return { ...item, observed: { ...metadata, width, height, byte_hash: createHash('sha256').update(bytes).digest('hex') }, ...metadata, width, height, resolvedUrl: response.url, resolved_url: response.url, bytes: bytes.length, squareish, scalable, highResolution, provenance: { retrieved_at: new Date().toISOString(), http_status: response.status }, dataUrl: `data:${metadata.mimeType};base64,${bytes.toString('base64')}` };
  } catch { return null; }
}
async function mapConcurrent(items, concurrency, mapper) { const output = new Array(items.length); let cursor = 0; await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { while (cursor < items.length) { const index = cursor++; output[index] = await mapper(items[index], index); } })); return output; }

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

function dedupeBytes(items) {
  const deduped = new Map();
  for (const item of items) {
    const key = item.observed.byte_hash, prior = deduped.get(key);
    if (!prior) deduped.set(key, item);
    else { const stronger = (SOURCE_WEIGHT[item.source] ?? 0) > (SOURCE_WEIGHT[prior.source] ?? 0) ? item : prior; stronger.evidence = { ...stronger.evidence, duplicate_sources: [...new Set([...(prior.evidence?.duplicate_sources ?? []), prior.source, item.source])], duplicate_urls: [...new Set([...(prior.evidence?.duplicate_urls ?? []), prior.url, item.url])] }; deduped.set(key, stronger); }
  }
  return [...deduped.values()];
}

function fromBrowserCandidate(item, homepage, eligibleRoles = ['icon', 'wide']) {
  const proofs = Array.isArray(item.evidence) ? item.evidence : [item.evidence].filter(Boolean);
  const proof = proofs[0] ?? {};
  const semantic = [proof.alt, proof.ariaLabel, proof.title, proof.id, proof.className].filter(Boolean).join(' ');
  const uiControl = /(?:^|[-_\s])(hamburger|menu-toggle|toggle-menu|close|search|chevron|arrow|whatsapp|tasks?|translate|language-switcher|button-icon)(?:$|[-_\s])|(?:^|[-_\s])fa-(?:language|magnifying-glass|search|bars|xmark|close|chevron-(?:left|right|up|down)|arrow-(?:left|right|up|down)|whatsapp)(?:$|[-_\s])/i.test(semantic);
  const positive = /logo|brand|wordmark/i.test(semantic);
  if (uiControl || (!positive && !proof.homeLinked)) return null;
  const url = item.kind === 'inline-svg'
    ? `data:image/svg+xml;base64,${Buffer.from(item.inlineSvg).toString('base64')}`
    : resolveHttpUrl(item.url, homepage);
  if (!url) return null;
  return candidate(url, item.source, '', item.kind === 'inline-svg' ? 'image/svg+xml' : '', {
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
  });
}

export async function extractLogos(website, options = {}) {
  const startedAt = performance.now(), timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS, normalized = normalizeWebsite(website), network = { requests: 0, bytesDownloaded: 0 }, isBare = normalized.url.hostname.toLowerCase() === normalized.domain;
  const attempts = [...new Set([normalized.url.href, `https://${normalized.domain}/`, `http://${normalized.domain}/`, ...(isBare ? [`https://www.${normalized.domain}/`] : [])])];
  let homepage = null, html = '', htmlTruncated = false; const reachability = [];
  for (const attempt of attempts) {
    try { const response = await fetchTimed(attempt, { timeoutMs, accept: 'text/html,application/xhtml+xml', diagnostics: network }); if (!response.ok) { reachability.push({ url: attempt, ok: false, status: response.status }); continue; } homepage = response.url; const read = await readLimited(response, MAX_HTML_BYTES, { truncate: true, diagnostics: network }); html = read.bytes.toString('utf8'); htmlTruncated = read.truncated; reachability.push({ url: attempt, ok: true, status: response.status, finalUrl: response.url }); break; }
    catch (error) { reachability.push({ url: attempt, ok: false, error: error.name === 'AbortError' ? 'timeout' : error.message }); }
  }
  if (!homepage) throw new Error(`Could not reach the website. ${reachability.map(item => `${item.url}: ${item.error ?? `HTTP ${item.status}`}`).join(' | ')}`);
  const namecheapInterstitial = !/(?:^|\.)namecheap\.com$/i.test(normalized.domain) && /alt=["']Namecheap Logo["']/i.test(html);
  const vercelInterstitial = !/(?:^|\.)vercel\.com$/i.test(normalized.domain) && /Vercel Security Checkpoint/i.test(html);
  if (/sedoparking|domain (?:name )?is for sale|buy this domain|hugedomains|afternic|parking-page\.shtml/i.test(html) || namecheapInterstitial || vercelInterstitial) {
    throw new Error('Website appears parked or for sale.');
  }
  const parsed = parseHomepage(html, homepage, { companyName: options.companyName });
  const [manifest, besticon] = await Promise.all([Promise.all(parsed.manifests.slice(0, 2).map(url => manifestCandidates(url, timeoutMs, network))).then(groups => groups.flat()), besticonCandidates(normalized.domain, options.besticonUrl, timeoutMs, network)]);
  const root = new URL(homepage); root.pathname = '/favicon.ico'; root.search = ''; root.hash = ''; const rootPng = new URL(root); rootPng.pathname = '/favicon.png';
  const all = [...parsed.candidates, ...manifest, ...besticon, candidate(root.href, 'root-favicon', '', 'image/x-icon', { source_page: homepage }), candidate(rootPng.href, 'root-favicon', '', 'image/png', { source_page: homepage })];
  const rankedUnique = dedupeUrls(all)
    .sort((a, b) => discoveryPriority(b) - discoveryPriority(a) || declaredPixels(b) - declaredPixels(a));
  const budget = options.maxCandidates ?? MAX_CANDIDATES_TO_DOWNLOAD;
  const queueSelection = options.roleAwareBudget ? selectRoleAware(rankedUnique, budget) : null;
  const unique = queueSelection?.chosen ?? rankedUnique.slice(0, budget);
  const validatedRaw = (await mapConcurrent(unique, 6, item => validateCandidate(item, timeoutMs, network))).filter(Boolean);
  let validated = dedupeBytes(validatedRaw);
  const contentStats = { boxes: 0 };
  await attachContentBoxes(validated, options.contentBoundingWide, options.companyName, contentStats);
  let ranked = rankCandidates(validated, { companyName: options.companyName });

  const expandedPages = [];
  if (options.expandedPages > 0 && !ranked.selectedByRole.wide) {
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
        const extra = (await mapConcurrent(additions, 4, item => validateCandidate(item, timeoutMs, network))).filter(Boolean);
        validated = dedupeBytes([...validated, ...extra]);
        await attachContentBoxes(validated, options.contentBoundingWide, options.companyName, contentStats);
        ranked = rankCandidates(validated, { companyName: options.companyName });
        if (ranked.selectedByRole.wide) break;
      } catch { /* Secondary pages are a bounded fallback, never a fatal path. */ }
    }
  }

  let browserDiagnostics = null;
  if (options.browser && (!ranked.selectedByRole.icon || !ranked.selectedByRole.wide)) {
    const missingRoles = ['icon', 'wide'].filter(role => !ranked.selectedByRole[role]);
    const rendered = await discoverBrowserLogos({ url: homepage, domain: normalized.domain, company: options.companyName }, {
      browser: options.browserInstance,
      darkMode: true,
      timeoutMs: Math.min(12_000, timeoutMs),
      userAgent: options.userAgent,
    });
    browserDiagnostics = rendered.diagnostics;
    const known = new Set(validated.map(item => item.url));
    const browserItems = rendered.candidates.map(item => fromBrowserCandidate(item, homepage, missingRoles)).filter(item => item && !known.has(item.url))
      .sort((a, b) => discoveryPriority(b) - discoveryPriority(a)).slice(0, 8);
    const extra = (await mapConcurrent(browserItems, 4, item => validateCandidate(item, timeoutMs, network))).filter(Boolean);
    validated = dedupeBytes([...validated, ...extra]);
    await attachContentBoxes(validated, options.contentBoundingWide, options.companyName, contentStats);
    ranked = rankCandidates(validated, { companyName: options.companyName });
  }

  const totalRequests = network.requests + (browserDiagnostics?.requests ?? 0);
  const totalBytes = network.bytesDownloaded + (browserDiagnostics?.declaredTransferBytes ?? 0);
  return { input: website, domain: normalized.domain, homepage, selected: ranked.selected, selectedByRole: ranked.selectedByRole, candidates: ranked.candidates, diagnostics: { discovered: all.length, uniqueConsidered: unique.length, roleQueues: queueSelection ? { reserved: ROLE_QUEUE_CAPS, used: queueSelection.queueCounts } : null, contentBounding: { enabled: Boolean(options.contentBoundingWide), ...contentStats }, validated: ranked.candidates.length, duplicatesByHash: validatedRaw.length - dedupeBytes(validatedRaw).length, historicalSquareHighProxy: Boolean(ranked.selected?.squareish && ranked.selected?.highResolution), selectedWideProxy: Boolean(ranked.selectedByRole.wide && ranked.selectedByRole.wide.width / ranked.selectedByRole.wide.height >= 2.2), manifests: parsed.manifests.length, besticonEnabled: Boolean(options.besticonUrl), htmlTruncated, expandedPages, browserUsed: browserDiagnostics?.status === 'ok', browser: browserDiagnostics, staticRequests: network.requests, requests: totalRequests, bytesDownloaded: totalBytes, downloadedBytes: totalBytes, reachability, durationMs: Math.round(performance.now() - startedAt) } };
}

// The old internal helper represented icon-oriented ranking; retain that test/debug contract.
export const internals = {
  imageMetadata, parseAttributes, parseHomepage, readLimited, provisionalQueue,
  selectRoleAware, measureContentBox, attachContentBoxes, dedupeBytes,
  fromBrowserCandidate, discoveryPriority, validateCandidate,
  scoreCandidate: item => scoreCandidate(item).role_scores.icon,
};
