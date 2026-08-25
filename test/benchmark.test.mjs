import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareResults, parseArgs, selectCohort, summarizeResults } from '../scripts/benchmark/benchmark.mjs';
import { adaptSelectedRoleLabels } from '../scripts/benchmark/selected-role-scoring-adapter.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('selects frozen, mutually exclusive benchmark cohorts', async () => {
  const fixture = JSON.parse(await readFile(join(ROOT, 'fixtures', 'companies-500.json'), 'utf8'));
  const original = selectCohort(fixture.companies, 'original-100');
  const holdout = selectCohort(fixture.companies, 'holdout-100');
  const remaining = selectCohort(fixture.companies, 'remaining-300');
  assert.equal(original.length, 100);
  assert.equal(holdout.length, 100);
  assert.equal(remaining.length, 300);
  assert.equal(new Set([...holdout, ...remaining].map(company => company.entity_id)).size, 400);
  assert.deepEqual(selectCohort(fixture.companies, 'holdout-100').map(company => company.entity_id), holdout.map(company => company.entity_id));
});

test('parses run and comparison command options', () => {
  assert.deepEqual(parseArgs(['--cohort', 'original-100', '--concurrency=7', '--browser']), {
    command: 'run', cohort: 'original-100', concurrency: 7, browser: true,
  });
  assert.deepEqual(parseArgs(['compare', '--before', 'a', '--after', 'b']), {
    command: 'compare', before: 'a', after: 'b',
  });
  assert.deepEqual(parseArgs(['score', '--run', 'runs/a', '--labels', 'review.jsonl']), {
    command: 'score', run: 'runs/a', labels: 'review.jsonl',
  });
});

test('parses opt-in deep discovery flags independently from the default path', () => {
  assert.deepEqual(parseArgs(['--cohort', 'original-100', '--deep-wide', '--spa-bundles']), {
    command: 'run', cohort: 'original-100', deepWide: true, spaBundles: true,
  });
});

function candidate(id, role, extras = {}) {
  return { candidate_id: id, predicted_roles: [role], source: 'test', width: role === 'wide' ? 400 : 200, height: 200, ...extras };
}

function result(id, candidates, selected = {}) {
  return {
    entity_id: id, name: id, website: `${id}.example`, status: 'success', reachability: 'live_html', candidates,
    selected_by_role: { icon: null, wide: null, favicon: null, ...selected },
    metrics: { duration_ms: 1000, requests: 4, downloaded_bytes: 100_000, browser_used: false },
  };
}

test('summarizes transparent role coverage, historical proxy, and labeled quality score', () => {
  const results = [
    { ...result('a', [candidate('ai', 'icon', { squareish: true, highResolution: true }), candidate('aw', 'wide')], { icon: 'ai', wide: 'aw' }), legacy_selected_candidate_id: 'ai' },
    result('b', [candidate('bi', 'icon')], { icon: 'bi' }),
  ];
  const labels = [
    { entity_id: 'a', candidate_id: 'ai', identity: 'correct', role: 'icon', usability: 'good' },
    { entity_id: 'a', candidate_id: 'aw', identity: 'correct', role: 'wide', usability: 'conditional' },
    { entity_id: 'b', candidate_id: 'bi', identity: 'wrong', role: 'icon', usability: 'unusable' },
  ];
  const summary = summarizeResults(results, {}, labels);
  assert.equal(summary.roles.icon.domains, 2);
  assert.equal(summary.roles.wide.domains, 1);
  assert.equal(summary.roles.favicon, undefined);
  assert.equal(summary.legacy_roles.favicon.compatibility_only, true);
  assert.equal(summary.historical_comparison_proxy.square_and_high_resolution_selected.numerator, 1);
  assert.equal(summary.benchmarkScore.role_components.icon.coverage.numerator, 1);
  assert.equal(summary.benchmarkScore.role_components.wide.top1_visual_usability.weighted_numerator, 0.5);
  assert.equal(summary.benchmarkScore.safety.wrong_brand_domains, 1);
  assert.ok(summary.benchmarkScore.value >= 0 && summary.benchmarkScore.value <= 100);
});

test('withholds a quality score until every selected role has a role-specific label', () => {
  const results = [result('a', [candidate('shared', 'icon', { predicted_roles: ['icon', 'wide'] })], { icon: 'shared', wide: 'shared' })];
  const partial = summarizeResults(results, {}, [
    { entity_id: 'a', candidate_id: 'shared', identity: 'correct', role: 'icon', usability: 'good' },
  ]).benchmarkScore;
  assert.equal(partial.status, 'incomplete');
  assert.equal(partial.value, null);
  assert.deepEqual(partial.labels, { records: 1, role_labels: 1, selected_roles: 2, selected_roles_labeled: 1, complete: false });
});

