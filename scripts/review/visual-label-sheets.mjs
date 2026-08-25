#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { CANDIDATE_SHEET_REVIEW_VERSION, normalizeLabelRecord, validateCanonicalLabel } from '../../benchmark/lib/labels.mjs';
import { captureAbstention, isPacketLabelableCapture } from '../../benchmark/lib/content-eligibility.mjs';

const execFileAsync = promisify(execFile);

export const ROLES = ['icon', 'wide', 'favicon', 'stacked'];
export const THEMES = ['light', 'dark'];
const DEFAULT_MAX_CANDIDATES = 24;
const DEFAULT_MAX_ENTITIES = 4;
const HARD_MAX_CANDIDATES = 24;
const HARD_MAX_ENTITIES = 4;
const PACKET_SCHEMA = 'visual-label-sheets-v3';
const REVIEW_PROTOCOL = CANDIDATE_SHEET_REVIEW_VERSION;
const COLUMNS = 3;
const TILE_WIDTH = 560;
const TILE_HEIGHT = 244;
const GAP = 16;
const PAGE_PADDING = 32;
const HEADER_HEIGHT = 104;
const ENTITY_HEADER_HEIGHT = 58;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;

function help() {
  return `Batched visual candidate labeling

Build numbered PNG sheets:
  node scripts/review/visual-label-sheets.mjs build --run runs/<capture> [options]

Validate compact AI responses and expand them to candidate JSONL:
  node scripts/review/visual-label-sheets.mjs validate --packet <packet-dir> --labels <file-or-dir>
    --reviewer ID --review-pass ID [--output candidate-labels.jsonl]

Build options:
  --output DIR             Default: <run>/label-sheets-v3
  --max-candidates N       Target maximum candidates per sheet (default: 24)
  --max-entities N         Maximum companies per sheet (default: 4)
  --seed TEXT              Stable blind ordering seed (default: visual-label-v3)
  --overwrite              Explicitly replace an existing packet/output

Validate options:
  --reviewer ID            Required reviewer identity stamped on every label
  --review-pass ID         Required review pass stamped on every label
  --reviewer-kind KIND     Default: ai
  --help

All candidates for a company stay together unless that company alone exceeds
--max-candidates. Candidate score, predicted role, and ranking are not shown.`;
}

