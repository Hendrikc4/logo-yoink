#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { extractLogos } from '../../src/extractor.mjs';
import { mapConcurrent } from '../../src/concurrency.mjs';

const [controlPath, outputPath = 'runs/deep-wide-experiment', rawLimit = '75'] = process.argv.slice(2);
if (!controlPath) throw new Error('Usage: node scripts/experiments/deep-wide-experiment.mjs <control results.jsonl> [output] [limit]');
const limit = Number(rawLimit);
if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
const records = (await readFile(resolve(controlPath), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const eligible = records.filter(record => record.status === 'success' && ['live_html', 'redirected_off_domain'].includes(record.reachability) && !record.selected_by_role?.wide)
  .sort((a, b) => createHash('sha256').update(`missing-wide-root-cause-audit-v1\0${a.entity_id}`).digest('hex').localeCompare(createHash('sha256').update(`missing-wide-root-cause-audit-v1\0${b.entity_id}`).digest('hex')))
  .slice(0, limit);
const output = resolve(outputPath), assets = join(output, 'assets');
await mkdir(assets, { recursive: true });

const treatment = await mapConcurrent(eligible, 3, async record => {
  try {
    const common = { companyName: record.name, roleAwareBudget: true, contentBoundingWide: true, timeoutMs: 12_000 };
    const control = await extractLogos(record.website, common);
    const result = await extractLogos(record.website, { ...common, deepWide: true, spaBundles: true });
    const wide = !control.selectedByRole.wide ? result.selectedByRole.wide : null;
    let asset = null;
    if (wide?.dataUrl) {
      const extension = wide.format === 'svg' ? '.svg' : extname(new URL(wide.resolved_url).pathname) || `.${wide.format}`;
      asset = `assets/${record.entity_id}${extension}`;
      await writeFile(join(output, asset), Buffer.from(wide.dataUrl.split(',')[1], 'base64'));
    }
    const roleMovement = Object.fromEntries(['icon', 'favicon'].map(role => {
      const before = control.selectedByRole[role]?.url ?? null, after = result.selectedByRole[role]?.url ?? null;
      return [role, { before, after, changed: before !== after }];
    }));
    const controlMetrics = { requests: control.diagnostics.requests, bytes: control.diagnostics.bytesDownloaded, duration_ms: control.diagnostics.durationMs };
    const treatmentMetrics = { requests: result.diagnostics.requests, bytes: result.diagnostics.bytesDownloaded, duration_ms: result.diagnostics.durationMs };
    return { entity_id: record.entity_id, name: record.name, website: record.website, status: 'success', wide: wide ? { url: wide.url, resolved_url: wide.resolved_url, source: wide.source, width: wide.width, height: wide.height, archive_member: wide.evidence?.archive_member, theme: wide.evidence?.theme, asset } : null, role_movement: roleMovement, metrics: { control: controlMetrics, treatment: treatmentMetrics, delta: { requests: treatmentMetrics.requests - controlMetrics.requests, bytes: treatmentMetrics.bytes - controlMetrics.bytes, duration_ms: treatmentMetrics.duration_ms - controlMetrics.duration_ms } }, deep: result.diagnostics.deepWide };
  } catch (error) { return { entity_id: record.entity_id, name: record.name, website: record.website, status: 'failure', error: error.message }; }
});
const successes = treatment.filter(item => item.status === 'success'), changes = successes.filter(item => item.wide);
const summary = {
  control: resolve(controlPath), seed: 'missing-wide-root-cause-audit-v1', attempted: eligible.length,
  successes: successes.length, new_wide: changes.length,
  sources: Object.fromEntries([...new Set(changes.map(item => item.wide.source))].map(source => [source, changes.filter(item => item.wide.source === source).length])),
  icon_movements: successes.filter(item => item.role_movement.icon.changed).length,
  favicon_movements: successes.filter(item => item.role_movement.favicon.changed).length,
  totals: Object.fromEntries(['control', 'treatment', 'delta'].map(kind => [kind, { requests: successes.reduce((sum, item) => sum + item.metrics[kind].requests, 0), bytes: successes.reduce((sum, item) => sum + item.metrics[kind].bytes, 0), duration_ms: successes.reduce((sum, item) => sum + item.metrics[kind].duration_ms, 0) }])),
};
await writeFile(join(output, 'results.jsonl'), `${treatment.map(JSON.stringify).join('\n')}\n`);
await writeFile(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
const cards = changes.map(item => `<article><h2>${item.name}</h2><p>${item.wide.source} · ${item.wide.width}×${item.wide.height}<br>${item.wide.archive_member ?? item.wide.resolved_url}</p><div class="panels"><div class="light"><img src="${item.wide.asset}"></div><div class="dark"><img src="${item.wide.asset}"></div></div></article>`).join('\n');
await writeFile(join(output, 'review.html'), `<!doctype html><meta charset="utf-8"><title>Deep-wide changes</title><style>body{font:14px system-ui;margin:24px}article{margin:0 0 32px}.panels{display:grid;grid-template-columns:1fr 1fr}.panels div{height:180px;display:grid;place-items:center}.light{background:#fff}.dark{background:#111}.panels img{max-width:80%;max-height:120px}</style>${cards}`);
console.log(JSON.stringify(summary, null, 2));
