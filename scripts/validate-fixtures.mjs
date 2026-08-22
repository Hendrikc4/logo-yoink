import { readFile } from 'node:fs/promises';

const payload = JSON.parse(await readFile(new URL('../fixtures/companies-500.json', import.meta.url), 'utf8'));
const companies = payload.companies;
if (!Array.isArray(companies)) throw new Error('Fixture companies must be an array.');
if (companies.length !== 500) throw new Error(`Expected 500 companies, found ${companies.length}.`);
if (companies.filter(row => row.cohort === 'original-100').length !== 100) throw new Error('Expected 100 original benchmark companies.');
if (companies.filter(row => row.cohort === 'additional-400').length !== 400) throw new Error('Expected 400 additional companies.');

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

console.log(`Validated ${companies.length} unique company fixtures.`);

function normalizeDomain(value) {
  try {
    return new URL(/^https?:\/\//i.test(String(value)) ? String(value) : `https://${value}`).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}
