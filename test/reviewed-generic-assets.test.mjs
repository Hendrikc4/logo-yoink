import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import catalog from '../src/reviewed-generic-assets.json' with { type: 'json' };
import { genericAssetRejection, identifyGenericAsset } from '../src/generic-assets.mjs';
import { genericAssetReason } from '../src/rank.mjs';

test('reviewed defaults reject exact bytes across providers and preserve owner domains', async () => {
  for (const entry of catalog) {
    const bytes = await readFile(new URL(`./fixtures/reviewed-generic/${entry.sha256}.webp`, import.meta.url));
    assert.equal((await genericAssetRejection(bytes, 'unrelated.example'))?.family, entry.family, entry.sha256);
    for (const domain of entry.ownerDomains) {
      assert.equal(await genericAssetRejection(bytes, domain), null, domain);
      assert.ok(await genericAssetRejection(bytes, `${domain}.example`));
      assert.equal(genericAssetReason({ observed: { byte_hash: entry.sha256 }, source_page: `https://${domain}/` }), null);
    }
  }
});

test('resizing and re-encoding retain reviewed distinctive fingerprints', async () => {
  for (const entry of catalog.filter(e => e.fingerprint && e.family !== 'ui-control')) {
    const bytes = await readFile(new URL(`./fixtures/reviewed-generic/${entry.sha256}.webp`, import.meta.url));
    const png = await sharp(bytes).resize(128, 128).png().toBuffer();
    const webp = await sharp(bytes).resize(64, 64).webp({ quality: 80 }).toBuffer();
    assert.ok(await genericAssetRejection(png, 'unrelated.example'), `png ${entry.family} ${entry.sha256}`);
    assert.ok(await genericAssetRejection(webp, 'unrelated.example'), `webp ${entry.family} ${entry.sha256}`);
  }
});

test('triangles and plain circles are outside the reviewed global ban', async () => {
  for (const svg of [
    '<svg width="128" height="128"><circle cx="64" cy="64" r="60"/></svg>',
    '<svg width="128" height="128"><rect width="128" height="128" rx="64"/><path d="M34 92 64 32 94 92Z" fill="white"/></svg>',
  ]) assert.equal(await identifyGenericAsset(await sharp(Buffer.from(svg)).png().toBuffer()), null);
});

test('hosted customer subdomains never inherit platform ownership', async () => {
  for (const [family, domain] of [['carrd', 'acme.carrd.co'], ['wordpress', 'customer.wordpress.com']]) {
    const entry = catalog.find(e => e.family === family);
    const bytes = await readFile(new URL(`./fixtures/reviewed-generic/${entry.sha256}.webp`, import.meta.url));
    assert.ok(await genericAssetRejection(bytes, domain));
    assert.equal(await genericAssetRejection(bytes, entry.ownerDomains[0]), null);
    assert.equal(await genericAssetRejection(bytes, `www.${entry.ownerDomains[0]}`), null);
  }
});