export function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { command: '', help: true };
  const [command = '', ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const raw = rest[index];
    if (!raw.startsWith('--')) throw new Error(`Unexpected argument: ${raw}`);
    const [rawKey, inline] = raw.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (rawKey === 'help' || rawKey === 'overwrite') { options[key] = inline === undefined ? true : inline !== 'false'; continue; }
    const value = inline ?? rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${rawKey}`);
    options[key] = value;
    if (inline === undefined) index += 1;
  }
  for (const key of ['maxCandidates', 'maxEntities']) {
    if (options[key] === undefined) continue;
    options[key] = Number(options[key]);
    const maximum = key === 'maxCandidates' ? HARD_MAX_CANDIDATES : HARD_MAX_ENTITIES;
    if (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > maximum) throw new Error(`--${key.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)} must be an integer from 1 to ${maximum}`);
  }
  return options;
}

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function bounded(value, length) {
  const text = String(value ?? '');
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

async function readJsonl(path) {
  if (!existsSync(path)) return [];
  return (await readFile(path, 'utf8')).split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; }
    catch (error) { throw new Error(`${path}:${index + 1}: ${error.message}`); }
  });
}

function stableOrder(seed, value) {
  return createHash('sha256').update(`${seed}\0${value}`).digest('hex');
}

function assetKey(candidate) {
  const hash = candidate.content_hash ?? candidate.contentHash;
  const path = assetPath(candidate);
  return hash ? `hash:${hash}` : path ? `path:${path}` : `candidate:${candidateId(candidate)}`;
}

function assetPath(candidate) {
  return candidate.preview_path ?? candidate.previewPath ?? candidate.asset_path ?? candidate.assetPath ?? '';
}

function entityId(record) {
  return String(record.entity_id ?? record.entityId ?? record.id ?? '');
}

function candidateId(record) {
  return String(record.candidate_id ?? record.candidateId ?? record.id ?? '');
}

export function prepareEntities(entities, candidates, { seed = 'visual-label-v3' } = {}) {
  const byEntity = new Map();
  const seenCandidateIds = new Set();
  for (const candidate of [...candidates].sort((a, b) => candidateId(a).localeCompare(candidateId(b)))) {
    const id = entityId(candidate);
    const idCandidate = candidateId(candidate);
    if (!id || !idCandidate) throw new Error('Every captured candidate requires entity_id and candidate_id');
    if (seenCandidateIds.has(idCandidate)) throw new Error(`Duplicate candidate_id ${idCandidate}`);
    seenCandidateIds.add(idCandidate);
    if (!byEntity.has(id)) byEntity.set(id, []);
    byEntity.get(id).push(candidate);
  }

  const known = new Map();
  for (const entity of entities) {
    const id = entityId(entity);
    if (!id) continue;
    if (known.has(id) && JSON.stringify(known.get(id)) !== JSON.stringify(entity)) throw new Error(`Conflicting entity records for ${id}`);
    known.set(id, entity);
  }
  for (const id of byEntity.keys()) if (!known.has(id)) known.set(id, { entity_id: id, name: id, website: '' });

  return [...known.values()].map(entity => {
    const id = entityId(entity);
    const uniqueByAsset = new Map();
    for (const candidate of byEntity.get(id) ?? []) {
      const key = assetKey(candidate);
      if (!key) continue;
      if (!uniqueByAsset.has(key)) uniqueByAsset.set(key, { ...candidate, candidate_ids: [] });
      uniqueByAsset.get(key).candidate_ids.push(candidateId(candidate));
    }
    const unique = [...uniqueByAsset.values()].map(candidate => ({
      ...candidate,
      candidate_ids: [...new Set(candidate.candidate_ids)].sort(),
    })).sort((a, b) => stableOrder(seed, `${id}\0${a.candidate_ids.join(',')}`).localeCompare(stableOrder(seed, `${id}\0${b.candidate_ids.join(',')}`)) || candidateId(a).localeCompare(candidateId(b)));
    return {
      entity_id: id,
      name: entity.name ?? entity.company_name ?? entity.company ?? id,
      website: entity.website ?? entity.requested_website ?? entity.url ?? '',
      candidates: unique,
    };
  }).filter(entity => entity.candidates.length > 0)
    .sort((a, b) => stableOrder(seed, a.entity_id).localeCompare(stableOrder(seed, b.entity_id)) || a.entity_id.localeCompare(b.entity_id));
}

export function packEntities(entities, { maxCandidates = DEFAULT_MAX_CANDIDATES, maxEntities = DEFAULT_MAX_ENTITIES } = {}) {
  const sheets = [];
  let current = [];
  let count = 0;
  const flush = () => {
    if (!current.length) return;
    sheets.push(current);
    current = [];
    count = 0;
  };
  for (const sourceEntity of entities) {
    const chunkCount = Math.ceil(sourceEntity.candidates.length / maxCandidates);
    const entityChunks = Array.from({ length: chunkCount }, (_, index) => ({
      ...sourceEntity,
      chunk_index: index + 1,
      chunk_count: chunkCount,
      candidates: sourceEntity.candidates.slice(index * maxCandidates, (index + 1) * maxCandidates),
    }));
    if (chunkCount > 1) {
      flush();
      for (const chunk of entityChunks) sheets.push([chunk]);
      continue;
    }
    const entity = entityChunks[0];
    const size = entity.candidates.length;
    if (current.length && (count + size > maxCandidates || current.length >= maxEntities)) flush();
    current.push(entity);
    count += size;
    if (count >= maxCandidates || current.length >= maxEntities) flush();
  }
  flush();
  return sheets;
}

function safeLocalAsset(runDirectory, relativePath) {
  if (!relativePath) return null;
  const absolute = resolve(runDirectory, relativePath);
  const root = `${resolve(runDirectory)}${sep}`;
  return absolute.startsWith(root) && existsSync(absolute) ? absolute : null;
}

async function renderCandidate(asset, width, height, background) {
  try {
    const bytes = await readFile(asset);
    if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error('asset too large');
    let input = bytes;
    if (/\.ico$/i.test(asset)) {
      const converted = await execFileAsync('ffmpeg', ['-v', 'error', '-i', asset, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 });
      input = converted.stdout;
    }
    const image = sharp(input, { density: 180, limitInputPixels: 40_000_000, animated: false, failOn: 'error' })
      .resize({ width: width - 28, height: height - 24, fit: 'contain', withoutEnlargement: false });
    const rendered = await image.png().toBuffer();
    return sharp({ create: { width, height, channels: 4, background } })
      .composite([{ input: rendered, gravity: 'center' }]).png().toBuffer();
  } catch {
    const text = `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="${background}"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="16" fill="#8b929c">preview unavailable</text></svg>`;
    return sharp(Buffer.from(text)).png().toBuffer();
  }
}

function textSvg(width, height, markup, background = 'transparent') {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${background}"/>${markup}</svg>`);
}

