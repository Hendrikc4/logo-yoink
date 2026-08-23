import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate } from '../scripts/identity-quarantine-challenge.mjs';

function record(name, website, signals) {
  return { name, website, observation: { signals } };
}

test('structured identity conflicts are veto-only and exact', () => {
  const exact = evaluate(record('Raiqon', 'raiqon.ai', [
    { type: 'og_site_name', value: 'Raiqon' },
    { type: 'jsonld_name', value: 'Raiqon' },
  ]));
  assert.equal(exact.policies.single_structured_name_conflict, 'retain');
  assert.equal(exact.policies.two_source_same_name_conflict, 'retain');

  const decorated = evaluate(record('Raiqon', 'raiqon.ai', [
    { type: 'og_site_name', value: 'Raiqon AI' },
    { type: 'jsonld_name', value: 'Raiqon AI' },
  ]));
  assert.equal(decorated.policies.two_source_same_name_conflict, 'quarantine');
});

test('hostname-shaped site names conflict only with a different exact host', () => {
  assert.equal(evaluate(record('Trustiu', 'trustiu.com', [
    { type: 'og_site_name', value: 'trustiu.com' },
  ])).policies.foreign_hostname_site_name, 'retain');
  assert.equal(evaluate(record('Bhr', 'bhr.fyi', [
    { type: 'og_site_name', value: 'www.realreports.ai' },
  ])).policies.foreign_hostname_site_name, 'quarantine');
});

test('canonical and og URLs remain diagnostic and never create agreement or rank evidence', () => {
  const result = evaluate(record('Mocksi', 'mocksi.ai', [
    { type: 'canonical_url', value: 'https://briefhq.ai/' },
    { type: 'og_url', value: 'https://briefhq.ai/' },
  ]));
  assert.equal(result.policies.single_structured_name_conflict, 'retain');
  assert.equal(result.policies.two_source_same_name_conflict, 'retain');
  assert.equal(result.policies.foreign_hostname_site_name, 'retain');
  assert.equal(result.url_diagnostics.length, 2);
});
