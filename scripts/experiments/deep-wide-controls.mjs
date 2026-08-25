#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { extractLogos } from '../../src/extractor.mjs';

const output = process.argv[2] ? resolve(process.argv[2]) : null;
const controls = [
  ['anthropic.com', 'Anthropic', false],
  ['stripe.com', 'Stripe', false],
  ['github.com', 'GitHub', false],
  ['cloudflare.com', 'Cloudflare', false],
  ['katalon.com', 'Katalon', false],
  ['slack.com', 'Slack', false],
  ['pnptc.com', 'Plug and Play', true],
];
const results = [];
for (const [website, companyName, spaBundles] of controls) {
  try {
    const result = await extractLogos(website, { companyName, deepWide: true, forceDeepWide: true, spaBundles, roleAwareBudget: true, contentBoundingWide: true, timeoutMs: 12_000 });
    const deepCandidates = result.candidates.filter(item => ['official-archive', 'official-direct', 'spa-bundle'].includes(item.source));
    results.push({ website, company_name: companyName, status: 'success', selected_wide: result.selectedByRole.wide ? { source: result.selectedByRole.wide.source, url: result.selectedByRole.wide.resolved_url, archive_member: result.selectedByRole.wide.evidence?.archive_member, width: result.selectedByRole.wide.width, height: result.selectedByRole.wide.height } : null, deep_candidates: deepCandidates.map(item => ({ source: item.source, url: item.resolved_url, archive_member: item.evidence?.archive_member, theme: item.evidence?.theme, width: item.width, height: item.height, roles: item.predicted_roles })), diagnostics: result.diagnostics.deepWide, metrics: { requests: result.diagnostics.requests, bytes: result.diagnostics.bytesDownloaded, duration_ms: result.diagnostics.durationMs } });
  } catch (error) { results.push({ website, company_name: companyName, status: 'failure', error: error.message }); }
}
if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(results, null, 2)}\n`); }
console.log(JSON.stringify(results, null, 2));
