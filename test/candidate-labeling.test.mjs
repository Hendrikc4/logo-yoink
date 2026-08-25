import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dedupeRunCandidates, mergeLabels, parseArgs, preparePacket, validateResponseRows } from '../scripts/review/candidate-labeling.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function fixtureResults(run) {
  return [{
    __run_directory: run,
    entity_id: 'acme', name: 'Acme', website: 'https://acme.test',
    candidates: [
      { candidate_id: 'a', content_hash: 'same', asset_path: 'assets/logo.png', source: 'header', width: 200, height: 50 },
      { candidate_id: 'a-duplicate', content_hash: 'same', asset_path: 'assets/logo.png', source: 'footer', width: 200, height: 50 },
      { candidate_id: 'b', resolved_url: 'https://acme.test/icon.png', asset_path: 'assets/logo.png', source: 'favicon', width: 32, height: 32 },
    ],
  }];
}

test('parses repeated inputs and deduplicates candidates without ranker fields', () => {
  assert.deepEqual(parseArgs(['--help']), { command: undefined, input: [], help: true });
  assert.deepEqual(parseArgs(['merge', '--packet', 'packet', '--input', 'a', '--input=b', '--allow-partial']), {
    command: 'merge', packet: 'packet', input: ['a', 'b'], allowPartial: true,
  });
  const entries = dedupeRunCandidates(fixtureResults('/tmp/no-assets'));
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0].duplicate_candidate_ids, ['a-duplicate']);
  assert.deepEqual(entries.map(entry => entry.candidate_number), [1, 2]);
  assert.ok(entries.every(entry => !('role_scores' in entry) && !('selected_by_role' in entry)));
});

test('strict response validation accepts only number, roles, and simple flags', () => {
  const entries = dedupeRunCandidates(fixtureResults('/tmp/no-assets'));
  const valid = [
    { candidate_number: 1, roles: ['wide'], flags: ['correct', 'good', 'best'] },
    { candidate_number: 2, roles: [], flags: ['wrong', 'unusable'] },
  ];
  assert.equal(validateResponseRows(valid, entries).size, 2);
  assert.throws(() => validateResponseRows([{ ...valid[0], explanation: 'looks right' }, valid[1]], entries), /keys must be exactly/);
  assert.throws(() => validateResponseRows([valid[0]], entries), /Incomplete response/);
  assert.throws(() => validateResponseRows([{ ...valid[0], flags: ['correct', 'good', 'wrong'] }, valid[1]], entries), /exactly one/);
  assert.throws(() => validateResponseRows([{ ...valid[0], flags: ['correct', 'good', 'preview_missing'] }, valid[1]], entries), /preview_missing requires/);
});

test('prepares PNG sheets and merges labels back to candidate IDs', async () => {
  const run = await mkdtemp(join(tmpdir(), 'logo-yoink-candidate-labeling-'));
  await mkdir(join(run, 'assets'));
  await writeFile(join(run, 'assets', 'logo.png'), PNG);
  const results = fixtureResults(run).map(({ __run_directory, ...record }) => record);
  await writeFile(join(run, 'results.jsonl'), `${JSON.stringify(results[0])}\n`);
  const packet = join(run, 'packet');
  const prepared = await preparePacket({ runDirectory: run, outputDirectory: packet, sheetSize: 8 });
  assert.equal(prepared.entries.length, 2);
  assert.equal(prepared.sheets.length, 1);
  const sheet = await readFile(join(packet, 'sheets', 'sheet-001.png'));
  assert.equal(sheet.subarray(1, 4).toString(), 'PNG');
  const response = join(run, 'response.jsonl');
  await writeFile(response, [
    JSON.stringify({ candidate_number: 1, roles: ['wide'], flags: ['correct', 'good', 'best'] }),
    JSON.stringify({ candidate_number: 2, roles: ['icon', 'favicon'], flags: ['correct', 'conditional'] }),
  ].join('\n') + '\n');
  const merged = await mergeLabels({ packetDirectory: packet, inputPaths: [response] });
  assert.equal(merged.labels.length, 4);
  assert.deepEqual(merged.labels.map(label => [label.candidate_id, label.role]), [['a', 'wide'], ['a-duplicate', 'wide'], ['b', 'icon'], ['b', 'favicon']]);
  assert.equal(merged.labels[0].best_for_role, true);
  assert.deepEqual(merged.labels[0].duplicate_candidate_ids, ['a-duplicate']);
  assert.equal(merged.labels[1].deduplicated_to_candidate_id, 'a');
});
