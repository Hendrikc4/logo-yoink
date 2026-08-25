#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const TRUSTED_REGIONS = new Set(['header', 'nav']);
const WIDE_MIN_RATIO = 1.8;
const WIDE_MAX_RATIO = 12;
const FOREGROUND_DISTANCE = 60;
const EMPTY_FOREGROUND_SHARE = 0.05;
const CLIPPED_EDGE_SHARE = 0.10;

async function readJsonl(path) {
  return (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function normalize(value) {
  return String(value ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
}

function host(value) {
  try { return new URL(/^https?:/i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

export function isLocalizedHomeLink(href, website) {
  try {
    const url = new URL(href);
    if (!host(href) || host(href) !== host(website)) return false;
    return /^\/$/.test(url.pathname) || /^\/[a-z]{2}(?:-[a-z]{2})?\/?$/i.test(url.pathname) || /^\/(?:int|en|de|fr|es|it|kr)\/?$/i.test(url.pathname);
  } catch { return false; }
}

export function hasPositiveLogoToken(value) {
  const separated = String(value ?? '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return /(^|[^a-z])(logo|brand|wordmark|identity)([^a-z]|$)/i.test(separated);
}

export function hasCompanyDomAgreement(instance, companyName) {
  const dom = normalize(`${instance.locator?.id ?? ''} ${instance.locator?.class_name ?? ''}`);
  const tokens = String(companyName ?? '').toLowerCase().match(/[a-z0-9]+/g)?.filter(token =>
    token.length >= 4 && !['company', 'incorporated', 'limited', 'sports', 'fitness'].includes(token)) ?? [];
  return tokens.some(token => dom.includes(normalize(token)));
}

export function candidateGate(instance, entity) {
  const box = instance.instance_box ?? {};
  const viewport = instance.evidence?.viewport ?? {};
  const ratio = box.width / box.height;
  const evidence = {
    home_link: isLocalizedHomeLink(instance.locator?.anchor_href, entity.website),
    logo_token: hasPositiveLogoToken(`${instance.locator?.id ?? ''} ${instance.locator?.class_name ?? ''}`),
    company_dom: hasCompanyDomAgreement(instance, entity.name),
  };
  const reasons = [];
  if (!instance.crop_path) reasons.push('missing-crop');
  if (!(box.width > 0 && box.width <= 400)) reasons.push('width-out-of-range');
  if (!(box.height > 0 && box.height <= 120)) reasons.push('height-out-of-range');
  if (!(viewport.width > 0 && box.width < viewport.width * 0.8)) reasons.push('viewport-width-limit');
  if (!(ratio >= WIDE_MIN_RATIO && ratio <= WIDE_MAX_RATIO)) reasons.push('ratio-out-of-range');
  if (!Object.values(evidence).some(Boolean)) reasons.push('missing-identity-evidence');
  return { accepted: reasons.length === 0, evidence, ratio, reasons };
}

function median(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

export async function analyzeCropBuffer(buffer) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const border = [];
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    if (x < 2 || y < 2 || x >= info.width - 2 || y >= info.height - 2) {
      const offset = (y * info.width + x) * info.channels;
      border.push([data[offset], data[offset + 1], data[offset + 2]]);
    }
  }
  const background = [0, 1, 2].map(channel => median(border.map(pixel => pixel[channel])));
  const edges = { left: [0, 0], right: [0, 0], top: [0, 0], bottom: [0, 0] };
  let foreground = 0, minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    const offset = (y * info.width + x) * info.channels;
    const distance = Math.abs(data[offset] - background[0]) + Math.abs(data[offset + 1] - background[1]) + Math.abs(data[offset + 2] - background[2]);
    const isForeground = distance > FOREGROUND_DISTANCE;
    if (isForeground) {
      foreground += 1;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    for (const [name, atEdge] of [['left', x < 2], ['right', x >= info.width - 2], ['top', y < 2], ['bottom', y >= info.height - 2]]) {
      if (atEdge) { edges[name][1] += 1; edges[name][0] += Number(isForeground); }
    }
  }
  const foregroundShare = foreground / (info.width * info.height);
  const edgeShares = Object.fromEntries(Object.entries(edges).map(([name, [count, total]]) => [name, count / total]));
  const reasons = [];
  if (foregroundShare < EMPTY_FOREGROUND_SHARE) reasons.push('empty-or-background-only');
  if (Math.max(...Object.values(edgeShares)) > CLIPPED_EDGE_SHARE) reasons.push('clipped-at-edge');
  const trim = foreground ? { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null;
  if (trim && (trim.width / trim.height < WIDE_MIN_RATIO || trim.width / trim.height > WIDE_MAX_RATIO)) reasons.push('trimmed-ratio-out-of-range');
  return { accepted: reasons.length === 0, reasons, width: info.width, height: info.height, background, foreground_share: foregroundShare, edge_shares: edgeShares, trim };
}

function occurrenceKey(instance) {
  const box = instance.instance_box, viewport = instance.evidence.viewport, locator = instance.locator ?? {};
  return JSON.stringify([instance.entity_id, instance.theme, viewport.width, viewport.height, locator.kind, locator.id, locator.class_name, locator.anchor_href, Math.round(box.x), Math.round(box.width), Math.round(box.height)]);
}

function viewKey(instance) {
  const viewport = instance.evidence.viewport;
  return `${instance.entity_id}\0${instance.theme}\0${viewport.width}x${viewport.height}`;
}

function identityStrength(record) {
  return Number(record.gate.evidence.home_link) * 4 + Number(record.gate.evidence.logo_token) * 2 + Number(record.gate.evidence.company_dom);
}

export function chooseSmallestDescendant(records) {
  return records.toSorted((left, right) => {
    const leftArea = left.instance.instance_box.width * left.instance.instance_box.height;
    const rightArea = right.instance.instance_box.width * right.instance.instance_box.height;
    return leftArea - rightArea || identityStrength(right) - identityStrength(left) || right.instance.locator.class_name.length - left.instance.locator.class_name.length || left.instance.visual_instance_id.localeCompare(right.instance.visual_instance_id);
  })[0];
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).flatMap((token, index, all) => token.startsWith('--') ? [[token.slice(2), all[index + 1]]] : []));
  if (!args.run || !args.split || !args.output) throw new Error('Usage: node scripts/experiments/rendered-wide-audit.mjs --run RUN --split development|validation --output DIRECTORY');
  if (!['development', 'validation'].includes(args.split)) throw new Error('--split must be development or validation');
  const run = resolve(args.run), output = resolve(args.output);
  const entities = await readJsonl(join(run, 'entities.jsonl'));
  const entityById = new Map(entities.map(entity => [entity.entity_id, entity]));
  const split = new Set((await readJsonl(join(run, 'splits', `${args.split}.jsonl`))).map(row => row.entity_id));
  const current = new Set((await readJsonl(join(run, 'captures.jsonl'))).filter(row => row.identity_status === 'current').map(row => row.entity_id));
  const selectedWide = new Set((await readJsonl(join(run, 'label-sheets-v3', 'baseline-current-system-selections.jsonl'))).filter(row => row.role === 'wide' && row.candidate_id).map(row => row.entity_id));
  const mappingByInstance = new Map((await readJsonl(join(run, 'mappings.jsonl'))).map(row => [row.visual_instance_id, row]));
  const instances = (await readJsonl(join(run, 'visual-instances.jsonl')).then(rows => rows.filter(instance =>
    split.has(instance.entity_id) && current.has(instance.entity_id) && !selectedWide.has(instance.entity_id) &&
    TRUSTED_REGIONS.has(instance.region) && instance.visual_role === 'horizontal_lockup' && !instance.source_url &&
    mappingByInstance.get(instance.visual_instance_id)?.mapping_confidence === 'unmapped')));
  const audit = instances.map(instance => ({ instance, entity: entityById.get(instance.entity_id), gate: candidateGate(instance, entityById.get(instance.entity_id)), status: 'gate-rejected', reasons: [] }));
  for (const record of audit) record.reasons = record.gate.reasons;

  const occurrences = new Map();
  for (const record of audit.filter(item => item.gate.accepted)) {
    const key = occurrenceKey(record.instance), prior = occurrences.get(key);
    if (!prior || record.instance.instance_box.y < prior.instance.instance_box.y) {
      if (prior) { prior.status = 'deduplicated-repeat'; prior.reasons = ['repeated-scroll-observation']; }
      occurrences.set(key, record);
    } else { record.status = 'deduplicated-repeat'; record.reasons = ['repeated-scroll-observation']; }
  }

  const hashSeen = new Map();
  for (const record of occurrences.values()) {
    const bytes = await readFile(join(run, record.instance.crop_path));
    record.crop_sha256 = createHash('sha256').update(bytes).digest('hex');
    const box = record.instance.instance_box, viewport = record.instance.evidence.viewport;
    const key = JSON.stringify([record.instance.entity_id, record.instance.theme, viewport.width, viewport.height, Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height), record.crop_sha256]);
    const prior = hashSeen.get(key);
    if (prior) {
      const keep = chooseSmallestDescendant([prior, record]);
      const drop = keep === prior ? record : prior;
      drop.status = 'deduplicated-underlying-element'; drop.reasons = ['same-box-and-crop']; hashSeen.set(key, keep);
    } else hashSeen.set(key, record);
  }

  const byView = new Map();
  for (const record of hashSeen.values()) {
    const key = viewKey(record.instance), rows = byView.get(key) ?? [];
    rows.push(record); byView.set(key, rows);
  }
  const viewportPicks = [];
  for (const records of byView.values()) {
    const pick = chooseSmallestDescendant(records); viewportPicks.push(pick);
    for (const record of records) if (record !== pick) { record.status = 'larger-ancestor'; record.reasons = ['smaller-visible-descendant-available']; }
  }

  for (const record of viewportPicks) {
    const bytes = await readFile(join(run, record.instance.crop_path));
    record.pixel = await analyzeCropBuffer(bytes);
    record.status = record.pixel.accepted ? 'pixel-accepted' : 'pixel-rejected';
    record.reasons = record.pixel.reasons;
  }
  const acceptedByTheme = new Map();
  for (const record of viewportPicks.filter(item => item.pixel.accepted)) {
    const key = `${record.instance.entity_id}\0${record.instance.theme}`, rows = acceptedByTheme.get(key) ?? [];
    rows.push(record); acceptedByTheme.set(key, rows);
  }
  const proposals = [];
  await mkdir(join(output, 'crops'), { recursive: true });
  for (const records of acceptedByTheme.values()) {
    records.sort((left, right) => right.pixel.trim.width * right.pixel.trim.height - left.pixel.trim.width * left.pixel.trim.height || left.instance.visual_instance_id.localeCompare(right.instance.visual_instance_id));
    const pick = records[0];
    for (const record of records.slice(1)) { record.status = 'theme-alternative'; record.reasons = ['higher-resolution-theme-result-available']; }
    pick.status = 'proposed'; pick.reasons = [];
    const cropName = `${pick.instance.entity_id}-${pick.instance.theme}.png`;
    await sharp(join(run, pick.instance.crop_path)).extract(pick.pixel.trim).png().toFile(join(output, 'crops', cropName));
    const outputBytes = await readFile(join(output, 'crops', cropName));
    proposals.push({
      tier: 'rendered_wide', entity_id: pick.instance.entity_id, company_name: pick.entity.name, benchmark_split: args.split,
      theme: pick.instance.theme, background_dependent: true, visual_instance_id: pick.instance.visual_instance_id,
      frozen_crop_path: pick.instance.crop_path, frozen_crop_sha256: pick.crop_sha256, output_crop_path: `crops/${cropName}`,
      output_crop_sha256: createHash('sha256').update(outputBytes).digest('hex'), evidence: pick.gate.evidence,
      source_box: pick.instance.instance_box, trimmed_box: pick.pixel.trim,
    });
  }
  await mkdir(output, { recursive: true });
  const auditRows = audit.map(record => ({
    entity_id: record.instance.entity_id, company_name: record.entity.name, visual_instance_id: record.instance.visual_instance_id,
    view: record.instance.view, theme: record.instance.theme, region: record.instance.region, source_box: record.instance.instance_box,
    crop_path: record.instance.crop_path, locator: record.instance.locator, gate: record.gate, pixel: record.pixel ?? null,
    status: record.status, reasons: record.reasons,
  }));
  const summary = {
    schema_version: 'rendered-wide-audit-v1', source_run: run, source_run_name: basename(run), split: args.split,
    scope: { split_entities: split.size, current_entities: [...split].filter(id => current.has(id)).length, missing_portable_wide_entities: [...split].filter(id => current.has(id) && !selectedWide.has(id)).length },
    observations: instances.length, companies_with_observations: new Set(instances.map(row => row.entity_id)).size,
    gate_accepted_observations: audit.filter(row => row.gate.accepted).length, deduplicated_occurrences: occurrences.size,
    viewport_picks: viewportPicks.length, pixel_accepted_viewport_picks: viewportPicks.filter(row => row.pixel.accepted).length,
    rendered_wide_results: proposals.length, rendered_wide_companies: new Set(proposals.map(row => row.entity_id)).size,
  };
  await writeFile(join(output, 'audit.jsonl'), `${auditRows.map(JSON.stringify).join('\n')}\n`);
  await writeFile(join(output, 'proposals.jsonl'), `${proposals.map(JSON.stringify).join('\n')}${proposals.length ? '\n' : ''}`);
  await writeFile(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`rendered-wide audit: ${error.message}\n`); process.exitCode = 1; });
}