async function tileBuffer(candidate, number, runDirectory) {
  const previewWidth = TILE_WIDTH - 24;
  const half = Math.floor(previewWidth / 2);
  const previewHeight = 154;
  const asset = safeLocalAsset(runDirectory, assetPath(candidate));
  const [light, dark] = asset
    ? await Promise.all([renderCandidate(asset, half, previewHeight, '#ffffff'), renderCandidate(asset, previewWidth - half, previewHeight, '#161a20')])
    : await Promise.all([renderCandidate('', half, previewHeight, '#ffffff'), renderCandidate('', previewWidth - half, previewHeight, '#161a20')]);
  const format = String(candidate.format ?? extname(assetPath(candidate)).slice(1) ?? '?').toUpperCase();
  const dimensions = candidate.width && candidate.height ? `${candidate.width}×${candidate.height}` : 'dimensions unknown';
  const header = textSvg(previewWidth, 48, `
    <rect x="0" y="0" width="70" height="48" rx="8" fill="#caff3d"/>
    <text x="35" y="31" text-anchor="middle" font-family="ui-monospace,monospace" font-size="24" font-weight="700" fill="#0c1116">#${String(number).padStart(2, '0')}</text>
    <text x="84" y="29" font-family="ui-sans-serif,sans-serif" font-size="15" fill="#59616b">${escapeXml(format)} · ${escapeXml(dimensions)}</text>`);
  const labels = textSvg(previewWidth, 22, `
    <text x="8" y="16" font-family="ui-monospace,monospace" font-size="11" fill="#727b86">LIGHT</text>
    <text x="${half + 8}" y="16" font-family="ui-monospace,monospace" font-size="11" fill="#aab2bd">DARK</text>`);
  return sharp({ create: { width: TILE_WIDTH, height: TILE_HEIGHT, channels: 4, background: '#eef1f4' } })
    .composite([
      { input: header, left: 12, top: 10 },
      { input: light, left: 12, top: 58 },
      { input: dark, left: 12 + half, top: 58 },
      { input: labels, left: 12, top: 216 },
    ]).png().toBuffer();
}

function promptText() {
  return `# Batched logo labeling prompt

Review each numbered candidate in the supplied sheet. The company name and domain above each group are the identity to match. A candidate can have more than one role.

Return exactly one JSON object and no prose:

\`\`\`json
{
  "sheet_id": "sheet-0001",
  "packet_fingerprint": "sha256:...",
  "reviewed": true,
  "logos": [
    { "n": 1, "roles": ["wide"], "works_on": ["light", "dark"] }
  ],
  "best": {
    "icon": [],
    "wide": [1],
    "favicon": [],
    "stacked": []
  },
  "uncertain": []
}
\`\`\`

Rules:

- Put only real logos of the named company in \`logos\`. Omitted numbers are treated as negatives after \`reviewed\` is true.
- Copy \`sheet_id\` and \`packet_fingerprint\` exactly from the response template. They bind the review to this mapping and PNG.
- \`icon\`: standalone symbol/mark. \`wide\`: wordmark or horizontal symbol+wordmark. \`favicon\`: a good tiny browser icon. \`stacked\`: vertically stacked lockup.
- \`works_on\` says where the candidate remains clearly visible in the LIGHT/DARK previews. Use one or both values.
- In each \`best\` role list, select at most one number per company across all of that company's sheets. Use only a number already given that role in \`logos\`.
- Put genuinely ambiguous numbers in \`uncertain\`; do not also put them in \`logos\`.
- Judge the image, not its filename, source, or current rank. Those signals are intentionally hidden.`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function mappingPayload(entities) {
  return { entities: entities.map(entity => ({
    group: entity.group,
    entity_id: entity.entity_id,
    name: entity.name,
    website: entity.website,
    chunk_index: entity.chunk_index,
    chunk_count: entity.chunk_count,
    candidates: entity.candidates.map(candidate => ({
      n: candidate.n,
      candidate_id: candidate.candidate_id,
      candidate_ids: candidate.candidate_ids,
      content_hash: candidate.content_hash,
      asset_path: candidate.asset_path,
    })),
  })) };
}

function fingerprintFor(sheetId, mappingSha256, imageSha256) {
  return `sha256:${sha256(JSON.stringify({ schema_version: PACKET_SCHEMA, sheet_id: sheetId, mapping_sha256: mappingSha256, image_sha256: imageSha256 }))}`;
}

async function renderSheet(groups, sheetIndex, runDirectory, outputDirectory) {
  let nextNumber = 1;
  const numberedGroups = groups.map((entity, index) => ({
    ...entity,
    group: String.fromCharCode(65 + index),
    candidates: entity.candidates.map(candidate => ({ ...candidate, n: nextNumber++ })),
  }));
  const mappedEntities = numberedGroups.map(entity => ({
    group: entity.group,
    entity_id: entity.entity_id,
    name: entity.name,
    website: entity.website,
    chunk_index: entity.chunk_index,
    chunk_count: entity.chunk_count,
    candidates: entity.candidates.map(candidate => ({
      n: candidate.n,
      candidate_id: candidateId(candidate),
      candidate_ids: candidate.candidate_ids ?? [candidateId(candidate)],
      content_hash: candidate.content_hash ?? candidate.contentHash ?? null,
      asset_path: assetPath(candidate),
    })),
  }));
  const mappingSha256 = sha256(JSON.stringify(mappingPayload(mappedEntities)));
  const sheetId = `sheet-${String(sheetIndex + 1).padStart(4, '0')}-${mappingSha256.slice(0, 8)}`;
  const rows = numberedGroups.reduce((total, entity) => total + Math.ceil(entity.candidates.length / COLUMNS), 0);
  const height = PAGE_PADDING * 2 + HEADER_HEIGHT + numberedGroups.length * ENTITY_HEADER_HEIGHT + rows * TILE_HEIGHT + Math.max(0, rows - numberedGroups.length) * GAP + Math.max(0, numberedGroups.length - 1) * GAP;
  const width = PAGE_PADDING * 2 + COLUMNS * TILE_WIDTH + (COLUMNS - 1) * GAP;
  const canvas = sharp({ create: { width, height, channels: 4, background: '#0b0f14' } });
  const composites = [];
  composites.push({ input: textSvg(width - PAGE_PADDING * 2, HEADER_HEIGHT, `
    <text x="0" y="38" font-family="ui-sans-serif,sans-serif" font-size="30" font-weight="700" fill="#f8fafc">Logo candidates · ${sheetId}</text>
    <text x="0" y="70" font-family="ui-sans-serif,sans-serif" font-size="16" fill="#9da7b3">Return the numbered candidates that are real company logos. Rank signals are hidden.</text>`, 'transparent'), left: PAGE_PADDING, top: PAGE_PADDING });

  let y = PAGE_PADDING + HEADER_HEIGHT;
  for (const entity of numberedGroups) {
    const header = textSvg(width - PAGE_PADDING * 2, ENTITY_HEADER_HEIGHT, `
      <rect x="0" y="6" width="38" height="38" rx="8" fill="#caff3d"/>
      <text x="19" y="33" text-anchor="middle" font-family="ui-monospace,monospace" font-size="22" font-weight="700" fill="#0b0f14">${entity.group}</text>
      <text x="52" y="27" font-family="ui-sans-serif,sans-serif" font-size="22" font-weight="700" fill="#f8fafc">${escapeXml(bounded(`${entity.name}${entity.chunk_count > 1 ? ` · part ${entity.chunk_index}/${entity.chunk_count}` : ''}`, 58))}</text>
      <text x="52" y="48" font-family="ui-monospace,monospace" font-size="13" fill="#9da7b3">${escapeXml(bounded(entity.website, 72))}</text>`, 'transparent');
    composites.push({ input: header, left: PAGE_PADDING, top: y });
    y += ENTITY_HEADER_HEIGHT;
    for (let index = 0; index < entity.candidates.length; index += 1) {
      const row = Math.floor(index / COLUMNS);
      const column = index % COLUMNS;
      composites.push({
        input: await tileBuffer(entity.candidates[index], entity.candidates[index].n, runDirectory),
        left: PAGE_PADDING + column * (TILE_WIDTH + GAP),
        top: y + row * (TILE_HEIGHT + GAP),
      });
    }
    y += Math.ceil(entity.candidates.length / COLUMNS) * (TILE_HEIGHT + GAP) - GAP + GAP;
  }
  const filename = `${sheetId}.png`;
  const imageBytes = await canvas.composite(composites).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(join(outputDirectory, 'sheets', filename), imageBytes);
  const imageSha256 = sha256(imageBytes);
  return {
    sheet_id: sheetId,
    image: `sheets/${filename}`,
    mapping_sha256: mappingSha256,
    image_sha256: imageSha256,
    packet_fingerprint: fingerprintFor(sheetId, mappingSha256, imageSha256),
    entities: mappedEntities,
  };
}

async function replaceDirectoryAtomically(temporary, output, overwrite) {
  if (!existsSync(output)) { await rename(temporary, output); return; }
  if (!overwrite) throw new Error(`Refusing to overwrite existing packet: ${output}; pass --overwrite explicitly`);
  const backup = `${output}.backup-${process.pid}-${Date.now()}`;
  await rename(output, backup);
  try {
    await rename(temporary, output);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(output) && existsSync(backup)) await rename(backup, output);
    throw error;
  }
}

