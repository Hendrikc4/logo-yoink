import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  buildLabelSheets, packEntities, parseArgs, prepareEntities,
  validateLabelResponses, validatePacket, validateResponse,
} from '../scripts/review/visual-label-sheets.mjs';
import { validateCanonicalLabel } from '../benchmark/lib/labels.mjs';
import { validateRecord } from '../scripts/benchmark/visual-benchmark-validate.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function writeJsonl(path, rows) {
  await writeFile(path, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
}

async function syntheticRun({ extraCandidates = [] } = {}) {
  const run = await mkdtemp(join(tmpdir(), 'logo-label-sheets-'));
  await mkdir(join(run, 'assets'));
  await writeFile(join(run, 'assets', 'one.png'), PNG);
  await writeFile(join(run, 'assets', 'two.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="#123456"/></svg>');
  await writeJsonl(join(run, 'entities.jsonl'), [
    { entity_id: 'acme', name: 'Acme', website: 'acme.example' },
    { entity_id: 'beta', name: 'Beta', website: 'beta.example' },
  ]);
  await writeJsonl(join(run, 'candidates.jsonl'), [
    { entity_id: 'acme', candidate_id: 'acme-icon', content_hash: 'same', asset_path: 'assets/one.png', format: 'png', width: 64, height: 64, score: 100 },
    { entity_id: 'acme', candidate_id: 'acme-icon-alias', content_hash: 'same', asset_path: 'assets/one.png', format: 'png', width: 64, height: 64, score: 1 },
    { entity_id: 'acme', candidate_id: 'acme-wide', content_hash: 'wide', asset_path: 'assets/two.svg', format: 'svg', width: 300, height: 80 },
    { entity_id: 'beta', candidate_id: 'beta-logo', content_hash: 'beta', asset_path: 'assets/one.png', format: 'png', width: 64, height: 64 },
    ...extraCandidates,
  ]);
  return run;
}

function emptyResponse(sheet) {
  return {
    sheet_id: sheet.sheet_id, packet_fingerprint: sheet.packet_fingerprint, reviewed: true,
    logos: [], best: { icon: [], wide: [], favicon: [], stacked: [] }, uncertain: [],
  };
}

test('parses bounded sheet options and explicit overwrite', () => {
  assert.deepEqual(parseArgs(['--help']), { command: '', help: true });
  assert.deepEqual(parseArgs(['build', '--run', 'runs/x', '--max-candidates=24', '--overwrite']), { command: 'build', run: 'runs/x', maxCandidates: 24, overwrite: true });
  assert.throws(() => parseArgs(['build', '--max-candidates', '25']), /1 to 24/);
});

test('preserves missing previews, deduplicates aliases only within a company, and orders deterministically', () => {
  const entities = [{ entity_id: 'b' }, { entity_id: 'a' }];
  const candidates = [
    { entity_id: 'a', candidate_id: 'a1', content_hash: 'same', asset_path: 'x' },
    { entity_id: 'a', candidate_id: 'a2', content_hash: 'same' },
    { entity_id: 'a', candidate_id: 'missing', asset_path: '' },
    { entity_id: 'b', candidate_id: 'b1', content_hash: 'same', asset_path: 'x' },
  ];
  const prepared = prepareEntities(entities, candidates);
  assert.deepEqual(prepareEntities([...entities].reverse(), [...candidates].reverse()), prepared);
  assert.equal(prepared.flatMap(entity => entity.candidates).length, 3);
  const company = prepared.find(entity => entity.entity_id === 'a');
  assert.deepEqual(company.candidates.find(candidate => candidate.content_hash === 'same').candidate_ids, ['a1', 'a2']);
  assert.ok(company.candidates.some(candidate => candidate.candidate_ids.includes('missing')));
});

test('omits ambiguous redirect candidates from v3 sheets and records an abstention', async () => {
  const run = await mkdtemp(join(tmpdir(), 'logo-yoink-label-abstention-'));
  await mkdir(join(run, 'assets'), { recursive: true });
  await writeFile(join(run, 'assets', 'one.png'), PNG);
  await writeJsonl(join(run, 'entities.jsonl'), [
    { entity_id: 'current', name: 'Current', website: 'current.example' },
    { entity_id: 'parked', name: 'Parked', website: 'parked.example' },
  ]);
  await writeJsonl(join(run, 'captures.jsonl'), [
    { entity_id: 'current', identity_status: 'current', reachability: 'live_first_party' },
    { entity_id: 'parked', identity_status: 'ambiguous', reachability: 'redirected_off_domain' },
  ]);
  await writeJsonl(join(run, 'candidates.jsonl'), [
    { entity_id: 'current', candidate_id: 'current-logo', content_hash: 'current', asset_path: 'assets/one.png', format: 'png', width: 1, height: 1 },
    { entity_id: 'current', candidate_id: 'current-partner-logo', content_hash: 'partner', asset_path: 'assets/one.png', format: 'png', width: 1, height: 1, score_reasons: ['generic exclusion (customer or partner logo) -100'] },
    { entity_id: 'parked', candidate_id: 'parked-favicon', content_hash: 'parked', asset_path: 'assets/one.png', format: 'png', width: 1, height: 1 },
  ]);
  const index = await buildLabelSheets({ runDirectory: run, outputDirectory: join(run, 'packet') });
  assert.equal(index.candidate_count, 2);
  assert.ok(index.sheets.flatMap(sheet => sheet.entities).flatMap(entity => entity.candidates).some(candidate => candidate.candidate_ids.includes('current-partner-logo')));
  assert.deepEqual(index.abstentions.map(item => item.entity_id), ['parked']);
});

test('chunks an oversized company and never exceeds the readable tile limit', () => {
  const candidates = Array.from({ length: 25 }, (_, index) => ({ candidate_id: `c${index}`, candidate_ids: [`c${index}`] }));
  const sheets = packEntities([{ entity_id: 'large', candidates }], { maxCandidates: 10, maxEntities: 4 });
  assert.deepEqual(sheets.map(sheet => sheet[0].candidates.length), [10, 10, 5]);
  assert.deepEqual(sheets.map(sheet => sheet[0].chunk_index), [1, 2, 3]);
  assert.ok(sheets.every(sheet => sheet.flatMap(entity => entity.candidates).length <= 10));
});

test('builds stable v3 PNG sheets including unavailable previews without rank signals', async () => {
  const run = await syntheticRun({ extraCandidates: [
    { entity_id: 'beta', candidate_id: 'beta-missing', content_hash: 'missing-preview' },
    { entity_id: 'beta', candidate_id: 'beta-corrupt', content_hash: 'corrupt-preview', asset_path: 'assets/not-an-image.png' },
  ] });
  const first = await buildLabelSheets({ runDirectory: run, outputDirectory: join(run, 'packet-a') });
  const sourceRows = (await readFile(join(run, 'candidates.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse).reverse();
  await writeJsonl(join(run, 'candidates.jsonl'), sourceRows);
  const second = await buildLabelSheets({ runDirectory: run, outputDirectory: join(run, 'packet-b') });
  assert.deepEqual(second, first);
  assert.equal(first.schema_version, 'visual-label-sheets-v3');
  assert.equal(first.candidate_count, 6);
  assert.equal(first.visual_candidate_count, 5);
  assert.ok(first.sheets.every(sheet => /^sha256:[a-f0-9]{64}$/.test(sheet.packet_fingerprint)));
  const metadata = await sharp(join(run, 'packet-a', first.sheets[0].image)).metadata();
  assert.equal(metadata.format, 'png');
  assert.ok(metadata.height < 3000);
  assert.match(await readFile(join(run, 'packet-a', 'prompt.md'), 'utf8'), /packet_fingerprint/);
  assert.doesNotMatch(await readFile(join(run, 'packet-a', 'sheets.jsonl'), 'utf8'), /role_scores|predicted_roles|score_reasons|"score"/);
  await validatePacket(join(run, 'packet-a'));
});

test('expands aliases and emits canonical labels stamped from importer identity and pass', async () => {
  const run = await syntheticRun();
  const packet = join(run, 'packet');
  const index = await buildLabelSheets({ runDirectory: run, outputDirectory: packet });
  const sheet = index.sheets[0];
  const flat = sheet.entities.flatMap(entity => entity.candidates.map(candidate => ({ entity, candidate })));
  const acmeWide = flat.find(item => item.candidate.candidate_id === 'acme-wide').candidate.n;
  const beta = flat.find(item => item.candidate.candidate_id === 'beta-logo').candidate.n;
  const response = {
    ...emptyResponse(sheet), logos: [{ n: acmeWide, roles: ['wide'], works_on: ['light', 'dark'] }],
    best: { icon: [], wide: [acmeWide], favicon: [], stacked: [] }, uncertain: [beta],
  };
  const expanded = validateResponse(response, sheet);
  assert.equal(expanded.length, 4);
  assert.equal(expanded.find(row => row.candidate_id === 'acme-wide').identity, 'correct');
  assert.equal(expanded.find(row => row.candidate_id === 'beta-logo').identity, 'ambiguous');
  assert.equal(expanded.find(row => row.candidate_id === 'acme-icon').identity, 'wrong');
  assert.equal(expanded.find(row => row.candidate_id === 'acme-wide').safety_class, 'correct_brand');
  assert.equal(expanded.find(row => row.candidate_id === 'beta-logo').safety_class, 'unjudgeable');
  assert.equal(expanded.find(row => row.candidate_id === 'acme-icon').safety_class, 'unclassified_negative');

  const responses = join(run, 'responses.jsonl');
  await writeJsonl(responses, [response]);
  const result = await validateLabelResponses({ packetDirectory: packet, labelsPath: responses, reviewerId: 'luna-17', reviewPass: 'primary' });
  const rows = (await readFile(result.output, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 4);
  assert.ok(rows.every(row => row.schema_version === 'visual-benchmark-v1' && row.record_type === 'label' && row.label_kind === 'candidate'));
  assert.ok(rows.every(row => row.reviewer_id === 'luna-17' && row.review_pass === 'primary'));
  assert.ok(rows.every(row => row.provenance.prompt_version === 'visual-label-sheets-v3-candidate-only'));
  assert.ok(rows.every((row, indexRow) => validateCanonicalLabel(row, `row ${indexRow}`)));
  assert.ok(rows.every((row, indexRow) => validateRecord(row, `row ${indexRow}`)));
  const wide = rows.find(row => row.candidate_id === 'acme-wide');
  assert.equal(wide.values.best_for_role.wide, true);
  assert.equal(wide.values.usability_light, 'good');
  assert.equal(wide.values.safety_class, 'correct_brand');
});

test('rejects stale fingerprints, arbitrary reviewer metadata, and tampered packet images', async () => {
  const run = await syntheticRun();
  const packet = join(run, 'packet');
  const index = await buildLabelSheets({ runDirectory: run, outputDirectory: packet });
  const sheet = index.sheets[0];
  assert.throws(() => validateResponse({ ...emptyResponse(sheet), packet_fingerprint: 'sha256:stale' }, sheet), /packet_fingerprint/);
  assert.throws(() => validateResponse({ ...emptyResponse(sheet), reviewer: 'self-asserted' }, sheet), /unexpected response field/);
  await writeFile(join(packet, sheet.image), PNG);
  await assert.rejects(validatePacket(packet), /image_sha256 mismatch/);
});

test('validates best choices globally across chunks', async () => {
  const run = await syntheticRun({ extraCandidates: Array.from({ length: 3 }, (_, index) => ({
    entity_id: 'beta', candidate_id: `beta-extra-${index}`, content_hash: `extra-${index}`, asset_path: 'assets/one.png',
  })) });
  const packet = join(run, 'packet');
  const index = await buildLabelSheets({ runDirectory: run, outputDirectory: packet, maxCandidates: 2 });
  assert.ok(index.sheets.filter(sheet => sheet.entities.some(entity => entity.entity_id === 'beta')).length > 1);
  const responses = index.sheets.map(sheet => {
    const response = emptyResponse(sheet);
    const candidate = sheet.entities.find(entity => entity.entity_id === 'beta')?.candidates[0];
    if (candidate) {
      response.logos = [{ n: candidate.n, roles: ['icon'], works_on: ['light'] }];
      response.best.icon = [candidate.n];
    }
    return response;
  });
  const responsePath = join(run, 'responses.jsonl');
  await writeJsonl(responsePath, responses);
  await assert.rejects(validateLabelResponses({ packetDirectory: packet, labelsPath: responsePath, reviewerId: 'reviewer', reviewPass: 'primary' }), /selects more than one candidate globally/);
});

test('enforces exact completeness, required importer metadata, and atomic overwrite', async () => {
  const run = await syntheticRun();
  const packet = join(run, 'packet');
  const index = await buildLabelSheets({ runDirectory: run, outputDirectory: packet });
  const responses = join(run, 'responses.jsonl');
  await writeJsonl(responses, index.sheets.map(emptyResponse));
  await assert.rejects(validateLabelResponses({ packetDirectory: packet, labelsPath: responses, reviewPass: 'primary' }), /reviewer identity is required/);
  const output = join(run, 'canonical-candidate-labels.jsonl');
  await validateLabelResponses({ packetDirectory: packet, labelsPath: responses, outputPath: output, reviewerId: 'reviewer', reviewPass: 'primary' });
  await assert.rejects(validateLabelResponses({ packetDirectory: packet, labelsPath: responses, outputPath: output, reviewerId: 'reviewer', reviewPass: 'primary' }), /Refusing to overwrite/);
  await validateLabelResponses({ packetDirectory: packet, labelsPath: responses, outputPath: output, reviewerId: 'reviewer', reviewPass: 'primary', overwrite: true });
  await assert.rejects(buildLabelSheets({ runDirectory: run, outputDirectory: packet }), /Refusing to overwrite/);
  const tampered = JSON.parse(await readFile(join(packet, 'index.json'), 'utf8'));
  tampered.candidate_count += 1;
  await writeFile(join(packet, 'index.json'), `${JSON.stringify(tampered, null, 2)}\n`);
  await assert.rejects(validatePacket(packet), /count invariant/);
});

test('rejects incomplete reviews and inconsistent best selections', async () => {
  const run = await syntheticRun();
  const index = await buildLabelSheets({ runDirectory: run, outputDirectory: join(run, 'packet') });
  const sheet = index.sheets[0];
  const number = sheet.entities[0].candidates[0].n;
  const base = emptyResponse(sheet);
  assert.throws(() => validateResponse({ ...base, reviewed: false }, sheet), /reviewed must be true/);
  assert.throws(() => validateResponse({ ...base, logos: [{ n: number, roles: ['wide'], works_on: ['light'] }], best: { ...base.best, icon: [number] } }, sheet), /not a positive with that role/);
});
