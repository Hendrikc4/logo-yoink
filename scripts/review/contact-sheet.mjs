#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROLE_NAMES = ['icon', 'wide', 'favicon'];
const SAFE_RASTER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico']);

function help() {
  return `Logo Yoink contact sheets

  node scripts/review/contact-sheet.mjs --run runs/<id> [options]

Options:
  --run DIR              Benchmark run directory (required)
  --output DIR           Default: <run>/contact-sheets
  --page-size N          Entities per page, 20–25 (default: 20)
  --failures-only        Generate only the reachability/failure sheet
  --help

The generator rasterizes previews through sharp when it is installed. Otherwise
browser-safe raster assets are displayed directly and SVG previews remain disabled;
untrusted SVG bytes are never embedded in generated HTML.`;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const raw = argv[index];
    if (!raw.startsWith('--')) throw new Error(`Unexpected argument: ${raw}`);
    const [rawKey, inline] = raw.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    if (['help', 'failures-only'].includes(rawKey)) result[key] = inline === undefined ? true : inline !== 'false';
    else {
      const value = inline ?? argv[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${rawKey}`);
      result[key] = value;
    }
  }
  if (result.pageSize !== undefined) {
    result.pageSize = Number(result.pageSize);
    if (!Number.isInteger(result.pageSize) || result.pageSize < 20 || result.pageSize > 25) throw new Error('--page-size must be between 20 and 25.');
  }
  return result;
}

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function readJsonl(path) {
  const content = await readFile(path, 'utf8');
  return content.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`Invalid JSON at ${path}:${index + 1}: ${error.message}`); }
  });
}

function roleScore(candidate, role) {
  return Number(candidate.role_scores?.[role] ?? candidate.roleScores?.[role] ?? candidate.score ?? 0);
}

function reviewCandidates(result) {
  const byId = new Map((result.candidates ?? []).map(candidate => [candidate.candidate_id, candidate]));
  const selected = [];
  const seen = new Set();
  for (const role of ROLE_NAMES) {
    const ranked = (result.candidates ?? []).filter(candidate => candidate.predicted_roles?.includes(role))
      .sort((a, b) => roleScore(b, role) - roleScore(a, role));
    const selectedCandidate = byId.get(result.selected_by_role?.[role]);
    for (const candidate of [selectedCandidate, ...ranked].filter(Boolean)) {
      const identity = candidate.content_hash ?? candidate.resolvedUrl ?? candidate.resolved_url ?? candidate.url ?? candidate.candidate_id;
      const key = `${role}\0${identity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push({ candidate, reviewRole: role, rank: selectedCandidate?.candidate_id === candidate.candidate_id ? 1 : 2 });
      if (selected.filter(item => item.reviewRole === role).length === 2) break;
    }
  }
  return selected;
}

function safeAssetPath(runDirectory, assetPath) {
  if (!assetPath) return null;
  const absolute = resolve(runDirectory, assetPath);
  const prefix = `${resolve(runDirectory)}${sep}`;
  return absolute.startsWith(prefix) && existsSync(absolute) ? absolute : null;
}

let sharpPromise;
async function loadSharp() {
  if (!sharpPromise) sharpPromise = import('sharp').then(module => module.default).catch(() => null);
  return sharpPromise;
}

async function previewFor(candidate, runDirectory, outputDirectory) {
  const asset = safeAssetPath(runDirectory, candidate.asset_path);
  if (!asset) return { path: null, reason: 'asset not saved' };
  const thumbnailDirectory = join(outputDirectory, 'thumbnails');
  const thumbnail = join(thumbnailDirectory, `${candidate.candidate_id}.png`);
  const sharp = await loadSharp();
  if (sharp) {
    try {
      await mkdir(thumbnailDirectory, { recursive: true });
      if (!existsSync(thumbnail)) {
        await sharp(asset, { density: 144, limitInputPixels: 40_000_000, animated: false })
          .resize({ width: 480, height: 240, fit: 'contain', withoutEnlargement: true })
          .png().toFile(thumbnail);
      }
      return { path: relative(outputDirectory, thumbnail).split(sep).join('/') };
    } catch (error) {
      return { path: null, reason: `thumbnail failed: ${error.message}` };
    }
  }
  if (SAFE_RASTER_EXTENSIONS.has(extname(asset).toLowerCase())) {
    return { path: relative(outputDirectory, asset).split(sep).join('/') };
  }
  return { path: null, reason: 'SVG/unknown preview disabled (install sharp to rasterize)' };
}

function styles() {
  return `<style>
    :root { color-scheme: light; font: 14px/1.35 ui-sans-serif, system-ui, sans-serif; color: #19212b; background: #eef1f5; }
    * { box-sizing: border-box; } body { margin: 0; } header { position: sticky; top: 0; z-index: 2; padding: 14px 22px; background: #10151c; color: white; }
    header a { color: #b9d8ff; margin-right: 14px; } main { padding: 22px; max-width: 1700px; margin: auto; }
    .entity { background: white; border: 1px solid #d7dce2; border-radius: 10px; margin: 0 0 18px; overflow: hidden; }
    .entity-head { display: flex; gap: 14px; align-items: baseline; padding: 11px 14px; border-bottom: 1px solid #e1e4e8; }
    .entity-head h2 { font-size: 17px; margin: 0; } .muted { color: #66717e; } .status { margin-left: auto; font-family: ui-monospace, monospace; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); }
    .tile { min-width: 0; padding: 12px; border-right: 1px solid #e7e9ec; border-bottom: 1px solid #e7e9ec; }
    .preview-pair { display: grid; grid-template-columns: 1fr 1fr; height: 142px; border: 1px solid #cbd1d8; }
    .preview { display: grid; place-items: center; overflow: hidden; padding: 12px; } .preview.dark { background: #15191f; }
    .preview.light { background: white; } .preview img { display: block; max-width: 100%; max-height: 115px; object-fit: contain; }
    .no-preview { grid-column: 1 / -1; display: grid; place-items: center; padding: 18px; color: #6b7280; background: repeating-linear-gradient(135deg,#f7f7f7,#f7f7f7 10px,#eee 10px,#eee 20px); text-align: center; }
    .meta { margin-top: 8px; display: grid; grid-template-columns: auto 1fr; gap: 3px 8px; font-size: 12px; }
    .meta dt { color: #66717e; } .meta dd { margin: 0; overflow-wrap: anywhere; } code { font-size: 11px; }
    .labels { display: grid; grid-template-columns: repeat(3,1fr); gap: 5px; margin-top: 9px; } label { font-size: 11px; color: #59636f; }
    select { width: 100%; margin-top: 2px; } .empty { padding: 20px; color: #687381; } nav { margin: 18px 0; }
  </style>`;
}

function pageScript() {
  return `<script>
    function downloadLabels() {
      const records = [...document.querySelectorAll('.tile')].map(tile => ({
        entity_id: tile.dataset.entityId,
        candidate_id: tile.dataset.candidateId,
        identity: tile.querySelector('[data-field=identity]').value,
        role: tile.querySelector('[data-field=role]').value,
        usability: tile.querySelector('[data-field=usability]').value,
        reviewer: '',
        labeled_at: new Date().toISOString()
      })).filter(record => record.identity || record.role || record.usability);
      const blob = new Blob([records.map(record => JSON.stringify(record)).join('\\n') + '\\n'], {type: 'application/x-ndjson'});
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'labels-' + document.title.replace(/\\W+/g, '-').toLowerCase() + '.jsonl'; link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
  </script>`;
}

function select(field, values, selected = '') {
  return `<label>${html(field)}<select data-field="${html(field)}"><option value=""></option>${values.map(value => `<option${selected === value ? ' selected' : ''}>${html(value)}</option>`).join('')}</select></label>`;
}

async function candidateTile(result, entry, runDirectory, outputDirectory) {
  const { candidate, reviewRole, rank } = entry;
  const preview = await previewFor(candidate, runDirectory, outputDirectory);
  const dimensions = candidate.width && candidate.height ? `${candidate.width}×${candidate.height}` : 'unknown';
  const image = preview.path ? `<img src="${html(preview.path)}" alt="">` : '';
  const previewHtml = preview.path
    ? `<div class="preview-pair"><div class="preview light">${image}</div><div class="preview dark">${image}</div></div>`
    : `<div class="preview-pair"><div class="no-preview">${html(preview.reason)}</div></div>`;
  const reasons = candidate.score_reasons ?? candidate.scoreReasons ?? [];
  return `<article class="tile" data-entity-id="${html(result.entity_id)}" data-candidate-id="${html(candidate.candidate_id)}">
    ${previewHtml}
    <dl class="meta">
      <dt>review slot</dt><dd><b>${html(reviewRole)} #${rank}</b></dd>
      <dt>candidate</dt><dd><code>${html(candidate.candidate_id)}</code></dd>
      <dt>source</dt><dd>${html(candidate.source)}</dd>
      <dt>asset</dt><dd>${html(candidate.format)} · ${html(dimensions)} · ${html(candidate.bytes)} bytes</dd>
      <dt>score</dt><dd>${html(roleScore(candidate, reviewRole))}</dd>
      <dt>reasons</dt><dd>${html(Array.isArray(reasons) ? reasons.slice(0, 4).join('; ') : reasons)}</dd>
      <dt>URL</dt><dd>${html(candidate.resolvedUrl ?? candidate.resolved_url ?? candidate.url)}</dd>
    </dl>
    <div class="labels">
      ${select('identity', ['correct', 'wrong', 'ambiguous'])}
      ${select('role', ['icon', 'wide', 'favicon', 'banner-or-other'], reviewRole)}
      ${select('usability', ['good', 'conditional', 'unusable'])}
    </div>
  </article>`;
}

async function entitySection(result, runDirectory, outputDirectory) {
  const entries = reviewCandidates(result);
  const tiles = await Promise.all(entries.map(entry => candidateTile(result, entry, runDirectory, outputDirectory)));
  return `<section class="entity" id="entity-${html(result.entity_id)}">
    <div class="entity-head"><h2>${html(result.name)}</h2><span>${html(result.website)}</span><code class="muted">${html(result.entity_id)}</code><span class="status">${html(result.reachability)}</span></div>
    ${tiles.length ? `<div class="tiles">${tiles.join('')}</div>` : `<div class="empty">No review candidates. ${html(result.error?.message)}</div>`}
  </section>`;
}

function documentHtml(title, body, navigation = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title>${styles()}</head>
  <body><header><b>${html(title)}</b> ${navigation}<button type="button" onclick="downloadLabels()">Download labels JSONL</button></header><main>${body}</main>${pageScript()}</body></html>`;
}

async function writePage(path, title, results, runDirectory, outputDirectory, navigation) {
  const sections = await Promise.all(results.map(result => entitySection(result, runDirectory, outputDirectory)));
  await writeFile(path, documentHtml(title, sections.join(''), navigation));
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { process.stdout.write(`${help()}\n`); return; }
    if (!options.run) throw new Error('--run is required.');
    const runDirectory = resolve(options.run);
    const outputDirectory = resolve(options.output ?? join(runDirectory, 'contact-sheets'));
    const results = await readJsonl(join(runDirectory, 'results.jsonl'));
    await mkdir(outputDirectory, { recursive: true });
    const failures = results.filter(result => result.status === 'failure' || !result.candidates?.length || result.reachability !== 'live_html');
    const failureFile = 'failures.html';
    await writePage(join(outputDirectory, failureFile), `${basename(runDirectory)} failures`, failures, runDirectory, outputDirectory, `<a href="index.html">index</a>`);
    const pages = [];
    if (!options.failuresOnly) {
      const size = options.pageSize ?? 20;
      for (let offset = 0; offset < results.length; offset += size) {
        const page = Math.floor(offset / size) + 1;
        const filename = `page-${String(page).padStart(3, '0')}.html`;
        pages.push({ filename, from: offset + 1, to: Math.min(results.length, offset + size) });
        const nav = `<a href="index.html">index</a><a href="${failureFile}">failures</a>`;
        await writePage(join(outputDirectory, filename), `${basename(runDirectory)} ${offset + 1}–${Math.min(results.length, offset + size)}`, results.slice(offset, offset + size), runDirectory, outputDirectory, nav);
      }
    }
    const links = `<h1>${html(basename(runDirectory))}</h1><p>${results.length} entities; ${failures.length} failure/empty/non-live cases.</p><nav><a href="${failureFile}">Failure sheet</a></nav><ol>${pages.map(page => `<li><a href="${page.filename}">Entities ${page.from}–${page.to}</a></li>`).join('')}</ol>`;
    await writeFile(join(outputDirectory, 'index.html'), documentHtml(`${basename(runDirectory)} contact sheets`, links));
    const template = results.flatMap(result => reviewCandidates(result).map(({ candidate, reviewRole }) => JSON.stringify({
      entity_id: result.entity_id, candidate_id: candidate.candidate_id, identity: '', role: reviewRole, usability: '', reviewer: '', labeled_at: '',
    }))).join('\n');
    await writeFile(join(outputDirectory, 'labels-template.jsonl'), `${template}${template ? '\n' : ''}`);
    process.stdout.write(`${join(outputDirectory, 'index.html')}\n`);
  } catch (error) {
    process.stderr.write(`contact-sheet: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
