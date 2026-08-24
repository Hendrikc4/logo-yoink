#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { internals } from '../src/extractor.mjs';
import { rankCandidates } from '../src/rank.mjs';
import { sanitizeCandidate, summarizeResults } from './benchmark.mjs';

const ROLES = ['icon', 'wide', 'favicon'];

async function jsonl(path) {
  return (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

export function explicitBrowserIdentity(item) {
  const evidence = item?.evidence ?? {};
  if (!evidence.home_linked || !evidence.positive_token) return null;
  const text = String(evidence.alt || evidence.aria_label || '').trim();
  const match = text.match(/^(.{2,80}?)\s+(?:logo|wordmark|brandmark|logomark)$/i);
  return match?.[1]?.trim() || null;
}

function words(value) {
  return String(value ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function conflictsWithRequestedIdentity(item, record) {
  const declared = explicitBrowserIdentity(item);
  if (!declared) return false;
  const requested = new Set([...words(record.name), ...words(record.domain)]);
  const declaredWords = words(declared).filter(word => word.length >= 3 && !['the', 'inc', 'company'].includes(word));
  const requestedCompact = words(`${record.name} ${record.domain}`).join('');
  const declaredCompact = words(declared).join('');
  const compactAgreement = declaredCompact.length >= 4 && (
    requestedCompact.includes(declaredCompact) || declaredCompact.includes(words(record.name).join(''))
  );
  return declaredWords.length > 0 && !compactAgreement && !declaredWords.some(word => requested.has(word));
}

export async function replayRecord(record, artifacts, assetsDirectory) {
  if (record.selected_by_role?.wide) return { record, added: 0, conflicts: [] };
  const knownHashes = new Set(record.candidates.map(item => item.observed?.byte_hash).filter(Boolean));
  const knownUrls = new Set(record.candidates.flatMap(item => [item.url, item.resolvedUrl, item.resolved_url]).filter(Boolean));
  const validated = artifacts.flatMap(artifact => (artifact.candidates ?? []).map(entry => entry.validated).filter(Boolean));
  const conflicts = validated.filter(item => conflictsWithRequestedIdentity(item, record));
  const extras = validated.filter(item => !conflicts.includes(item))
    .filter(item => !knownHashes.has(item.observed?.byte_hash) &&
      ![item.url, item.resolvedUrl, item.resolved_url].some(url => url && knownUrls.has(url)));
  if (!extras.length) return { record, added: 0, conflicts };
  const stats = { boxes: 0 };
  await internals.attachContentBoxes(extras, true, record.name, stats);
  const sanitized = await Promise.all(extras.map(item => sanitizeCandidate(item, record.entity_id, assetsDirectory)));
  const ranked = rankCandidates(internals.dedupeBytes([...record.candidates, ...sanitized]), { companyName: record.name });
  return {
    record: {
      ...record,
      candidates: ranked.candidates,
      selected_by_role: Object.fromEntries(ROLES.map(role => [role, role === 'wide'
        ? ranked.selectedByRole[role]?.candidate_id ?? null
        : record.selected_by_role?.[role] ?? null])),
      diagnostics: { ...record.diagnostics, async_browser_replay: {
        observation_keys: artifacts.map(item => item.observation_key),
        validated_added: sanitized.length,
        identity_conflicts: conflicts.map(item => ({
          declared_identity: explicitBrowserIdentity(item),
          url: item.resolvedUrl ?? item.resolved_url ?? item.url,
        })),
      } },
    },
    added: sanitized.length,
    conflicts,
  };
}

async function main() {
  const [runArg, observationsArg, outputArg] = process.argv.slice(2);
  if (!runArg || !observationsArg || !outputArg) {
    throw new Error('Usage: node scripts/replay-browser-observations.mjs <static-run> <observations> <output-run>');
  }
  const runDirectory = resolve(runArg);
  const observationsDirectory = resolve(observationsArg);
  const outputDirectory = resolve(outputArg);
  const assetsDirectory = join(outputDirectory, 'assets');
  await mkdir(assetsDirectory, { recursive: true });
  const byEntity = new Map();
  for (const name of (await readdir(observationsDirectory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
    const artifact = JSON.parse(await readFile(join(observationsDirectory, name), 'utf8'));
    byEntity.set(artifact.entity_id, [...byEntity.get(artifact.entity_id) ?? [], artifact]);
  }
  const results = await jsonl(join(runDirectory, 'results.jsonl'));
  let treated = 0, additions = 0, conflicts = 0;
  const output = [];
  for (const record of results) {
    const artifacts = byEntity.get(record.entity_id) ?? [];
    const replay = artifacts.length ? await replayRecord(record, artifacts, assetsDirectory) : { record, added: 0, conflicts: [] };
    if (replay.added) treated++;
    additions += replay.added;
    conflicts += replay.conflicts.length;
    output.push(replay.record);
  }
  await writeFile(join(outputDirectory, 'results.jsonl'), `${output.map(JSON.stringify).join('\n')}\n`);
  const summary = summarizeResults(output, { run_id: 'async-browser-replay', parent_run: runDirectory });
  summary.async_browser_replay = { treated_domains: treated, validated_additions: additions, identity_conflicts: conflicts };
  await writeFile(join(outputDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${outputDirectory}\nwide ${summary.roles.wide.domains}; treated ${treated}; additions ${additions}; identity conflicts ${conflicts}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch(error => { process.stderr.write(`browser observation replay: ${error.message}\n`); process.exitCode = 1; });
}