test('selected-role adapter makes reviewed negatives and role mismatches explicit without changing identity safety', () => {
  const results = [result('a', [candidate('icon-good', 'icon'), candidate('wide-only', 'wide'), candidate('wrong', 'icon')], { icon: 'icon-good', wide: 'wide-only' }),
    result('b', [candidate('wrong-icon', 'favicon')], { icon: 'wrong-icon' })];
  const labels = [
    { entity_id: 'a', candidate_id: 'icon-good', values: { identity: 'correct', roles: ['icon'], usability_light: 'good', usability_dark: 'good' }, label_id: 'label-good' },
    { entity_id: 'a', candidate_id: 'wide-only', values: { identity: 'correct', roles: ['wide'], usability_light: 'good', usability_dark: 'good' }, label_id: 'label-wide' },
    { entity_id: 'a', candidate_id: 'wrong', values: { identity: 'wrong', roles: [], usability_light: 'unusable', usability_dark: 'unusable' }, label_id: 'label-wrong' },
    { entity_id: 'b', candidate_id: 'wrong-icon', values: { identity: 'correct', roles: ['favicon'], usability_light: 'good', usability_dark: 'good' }, label_id: 'label-favicon' },
  ];
  const adapted = adaptSelectedRoleLabels(results, labels);
  const slots = adapted.filter(row => row.review_role);
  assert.deepEqual(slots.map(row => ({ entity_id: row.entity_id, role: row.review_role, correct: row.correct, identity: row.identity, reason: row.adjudication_reason })), [
    { entity_id: 'a', role: 'icon', correct: true, identity: 'correct', reason: 'reviewed_role_match' },
    { entity_id: 'a', role: 'wide', correct: true, identity: 'correct', reason: 'reviewed_role_match' },
    { entity_id: 'b', role: 'icon', correct: true, identity: 'correct', reason: 'canonical_icon_favicon_fallback' },
  ]);

  const mismatchResults = [result('c', [candidate('wide', 'wide')], { icon: 'wide' })];
  const mismatch = adaptSelectedRoleLabels(mismatchResults, [{
    entity_id: 'c', candidate_id: 'wide', values: { identity: 'correct', roles: ['wide'], usability_light: 'good', usability_dark: 'good' }, label_id: 'label-mismatch',
  }]).find(row => row.review_role);
  assert.deepEqual({ correct: mismatch.correct, identity: mismatch.identity, reason: mismatch.adjudication_reason }, {
    correct: false, identity: 'correct', reason: 'reviewed_without_selected_role',
  });
});

test('selected-role adapter completes canonical scoring with explicit false slots', () => {
  const results = [result('a', [candidate('good', 'icon'), candidate('wrong', 'wide')], { icon: 'good', wide: 'wrong' })];
  const labels = [
    { entity_id: 'a', candidate_id: 'good', values: { identity: 'correct', roles: ['icon'], usability_light: 'good', usability_dark: 'good' }, label_id: 'label-good' },
    { entity_id: 'a', candidate_id: 'wrong', values: { identity: 'wrong', roles: [], usability_light: 'unusable', usability_dark: 'unusable' }, label_id: 'label-wrong' },
  ];
  const summary = summarizeResults(results, {}, adaptSelectedRoleLabels(results, labels)).benchmarkScore;
  assert.equal(summary.status, 'complete');
  assert.equal(summary.value, 50);
  assert.deepEqual(summary.labels, { records: 4, role_labels: 2, selected_roles: 2, selected_roles_labeled: 2, complete: true });
  assert.equal(summary.safety.wrong_brand_domains, 1);
});

test('repeat comparison reports availability gains, losses, and flips', () => {
  const before = [result('a', [candidate('ai', 'icon')], { icon: 'ai' }), result('b', [], {})];
  const after = [result('a', [], {}), result('b', [candidate('bw', 'wide')], { wide: 'bw' })];
  const comparison = compareResults(before, after);
  assert.equal(comparison.flip_count, 2);
  assert.deepEqual(comparison.role_availability.icon, { gains: 0, losses: 1, net: -1 });
  assert.deepEqual(comparison.role_availability.wide, { gains: 1, losses: 0, net: 1 });
});

