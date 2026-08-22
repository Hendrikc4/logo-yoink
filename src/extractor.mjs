import { isIP } from 'node:net';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_CANDIDATES_TO_DOWNLOAD = 30;

const SOURCE_WEIGHT = {
  schema: 28,
  manifest: 24,
  apple: 22,
  'html-icon': 18,
  besticon: 14,
  'root-favicon': 6,
};

export function normalizeWebsite(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Enter a company website.');
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) {
    throw new Error('Only HTTP and HTTPS websites are supported.');
  }
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS websites are supported.');
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || isPrivateIp(hostname)) {
    throw new Error('Local and private-network addresses are not supported.');
  }
  return { url, domain: hostname.replace(/^www\./, '') };
}

function isPrivateIp(hostname) {
  if (!isIP(hostname)) return false;
  if (hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')) return true;
  const parts = hostname.split('.').map(Number);
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

async function fetchTimed(url, { timeoutMs, accept = '*/*' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept,
        'user-agent': 'Mozilla/5.0 (compatible; LogoYoink/0.1; +https://github.com/Hendrikc4/logo-yoink)',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes.`);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response exceeds ${maxBytes} bytes.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function parseAttributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return result;
}

function resolveHttpUrl(value, base) {
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function declaredPixels(candidate) {
  if (/svg/i.test(`${candidate.type ?? ''} ${candidate.url}`)) return 1e12;
  if (String(candidate.sizes).toLowerCase() === 'any') return 1e11;
  return Math.max(0, ...[...String(candidate.sizes ?? '').matchAll(/(\d+)x(\d+)/gi)].map(match => Number(match[1]) * Number(match[2])));
}

function parseHomepage(html, base) {
  const candidates = [];
  const manifests = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const rel = String(attributes.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const url = resolveHttpUrl(attributes.href, base);
    if (!url) continue;
    if (rel.includes('manifest')) manifests.push(url);
    if (rel.some(token => token.startsWith('apple-touch-icon'))) {
      candidates.push(candidate(url, 'apple', attributes.sizes, attributes.type));
    } else if (rel.includes('icon') || rel.includes('shortcut')) {
      candidates.push(candidate(url, 'html-icon', attributes.sizes, attributes.type));
    }
  }

  function collectSchemaLogo(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) collectSchemaLogo(child);
      return;
    }
    const types = (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).filter(Boolean);
    if (types.some(type => /(Organization|Corporation|Business|Brand|NGO)$/i.test(String(type))) && node.logo) {
      for (const value of Array.isArray(node.logo) ? node.logo : [node.logo]) {
        const raw = typeof value === 'string' ? value : value?.contentUrl ?? value?.url;
        const url = resolveHttpUrl(raw, base);
        if (url) candidates.push(candidate(url, 'schema'));
      }
    }
    for (const value of Object.values(node)) collectSchemaLogo(value);
  }

  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectSchemaLogo(JSON.parse(match[1].trim())); } catch { /* Ignore malformed publisher markup. */ }
  }
  return { candidates, manifests: [...new Set(manifests)] };
}

function candidate(url, source, sizes = '', type = '') {
  return { url, source, sizes: String(sizes ?? ''), type: String(type ?? '') };
}

async function manifestCandidates(url, timeoutMs) {
  try {
    const response = await fetchTimed(url, { timeoutMs, accept: 'application/manifest+json,application/json' });
    if (!response.ok) return [];
    const bytes = await readLimited(response, 512 * 1024);
    const manifest = JSON.parse(bytes.toString('utf8'));
    return (Array.isArray(manifest.icons) ? manifest.icons : []).flatMap(icon => {
      const resolved = resolveHttpUrl(icon?.src, response.url);
      return resolved ? [candidate(resolved, 'manifest', icon.sizes, icon.type)] : [];
    });
  } catch {
    return [];
  }
}

async function besticonCandidates(domain, endpoint, timeoutMs) {
  if (!endpoint) return [];
  try {
    const url = new URL('/allicons.json', endpoint);
    url.searchParams.set('url', domain);
    url.searchParams.set('formats', 'png,ico,gif,jpg,svg');
    const response = await fetchTimed(url, { timeoutMs, accept: 'application/json' });
    if (!response.ok) return [];
    const payload = JSON.parse((await readLimited(response, 1024 * 1024)).toString('utf8'));
    return (Array.isArray(payload.icons) ? payload.icons : []).flatMap(icon =>
      !icon?.error && icon?.url ? [{ ...candidate(icon.url, 'besticon', `${icon.width ?? 0}x${icon.height ?? 0}`, `image/${icon.format ?? ''}`), discoveredWidth: icon.width, discoveredHeight: icon.height }] : []);
  } catch {
    return [];
  }
}

function imageMetadata(bytes, contentType) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { format: 'png', mimeType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 10 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) {
    let width = 0, height = 0;
    for (let index = 0, count = bytes.readUInt16LE(4); index < count && 21 + index * 16 < bytes.length; index++) {
      width = Math.max(width, bytes[6 + index * 16] || 256);
      height = Math.max(height, bytes[7 + index * 16] || 256);
    }
    return { format: 'ico', mimeType: 'image/x-icon', width, height };
  }
  if (bytes.length >= 10 && bytes.subarray(0, 3).toString('ascii') === 'GIF') {
    return { format: 'gif', mimeType: 'image/gif', width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { format: 'jpg', mimeType: 'image/jpeg', width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      if (length < 2) break;
      offset += length + 2;
    }
  }
  const prefix = bytes.subarray(0, Math.min(bytes.length, 16_384)).toString('utf8');
  if (type.includes('svg') || /<svg\b/i.test(prefix)) {
    const attributes = parseAttributes(prefix.match(/<svg\b[^>]*>/i)?.[0] ?? '');
    const viewBox = String(attributes.viewbox ?? '').split(/[\s,]+/).map(Number);
    const width = Number.parseFloat(attributes.width) || (viewBox.length === 4 ? viewBox[2] : null);
    const height = Number.parseFloat(attributes.height) || (viewBox.length === 4 ? viewBox[3] : null);
    return { format: 'svg', mimeType: 'image/svg+xml', width: width || null, height: height || null };
  }
  if (type.includes('webp') || (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')) {
    return { format: 'webp', mimeType: 'image/webp', width: null, height: null };
  }
  if (type.includes('avif')) return { format: 'avif', mimeType: 'image/avif', width: null, height: null };
  return null;
}

async function validateCandidate(item, timeoutMs) {
  try {
    const response = await fetchTimed(item.url, { timeoutMs, accept: 'image/*,*/*;q=0.6' });
    if (!response.ok) return null;
    const bytes = await readLimited(response, MAX_IMAGE_BYTES);
    const metadata = imageMetadata(bytes, response.headers.get('content-type'));
    if (!metadata || !bytes.length) return null;
    const width = metadata.width ?? item.discoveredWidth ?? null;
    const height = metadata.height ?? item.discoveredHeight ?? null;
    const ratio = width && height ? width / height : null;
    const squareish = ratio !== null && ratio >= 0.75 && ratio <= 1.33;
    const scalable = metadata.format === 'svg';
    const highResolution = scalable || Boolean(width && height && Math.min(width, height) >= 128);
    const scored = { ...item, ...metadata, width, height, resolvedUrl: response.url, bytes: bytes.length, squareish, scalable, highResolution };
    return { ...scored, score: scoreCandidate(scored), dataUrl: `data:${metadata.mimeType};base64,${bytes.toString('base64')}` };
  } catch {
    return null;
  }
}

function scoreCandidate(item) {
  let score = SOURCE_WEIGHT[item.source] ?? 0;
  if (item.squareish) score += 40;
  else if (item.width && item.height) score -= Math.abs(Math.log2(item.width / item.height)) * 12;
  if (item.highResolution) score += 22;
  if (item.scalable) score += 10;
  if (item.width && item.height) {
    const edge = Math.min(item.width, item.height);
    score += Math.min(14, Math.log2(Math.max(1, edge)) * 1.5);
    if (edge < 48) score -= 18;
  }
  return Math.round(score * 10) / 10;
}

async function mapConcurrent(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  }));
  return output;
}

export async function extractLogos(website, options = {}) {
  const startedAt = performance.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const normalized = normalizeWebsite(website);
  const attempts = [...new Set([normalized.url.href, `https://${normalized.domain}/`, `http://${normalized.domain}/`])];
  let homepage = null;
  let html = '';
  const attemptErrors = [];
  for (const attempt of attempts) {
    try {
      const response = await fetchTimed(attempt, { timeoutMs, accept: 'text/html,application/xhtml+xml' });
      if (!response.ok) { attemptErrors.push(`${attempt}: HTTP ${response.status}`); continue; }
      homepage = response.url;
      html = (await readLimited(response, MAX_HTML_BYTES)).toString('utf8');
      break;
    } catch (error) {
      attemptErrors.push(`${attempt}: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
    }
  }
  if (!homepage) throw new Error(`Could not reach the website. ${attemptErrors.join(' | ')}`);

  const parsed = parseHomepage(html, homepage);
  const [manifest, besticon] = await Promise.all([
    Promise.all(parsed.manifests.slice(0, 2).map(url => manifestCandidates(url, timeoutMs))).then(groups => groups.flat()),
    besticonCandidates(normalized.domain, options.besticonUrl, timeoutMs),
  ]);
  const root = new URL(homepage);
  root.pathname = '/favicon.ico'; root.search = ''; root.hash = '';
  const rootPng = new URL(root); rootPng.pathname = '/favicon.png';
  const all = [...parsed.candidates, ...manifest, ...besticon,
    candidate(root.href, 'root-favicon', '', 'image/x-icon'), candidate(rootPng.href, 'root-favicon', '', 'image/png')];
  const unique = [...new Map(all.map(item => [item.url, item])).values()]
    .sort((a, b) => (SOURCE_WEIGHT[b.source] ?? 0) - (SOURCE_WEIGHT[a.source] ?? 0) || declaredPixels(b) - declaredPixels(a))
    .slice(0, MAX_CANDIDATES_TO_DOWNLOAD);
  const validated = (await mapConcurrent(unique, 6, item => validateCandidate(item, timeoutMs)))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.bytes - a.bytes);

  return {
    input: website,
    domain: normalized.domain,
    homepage,
    selected: validated[0] ?? null,
    candidates: validated,
    diagnostics: {
      discovered: all.length,
      uniqueConsidered: unique.length,
      validated: validated.length,
      manifests: parsed.manifests.length,
      besticonEnabled: Boolean(options.besticonUrl),
      durationMs: Math.round(performance.now() - startedAt),
    },
  };
}

export const internals = { imageMetadata, parseAttributes, parseHomepage, scoreCandidate };
