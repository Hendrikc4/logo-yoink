import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { replay } from '../scripts/benchmark/visual-benchmark-replay.mjs';

test('offline replay scores stored selections and explicit current-site abstentions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logo-replay-'));
  const entity = (id, split = 'development') => ({ entity_id: id, name: id, benchmark_split: split });
  await writeFile(join(root, 'entities.jsonl'), `${[entity('a'), entity('b')].map(JSON.stringify).join('\n')}\n`);
  await writeFile(join(root, 'captures.jsonl'), `${[
    { entity_id: 'a', identity_status: 'current' }, { entity_id: 'b', identity_status: 'current' },
  ].map(JSON.stringify).join('\n')}\n`);
  await writeFile(join(root, 'candidates.jsonl'), `${[
    { entity_id: 'a', candidate_id: 'good', predicted_roles: ['icon', 'wide'], role_scores: { icon: 80, wide: 70 } },
    { entity_id: 'a', candidate_id: 'wrong', predicted_roles: ['icon'], role_scores: { icon: 60 } },
  ].map(JSON.stringify).join('\n')}\n`);
  const labels = join(root, 'labels.jsonl');
  await writeFile(labels, `${[
    { entity_id: 'a', candidate_id: 'good', values: { identity: 'correct', roles: ['icon', 'wide'], best_for_role: { icon: true, wide: true }, usability_light: 'good', usability_dark: 'unusable' } },
    { entity_id: 'a', candidate_id: 'wrong', values: { identity: 'wrong', roles: [], best_for_role: {}, usability_light: 'unusable', usability_dark: 'unusable' } },
  ].map(JSON.stringify).join('\n')}\n`);
  const { result } = await replay({ root, labels, splits: ['development'] });
  assert.equal(result.population.current_zero_candidates, 1);
  assert.equal(result.overall.roles.icon.selected, 1);
  assert.equal(result.overall.roles.icon.role_correct, 1);
  assert.equal(result.overall.roles.icon.answer_rate, 0.5);
  assert.equal(result.overall.roles.icon.usable_on_both_themes, 0);
  assert.equal(result.overall.roles.favicon.selected, 0);
  assert.equal(result.quality_subtotal.maximum, 90);
});
