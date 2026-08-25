import { readFile } from 'node:fs/promises';

const legacy = JSON.parse(await readFile(new URL('../../fixtures/companies-500.json', import.meta.url), 'utf8'));
const expanded = JSON.parse(await readFile(new URL('../../fixtures/companies-800.json', import.meta.url), 'utf8'));
validateFixture(legacy, { 'original-100': 100, 'additional-400': 400 });
validateFixture(expanded, { 'original-100': 100, 'additional-400': 400, 'major-brands-300': 300 });
if (JSON.stringify(expanded.companies.slice(0, 500)) !== JSON.stringify(legacy.companies)) {
  throw new Error('The expanded fixture must preserve the frozen 500 rows byte-for-byte at the object level.');
}

console.log('Validated frozen 500-company and expanded 800-company fixtures.');

function validateFixture(payload, expectedCohorts) {
  const companies = payload.companies;
  if (!Array.isArray(companies)) throw new Error('Fixture companies must be an array.');
  if (companies.length !== payload.counts?.total) throw new Error(`Fixture counts.total mismatch: metadata=${payload.counts?.total}, rows=${companies.length}.`);
  for (const [cohort, expected] of Object.entries(expectedCohorts)) {
    if (companies.filter(row => row.cohort === cohort).length !== expected) throw new Error(`Expected ${expected} ${cohort} companies.`);
  }
  const ids = new Set();
  const domains = new Set();
  for (const [index, row] of companies.entries()) {
    if (!row.entity_id || !row.name || !row.website) throw new Error(`Fixture row ${index + 1} is incomplete.`);
    if (ids.has(row.entity_id)) throw new Error(`Duplicate entity_id: ${row.entity_id}`);
    ids.add(row.entity_id);
    const domain = normalizeDomain(row.website);
    if (!domain) throw new Error(`Invalid website at row ${index + 1}: ${row.website}`);
    if (domains.has(domain)) throw new Error(`Duplicate website domain: ${domain}`);
    domains.add(domain);
  }
}

function normalizeDomain(value) {
  try {
    const raw = String(value).trim();
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    const hostname = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (!hostname.includes('.') || !hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
    return hostname;
  } catch {
    return null;
  }
}
