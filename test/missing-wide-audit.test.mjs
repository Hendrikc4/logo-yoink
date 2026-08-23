import assert from 'node:assert/strict';
import test from 'node:test';
import { selectMissingWideSample } from '../scripts/prepare-missing-wide-audit.mjs';

test('missing-wide audit sampling is deterministic and eligibility-gated', () => {
  const eligible = index => ({
    entity_id: `entity-${index}`,
    status: 'success',
    reachability: index % 2 ? 'live_html' : 'redirected_off_domain',
    selected_by_role: { wide: null },
  });
  const results = Array.from({ length: 60 }, (_, index) => eligible(index));
  results.push({ ...eligible(61), status: 'failure' });
  results.push({ ...eligible(62), reachability: 'parked_for_sale' });
  results.push({ ...eligible(63), selected_by_role: { wide: 'candidate' } });
  const first = selectMissingWideSample(results, 50, 'fixed-seed');
  const second = selectMissingWideSample([...results].reverse(), 50, 'fixed-seed');
  assert.deepEqual(first.map(item => item.result.entity_id), second.map(item => item.result.entity_id));
  assert.equal(first.length, 50);
  assert.ok(first.every(item => item.result.status === 'success' && !item.result.selected_by_role.wide));
});
