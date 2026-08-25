#!/usr/bin/env node

import { lookup as dnsLookup } from 'node:dns/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomUtils, parseDocument } from 'htmlparser2';
import { canonicalHostname, isIpAddress, isPrivateIp } from '../../src/network-safety.mjs';

const [command, runArg, artifactArg] = process.argv.slice(2);
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FIXTURE = resolve(ROOT, 'fixtures/companies-500.json');
const BEFORE = resolve(ROOT, 'labels/review-500-before-precision-2026-08-22.jsonl');
const FINAL = resolve(ROOT, 'labels/review-500-final-2026-08-22.jsonl');

const HARMFUL_IDENTITY_IDS = new Set([
  '8833fe2c-37ff-5939-ae80-46b6503b3a98', // Haryon / unrelated casino
  '0dae4932-edb9-4195-b92d-50cd79b5ebce', // Bhr / RealReports, same-domain repurposing
  '15d7129b-f412-5429-9dd7-0ea6d827a477', // RapidVerify / 789BET
  'a2d6b35a-dffb-595f-b021-3e4596aa23f7', // BanterAI / jwsatinfo
  'c86e510f-e118-5aa5-826f-5d9d7efdcae2', // NUMiX / Meriam Hoki
  'b458cf0f-7bc3-589b-9a18-1ce145f7462a', // Obseva / 90PHUT
]);

const LEGAL_SUFFIXES = new Set(['ag', 'co', 'company', 'corp', 'corporation', 'gmbh', 'inc', 'incorporated', 'ltd', 'limited', 'llc', 'plc']);
const ROLE_NAMES = ['icon', 'wide'];
const VERIFIED_FINAL_CORRECT_SELECTIONS = 576;
const VERIFIED_REACHABLE_DOMAINS = 423;

async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function jsonl(path) {
  return (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

async function assertPublic(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('unsafe URL');
  const host = canonicalHostname(parsed.hostname);
  if (host === 'localhost' || host.endsWith('.local') || isPrivateIp(host)) throw new Error('non-public URL');
  if (!isIpAddress(host)) {
    const addresses = await dnsLookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) throw new Error('non-public DNS result');
  }
}

async function fetchHomepage(website) {
  let current = /^https?:/i.test(website) ? website : `https://${website}`;
  const started = performance.now();
  let requests = 0;
  for (let redirect = 0; redirect <= 5; redirect++) {
    await assertPublic(current);
    requests++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual', signal: controller.signal,
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0 (compatible; LogoYoinkIdentityExperiment/0.1)' },
      });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`redirect ${response.status} without location`);
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body?.getReader();
    const chunks = [];
    let length = 0;
    const bodyTimer = setTimeout(() => controller.abort(), 12_000);
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = 2 * 1024 * 1024 - length;
        if (value.length > remaining) {
          chunks.push(Buffer.from(value.subarray(0, remaining)));
          length += remaining;
          await reader.cancel();
          break;
        }
        chunks.push(Buffer.from(value));
        length += value.length;
      }
    } finally { clearTimeout(bodyTimer); }
    const bytes = Buffer.concat(chunks);
    return { final_url: response.url || current, html: bytes.toString('utf8'), metrics: {
      requests, bytes: bytes.length, latency_ms: Math.round(performance.now() - started),
    } };
  }
  throw new Error('too many redirects');
}

function structuredIdentity(html, base) {
  const document = parseDocument(html, { decodeEntities: true, lowerCaseAttributeNames: true });
  const nodes = DomUtils.findAll(DomUtils.isTag, document.children);
  const signals = [];
  for (const node of nodes) {
    const attributes = node.attribs ?? {};
    if (node.name === 'link' && String(attributes.rel ?? '').toLowerCase().split(/\s+/).includes('canonical') && attributes.href) {
      try { signals.push({ type: 'canonical_url', value: new URL(attributes.href, base).href }); } catch { /* diagnostic only */ }
    }
    if (node.name === 'meta') {
      const key = String(attributes.property ?? attributes.name ?? '').toLowerCase();
      if (key === 'og:site_name' && attributes.content?.trim()) signals.push({ type: 'og_site_name', value: attributes.content.trim() });
      if (key === 'og:url' && attributes.content) {
        try { signals.push({ type: 'og_url', value: new URL(attributes.content, base).href }); } catch { /* diagnostic only */ }
      }
    }
  }
  const visit = (value, path = '$') => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, `${path}[${index}]`));
    const types = (Array.isArray(value['@type']) ? value['@type'] : [value['@type']]).map(String);
    if (types.some(type => /^(?:Organization|Corporation|Business|Brand|NGO)$/i.test(type))) {
      if (typeof value.name === 'string' && value.name.trim()) signals.push({ type: 'jsonld_name', value: value.name.trim(), path });
      const urls = Array.isArray(value.url) ? value.url : [value.url];
      for (const url of urls) if (typeof url === 'string') {
        try { signals.push({ type: 'jsonld_url', value: new URL(url, base).href, path }); } catch { /* diagnostic only */ }
      }
    }
    for (const [key, child] of Object.entries(value)) if (key !== '@context') visit(child, `${path}.${key}`);
  };
  for (const node of nodes.filter(item => item.name === 'script' && /application\/ld\+json/i.test(item.attribs?.type ?? ''))) {
    try { visit(JSON.parse(DomUtils.textContent(node).trim())); } catch { /* malformed JSON-LD is absence, not conflict */ }
  }
  return signals;
}

