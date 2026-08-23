import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { parseHomepage } from '../src/discover-static.mjs';
import { discoverSpaBundleAssets, extractZipMember, inspectRemoteZip, parseZipCentralDirectory, scanEntryBundle, scoreArchiveMember } from '../src/discover-deep.mjs';
import { rankCandidates } from '../src/rank.mjs';

function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const input of entries) {
    const name = Buffer.from(input.name), raw = Buffer.from(input.bytes ?? '<svg viewBox="0 0 590 68"></svg>');
    const compression = input.compression ?? 8, body = compression === 8 ? deflateRawSync(raw) : raw;
    const flags = input.flags ?? 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(compression, 8);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(compression, 10);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(input.externalAttributes ?? 0, 38); central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

test('semantic high-intent links retain anchor, heading, card, ARIA, and source context', () => {
  const html = '<section class="resources"><h2>Company resources</h2><p>Approved identity files for journalists.</p><a href="/downloads" aria-label="Get the media kit" title="Official files">Download assets</a></section>';
  const parsed = parseHomepage(html, 'https://acme.test/', { collectDeepLinks: true });
  assert.equal(parsed.highIntentLinks.length, 1);
  assert.equal(parsed.highIntentLinks[0].url, 'https://acme.test/downloads');
  assert.match(parsed.highIntentLinks[0].evidence.semantic_text, /Company resources/);
  assert.match(parsed.highIntentLinks[0].evidence.semantic_text, /media kit/);
  assert.equal(parsed.highIntentLinks[0].source_page, 'https://acme.test/');
});

test('default parsing preserves legacy brand pages without collecting deep context', () => {
  const parsed = parseHomepage('<a href="/about">About us</a><a href="/news">News</a>', 'https://acme.test/');
  assert.deepEqual(parsed.brandPages, ['https://acme.test/about']);
  assert.deepEqual(parsed.highIntentLinks, []);
  assert.deepEqual(parsed.entryScripts, []);
});

test('ZIP central directory extracts selected SVG without writing to disk', () => {
  const bytes = zip([{ name: 'Logos/Anthropic logo - Slate.svg' }, { name: 'Icons/Anthropic icon.png', bytes: 'not-an-image', compression: 0 }]);
  const parsed = parseZipCentralDirectory(bytes);
  assert.equal(parsed.entries.length, 2);
  assert.equal(extractZipMember(bytes, parsed.entries[0]).toString(), '<svg viewBox="0 0 590 68"></svg>');
  const conflicting = Buffer.from(bytes); conflicting.writeUInt32LE(parsed.entries[0].compressedSize + 1, 18);
  assert.throws(() => extractZipMember(conflicting, parsed.entries[0]), /conflicts/);
});

test('ZIP parser rejects traversal, encryption, nesting, symlinks, unsupported compression, and malformed bounds', () => {
  for (const bytes of [
    zip([{ name: '../logo.svg' }]),
    zip([{ name: 'logo.svg', flags: 0x801 }]),
    zip([{ name: 'nested.zip' }]),
    zip([{ name: 'link.svg', externalAttributes: (0xa000 << 16) >>> 0 }]),
    zip([{ name: 'logo.svg', compression: 12 }]),
  ]) assert.throws(() => parseZipCentralDirectory(bytes));
  const malformed = zip([{ name: 'logo.svg' }]); malformed.writeUInt32LE(0xffffff00, malformed.length - 6);
  assert.throws(() => parseZipCentralDirectory(malformed), /bounds/);
});

test('archive member ranking separates wordmarks, icons, product variants, and themes', () => {
  assert.ok(scoreArchiveMember('GitHub_Logos/GitHub_Lockup_Dark.svg', 'GitHub') > 70);
  assert.ok(scoreArchiveMember('GitHub_Logos/GitHub_Copilot_Lockup.svg', 'GitHub') < 45);
  assert.ok(scoreArchiveMember('Icons/GitHub-icon.svg', 'GitHub') < 45);
  assert.ok(scoreArchiveMember('Primary Logo/Primary Logo - White.svg', 'Katalon') > 70);
});

test('remote ZIP range validation rejects a server that lies about Content-Range', async () => {
  const bytes = zip([{ name: 'Anthropic logo - Slate.svg' }]);
  const fetchResource = async () => ({ status: 206, headers: new Headers({ 'content-range': `bytes 1-${bytes.length}/${bytes.length}` }), bytes, ok: true, url: 'https://cdn.test/logos.zip' });
  await assert.rejects(inspectRemoteZip('https://cdn.test/logos.zip', { fetchResource, companyName: 'Anthropic' }), /Invalid ZIP range/);
});

test('remote ZIP accepts capped full fallback and preserves complete provenance plus theme variants', async () => {
  const bytes = zip([{ name: 'Anthropic logo - Slate.svg' }, { name: 'Anthropic logo - Ivory.svg' }]);
  const fetchResource = async () => ({ status: 200, headers: new Headers({ 'content-type': 'application/zip' }), bytes, ok: true, url: 'https://cdn.test/logos.zip' });
  const chain = [{ kind: 'homepage', url: 'https://anthropic.com/' }, { kind: 'official-page', url: 'https://anthropic.com/press-kit' }];
  const result = await inspectRemoteZip('https://cdn.test/logos.zip', { fetchResource, companyName: 'Anthropic', context: 'Download press kit', chain });
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(new Set(result.candidates.map(item => item.evidence.theme)), new Set(['light', 'dark']));
  assert.equal(result.candidates[0].provenance_chain[0].url, 'https://anthropic.com/');
  assert.equal(result.candidates[0].provenance_chain.at(-1).kind, 'archive-member');
});

test('remote ZIP range happy path validates suffix and selectively reads members', async () => {
  const bytes = zip([{ name: 'Anthropic logo - Slate.svg' }]);
  const fetchResource = async (_url, options) => {
    const range = options.headers.range;
    let start, end;
    if (/^bytes=-/.test(range)) { start = 0; end = bytes.length - 1; }
    else { const match = /^bytes=(\d+)-(\d+)$/.exec(range); start = Number(match[1]); end = Math.min(Number(match[2]), bytes.length - 1); }
    return { status: 206, headers: new Headers({ 'content-range': `bytes ${start}-${end}/${bytes.length}` }), bytes: bytes.subarray(start, end + 1), ok: true, url: 'https://cdn.test/logos.zip' };
  };
  const result = await inspectRemoteZip('https://cdn.test/logos.zip', { fetchResource, companyName: 'Anthropic', context: 'Download logo kit' });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.diagnostics.range_used, true);
});

