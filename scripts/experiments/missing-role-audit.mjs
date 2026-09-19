#!/usr/bin/env node
// Download only the candidates in explicit discovery reports; no identity/search changes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { internals } from '../../src/extractor.mjs';
import { rankCandidates } from '../../src/rank.mjs';
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const reports = option('--reports', 'runs/wikimedia-recall-2026-09-18/development-final-replay.json,runs/wikimedia-recall-2026-09-18/validation-final-replay.json').split(',');
const output = resolve(option('--output', 'runs/missing-logo-program-2026-09-19/roles'));
await mkdir(output, { recursive: true });
const results = [];
for (const report of reports) {
  const rows = JSON.parse(await readFile(resolve(report), 'utf8')).rows;
  for (const row of rows) {
    for (const candidate of row.candidates) {
      const network = { requests: 0, bytesDownloaded: 0 };
      const validated = await internals.validateCandidate(candidate, 10000, network);
      const ranked = rankCandidates(validated ? [validated] : [], {
        companyName: row.name, preferences: { logo: { theme: 'light' }, icon: { theme: 'light' } },
      });
      const result = { report: resolve(report), id: row.id, name: row.name, domain: row.domain,
        network, validated: Boolean(validated), selected: Object.keys(ranked.assets).filter(key => ranked.assets[key]),
        candidate: ranked.candidates[0] ?? candidate };
      results.push(result);
      console.log(JSON.stringify({ id: row.id, validated: result.validated, selected: result.selected }));
      await writeFile(resolve(output, 'audit.json'), JSON.stringify(results, null, 2) + '\n');
    }
  }
}