function normalizeName(value) {
  const words = String(value ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]+/g) ?? [];
  while (words.length > 1 && LEGAL_SUFFIXES.has(words.at(-1))) words.pop();
  return words.join(' ');
}

function expectedNames(entry) {
  const label = new Set([normalizeName(entry.name)]);
  const firstHostLabel = new URL(`https://${entry.website}`).hostname.replace(/^www\./, '').split('.')[0];
  label.add(normalizeName(firstHostLabel));
  return label;
}

export function evaluate(entry) {
  const names = (entry.observation?.signals ?? []).filter(item => ['jsonld_name', 'og_site_name'].includes(item.type));
  const expected = expectedNames(entry);
  const declarations = names.map(item => ({ ...item, normalized: normalizeName(item.value) })).filter(item => item.normalized);
  const agreements = declarations.filter(item => expected.has(item.normalized));
  const conflicts = declarations.filter(item => !expected.has(item.normalized));
  const conflictTypes = new Set(conflicts.map(item => item.type));
  const foreignNameCounts = new Map();
  for (const item of conflicts) foreignNameCounts.set(item.normalized, (foreignNameCounts.get(item.normalized) ?? new Set()).add(item.type));
  const corroborated = [...foreignNameCounts.entries()].filter(([, types]) => types.size >= 2).map(([name]) => name);
  const urlDiagnostics = (entry.observation?.signals ?? []).filter(item => item.type.endsWith('_url'));
  const requestedHost = new URL(`https://${entry.website}`).hostname.replace(/^www\./, '').toLowerCase();
  const foreignHostSiteName = declarations.some(item => {
    if (item.type !== 'og_site_name' || !/^(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}$/i.test(item.value)) return false;
    return item.value.toLowerCase().replace(/^www\./, '') !== requestedHost;
  });
  return {
    expected_names: [...expected], declarations, agreements, conflicts, url_diagnostics: urlDiagnostics,
    policies: {
      single_structured_name_conflict: agreements.length === 0 && conflicts.length > 0 ? 'quarantine' : 'retain',
      two_source_same_name_conflict: agreements.length === 0 && conflictTypes.size >= 2 && corroborated.length > 0 ? 'quarantine' : 'retain',
      foreign_hostname_site_name: foreignHostSiteName ? 'quarantine' : 'retain',
    },
  };
}