test('SPA entry bundle scan is same-origin, strongly named, bounded, and wide-only', () => {
  const found = scanEntryBundle('x="assets/pnp-logo.svg"; y="assets/customer-logo.svg"; z="assets/pnp-icon.svg"', {
    scriptUrl: 'https://www.plugandplaytechcenter.com/main-X.js', homepage: 'https://www.plugandplaytechcenter.com/', companyName: 'Plug and Play',
  });
  assert.deepEqual(found.map(item => item.url), ['https://www.plugandplaytechcenter.com/assets/pnp-logo.svg']);
  assert.deepEqual(found[0].evidence.eligible_roles, ['wide']);
  assert.equal(scanEntryBundle('x="assets/logo.svg"', { scriptUrl: 'https://evil.test/main.js', homepage: 'https://acme.test/', companyName: 'Acme' }).length, 0);
  assert.equal(scanEntryBundle('x="logos/samsung-wordmark.svg"', { scriptUrl: 'https://general-instinct.com/main.js', homepage: 'https://general-instinct.com/', companyName: 'General Instinct' }).length, 0);
  assert.equal(scanEntryBundle('x="assets/sangrah-logo.png"', { scriptUrl: 'https://quansys.ai/main.js', homepage: 'https://quansys.ai/', companyName: 'Quansys' }).length, 0);
});

test('oversized SPA entry bundles are a recorded miss, not an extraction failure', async () => {
  const parsed = { candidates: [], entryScripts: ['https://acme.test/main-X.js'], pageTitle: 'Acme' };
  const result = await discoverSpaBundleAssets({ homepage: 'https://acme.test/', parsed, companyName: 'Acme', fetchResource: async () => { throw new Error('Response exceeds 2200000 bytes.'); } });
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.diagnostics.errors, ['Response exceeds 2200000 bytes.']);
});

test('deep candidates cannot move icon or favicon and product archive members are withheld', () => {
  const icon = { url: 'https://acme.test/icon.svg', source: 'manifest', width: 256, height: 256, highResolution: true, scalable: true, bytes: 20, evidence: {} };
  const favicon = { ...icon, url: 'https://acme.test/favicon.svg', source: 'html-icon' };
  const wide = { url: 'zip+https://acme.test/logos.zip#Acme_Lockup.svg', source: 'official-archive', width: 590, height: 68, highResolution: true, scalable: true, bytes: 30, evidence: { eligible_roles: ['wide'], archive_score: 90, archive_member: 'Acme_Lockup.svg', deep_official: true, positive_token: true } };
  const product = { ...wide, url: 'zip+https://acme.test/logos.zip#Copilot_Lockup.svg', evidence: { ...wide.evidence, archive_member: 'Copilot_Lockup.svg' } };
  const before = rankCandidates([icon, favicon], { companyName: 'Acme' });
  const after = rankCandidates([icon, favicon, wide, product], { companyName: 'Acme' });
  assert.equal(after.selectedByRole.icon.url, before.selectedByRole.icon.url);
  assert.equal(after.selectedByRole.favicon.url, before.selectedByRole.favicon.url);
  assert.equal(after.selectedByRole.wide.url, wide.url);
  assert.deepEqual(after.candidates.find(item => item.url === product.url).predicted_roles, []);
});
