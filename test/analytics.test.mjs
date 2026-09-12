import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/analytics.js', import.meta.url), 'utf8');
function setup() {
  const window = {};
  const listeners = {};
  vm.runInNewContext(source, { window, URL, document: { addEventListener: (name, fn) => { listeners[name] = fn; } } });
  return { window, listeners };
}

test('analytics allowlists categories and strips sensitive URL components', () => {
  const { window } = setup();
  window.yoinkTrack('extraction_finished', { outcome: 'success', website: 'private.example', filename: 'secret.svg' });
  window.yoinkTrack('private.example');
  window.yoinkTrack('extraction_finished', { outcome: 'private.example' });
  const events = window.vaq.filter(entry => entry[0] === 'event').map(entry => entry[1]);
  assert.equal(JSON.stringify(events), JSON.stringify([
    { name: 'extraction_finished', data: { outcome: 'success' } },
    { name: 'extraction_finished', data: {} },
  ]));
  const sanitize = window.vaq.find(entry => entry[0] === 'beforeSend')[1];
  assert.equal(sanitize({ url: 'https://logo-yoink.com/?website=private.example#secret' }).url, 'https://logo-yoink.com/');
  window.va = () => { throw Error('blocked'); };
  assert.doesNotThrow(() => window.yoinkTrack('extraction_started'));
});

test('download and GitHub events use placement without recording destinations', () => {
  const { window, listeners } = setup();
  const link = {
    hasAttribute: name => ['download', 'data-asset-download'].includes(name),
    closest: () => true,
    getAttribute: () => 'data:image/svg+xml;base64,private',
    dataset: {},
  };
  listeners.click({ target: { closest: () => link } });
  link.hasAttribute = () => false;
  link.getAttribute = () => 'https://github.com/Hendrikc4/logo-yoink';
  link.dataset.githubPlacement = 'result';
  listeners.click({ target: { closest: () => link } });
  const events = window.vaq.filter(entry => entry[0] === 'event').map(entry => entry[1]);
  assert.equal(JSON.stringify(events), JSON.stringify([
    { name: 'asset_download', data: { placement: 'recommended' } },
    { name: 'github_clicked', data: { placement: 'result' } },
  ]));
});