async function build(runDirectory, artifactPath) {
  const fixture = (await json(FIXTURE)).companies;
  const fixtures = new Map(fixture.map(item => [item.entity_id, item]));
  const before = await jsonl(BEFORE), final = await jsonl(FINAL);
  const results = await jsonl(resolve(runDirectory, 'results.jsonl'));
  const resultById = new Map(results.map(item => [item.entity_id, item]));
  const beforeById = Map.groupBy(before, item => item.entity_id);
  const finalById = Map.groupBy(final, item => item.entity_id);
  const ids = new Set([
    ...before.filter(item => item.identity !== 'correct').map(item => item.entity_id),
    ...final.filter(item => item.identity === 'ambiguous').map(item => item.entity_id),
    ...results.filter(item => item.reachability === 'redirected_off_domain').map(item => item.entity_id),
  ]);
  const entries = [];
  for (const entityId of [...ids].sort()) {
    const company = fixtures.get(entityId), result = resultById.get(entityId);
    const prior = beforeById.get(entityId) ?? [], currentLabels = finalById.get(entityId) ?? [];
    const ambiguous = currentLabels.some(item => item.identity === 'ambiguous');
    const historicalWrong = prior.filter(item => item.identity === 'wrong');
    const expected = HARMFUL_IDENTITY_IDS.has(entityId) ? 'quarantine' : ambiguous ? 'unresolved' : 'retain';
    let observation;
    try {
      const fetched = await fetchHomepage(company.website);
      observation = { status: 'ok', final_url: fetched.final_url, signals: structuredIdentity(fetched.html, fetched.final_url), metrics: fetched.metrics };
    } catch (error) { observation = { status: 'failure', error: String(error?.message ?? error), signals: [], metrics: null }; }
    entries.push({
      entity_id: entityId, name: company.name, website: company.website, expected,
      categories: {
        historical_wrong_selection: historicalWrong.length > 0,
        historical_wrong_roles: historicalWrong.map(item => item.role),
        final_ambiguous_identity: ambiguous,
        fresh_off_domain_redirect: result?.reachability === 'redirected_off_domain',
        same_domain_repurposing: entityId === '0dae4932-edb9-4195-b92d-50cd79b5ebce',
      },
      historical_labels: prior.filter(item => item.identity !== 'correct'),
      final_labels: currentLabels.filter(item => item.identity !== 'correct'),
      final_correct_labels: currentLabels.filter(item => item.identity === 'correct'),
      current_main: result ? { reachability: result.reachability, homepage: result.homepage, selected_by_role: result.selected_by_role } : null,
      observation,
    });
  }
  const artifact = {
    schema_version: 1, generated_at: new Date().toISOString(), source_run: runDirectory,
    source_run_git_revision: (await json(resolve(runDirectory, 'config.json'))).git_revision,
    source_run_summary: await json(resolve(runDirectory, 'summary.json')),
    construction: 'Union of all non-correct before labels, all ambiguous final labels, and every fresh off-domain redirect.',
    entries,
  };
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

function summarize(artifact) {
  const policies = ['single_structured_name_conflict', 'two_source_same_name_conflict', 'foreign_hostname_site_name'];
  const rows = artifact.entries.map(entry => ({ entry, evaluation: evaluate(entry) }));
  const summaries = {};
  for (const policy of policies) {
    let historicalHarmfulVetoes = 0, currentHarmfulVetoes = 0, falseQuarantines = 0, unresolvedQuarantines = 0;
    let unresolvedCases = 0, historicalCorrectRetained = VERIFIED_FINAL_CORRECT_SELECTIONS, historicalScoreDelta = 0;
    const roleLosses = { icon: 0, wide: 0, favicon: 0 };
    const changed = [];
    for (const row of rows) {
      const action = row.evaluation.policies[policy];
      if (action === 'quarantine') {
        changed.push({ entity_id: row.entry.entity_id, name: row.entry.name, expected: row.entry.expected, declarations: row.evaluation.declarations });
        for (const role of ['icon', 'wide', 'favicon']) if (row.entry.current_main?.selected_by_role?.[role]) roleLosses[role]++;
        if (row.entry.expected === 'quarantine') {
          historicalHarmfulVetoes += row.entry.categories.historical_wrong_roles.length;
          currentHarmfulVetoes += ROLE_NAMES.filter(role => row.entry.current_main?.selected_by_role?.[role]).length;
        } else if (row.entry.expected === 'unresolved') unresolvedQuarantines++;
        else falseQuarantines++;
      } else if (row.entry.expected === 'unresolved') unresolvedCases++;
      const finalCorrect = row.entry.final_correct_labels ?? [];
      if (action === 'quarantine') for (const label of finalCorrect) {
        historicalCorrectRetained--;
        const usability = typeof label.usability === 'object'
          ? (['light', 'dark'].map(key => ({ good: 1, conditional: 0.5, unusable: 0 })[label.usability[key]] ?? 0).reduce((a, b) => a + b, 0) / 2)
          : ({ good: 1, conditional: 0.5, unusable: 0 })[label.usability] ?? 0;
        historicalScoreDelta -= (15 + 15 + 10 * usability) / VERIFIED_REACHABLE_DOMAINS;
      }
    }
    summaries[policy] = {
      historical_harmful_selection_vetoes: historicalHarmfulVetoes,
      current_harmful_selection_vetoes: currentHarmfulVetoes,
      false_quarantines: falseQuarantines,
      unresolved_quarantines: unresolvedQuarantines,
      unresolved_cases: unresolvedCases,
      historical_correct_selections_retained: historicalCorrectRetained,
      current_role_coverage_delta: Object.fromEntries(Object.entries(roleLosses).map(([role, count]) => [role, -count])),
      current_wrong_brand_domains_delta: 0,
      verified_71_97_score_delta: Math.round(historicalScoreDelta * 100) / 100,
      changed,
    };
  }
  return {
    challenge_entries: rows.length,
    historical_wrong_selection_records: artifact.entries.reduce((sum, entry) => sum + entry.categories.historical_wrong_roles.length, 0),
    final_ambiguous_records: artifact.entries.reduce((sum, entry) => sum + entry.final_labels.length, 0),
    observations_ok: artifact.entries.filter(entry => entry.observation.status === 'ok').length,
    observation_cost: {
      requests: artifact.entries.reduce((sum, entry) => sum + (entry.observation.metrics?.requests ?? 0), 0),
      bytes: artifact.entries.reduce((sum, entry) => sum + (entry.observation.metrics?.bytes ?? 0), 0),
      latency_ms_total: artifact.entries.reduce((sum, entry) => sum + (entry.observation.metrics?.latency_ms ?? 0), 0),
    },
    policies: summaries,
  };
}

async function main() {
  if (command === 'freeze') {
    if (!runArg || !artifactArg) throw new Error('Usage: identity-quarantine-challenge.mjs freeze <all-500-run> <artifact.json>');
    const artifact = await build(runArg, resolve(artifactArg));
    process.stdout.write(`${JSON.stringify(summarize(artifact), null, 2)}\n`);
  } else if (command === 'evaluate') {
    if (!runArg) throw new Error('Usage: identity-quarantine-challenge.mjs evaluate <artifact.json>');
    process.stdout.write(`${JSON.stringify(summarize(await json(resolve(runArg))), null, 2)}\n`);
  } else {
    throw new Error('Usage: identity-quarantine-challenge.mjs <freeze|evaluate> ...');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`identity quarantine challenge: ${error.message}\n`); process.exitCode = 1; });
}
