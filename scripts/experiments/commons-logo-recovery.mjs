#!/usr/bin/env node
// Direct Wikimedia Commons file-title recovery for brand-library logo gaps.
// This intentionally bypasses Wikidata P154 and homepage crawling.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
};
const root = resolve(option('--root') ?? 'brand-library/v2');
const runId = option('--run') ?? 'commons-logo-recovery';
const outputPath = resolve(root, option('--output') ?? 'commons-logo-recovery-candidates.json');
const selectionConfigPath = option('--selection-config');
const planOnly = args.includes('--plan-only');
const limit = Number(option('--limit') ?? Infinity);
const cachePath = resolve(root, 'runs', runId, 'commons-file-search-cache.json');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
};
const sleep = ms => new Promise(done => setTimeout(done, ms));
const normalized = value => String(value ?? '').toLowerCase().normalize('NFKD')
  .replace(/[’'&]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const compact = value => normalized(value).replace(/\s+/g, '');
const ignoredTokens = new Set(['the', 'and', 'company', 'corporation', 'corp', 'inc', 'limited', 'ltd', 'plc', 'group', 'holdings']);

async function fetchJson(url) {
  let response;
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await fetch(url, {
      headers: { 'user-agent': 'LogoYoinkBrandLibrary/1.0 (direct Commons file-title recovery)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok || ![429, 500, 502, 503, 504].includes(response.status)) break;
    await response.body?.cancel();
    await sleep(1000 * (attempt + 1));
  }
  if (!response?.ok) throw new Error(`Commons API HTTP ${response?.status ?? 'network'}`);
  return response.json();
}

function agreement(title, brand) {
  const titleCompact = compact(title.replace(/^File:/i, '').replace(/\.[^.]+$/, ''));
  const names = [brand.name, brand.id.replaceAll('-', ' '), ...(brand.aliases ?? [])].filter(Boolean);
  if (names.some(name => compact(name).length >= 3 && titleCompact.includes(compact(name)))) return true;
  const tokens = normalized(brand.name).split(' ').filter(token => token.length >= 2 && !ignoredTokens.has(token));
  return tokens.length > 0 && tokens.every(token => titleCompact.includes(token));
}

function scoreCandidate(candidate, brand) {
  const title = candidate.title;
  const ratio = candidate.width && candidate.height ? candidate.width / candidate.height : 0;
  let score = agreement(title, brand) ? 50 : -100;
  if (/wordmark/i.test(title)) score += 30;
  if (/logo|logotype/i.test(title)) score += 15;
  if (candidate.mime === 'image/svg+xml') score += 18;
  else if (/image\/(png|webp)/.test(candidate.mime ?? '')) score += 8;
  if (ratio >= 2) score += 22;
  else if (ratio >= 1.35) score += 14;
  else if (ratio >= 0.8) score += 4;
  else score -= 20;
  if (/\b(icon|symbol|favicon|app[ _-]?icon|seal|emblem|monogram)\b/i.test(title)) score -= 55;
  if (/\b(old|former|obsolete|legacy|historic|history|construction|store|building|headquarters|screenshot|photo|advert|sponsor|foundation)\b/i.test(title)) score -= 45;
  if (/\b(19\d{2}|200\d|201[0-6])\b/.test(title)) score -= 18;
  return score;
}

async function searchBrand(brand) {
  const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
  const queryName = brand.name.replaceAll('"', '');
  const params = {
    action: 'query', format: 'json', formatversion: '2', generator: 'search',
    gsrnamespace: '6', gsrlimit: '8', gsrsearch: `intitle:"${queryName}" (logo OR wordmark)`,
    prop: 'imageinfo', iiprop: 'url|size|mime|mediatype|extmetadata',
  };
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(key, value);
  const json = await fetchJson(endpoint);
  return (json.query?.pages ?? []).flatMap(page => {
    const info = page.imageinfo?.[0];
    if (!info?.url || !String(info.mime).startsWith('image/')) return [];
    const candidate = {
      title: page.title,
      url: info.url,
      descriptionUrl: info.descriptionurl,
      width: info.width,
      height: info.height,
      bytes: info.size,
      mime: info.mime,
      mediatype: info.mediatype,
      artist: info.extmetadata?.Artist?.value ?? null,
      credit: info.extmetadata?.Credit?.value ?? null,
      license: info.extmetadata?.LicenseShortName?.value ?? null,
    };
    candidate.identityAgreement = agreement(candidate.title, brand);
    candidate.score = scoreCandidate(candidate, brand);
    return [candidate];
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

const manifest = await readJson(resolve(root, 'manifest.json'));
const brands = manifest.brands.filter(brand => brand.assets?.icon && !brand.assets?.logo).slice(0, limit);
let cache = {};
try { cache = await readJson(cachePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (planOnly) {
  if (!selectionConfigPath) throw new Error('--plan-only requires --selection-config.');
  const config = await readJson(resolve(selectionConfigPath));
  const chosen = config.selections.map(selection => {
    const candidate = cache[selection.brandId]?.candidates?.find(item => item.title === selection.title);
    if (!candidate) throw new Error(`Selected Commons file is not cached: ${selection.brandId} / ${selection.title}`);
    return { selection, candidate };
  });
  const thumbnails = new Map();
  for (let start = 0; start < chosen.length; start += 40) {
    const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
    const params = {
      action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo',
      titles: chosen.slice(start, start + 40).map(item => item.candidate.title).join('|'),
      iiprop: 'url|size|mime', iiurlwidth: '1600',
    };
    for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(key, value);
    const json = await fetchJson(endpoint);
    for (const page of json.query?.pages ?? []) {
      const info = page.imageinfo?.[0];
      if (info?.thumburl) thumbnails.set(page.title, info.thumburl);
    }
    await sleep(750);
  }
  const selected = chosen.map(({ selection, candidate }) => {
    const sourceUrl = thumbnails.get(candidate.title) ?? candidate.url;
    return {
      brandId: selection.brandId,
      sourceUrl,
      originalSourceUrl: candidate.url,
      external: true,
      source: 'wikimedia-commons-file-search',
      discoveryPage: candidate.descriptionUrl,
      commonsTitle: candidate.title,
      ...(selection.theme ? { theme: selection.theme } : {}),
      representation: selection.representation ?? (candidate.width / candidate.height < 2.5 ? 'compact_wordmark' : 'wordmark_or_lockup'),
    };
  });
  await writeJson(outputPath, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    method: 'Hand-selected direct Wikimedia Commons file-title/imageinfo recovery candidates.',
    stagingPlan: { records: selected },
  });
  console.log(JSON.stringify({ output: outputPath, selectedForVisualReview: selected.length }, null, 2));
  process.exit(0);
}
const records = [];
for (let start = 0; start < brands.length; start += 5) {
  const batch = brands.slice(start, start + 5);
  const fetched = await Promise.all(batch.map(async brand => {
    try {
      if (!cache[brand.id]) return { brand, value: { checkedAt: new Date().toISOString(), candidates: await searchBrand(brand) } };
      return { brand, value: cache[brand.id] };
    } catch (error) {
      return { brand, error: error.message };
    }
  }));
  for (const item of fetched) {
    if (item.value) cache[item.brand.id] = item.value;
    const candidates = item.value?.candidates ?? [];
    const plausible = candidates.filter(candidate => candidate.identityAgreement && candidate.score >= 72).slice(0, 3);
    records.push({ brandId: item.brand.id, name: item.brand.name, domain: item.brand.domain, ...(item.error ? { error: item.error } : {}), candidates, plausible });
  }
  await writeJson(cachePath, cache);
  await sleep(325);
  const completed = Math.min(start + batch.length, brands.length);
  if (completed % 25 === 0 || completed === brands.length) {
    process.stdout.write(`${completed}/${brands.length} searched; ${records.filter(record => record.plausible.length).length} brands with plausible files\n`);
  }
}
let selectedCandidates;
if (selectionConfigPath) {
  const config = await readJson(resolve(selectionConfigPath));
  selectedCandidates = config.selections.map(selection => {
    const record = records.find(item => item.brandId === selection.brandId);
    const candidate = record?.candidates.find(item => item.title === selection.title);
    if (!candidate) throw new Error(`Selected Commons file not found: ${selection.brandId} / ${selection.title}`);
    return { record, candidate, selection };
  });
} else {
  selectedCandidates = records.flatMap(record => record.plausible[0] ? [{ record, candidate: record.plausible[0], selection: {} }] : []);
}
const selected = selectedCandidates.map(({ record, candidate, selection }) => ({
  brandId: record.brandId,
  sourceUrl: candidate.url,
  external: true,
  source: 'wikimedia-commons-file-search',
  discoveryPage: candidate.descriptionUrl,
  commonsTitle: candidate.title,
  ...(selection.theme ? { theme: selection.theme } : {}),
  representation: selection.representation ?? (candidate.width / candidate.height < 2.5 ? 'compact_wordmark' : 'wordmark_or_lockup'),
}));
await writeJson(outputPath, {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method: 'Direct Wikimedia Commons file-title search with imageinfo; independent of Wikidata P154.',
  searchedBrands: brands.length,
  brandsWithPlausibleFiles: records.filter(record => record.plausible.length).length,
  selectedForVisualReview: selected.length,
  records,
  stagingPlan: { records: selected },
});
console.log(JSON.stringify({ output: outputPath, searchedBrands: brands.length, brandsWithPlausibleFiles: records.filter(record => record.plausible.length).length, selectedForVisualReview: selected.length }, null, 2));