test('contact sheet emits entity-keyed, data-URL-free raster previews', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logo-yoink-contact-'));
  await mkdir(join(directory, 'assets'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await writeFile(join(directory, 'assets', 'abc.png'), png);
  const record = result('entity-1', [{ ...candidate('candidate-1', 'icon'), asset_path: 'assets/abc.png', format: 'png', url: 'https://example.test/logo.png' }], { icon: 'candidate-1' });
  await writeFile(join(directory, 'results.jsonl'), `${JSON.stringify(record)}\n`);
  const processResult = spawnSync(process.execPath, [join(ROOT, 'scripts', 'review', 'contact-sheet.mjs'), '--run', directory], { encoding: 'utf8' });
  assert.equal(processResult.status, 0, processResult.stderr);
  const page = await readFile(join(directory, 'contact-sheets', 'page-001.html'), 'utf8');
  assert.match(page, /data-entity-id="entity-1"/);
  assert.doesNotMatch(page, /data:image/);
  assert.match(page, /(?:assets\/abc|thumbnails\/candidate-1)\.png/);
});

test('review-label builder rejects invalid or unmatched overrides', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logo-yoink-labels-'));
  const record = result('entity-1', [candidate('candidate-1', 'icon')], { icon: 'candidate-1' });
  record.website = 'example.test';
  await writeFile(join(directory, 'results.jsonl'), `${JSON.stringify(record)}\n`);
  const reviewPath = join(directory, 'review.json');
  await writeFile(reviewPath, JSON.stringify({ overrides: [{ website: 'missing.test', role: 'icon', identity: 'wrong', usability: 'unusable' }] }));
  const unmatched = spawnSync(process.execPath, [join(ROOT, 'scripts', 'review', 'build-review-labels.mjs'), directory, reviewPath], { encoding: 'utf8' });
  assert.notEqual(unmatched.status, 0);
  assert.match(unmatched.stderr, /do not match a selected role/);

  await writeFile(reviewPath, JSON.stringify({ overrides: [{ website: 'example.test', role: 'icon', identity: 'maybe', usability: 'good' }] }));
  const invalid = spawnSync(process.execPath, [join(ROOT, 'scripts', 'review', 'build-review-labels.mjs'), directory, reviewPath], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /invalid identity/);
});

test('review-label transfer preserves unchanged judgments and requires changed selections to be reviewed', async () => {
  const source = await mkdtemp(join(tmpdir(), 'logo-yoink-label-source-'));
  const target = await mkdtemp(join(tmpdir(), 'logo-yoink-label-target-'));
  const unchanged = result('unchanged', [candidate('same', 'icon')], { icon: 'same' });
  const changedBefore = result('changed', [candidate('old', 'icon')], { icon: 'old' });
  const changedAfter = result('changed', [candidate('new', 'icon')], { icon: 'new' });
  await writeFile(join(source, 'results.jsonl'), `${JSON.stringify(unchanged)}\n${JSON.stringify(changedBefore)}\n`);
  await writeFile(join(target, 'results.jsonl'), `${JSON.stringify(unchanged)}\n${JSON.stringify(changedAfter)}\n`);
  await writeFile(join(source, 'review-labels.jsonl'), [
    JSON.stringify({ entity_id: 'unchanged', candidate_id: 'same', role: 'icon', identity: 'ambiguous', usability: 'conditional' }),
    JSON.stringify({ entity_id: 'changed', candidate_id: 'old', role: 'icon', identity: 'wrong', usability: 'unusable' }),
  ].join('\n') + '\n');
  const reviewPath = join(target, 'changed-review.json');
  await writeFile(reviewPath, JSON.stringify({ overrides: [] }));
  const missing = spawnSync(process.execPath, [join(ROOT, 'scripts', 'review', 'transfer-review-labels.mjs'), source, target, reviewPath], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /requires review/);

  await writeFile(reviewPath, JSON.stringify({ overrides: [
    { website: 'changed.example', role: 'icon', identity: 'correct', usability: 'good' },
  ] }));
  const transferred = spawnSync(process.execPath, [join(ROOT, 'scripts', 'review', 'transfer-review-labels.mjs'), source, target, reviewPath], { encoding: 'utf8' });
  assert.equal(transferred.status, 0, transferred.stderr);
  const labels = (await readFile(join(target, 'review-labels.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(labels.map(({ identity, usability }) => ({ identity, usability })), [
    { identity: 'ambiguous', usability: 'conditional' },
    { identity: 'correct', usability: 'good' },
  ]);
});
