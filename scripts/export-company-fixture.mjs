import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const args = process.argv.slice(2);
const sourceProject = option('--source-project');
const originalSamplePath = option('--original-sample');
const outputPath = resolve(option('--output') ?? 'fixtures/companies-500.json');
const additionalCount = Number(option('--additional-count') ?? 400);
const seed = option('--seed') ?? 'logo-yoink-2026-08-22';

if (!sourceProject || !originalSamplePath || !Number.isInteger(additionalCount) || additionalCount < 1) {
  console.error('Usage: node scripts/export-company-fixture.mjs --source-project <path> --original-sample <json> [--output <json>] [--additional-count 400] [--seed <seed>]');
  process.exit(1);
}

const originalPayload = JSON.parse(await readFile(resolve(originalSamplePath), 'utf8'));
const originalRows = Array.isArray(originalPayload) ? originalPayload : originalPayload.rows;
if (!Array.isArray(originalRows)) throw new Error('Original sample must be an array or contain a rows array.');

const fetchCount = Math.max(additionalCount + originalRows.length + 100, additionalCount * 2);
const escapedSeed = seed.replaceAll("'", "''");
const sql = `
  select entity_id::text, name, website
  from canonical_v2.startup_directory_projection
  where nullif(btrim(name), '') is not null
    and nullif(btrim(website), '') is not null
  order by md5(entity_id::text || '${escapedSeed}')
  limit ${fetchCount}
`;

const { stdout } = await execute('supabase', ['db', 'query', '--linked', '--output-format', 'json', sql], {
  cwd: resolve(sourceProject),
  maxBuffer: 10 * 1024 * 1024,
});
const queried = JSON.parse(stdout).rows;
if (!Array.isArray(queried)) throw new Error('Supabase CLI did not return a rows array.');

const originalIds = new Set(originalRows.map(row => String(row.entity_id)));
const seenDomains = new Set(originalRows.map(row => normalizeDomain(row.website)).filter(Boolean));
const additions = [];
for (const row of queried) {
  const domain = normalizeDomain(row.website);
  if (!domain || originalIds.has(String(row.entity_id)) || seenDomains.has(domain)) continue;
  seenDomains.add(domain);
  additions.push({ entity_id: String(row.entity_id), name: String(row.name).trim(), website: String(row.website).trim() });
  if (additions.length === additionalCount) break;
}
if (additions.length !== additionalCount) throw new Error(`Only found ${additions.length} unique additions; requested ${additionalCount}.`);

const companies = [
  ...originalRows.map(row => ({ entity_id: String(row.entity_id), name: String(row.name).trim(), website: String(row.website).trim(), cohort: 'original-100' })),
  ...additions.map(row => ({ ...row, cohort: 'additional-400' })),
];
const payload = {
  generatedAt: new Date().toISOString(),
  source: 'canonical_v2.startup_directory_projection',
  seed,
  counts: { total: companies.length, original: originalRows.length, additional: additions.length },
  companies,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${companies.length} companies (${additions.length} new) to ${outputPath}`);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function normalizeDomain(value) {
  try {
    return new URL(/^https?:\/\//i.test(String(value)) ? String(value) : `https://${value}`).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}
