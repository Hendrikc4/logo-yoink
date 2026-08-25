import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { RANKING_VERSION } from '../../src/rank.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const qualification = JSON.parse(await readFile(resolve(root, 'benchmarks/frozen-baseline-qualification.json'), 'utf8'));
const readme = await readFile(resolve(root, 'README.md'), 'utf8');

if (qualification.acknowledged_runtime_ranking_version !== RANKING_VERSION) {
  throw new Error(`Ranking changed to v${RANKING_VERSION} without updating benchmark qualification status (acknowledged v${qualification.acknowledged_runtime_ranking_version}).`);
}
if (qualification.captured_ranking_version !== RANKING_VERSION && qualification.qualifies_current_runtime !== false) {
  throw new Error('Frozen metrics must not qualify a different runtime ranking version.');
}
if (!readme.includes(`captured under ranking version ${qualification.captured_ranking_version}`)) {
  throw new Error('README frozen metrics must state their captured ranking version.');
}
console.log(`Benchmark qualification is explicit: frozen v${qualification.captured_ranking_version}, runtime v${RANKING_VERSION}, runtime-qualified=${qualification.qualifies_current_runtime}.`);
