import { inflateRawSync } from 'node:zlib';
import { parseHomepage, resolveHttpUrl } from './discover-static.mjs';

const PAGE_LIMIT = 2;
const LINK_LIMIT_PER_PAGE = 12;
const ARCHIVE_FULL_LIMIT = 12 * 1024 * 1024;
const ARCHIVE_TAIL_LIMIT = 65_557;
const ARCHIVE_ENTRY_LIMIT = 512;
const ARCHIVE_MEMBER_COMPRESSED_LIMIT = 3 * 1024 * 1024;
const ARCHIVE_MEMBER_UNCOMPRESSED_LIMIT = 6 * 1024 * 1024;
const ARCHIVE_TOTAL_UNCOMPRESSED_LIMIT = 64 * 1024 * 1024;
const ARCHIVE_RANGE_TOTAL_LIMIT = 8 * 1024 * 1024;
const ARCHIVE_RATIO_LIMIT = 100;
const MEMBER_SELECTION_LIMIT = 8;
const IMAGE_PATH = /\.(?:svg|png|webp)(?:$|[?#])/i;
const ZIP_PATH = /\.zip(?:$|[?#])/i;
const STRONG_ROLE = /(?:^|[\s/_.-])(wordmark|lockup|horizontal|primary|full[-_\s]*logo|logo[-_\s]*(?:primary|horizontal))(?:$|[\s/_.-])/i;
const LOGO_TERM = /(?:^|[\s/_.-])(?:logo|wordmark|lockup)(?:$|[\s/_.-])/i;
const NEGATIVE = /__MACOSX|(?:^|\/)\._|badge|powered[-_\s]*by|screenshot|headshot|deprecated|legacy|(?:^|[\s/_.-])(?:icon|symbol|glyph|vertical|stacked|favicon|app[-_\s]*icon)(?:$|[\s/_.-])/i;
const PRODUCT = /(?:^|[\s/_.-])(?:copilot|claude|connect|checkout|terminal|atlas|slackbot|salesforce)(?:$|[\s/_.-])/i;
const ARCHIVE_NESTED = /\.(?:zip|tar|tgz|gz|7z|rar)$/i;

function words(value) {
  return String(value ?? '').toLowerCase().replace(/\b(?:inc|llc|ltd|corp|corporation|company|co|technologies|technology|tech|center)\b/g, ' ').match(/[a-z0-9]+/g) ?? [];
}

function companyAgreement(value, companyName) {
  const haystack = words(value).join('');
  return words(companyName).some(word => word.length >= 3 && haystack.includes(word));
}

function acronymAgreement(value, companyName) {
  const nameWords = String(companyName ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const meaningful = nameWords.filter(word => !['inc', 'llc', 'ltd', 'corp', 'corporation', 'company', 'technologies', 'technology', 'tech', 'center'].includes(word));
  const acronym = meaningful.map(word => word === 'and' ? 'n' : word[0]).join('');
  const escaped = acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return acronym.length >= 3 && new RegExp(`(?:^|[/_.-])${escaped}(?:[/_.-]|logo|wordmark|lockup)`, 'i').test(String(value ?? ''));
}

function relatedHost(a, b) {
  const clean = value => value.toLowerCase().replace(/^www\./, '');
  const left = clean(a), right = clean(b);
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function isDirectAsset(link) {
  return IMAGE_PATH.test(link.url) || ZIP_PATH.test(link.url);
}

function pagePriority(link) {
  const semantic = `${link.evidence?.anchor_text ?? ''} ${link.evidence?.aria_label ?? ''} ${link.evidence?.title ?? ''} ${link.evidence?.heading ?? ''} ${link.url}`;
  if (/^logos?$/i.test(link.evidence?.heading ?? '')) return 5;
  if (/press[-_\s]*kit|media[-_\s]*kit|brand[-_\s]*(?:asset|toolkit)|logo(?:s|[-_\s]*(?:kit|file|download))?/i.test(semantic)) return 4;
  if (/press|media|brand|newsroom/i.test(semantic)) return 3;
  if (/(?:^|[\/_-])news(?:$|[\/?#_-])/i.test(semantic)) return 2;
  if (/company|about/i.test(semantic)) return 1;
  return 0;
}

function assetLinkEligible(link) {
  const focused = `${link.evidence?.anchor_text ?? ''} ${link.evidence?.aria_label ?? ''} ${link.evidence?.title ?? ''} ${link.evidence?.heading ?? ''} ${link.url}`;
  if (/headshot|screenshot|badge|network[-_\s]*map|product[-_\s]*screen/i.test(focused)) return false;
  return /logo|wordmark|lockup|brand|press[-_\s]*kit/i.test(focused);
}

function provenance(chain, link, kind) {
  return [...chain, { kind, url: link.url, source_page: link.source_page, context: link.evidence?.semantic_text ?? '' }];
}

function memberTheme(path) {
  if (/(?:^|[-_\s.])(?:white|ivory|light|reverse|reversed)(?:$|[-_\s.])/i.test(path)) return 'dark';
  if (/(?:^|[-_\s.])(?:black|slate|dark)(?:$|[-_\s.])/i.test(path)) return 'light';
  if (/(?:^|[-_\s.])(?:color|colour|blurple|primary)(?:$|[-_\s.])/i.test(path)) return 'color';
  return 'unknown';
}

export function scoreArchiveMember(path, companyName, archiveContext = '') {
  const normalized = decodeURIComponent(path).replace(/\\/g, '/');
  let score = 0;
  if (/\.svg$/i.test(normalized)) score += 30;
  else if (/\.png$/i.test(normalized)) score += 18;
  else if (/\.webp$/i.test(normalized)) score += 12;
  else return -Infinity;
  if (STRONG_ROLE.test(normalized)) score += 45;
  else if (LOGO_TERM.test(normalized)) score += 18;
  if (companyAgreement(normalized, companyName)) score += 35;
  if (/brand|press|media|logo/i.test(archiveContext)) score += 8;
  if (NEGATIVE.test(normalized)) score -= 80;
  const product = normalized.match(/(?:^|[\s/_.-])(copilot|claude|connect|checkout|terminal|atlas|slackbot|salesforce)(?:$|[\s/_.-])/i)?.[1]?.toLowerCase();
  if (product && !words(companyName).includes(product)) score -= 100;
  return score;
}

function safeName(name) {
  const normalized = name.replace(/\\/g, '/');
  if (!normalized || normalized.length > 512 || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) return false;
  const parts = normalized.replace(/\/$/, '').split('/');
  return parts.length <= 12 && !parts.some(part => !part || part === '.' || part === '..' || part.includes('\0'));
}

export function parseZipCentralDirectory(bytes, { archiveSize = bytes.length, offsetBase = 0 } = {}) {
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - ARCHIVE_TAIL_LIMIT); index--) {
    if (bytes.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0 || eocd + 22 > bytes.length) throw new Error('Malformed ZIP: EOCD not found.');
  const disk = bytes.readUInt16LE(eocd + 4), cdDisk = bytes.readUInt16LE(eocd + 6);
  const diskEntries = bytes.readUInt16LE(eocd + 8), entryCount = bytes.readUInt16LE(eocd + 10);
  const cdSize = bytes.readUInt32LE(eocd + 12), cdOffset = bytes.readUInt32LE(eocd + 16);
  const commentLength = bytes.readUInt16LE(eocd + 20);
  if (disk || cdDisk || diskEntries !== entryCount) throw new Error('Unsupported multi-disk ZIP.');
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported.');
  if (entryCount > ARCHIVE_ENTRY_LIMIT || eocd + 22 + commentLength > bytes.length) throw new Error('ZIP exceeds structural limits.');
  if (cdOffset + cdSize > archiveSize) throw new Error('Malformed ZIP central directory bounds.');
  const localCdOffset = cdOffset - offsetBase;
  if (localCdOffset < 0 || localCdOffset + cdSize > bytes.length) return { entryCount, cdOffset, cdSize, entries: null };
  const entries = [];
  let cursor = localCdOffset;
  while (cursor < localCdOffset + cdSize) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Malformed ZIP central directory entry.');
    const flags = bytes.readUInt16LE(cursor + 8), compression = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20), uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
    const externalAttributes = bytes.readUInt32LE(cursor + 38), localOffset = bytes.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + comment;
    if (end > bytes.length || !nameLength) throw new Error('Malformed ZIP entry lengths.');
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString(flags & 0x800 ? 'utf8' : 'latin1');
    if (!safeName(name)) throw new Error('Unsafe ZIP member path.');
    if (flags & 1) throw new Error('Encrypted ZIP entries are not supported.');
    if (![0, 8].includes(compression)) throw new Error('Unsupported ZIP compression.');
    if (ARCHIVE_NESTED.test(name)) throw new Error('Nested archives are not supported.');
    if ((externalAttributes >>> 16 & 0xf000) === 0xa000) throw new Error('ZIP symlinks are not supported.');
    const eligibleSize = compressedSize <= ARCHIVE_MEMBER_COMPRESSED_LIMIT && uncompressedSize <= ARCHIVE_MEMBER_UNCOMPRESSED_LIMIT && uncompressedSize / Math.max(1, compressedSize) <= ARCHIVE_RATIO_LIMIT;
    entries.push({ name, flags, compression, compressedSize, uncompressedSize, localOffset, eligibleSize });
    cursor = end;
  }
  if (entries.length !== entryCount) throw new Error('ZIP entry count mismatch.');
  return { entryCount, cdOffset, cdSize, entries };
}

export function extractZipMember(bytes, entry, { offsetBase = 0 } = {}) {
  const cursor = entry.localOffset - offsetBase;
  if (cursor < 0 || cursor + 30 > bytes.length || bytes.readUInt32LE(cursor) !== 0x04034b50) throw new Error('Malformed ZIP local header.');
  const flags = bytes.readUInt16LE(cursor + 6), compression = bytes.readUInt16LE(cursor + 8);
  const localCompressedSize = bytes.readUInt32LE(cursor + 18), localUncompressedSize = bytes.readUInt32LE(cursor + 22);
  const nameLength = bytes.readUInt16LE(cursor + 26), extraLength = bytes.readUInt16LE(cursor + 28);
  const localName = bytes.subarray(cursor + 30, cursor + 30 + nameLength).toString(flags & 0x800 ? 'utf8' : 'latin1');
  if ((flags & 9) !== (entry.flags & 9) || compression !== entry.compression || localName !== entry.name ||
    !(flags & 8) && (localCompressedSize !== entry.compressedSize || localUncompressedSize !== entry.uncompressedSize)) throw new Error('ZIP local header conflicts with central directory.');
  const dataStart = cursor + 30 + nameLength + extraLength, dataEnd = dataStart + entry.compressedSize;
  if (dataStart < cursor || dataEnd > bytes.length) throw new Error('Truncated ZIP member.');
  const compressed = bytes.subarray(dataStart, dataEnd);
  const output = compression === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: ARCHIVE_MEMBER_UNCOMPRESSED_LIMIT });
  if (output.length !== entry.uncompressedSize) throw new Error('ZIP member size mismatch.');
  return output;
}

async function range(fetchResource, url, header, maxBytes, validator = null) {
  const response = await fetchResource(url, { headers: { range: header, 'accept-encoding': 'identity', ...(validator ? { 'if-range': validator } : {}) }, maxBytes });
  return response;
}

function contentRange(value) {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(String(value ?? ''));
  return match ? { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) } : null;
}

export async function inspectRemoteZip(url, { fetchResource, companyName, context = '', chain = [] }) {
  let rangedBytes = 0;
  const fetchRange = async (header, maxBytes, validator = null) => {
    const response = await range(fetchResource, url, header, maxBytes, validator);
    rangedBytes += response.bytes.length;
    if (rangedBytes > ARCHIVE_RANGE_TOTAL_LIMIT) throw new Error('ZIP range-byte budget exceeded.');
    return response;
  };
  const tail = await fetchRange(`bytes=-${ARCHIVE_TAIL_LIMIT}`, ARCHIVE_FULL_LIMIT);
  const validator = tail.headers.get('etag') ?? tail.headers.get('last-modified');
  let full = null, archiveSize, directory;
  if (tail.status === 200) {
    if (tail.bytes.length > ARCHIVE_FULL_LIMIT) throw new Error('ZIP full-download fallback exceeds cap.');
    full = tail.bytes; archiveSize = full.length;
    directory = parseZipCentralDirectory(full);
  } else {
    const cr = tail.status === 206 ? contentRange(tail.headers.get('content-range')) : null;
    if (!cr || cr.end !== cr.total - 1 || cr.end - cr.start + 1 !== tail.bytes.length) throw new Error('Invalid ZIP range response.');
    archiveSize = cr.total;
    directory = parseZipCentralDirectory(tail.bytes, { archiveSize, offsetBase: cr.start });
    if (!directory.entries) {
      const cd = await fetchRange(`bytes=${directory.cdOffset}-${directory.cdOffset + directory.cdSize - 1}`, directory.cdSize, validator);
      const cdRange = cd.status === 206 ? contentRange(cd.headers.get('content-range')) : null;
      if (!cdRange || cdRange.start !== directory.cdOffset || cdRange.end - cdRange.start + 1 !== cd.bytes.length) throw new Error('Invalid ZIP central-directory range.');
      const synthetic = Buffer.concat([cd.bytes, tail.bytes]);
      directory = parseZipCentralDirectory(synthetic, { archiveSize, offsetBase: directory.cdOffset });
    }
  }
  const selected = directory.entries.filter(entry => entry.eligibleSize).map(entry => ({ entry, score: scoreArchiveMember(entry.name, companyName, context) }))
    .filter(item => item.score >= 40).sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name)).slice(0, MEMBER_SELECTION_LIMIT);
  if (selected.reduce((sum, item) => sum + item.entry.uncompressedSize, 0) > ARCHIVE_TOTAL_UNCOMPRESSED_LIMIT) throw new Error('Selected ZIP expansion total exceeds limit.');
  const output = [];
  for (const { entry, score } of selected) {
    let bytes;
    if (full) bytes = extractZipMember(full, entry);
    else {
      const end = Math.min(archiveSize - 1, entry.localOffset + 30 + Buffer.byteLength(entry.name) + 4096 + entry.compressedSize - 1);
      const member = await fetchRange(`bytes=${entry.localOffset}-${end}`, Math.min(ARCHIVE_MEMBER_COMPRESSED_LIMIT + 8192, end - entry.localOffset + 1), validator);
      const cr = member.status === 206 ? contentRange(member.headers.get('content-range')) : null;
      if (!cr || cr.start !== entry.localOffset) throw new Error('Invalid ZIP member range.');
      bytes = extractZipMember(member.bytes, entry, { offsetBase: entry.localOffset });
    }
    output.push({
      url: `zip+${url}#${encodeURIComponent(entry.name)}`, source: 'official-archive', rawBytes: bytes,
      source_page: chain.at(-1)?.url ?? null,
      evidence: { eligible_roles: ['wide'], archive_member: entry.name, archive_score: score, semantic_text: `${context} ${entry.name}`, positive_token: true, deep_official: true, theme: memberTheme(entry.name) },
      provenance_chain: [...chain, { kind: 'archive-member', url, member: entry.name }],
    });
  }
  return { candidates: output, diagnostics: { archive_url: url, archive_size: archiveSize, entries: directory.entryCount, selected_members: output.map(item => item.evidence.archive_member), range_used: !full } };
}

export function scanEntryBundle(text, { scriptUrl, homepage, companyName }) {
  const sameOrigin = new URL(scriptUrl).origin === new URL(homepage).origin;
  if (!sameOrigin || text.length > 2_200_000) return [];
  const matches = new Set();
  for (const match of text.matchAll(/["'`](?!data:)([^"'`\s]{1,240}\.(?:svg|png|webp)(?:\?[^"'`\s]*)?)["'`]/gi)) {
    const path = match[1];
    if (!LOGO_TERM.test(path) || NEGATIVE.test(path) || /customer|partner|client|sponsor/i.test(path) ||
      !companyAgreement(path, companyName) && !acronymAgreement(path, companyName)) continue;
    const url = resolveHttpUrl(path, scriptUrl);
    if (url && new URL(url).origin === new URL(homepage).origin) matches.add(url);
  }
  return [...matches].slice(0, 4).map(url => ({
    url, source: 'spa-bundle', source_page: scriptUrl,
    evidence: { eligible_roles: ['wide'], positive_token: true, semantic_text: new URL(url).pathname, spa_bundle_entry: true, same_origin: true, strong_logo_filename: true, spa_identity_agreement: true, company_name: companyName, theme: memberTheme(new URL(url).pathname) },
    provenance_chain: [{ kind: 'homepage', url: homepage }, { kind: 'entry-script', url: scriptUrl }, { kind: 'asset-literal', url }],
  }));
}

export async function discoverSpaBundleAssets({ homepage, parsed, companyName, fetchResource }) {
  const shell = parsed.candidates.filter(item => !['html-icon', 'apple', 'mask-icon', 'ms-tile', 'social-banner'].includes(item.source)).length === 0;
  if (!shell) return { candidates: [], diagnostics: { attempted: false, reason: 'not-shell' } };
  const scripts = parsed.entryScripts.filter(url => new URL(url).origin === new URL(homepage).origin)
    .sort((a, b) => Number(!/(?:^|\/)main[-.][^/]+\.m?js(?:[?#]|$)/i.test(a)) - Number(!/(?:^|\/)main[-.][^/]+\.m?js(?:[?#]|$)/i.test(b))).slice(0, 1);
  const candidates = [];
  let bytes = 0;
  const errors = [];
  for (const scriptUrl of scripts) {
    try {
      const response = await fetchResource(scriptUrl, { maxBytes: 2_200_000, accept: 'text/javascript,application/javascript' });
      if (!response.ok) continue;
      bytes += response.bytes.length;
      candidates.push(...scanEntryBundle(response.bytes.toString('utf8'), { scriptUrl: response.url, homepage, companyName: `${companyName} ${parsed.pageTitle ?? ''}` }));
    } catch (error) { errors.push(error.message); }
  }
  return { candidates, diagnostics: { attempted: scripts.length > 0, scripts: scripts.length, bytes, discovered: candidates.length, errors } };
}

export async function discoverOfficialBrandAssets({ homepage, parsed, companyName, fetchResource, maxPages = PAGE_LIMIT }) {
  const originHost = new URL(homepage).hostname;
  const queue = parsed.highIntentLinks.filter(link => {
    const url = new URL(link.url);
    return url.href !== homepage && !(url.origin === new URL(homepage).origin && url.pathname === new URL(homepage).pathname && url.hash);
  }).sort((a, b) => pagePriority(b) - pagePriority(a)).map(link => ({ link, depth: 1, chain: [{ kind: 'homepage', url: homepage }] }));
  const visited = new Set(), direct = [], archives = [], pages = [], candidates = [];
  while (queue.length && pages.length < Math.min(PAGE_LIMIT, maxPages) && !candidates.length) {
    const current = queue.shift();
    if (visited.has(current.link.url)) continue;
    visited.add(current.link.url);
    if (isDirectAsset(current.link)) { if (assetLinkEligible(current.link)) direct.push({ link: current.link, chain: current.chain }); continue; }
    const target = new URL(current.link.url);
    const officialPage = relatedHost(target.hostname, originHost);
    const explicitExternalGallery = current.depth <= 2 && (/(?:brand|press|media|logo)[^]{0,80}(?:download|kit|asset|gallery)|download[^]{0,80}(?:brand|press|media|logo)/i.test(current.link.evidence?.semantic_text ?? '') ||
      /^logos?$/i.test(current.link.evidence?.heading ?? '') && companyAgreement(current.link.evidence?.semantic_text, companyName));
    if (!officialPage && !explicitExternalGallery) continue;
    try {
      const chain = provenance(current.chain, current.link, officialPage ? 'official-page' : 'explicit-asset-gallery');
      const response = await fetchResource(current.link.url, { maxBytes: 2 * 1024 * 1024, accept: 'text/html,application/xhtml+xml,application/zip;q=0.9', detectArchive: true });
      if (!response.ok) continue;
      if (/(?:application|multipart)\/(?:zip|x-zip-compressed)/i.test(response.headers.get('content-type') ?? '')) {
        const archiveChain = [...chain, { kind: 'archive-redirect', url: response.url }];
        try {
          const inspected = await inspectRemoteZip(response.url, { fetchResource, companyName, context: current.link.evidence?.semantic_text, chain: archiveChain });
          candidates.push(...inspected.candidates); archives.push(inspected.diagnostics);
        } catch (error) { archives.push({ archive_url: response.url, error: error.message }); }
        continue;
      }
      if (!/html/i.test(response.headers.get('content-type') ?? '')) continue;
      const page = parseHomepage(response.bytes.toString('utf8'), response.url, { companyName, collectDeepLinks: true });
      pages.push(response.url);
      const pageLinks = [...page.highIntentLinks].sort((a, b) => Number(isDirectAsset(b)) - Number(isDirectAsset(a)) || pagePriority(b) - pagePriority(a));
      for (const link of pageLinks.slice(0, LINK_LIMIT_PER_PAGE)) {
        if (isDirectAsset(link)) { if (assetLinkEligible(link)) direct.push({ link, chain }); }
        else if (current.depth < 2) queue.push({ link, depth: current.depth + 1, chain });
      }
      queue.sort((a, b) => pagePriority(b.link) - pagePriority(a.link) || b.depth - a.depth);
    } catch { /* Deep discovery is opt-in and non-fatal. */ }
  }
  for (const item of direct.slice(0, 8)) {
    const chain = provenance(item.chain, item.link, ZIP_PATH.test(item.link.url) ? 'archive' : 'direct-asset');
    if (ZIP_PATH.test(item.link.url)) {
      try {
        const inspected = await inspectRemoteZip(item.link.url, { fetchResource, companyName, context: item.link.evidence?.semantic_text, chain });
        candidates.push(...inspected.candidates); archives.push(inspected.diagnostics);
      } catch (error) { archives.push({ archive_url: item.link.url, error: error.message }); }
    } else if (IMAGE_PATH.test(item.link.url)) {
      candidates.push({ url: item.link.url, source: 'official-direct', source_page: item.link.source_page, evidence: { eligible_roles: ['wide'], positive_token: true, semantic_text: item.link.evidence?.semantic_text, deep_official: true }, provenance_chain: chain });
    }
  }
  return { candidates, diagnostics: { pages, direct_links: direct.length, archives } };
}

export const limits = { ARCHIVE_FULL_LIMIT, ARCHIVE_ENTRY_LIMIT, ARCHIVE_MEMBER_COMPRESSED_LIMIT, ARCHIVE_MEMBER_UNCOMPRESSED_LIMIT, ARCHIVE_RATIO_LIMIT, ARCHIVE_RANGE_TOTAL_LIMIT };
