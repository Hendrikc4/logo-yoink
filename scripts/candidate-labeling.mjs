#!/usr/bin/env node

/**
 * Candidate-only visual labeling for frozen benchmark runs.
 *
 * `prepare` deduplicates the candidates already scraped into results.jsonl and
 * renders numbered PNG contact sheets. `merge` validates one or more AI JSONL
 * responses and emits ordinary benchmark labels keyed by candidate_id.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROLES = new Set(['icon', 'wide', 'favicon', 'other']);
const IDENTITY_FLAGS = new Set(['correct', 'wrong', 'ambiguous']);
const USABILITY_FLAGS = new Set(['good', 'conditional', 'unusable']);
const OPTIONAL_FLAGS = new Set(['best', 'theme_specific', 'stale', 'composite', 'preview_missing']);
const FLAGS = new Set([...IDENTITY_FLAGS, ...USABILITY_FLAGS, ...OPTIONAL_FLAGS]);
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const TILE_WIDTH = 400;
const TILE_HEIGHT = 280;

function help() {
  return `Candidate-only benchmark labeling

Prepare numbered contact sheets from an existing benchmark run:
  node scripts/candidate-labeling.mjs prepare --run runs/<id> [--output DIR] [--sheet-size 24]

Validate and merge AI responses:
  node scripts/candidate-labeling.mjs merge --packet DIR --input labels-01.jsonl [--input labels-02.jsonl] [--output FILE] [--allow-partial]

The AI response is JSONL with no candidate IDs or scores:
  {"candidate_number":17,"roles":["wide"],"flags":["correct","good","best"]}

Each row needs one identity flag and one usability flag. Allowed roles are
icon, wide, favicon, other. Optional flags are best, theme_specific, stale,
composite, and preview_missing.`;
}

export function parseArgs(argv) {
  const args = [...argv];
  const first = args.shift();
  const command = first === '--help' ? undefined : first;
  const options = { command, input: [] };
  if (first === '--help') options.help = true;
  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index];
    if (!raw.startsWith('--')) throw new Error(`Unexpected argument: ${raw}`);
    const [rawKey, inline] = raw.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    if (['help', 'allow-partial'].includes(rawKey)) options[key] = inline === undefined ? true : inline !== 'false';
    else {
      const value = inline ?? args[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${rawKey}`);
      if (rawKey === 'input') options.input.push(value);
      else options[key] = value;
    }
  }
  if (options.sheetSize !== undefined) {
    options.sheetSize = Number(options.sheetSize);
    if (!Number.isInteger(options.sheetSize) || options.sheetSize < 8 || options.sheetSize > 40) throw new Error('--sheet-size must be between 8 and 40.');
  }
  return options;
}

async function readBounded(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error(`${path}: input exceeds ${MAX_FILE_BYTES} bytes`);
  return readFile(path, 'utf8');
}

export async function readJsonl(path) {
  const rows = [];
  for (const [index, line] of (await readBounded(path)).split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); }
    catch (error) { throw new Error(`${path}:${index + 1}: invalid JSON: ${error.message}`); }
  }
  return rows;
}

function candidateIdentity(candidate) {
  const contentHash = candidate.content_hash ?? candidate.contentHash ?? candidate.observed?.byte_hash;
  if (contentHash) return `hash:${String(contentHash).toLowerCase()}`;
  const url = candidate.resolvedUrl ?? candidate.resolved_url ?? candidate.url;
  if (url) {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      return `url:${parsed.href}`;
    } catch { return `url:${url}`; }
  }
  return `candidate:${candidate.candidate_id}`;
}

export function dedupeRunCandidates(results) {
  const entries = [];
  let candidateNumber = 1;
  for (const result of results) {
    const groups = new Map();
    for (const candidate of result.candidates ?? []) {
      if (!candidate?.candidate_id) continue;
      const key = candidateIdentity(candidate);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(candidate);
    }
    for (const duplicates of groups.values()) {
      const candidate = duplicates.find(item => item.asset_path && existsSync(resolve(result.__run_directory ?? '', item.asset_path))) ?? duplicates[0];
      entries.push({
        candidate_number: candidateNumber++,
        entity_id: result.entity_id,
        name: result.name ?? result.entity_id,
        website: result.website ?? '',
        candidate_id: candidate.candidate_id,
        duplicate_candidate_ids: duplicates.map(item => item.candidate_id).filter(id => id !== candidate.candidate_id),
        asset_path: candidate.asset_path ?? null,
        source: candidate.source ?? null,
        format: candidate.format ?? null,
        width: candidate.width ?? candidate.observed?.width ?? null,
        height: candidate.height ?? candidate.observed?.height ?? null,
        content_hash: candidate.content_hash ?? candidate.contentHash ?? null,
      });
    }
  }
  return entries;
}

function xml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function confinedAsset(runDirectory, value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || /^(?:data|https?):/i.test(value)) return null;
  const root = resolve(runDirectory);
  const path = resolve(root, value);
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) return null;
  return path;
}

async function previewBuffer(entry, runDirectory) {
  const path = confinedAsset(runDirectory, entry.asset_path);
  if (!path || !existsSync(path)) return null;
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_ASSET_BYTES) return null;
  try {
    return await sharp(path, { density: 144, limitInputPixels: 32_000_000, animated: false })
      .resize({ width: 330, height: 76, fit: 'contain', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch { return null; }
}

async function renderSheet(entries, path, runDirectory) {
  const columns = entries.length <= 12 ? 3 : 4;
  const rows = Math.ceil(entries.length / columns);
  const width = columns * TILE_WIDTH;
  const height = rows * TILE_HEIGHT;
  const labels = entries.map((entry, index) => {
    const x = index % columns * TILE_WIDTH;
    const y = Math.floor(index / columns) * TILE_HEIGHT;
    const dimensions = entry.width && entry.height ? `${entry.width}×${entry.height}` : 'dimensions unknown';
    return `<g transform="translate(${x} ${y})">
      <rect x="1" y="1" width="398" height="278" rx="8" fill="#f5f6f8" stroke="#bcc2ca"/>
      <text x="16" y="27" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#101318">#${entry.candidate_number} · ${xml(entry.name).slice(0, 40)}</text>
      <text x="16" y="50" font-family="Arial,sans-serif" font-size="13" fill="#59616c">${xml(entry.source ?? 'unknown source').slice(0, 32)} · ${xml(dimensions)}</text>
      <rect x="16" y="64" width="368" height="88" fill="#fff" stroke="#d5d9df"/>
      <rect x="16" y="160" width="368" height="88" fill="#171a20" stroke="#303641"/>
    </g>`;
  }).join('');
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#e5e8ec"/>${labels}</svg>`);
  const composites = [];
  for (const [index, entry] of entries.entries()) {
    const preview = await previewBuffer(entry, runDirectory);
    const x = index % columns * TILE_WIDTH + 35;
    const y = Math.floor(index / columns) * TILE_HEIGHT;
    if (preview) composites.push({ input: preview, left: x, top: y + 70 }, { input: preview, left: x, top: y + 166 });
    else {
      const unavailable = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="330" height="76"><text x="165" y="42" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#777f89">PREVIEW UNAVAILABLE</text></svg>');
      composites.push({ input: unavailable, left: x, top: y + 70 }, { input: unavailable, left: x, top: y + 166 });
    }
  }
  await sharp(background, { limitInputPixels: 50_000_000 }).composite(composites).png().toFile(path);
}

export async function preparePacket({ runDirectory, outputDirectory, sheetSize = 24 }) {
  const run = resolve(runDirectory);
  const output = resolve(outputDirectory ?? join(run, 'candidate-labeling'));
  if (existsSync(output)) throw new Error(`Refusing to overwrite existing packet directory: ${output}`);
  const resultsPath = join(run, 'results.jsonl');
  const results = (await readJsonl(resultsPath)).map(result => ({ ...result, __run_directory: run }));
  const entries = dedupeRunCandidates(results);
  await mkdir(join(output, 'sheets'), { recursive: true });
  const sheets = [];
  for (let offset = 0; offset < entries.length; offset += sheetSize) {
    const batch = entries.slice(offset, offset + sheetSize);
    const filename = `sheet-${String(sheets.length + 1).padStart(3, '0')}.png`;
    await renderSheet(batch, join(output, 'sheets', filename), run);
    sheets.push({ sheet: sheets.length + 1, path: `sheets/${filename}`, candidate_numbers: batch.map(entry => entry.candidate_number) });
  }
  const runDigest = createHash('sha256').update(await readBounded(resultsPath)).digest('hex');
  const manifest = {
    schema_version: 1,
    workflow: 'candidate-only-visual-labeling-v1',
    source_run: basename(run),
    source_results_sha256: runDigest,
    candidate_count: entries.length,
    sheet_count: sheets.length,
    roles: [...ROLES],
    flags: [...FLAGS],
    response_example: { candidate_number: 17, roles: ['wide'], flags: ['correct', 'good', 'best'] },
    sheets,
  };
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(output, 'candidates.jsonl'), entries.map(entry => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : ''));
  await writeFile(join(output, 'AI-INSTRUCTIONS.txt'), `Inspect every numbered candidate in the supplied sheets. Return JSONL only, one object per number, with exactly these keys: candidate_number, roles, flags.\n\nroles: icon, wide, favicon, other\nflags: exactly one of correct/wrong/ambiguous; exactly one of good/conditional/unusable; optional best/theme_specific/stale/composite/preview_missing\n\nExample:\n{"candidate_number":17,"roles":["wide"],"flags":["correct","good","best"]}\n\nDo not return candidate IDs, scores, explanations, markdown, or unnumbered observations. Use an empty roles array for non-logo candidates. When a tile says PREVIEW UNAVAILABLE, use ambiguous, unusable, and preview_missing rather than guessing.\n`);
  return { output, entries, sheets };
}

function oneOf(flags, set, context) {
  const values = flags.filter(flag => set.has(flag));
  if (values.length !== 1) throw new Error(`${context}: expected exactly one of ${[...set].join(', ')}`);
  return values[0];
}

export function validateResponseRows(rows, entries, { allowPartial = false } = {}) {
  const byNumber = new Map(entries.map(entry => [entry.candidate_number, entry]));
  const seen = new Map();
  for (const [index, row] of rows.entries()) {
    const context = `label row ${index + 1}`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${context}: must be an object`);
    const keys = Object.keys(row).sort();
    if (keys.join(',') !== 'candidate_number,flags,roles') throw new Error(`${context}: keys must be exactly candidate_number, roles, flags`);
    if (!Number.isInteger(row.candidate_number) || !byNumber.has(row.candidate_number)) throw new Error(`${context}: unknown candidate_number ${JSON.stringify(row.candidate_number)}`);
    if (seen.has(row.candidate_number)) throw new Error(`${context}: duplicate candidate_number ${row.candidate_number}`);
    if (!Array.isArray(row.roles) || !Array.isArray(row.flags)) throw new Error(`${context}: roles and flags must be arrays`);
    if (new Set(row.roles).size !== row.roles.length || row.roles.some(role => !ROLES.has(role))) throw new Error(`${context}: invalid or duplicate role`);
    if (new Set(row.flags).size !== row.flags.length || row.flags.some(flag => !FLAGS.has(flag))) throw new Error(`${context}: invalid or duplicate flag`);
    const identity = oneOf(row.flags, IDENTITY_FLAGS, context);
    const usability = oneOf(row.flags, USABILITY_FLAGS, context);
    if (row.flags.includes('best') && (!row.roles.length || identity !== 'correct' || usability === 'unusable')) throw new Error(`${context}: best requires a correct, usable role label`);
    if (row.flags.includes('preview_missing') && (identity !== 'ambiguous' || usability !== 'unusable')) throw new Error(`${context}: preview_missing requires ambiguous and unusable`);
    seen.set(row.candidate_number, { ...row, identity, usability });
  }
  if (!allowPartial && seen.size !== entries.length) {
    const missing = entries.filter(entry => !seen.has(entry.candidate_number)).map(entry => entry.candidate_number);
    throw new Error(`Incomplete response: ${missing.length} candidate number(s) missing (${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', …' : ''})`);
  }
  const best = new Map();
  for (const [number, row] of seen) {
    if (!row.flags.includes('best')) continue;
    const entry = byNumber.get(number);
    for (const role of row.roles.filter(value => value !== 'other')) {
      const key = `${entry.entity_id}\0${role}`;
      if (best.has(key)) throw new Error(`Candidates #${best.get(key)} and #${number} are both best for ${entry.entity_id}/${role}`);
      best.set(key, number);
    }
  }
  return seen;
}

export async function mergeLabels({ packetDirectory, inputPaths, outputPath, allowPartial = false }) {
  const packet = resolve(packetDirectory);
  const manifest = JSON.parse(await readBounded(join(packet, 'manifest.json')));
  if (manifest.workflow !== 'candidate-only-visual-labeling-v1') throw new Error('Unsupported packet workflow.');
  const entries = await readJsonl(join(packet, 'candidates.jsonl'));
  const rows = (await Promise.all(inputPaths.map(path => readJsonl(resolve(path))))).flat();
  const validated = validateResponseRows(rows, entries, { allowPartial });
  const labels = [];
  for (const entry of entries) {
    const row = validated.get(entry.candidate_number);
    if (!row) continue;
    const common = {
      entity_id: entry.entity_id,
      candidate_id: entry.candidate_id,
      candidate_number: entry.candidate_number,
      identity: row.identity,
      usability: row.usability,
      flags: row.flags.filter(flag => !IDENTITY_FLAGS.has(flag) && !USABILITY_FLAGS.has(flag) && flag !== 'best'),
      duplicate_candidate_ids: entry.duplicate_candidate_ids,
      labeling_workflow: manifest.workflow,
      source_results_sha256: manifest.source_results_sha256,
    };
    const candidateIds = [entry.candidate_id, ...entry.duplicate_candidate_ids];
    for (const candidateId of candidateIds) {
      const expanded = { ...common, candidate_id: candidateId, deduplicated_to_candidate_id: entry.candidate_id };
      if (!row.roles.length) labels.push({ ...expanded, roles: [] });
      else for (const role of row.roles) labels.push({ ...expanded, role, best_for_role: row.flags.includes('best') });
    }
  }
  const target = resolve(outputPath ?? join(packet, 'candidate-labels.jsonl'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, labels.map(label => JSON.stringify(label)).join('\n') + (labels.length ? '\n' : ''));
  return { output: target, labels };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help || !options.command) { process.stdout.write(`${help()}\n`); return; }
    if (options.command === 'prepare') {
      if (!options.run) throw new Error('prepare requires --run.');
      const result = await preparePacket({ runDirectory: options.run, outputDirectory: options.output, sheetSize: options.sheetSize });
      process.stdout.write(`${result.output}\n${result.entries.length} deduplicated candidates in ${result.sheets.length} sheets\n`);
    } else if (options.command === 'merge') {
      if (!options.packet || !options.input.length) throw new Error('merge requires --packet and at least one --input.');
      const result = await mergeLabels({ packetDirectory: options.packet, inputPaths: options.input, outputPath: options.output, allowPartial: options.allowPartial });
      process.stdout.write(`${result.output}\n${result.labels.length} validated role-label rows\n`);
    } else throw new Error(`Unknown command: ${options.command}`);
  } catch (error) {
    process.stderr.write(`candidate-labeling: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
