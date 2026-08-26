#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bimiCandidate, lookupBimiAssertion } from '../../src/discover-bimi.mjs';
import { internals as extractorInternals } from '../../src/extractor.mjs';
import { mapConcurrent } from '../../src/concurrency.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function parseArgs(argv) {
  const result = { concurrency: 8, timeoutMs: 2_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[++index];
    if (!value) throw new Error(`Missing value for ${key}.`);
    if (key === '--split') result.split = value;
    else if (key === '--output') result.output = value;
    else if (key === '--concurrency') result.concurrency = Number(value);
    else if (key === '--timeout-ms') result.timeoutMs = Number(value);
    else throw new Error(`Unknown option ${key}.`);
  }
  if (!['development', 'validation'].includes(result.split)) throw new Error('--split must be development or validation.');
  if (!result.output) throw new Error('--output is required.');
  if (!Number.isInteger(result.concurrency) || result.concurrency < 1 || !Number.isInteger(result.timeoutMs) || result.timeoutMs < 1) throw new Error('Invalid numeric option.');
  return result;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

async function hashFile(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const splitPath = resolve(ROOT, 'benchmarks/major-brands-300-v1/splits', `${options.split}.jsonl`);
  const fixturePath = resolve(ROOT, 'fixtures/companies-800.json');
  const assignments = (await readFile(splitPath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const companies = new Map(fixture.companies.map(company => [company.entity_id, company]));
  const startedAt = new Date().toISOString();
  const outcomes = await mapConcurrent(assignments, options.concurrency, async assignment => {
    const company = companies.get(assignment.entity_id);
    if (!company) throw new Error(`Missing fixture entity ${assignment.entity_id}.`);
    const started = performance.now();
    const assertion = await lookupBimiAssertion(company.website, { cache: new Map(), timeoutMs: options.timeoutMs });
    const diagnostics = { requests: 0, bytesDownloaded: 0 };
    let candidate = null;
    if (assertion.status === 'accepted') {
      candidate = await extractorInternals.validateCandidate(bimiCandidate(assertion), options.timeoutMs, diagnostics, MAX_IMAGE_BYTES);
    }
    return {
      entity_id: company.entity_id,
      name: company.name,
      website: company.website,
      assertion_status: assertion.status,
      assertion_reason: assertion.reason ?? null,
      query_name: assertion.queryName ?? `default._bimi.${company.website}`,
      record_sha256: assertion.recordDigest ?? null,
      logo_url: assertion.logoUrl ?? null,
      evidence_document_url: assertion.authorityUrl ?? null,
      evidence_document_present: assertion.evidenceDocumentPresent ?? false,
      certificate_validation: assertion.certificateValidation ?? 'not_performed',
      logo_validation: candidate ? 'valid_safe_svg' : assertion.status === 'accepted' ? 'fetch_or_validation_failed' : 'not_attempted',
      content_sha256: candidate?.observed?.byte_hash ?? null,
      width: candidate?.width ?? null,
      height: candidate?.height ?? null,
      dns_requests: assertion.dnsRequests ?? 0,
      http_requests: diagnostics.requests,
      downloaded_bytes: diagnostics.bytesDownloaded,
      duration_ms: Math.round(performance.now() - started),
    };
  });
  const statusCounts = Object.fromEntries([...new Set(outcomes.map(item => item.assertion_status))].sort().map(status => [status, outcomes.filter(item => item.assertion_status === status).length]));
  const durations = outcomes.map(item => item.duration_ms);
  const summary = {
    schema_version: 1,
    experiment: 'bimi-live-prevalence',
    split: options.split,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    frozen_inputs: {
      fixture: 'fixtures/companies-800.json',
      fixture_sha256: await hashFile(fixturePath),
      split: `benchmarks/major-brands-300-v1/splits/${options.split}.jsonl`,
      split_sha256: await hashFile(splitPath),
      entity_ids: assignments.map(item => item.entity_id),
    },
    settings: { selector: 'default', timeout_ms: options.timeoutMs, max_image_bytes: MAX_IMAGE_BYTES, concurrency: options.concurrency },
    metrics: {
      domains: outcomes.length,
      assertion_statuses: statusCounts,
      domains_with_bimi: outcomes.filter(item => item.assertion_status === 'accepted').length,
      retrievable_valid_safe_svgs: outcomes.filter(item => item.logo_validation === 'valid_safe_svg').length,
      dns_requests: outcomes.reduce((sum, item) => sum + item.dns_requests, 0),
      http_requests: outcomes.reduce((sum, item) => sum + item.http_requests, 0),
      downloaded_bytes: outcomes.reduce((sum, item) => sum + item.downloaded_bytes, 0),
      latency_ms: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95) },
    },
    outcomes,
  };
  const target = resolve(options.output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${target}\n${JSON.stringify(summary.metrics)}\n`);
}

await main();