function captureKeyFor(candidates, run) {
  const keys = [...new Set(candidates.map(candidate => candidate.provenance?.capture_version).filter(Boolean).map(String))];
  return keys.length === 1 ? keys[0] : basename(run);
}

export async function buildLabelSheets({ runDirectory, outputDirectory, maxCandidates = DEFAULT_MAX_CANDIDATES, maxEntities = DEFAULT_MAX_ENTITIES, seed = 'visual-label-v3', overwrite = false }) {
  const run = resolve(runDirectory);
  const output = resolve(outputDirectory ?? join(run, 'label-sheets-v3'));
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > HARD_MAX_CANDIDATES) throw new Error(`maxCandidates must be from 1 to ${HARD_MAX_CANDIDATES}`);
  if (!Number.isInteger(maxEntities) || maxEntities < 1 || maxEntities > HARD_MAX_ENTITIES) throw new Error(`maxEntities must be from 1 to ${HARD_MAX_ENTITIES}`);
  const [entities, candidates, captures] = await Promise.all([readJsonl(join(run, 'entities.jsonl')), readJsonl(join(run, 'candidates.jsonl')), readJsonl(join(run, 'captures.jsonl'))]);
  if (!entities.length) throw new Error(`No entities found in ${join(run, 'entities.jsonl')}`);
  if (!candidates.length) throw new Error(`No candidates found in ${join(run, 'candidates.jsonl')}`);
  const captureByEntity = new Map(captures.map(capture => [entityId(capture), capture]));
  const excludedByEntity = new Map();
  const labelableCandidates = candidates.filter(candidate => {
    const capture = captureByEntity.get(entityId(candidate));
    if (isPacketLabelableCapture(capture)) return true;
    const list = excludedByEntity.get(entityId(candidate)) ?? [];
    list.push(candidate);
    excludedByEntity.set(entityId(candidate), list);
    return false;
  });
  const abstentions = [...excludedByEntity].map(([id, excluded]) => {
    const capture = captureByEntity.get(id);
    return { entity_id: id, identity_status: capture?.identity_status ?? null, reachability: capture?.reachability ?? null, excluded_candidate_count: excluded.length, reason: captureAbstention(capture) };
  }).sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  const prepared = prepareEntities(entities, labelableCandidates, { seed });
  const packed = packEntities(prepared, { maxCandidates, maxEntities });
  await mkdir(dirname(output), { recursive: true });
  const temporary = await mkdtemp(`${output}.tmp-`);
  try {
    await mkdir(join(temporary, 'sheets'));
    const sheets = [];
    for (let index = 0; index < packed.length; index += 1) sheets.push(await renderSheet(packed[index], index, run, temporary));
    const allCandidateIds = sheets.flatMap(sheet => sheet.entities.flatMap(entity => entity.candidates.flatMap(candidate => candidate.candidate_ids)));
    const packetIndex = {
      schema_version: PACKET_SCHEMA,
      review_protocol: REVIEW_PROTOCOL,
      run_key: basename(run),
      capture_key: captureKeyFor(labelableCandidates, run),
      seed,
      max_candidates_per_sheet: maxCandidates,
      max_entities_per_sheet: maxEntities,
      sheet_count: sheets.length,
      entity_count: prepared.length,
      visual_candidate_count: sheets.flatMap(sheet => sheet.entities.flatMap(entity => entity.candidates)).length,
      candidate_count: allCandidateIds.length,
      candidate_ids_sha256: sha256([...allCandidateIds].sort().join('\n')),
      abstentions,
      sheets,
    };
    await writeFile(join(temporary, 'index.json'), `${JSON.stringify(packetIndex, null, 2)}\n`);
    await writeFile(join(temporary, 'sheets.jsonl'), `${sheets.map(sheet => JSON.stringify(sheet)).join('\n')}\n`);
    await writeFile(join(temporary, 'prompt.md'), `${promptText()}\n`);
    await writeFile(join(temporary, 'responses-template.jsonl'), `${sheets.map(sheet => JSON.stringify({ sheet_id: sheet.sheet_id, packet_fingerprint: sheet.packet_fingerprint, reviewed: false, logos: [], best: Object.fromEntries(ROLES.map(role => [role, []])), uncertain: [] })).join('\n')}\n`);
    await replaceDirectoryAtomically(temporary, output, overwrite);
    return packetIndex;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function assertIntegerList(value, field) {
  if (!Array.isArray(value) || value.some(number => !Number.isInteger(number) || number < 1) || new Set(value).size !== value.length) throw new Error(`${field} must be a deduplicated array of positive integers`);
}

export function validateResponse(response, sheet) {
  const context = response?.sheet_id ?? 'unknown sheet';
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('response must be an object');
  if (response.sheet_id !== sheet.sheet_id) throw new Error(`${context}: sheet_id does not match packet`);
  if (response.packet_fingerprint !== sheet.packet_fingerprint) throw new Error(`${context}: packet_fingerprint does not match the frozen mapping and image`);
  if (response.reviewed !== true) throw new Error(`${context}: reviewed must be true before omissions can become negatives`);
  const allowedKeys = new Set(['sheet_id', 'packet_fingerprint', 'reviewed', 'logos', 'best', 'uncertain']);
  if (Object.keys(response).some(key => !allowedKeys.has(key))) throw new Error(`${context}: unexpected response field`);
  if (!Array.isArray(response.logos)) throw new Error(`${context}: logos must be an array`);
  assertIntegerList(response.uncertain, `${context}.uncertain`);
  const candidates = sheet.entities.flatMap(entity => entity.candidates.map(candidate => ({ ...candidate, entity_id: entity.entity_id })));
  const byNumber = new Map(candidates.map(candidate => [candidate.n, candidate]));
  const positives = new Map();
  for (const logo of response.logos) {
    if (!logo || typeof logo !== 'object' || Array.isArray(logo)) throw new Error(`${context}: every logos entry must be an object`);
    if (Object.keys(logo).some(key => !['n', 'roles', 'works_on'].includes(key))) throw new Error(`${context}: unexpected logo field`);
    if (!byNumber.has(logo.n)) throw new Error(`${context}: unknown candidate number ${logo.n}`);
    if (positives.has(logo.n)) throw new Error(`${context}: duplicate logo number ${logo.n}`);
    if (!Array.isArray(logo.roles) || !logo.roles.length || logo.roles.some(role => !ROLES.includes(role)) || new Set(logo.roles).size !== logo.roles.length) throw new Error(`${context}: candidate ${logo.n} has invalid roles`);
    if (!Array.isArray(logo.works_on) || !logo.works_on.length || logo.works_on.some(theme => !THEMES.includes(theme)) || new Set(logo.works_on).size !== logo.works_on.length) throw new Error(`${context}: candidate ${logo.n} has invalid works_on`);
    positives.set(logo.n, logo);
  }
  for (const number of response.uncertain) {
    if (!byNumber.has(number)) throw new Error(`${context}: unknown uncertain number ${number}`);
    if (positives.has(number)) throw new Error(`${context}: candidate ${number} cannot be positive and uncertain`);
  }
  if (!response.best || typeof response.best !== 'object' || Array.isArray(response.best) || Object.keys(response.best).sort().join(',') !== [...ROLES].sort().join(',')) throw new Error(`${context}: best must contain exactly ${ROLES.join(', ')}`);
  const bestByNumber = new Map();
  for (const role of ROLES) {
    assertIntegerList(response.best[role], `${context}.best.${role}`);
    const usedEntities = new Set();
    for (const number of response.best[role]) {
      const candidate = byNumber.get(number);
      const positive = positives.get(number);
      if (!candidate || !positive?.roles.includes(role)) throw new Error(`${context}: best ${role} candidate ${number} is not a positive with that role`);
      if (usedEntities.has(candidate.entity_id)) throw new Error(`${context}: best.${role} selects more than one candidate for ${candidate.entity_id}`);
      usedEntities.add(candidate.entity_id);
      if (!bestByNumber.has(number)) bestByNumber.set(number, []);
      bestByNumber.get(number).push(role);
    }
  }
  return candidates.flatMap(candidate => {
    const positive = positives.get(candidate.n);
    const uncertain = response.uncertain.includes(candidate.n);
    const values = {
      sheet_id: sheet.sheet_id,
      sheet_number: candidate.n,
      entity_id: candidate.entity_id,
      identity: uncertain ? 'ambiguous' : positive ? 'correct' : 'wrong',
      roles: positive ? [...positive.roles] : [],
      works_on: positive ? [...positive.works_on] : [],
      best_for_role: bestByNumber.get(candidate.n) ?? [],
    };
    return (candidate.candidate_ids ?? [candidate.candidate_id]).map(id => ({ ...values, candidate_id: id }));
  });
}

async function labelFiles(path) {
  const absolute = resolve(path);
  const info = await stat(absolute);
  if (info.isFile()) return [absolute];
  return (await readdir(absolute, { withFileTypes: true })).filter(entry => entry.isFile() && /\.(json|jsonl)$/i.test(entry.name)).map(entry => join(absolute, entry.name)).sort();
}

function confinedPacketPath(packet, value, context) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error(`${context} must be a relative packet path`);
  const absolute = resolve(packet, value);
  const rel = relative(packet, absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new Error(`${context} escapes packet directory`);
  return absolute;
}

export async function validatePacket(packetDirectory) {
  const packet = resolve(packetDirectory);
  const index = JSON.parse(await readFile(join(packet, 'index.json'), 'utf8'));
  if (index.schema_version !== PACKET_SCHEMA || index.review_protocol !== REVIEW_PROTOCOL) throw new Error(`Unsupported packet schema; expected ${PACKET_SCHEMA}`);
  if (![index.run_key, index.capture_key, index.seed].every(value => typeof value === 'string' && value)) throw new Error('Packet run, capture, and seed identities are required');
  if (!Array.isArray(index.sheets) || index.sheet_count !== index.sheets.length) throw new Error('Packet sheet_count invariant failed');
  if (!Number.isInteger(index.max_candidates_per_sheet) || index.max_candidates_per_sheet < 1 || index.max_candidates_per_sheet > HARD_MAX_CANDIDATES) throw new Error('Packet has an unreadable max_candidates_per_sheet');
  if (!Number.isInteger(index.max_entities_per_sheet) || index.max_entities_per_sheet < 1 || index.max_entities_per_sheet > HARD_MAX_ENTITIES) throw new Error('Packet has an invalid max_entities_per_sheet');
  const sheetIds = new Set();
  const imagePaths = new Set();
  const candidateIds = new Set();
  const entityIds = new Set();
  const chunkState = new Map();
  let visualCount = 0;
  for (const [sheetIndex, sheet] of index.sheets.entries()) {
    if (!sheet || typeof sheet !== 'object' || sheetIds.has(sheet.sheet_id)) throw new Error(`Duplicate or invalid sheet_id ${sheet?.sheet_id}`);
    sheetIds.add(sheet.sheet_id);
    if (!Array.isArray(sheet.entities) || !sheet.entities.length || sheet.entities.length > index.max_entities_per_sheet) throw new Error(`${sheet.sheet_id}: invalid entity count`);
    const candidates = sheet.entities.flatMap(entity => entity.candidates ?? []);
    if (!candidates.length || candidates.length > index.max_candidates_per_sheet) throw new Error(`${sheet.sheet_id}: invalid candidate tile count`);
    const numbers = candidates.map(candidate => candidate.n);
    if (numbers.some((number, position) => number !== position + 1)) throw new Error(`${sheet.sheet_id}: candidate numbers must be contiguous and ordered`);
    for (const [entityIndex, entity] of sheet.entities.entries()) {
      if (!entity.entity_id || !Number.isInteger(entity.chunk_index) || !Number.isInteger(entity.chunk_count) || entity.chunk_index < 1 || entity.chunk_index > entity.chunk_count) throw new Error(`${sheet.sheet_id}: invalid entity chunk metadata`);
      if (entity.group !== String.fromCharCode(65 + entityIndex)) throw new Error(`${sheet.sheet_id}: entity groups must be contiguous and ordered`);
      entityIds.add(entity.entity_id);
      const state = chunkState.get(entity.entity_id) ?? { count: entity.chunk_count, indices: new Set(), name: entity.name, website: entity.website };
      if (state.count !== entity.chunk_count || state.name !== entity.name || state.website !== entity.website || state.indices.has(entity.chunk_index)) throw new Error(`${entity.entity_id}: inconsistent or duplicate chunks`);
      state.indices.add(entity.chunk_index);
      chunkState.set(entity.entity_id, state);
      for (const candidate of entity.candidates ?? []) {
        visualCount += 1;
        if (typeof candidate.candidate_id !== 'string' || !candidate.candidate_id || !Array.isArray(candidate.candidate_ids) || !candidate.candidate_ids.length || candidate.candidate_ids.some(id => typeof id !== 'string' || !id) || JSON.stringify(candidate.candidate_ids) !== JSON.stringify([...new Set(candidate.candidate_ids)].sort())) throw new Error(`${sheet.sheet_id} #${candidate.n}: candidate_ids must be non-empty, unique, and sorted`);
        if (!candidate.candidate_ids.includes(candidate.candidate_id)) throw new Error(`${sheet.sheet_id} #${candidate.n}: representative candidate_id is not an alias`);
        for (const id of candidate.candidate_ids) {
          if (candidateIds.has(id)) throw new Error(`Candidate ${id} occurs more than once in packet mappings`);
          candidateIds.add(id);
        }
      }
    }
    const actualMapping = sha256(JSON.stringify(mappingPayload(sheet.entities)));
    if (actualMapping !== sheet.mapping_sha256) throw new Error(`${sheet.sheet_id}: mapping_sha256 mismatch`);
    const expectedSheetId = `sheet-${String(sheetIndex + 1).padStart(4, '0')}-${actualMapping.slice(0, 8)}`;
    if (sheet.sheet_id !== expectedSheetId) throw new Error(`${sheet.sheet_id}: sheet_id is not derived from its ordered mapping`);
    const imagePath = confinedPacketPath(packet, sheet.image, `${sheet.sheet_id}.image`);
    if (imagePaths.has(imagePath)) throw new Error(`${sheet.sheet_id}: duplicate image path`);
    imagePaths.add(imagePath);
    const imageBytes = await readFile(imagePath);
    const actualImage = sha256(imageBytes);
    if (actualImage !== sheet.image_sha256) throw new Error(`${sheet.sheet_id}: image_sha256 mismatch`);
    if (sheet.packet_fingerprint !== fingerprintFor(sheet.sheet_id, actualMapping, actualImage)) throw new Error(`${sheet.sheet_id}: packet_fingerprint mismatch`);
  }
  for (const [id, state] of chunkState) if (state.indices.size !== state.count || [...Array(state.count)].some((_, index) => !state.indices.has(index + 1))) throw new Error(`${id}: packet is missing one or more company chunks`);
  if (index.entity_count !== entityIds.size || index.visual_candidate_count !== visualCount || index.candidate_count !== candidateIds.size) throw new Error('Packet count invariant failed');
  if (index.candidate_ids_sha256 !== sha256([...candidateIds].sort().join('\n'))) throw new Error('Packet candidate completeness digest mismatch');
  const manifestSheets = await readJsonl(join(packet, 'sheets.jsonl'));
  if (JSON.stringify(manifestSheets) !== JSON.stringify(index.sheets)) throw new Error('sheets.jsonl does not exactly match index.json');
  return index;
}

async function atomicWrite(path, contents, overwrite) {
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path) && !overwrite) throw new Error(`Refusing to overwrite existing label output: ${path}; pass --overwrite explicitly`);
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  try {
    await writeFile(temporary, contents, { flag: 'wx' });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function validateLabelResponses({ packetDirectory, labelsPath, outputPath, reviewerId, reviewPass, reviewerKind = 'ai', overwrite = false }) {
  if (typeof reviewerId !== 'string' || !reviewerId.trim() || reviewerId.trim() === 'unassigned') throw new Error('A non-empty --reviewer identity is required at import time');
  if (typeof reviewPass !== 'string' || !reviewPass.trim()) throw new Error('A non-empty --review-pass is required at import time');
  if (typeof reviewerKind !== 'string' || !reviewerKind.trim()) throw new Error('reviewerKind must be non-empty');
  const stampedReviewerId = reviewerId.trim();
  const stampedReviewPass = reviewPass.trim();
  const stampedReviewerKind = reviewerKind.trim();
  const packet = resolve(packetDirectory);
  const index = await validatePacket(packet);
  const responses = [];
  for (const file of await labelFiles(labelsPath)) {
    const text = await readFile(file, 'utf8');
    if (/\.jsonl$/i.test(file)) responses.push(...text.split(/\r?\n/).filter(Boolean).map((line, lineIndex) => {
      try { return JSON.parse(line); } catch (error) { throw new Error(`${file}:${lineIndex + 1}: ${error.message}`); }
    }));
    else {
      const parsed = JSON.parse(text);
      responses.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    }
  }
  const bySheet = new Map();
  for (const response of responses) {
    if (bySheet.has(response.sheet_id)) throw new Error(`Duplicate response for ${response.sheet_id}`);
    bySheet.set(response.sheet_id, response);
  }
  const expected = new Set(index.sheets.map(sheet => sheet.sheet_id));
  const extras = [...bySheet.keys()].filter(sheetId => !expected.has(sheetId));
  const missing = [...expected].filter(sheetId => !bySheet.has(sheetId));
  if (extras.length) throw new Error(`Responses include unknown sheets: ${extras.join(', ')}`);
  if (missing.length) throw new Error(`Missing reviewed responses: ${missing.join(', ')}`);
  const expanded = index.sheets.flatMap(sheet => validateResponse(bySheet.get(sheet.sheet_id), sheet));
  const globalBest = new Map();
  for (const row of expanded) for (const role of row.best_for_role) {
    const key = `${row.entity_id}\0${role}`;
    const tiles = globalBest.get(key) ?? new Set();
    tiles.add(`${row.sheet_id}\0${row.sheet_number}`);
    globalBest.set(key, tiles);
  }
  for (const [key, tiles] of globalBest) if (tiles.size > 1) {
    const [id, role] = key.split('\0');
    throw new Error(`best.${role} selects more than one candidate globally for chunked company ${id}`);
  }
  const reviewedAt = new Date().toISOString();
  const rows = expanded.map(row => {
    const label = normalizeLabelRecord({
      label_kind: 'candidate',
      entity_id: row.entity_id,
      candidate_id: row.candidate_id,
      reviewed_at: reviewedAt,
      values: {
        identity: row.identity,
        roles: row.roles,
        best_for_role: row.best_for_role,
        usability_light: row.works_on.includes('light') ? 'good' : 'unusable',
        usability_dark: row.works_on.includes('dark') ? 'good' : 'unusable',
      },
      provenance: {
        schema_version: 'visual-benchmark-v1',
        capture_version: index.capture_key,
        task_id: `${row.sheet_id}:${row.sheet_number}`,
        prompt_version: REVIEW_PROTOCOL,
        packet_fingerprint: bySheet.get(row.sheet_id).packet_fingerprint,
      },
    }, { runKey: index.run_key, captureKey: index.capture_key, passId: stampedReviewPass, reviewerId: stampedReviewerId, reviewerKind: stampedReviewerKind });
    validateCanonicalLabel(label, `candidate ${row.candidate_id}`);
    return label;
  });
  const expectedIds = new Set(index.sheets.flatMap(sheet => sheet.entities.flatMap(entity => entity.candidates.flatMap(candidate => candidate.candidate_ids))));
  const actualIds = new Set(rows.map(row => row.candidate_id));
  if (rows.length !== expectedIds.size || actualIds.size !== expectedIds.size || [...expectedIds].some(id => !actualIds.has(id))) throw new Error('Expanded labels are not exactly candidate-complete');
  const output = resolve(outputPath ?? join(packet, 'candidate-labels.jsonl'));
  await atomicWrite(output, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`, overwrite);
  return { output, sheet_count: index.sheets.length, candidate_count: rows.length };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help || !options.command) { process.stdout.write(`${help()}\n`); return; }
    if (options.command === 'build') {
      if (!options.run) throw new Error('build requires --run');
      const result = await buildLabelSheets({
        runDirectory: options.run,
        outputDirectory: options.output,
        maxCandidates: options.maxCandidates ?? DEFAULT_MAX_CANDIDATES,
        maxEntities: options.maxEntities ?? DEFAULT_MAX_ENTITIES,
        seed: options.seed ?? 'visual-label-v3',
        overwrite: options.overwrite ?? false,
      });
      process.stdout.write(`${result.sheet_count} sheets, ${result.entity_count} companies, ${result.visual_candidate_count} unique visuals (${result.candidate_count} candidate records)\n`);
      return;
    }
    if (options.command === 'validate') {
      if (!options.packet || !options.labels) throw new Error('validate requires --packet and --labels');
      if (!options.reviewer || !options.reviewPass) throw new Error('validate requires --reviewer and --review-pass');
      const result = await validateLabelResponses({
        packetDirectory: options.packet,
        labelsPath: options.labels,
        outputPath: options.output,
        reviewerId: options.reviewer,
        reviewPass: options.reviewPass,
        reviewerKind: options.reviewerKind ?? 'ai',
        overwrite: options.overwrite ?? false,
      });
      process.stdout.write(`${result.sheet_count} reviewed sheets, ${result.candidate_count} candidate labels -> ${result.output}\n`);
      return;
    }
    throw new Error(`Unknown command: ${options.command}`);
  } catch (error) {
    process.stderr.write(`visual-label-sheets: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
