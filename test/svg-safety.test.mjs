import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeSvg } from '../src/svg-safety.mjs';
import { normalizeStandaloneSvg } from '../src/standalone-svg.mjs';
import { internals as extractor } from '../src/extractor.mjs';

const SAFE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 30"><defs><linearGradient id="g"><stop stop-color="#fff"/><stop offset="1" stop-color="#111"/></linearGradient><mask id="m"><path fill="#fff" d="M0 0h120v30H0z"/></mask></defs><path fill="url(#g)" mask="url(#m)" d="M0 0h120v30H0z"/></svg>';

test('accepts legitimate standalone SVG features and preserves safe bytes', async () => {
  assert.equal(isSafeSvg(SAFE), true);
  const result = await extractor.validateCandidateBytes({ source: 'inline-svg', url: 'https://example.test/logo.svg', evidence: {} }, Buffer.from(SAFE));
  assert.ok(result);
  const output = Buffer.from(result.dataUrl.split(',')[1], 'base64').toString();
  assert.match(output, /linearGradient/);
  assert.match(output, /mask="url\(#m\)"/);
  assert.doesNotMatch(output, /script|onload|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
});

test('rejects executable content beyond the old 64 KiB prefix through both candidate paths', async () => {
  const active = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/><!--${'x'.repeat(66_000)}--><script>globalThis.pwned=1</script></svg>`;
  const item = { source: 'schema', url: 'https://cdn.example.test/logo.svg', evidence: {} };
  assert.equal(await extractor.validateCandidateBytes(item, Buffer.from(active)), null);
  assert.equal(await extractor.validateCandidate(item, 500, { requests: 0, bytesDownloaded: 0 }, 128 * 1024, {
    validateUrl: async () => {}, fetchImpl: async () => new Response(active, { headers: { 'content-type': 'image/svg+xml' } }),
  }), null);
  assert.equal(normalizeStandaloneSvg(active), null);
});

test('rejects malformed XML, namespace ambiguity, event handlers, DTDs and unsafe animation', () => {
  for (const body of [
    '<svg><g></svg>', '<svg></svg><svg/>', '<svg viewBox="0 0 1 1" viewBox="0 0 2 2"/>',
    '<svg viewBox=0></svg>', '<?target data?><svg/>', '<svg xmlns="urn:other"><path/></svg>',
    '<svg><svg:script xmlns:svg="http://www.w3.org/2000/svg"/></svg>', '<svg><path onload="alert(1)"/></svg>',
    '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg><text>&xxe;</text></svg>',
    '<svg><animate attributeName="href" values="#safe;javascript:alert(1)"/></svg>',
  ]) assert.equal(isSafeSvg(body), false, body);
});

test('rejects encoded and external resources while allowing internal fragments and embedded raster pixels', () => {
  for (const body of [
    '<svg><image href="https://evil.test/x.png"/></svg>',
    '<svg><use href="javascript%3Aalert(1)"/></svg>',
    '<svg><use href="java&#x73;cript:alert(1)"/></svg>',
    '<svg><path style="fill:url(https%3A%2F%2Fevil.test/x.svg)"/></svg>',
    '<svg><style>@import url(https://evil.test/x.css)</style></svg>',
    '<svg><style>.x{fill:u\\72l(https://evil.test/x.svg)}</style><path class="x"/></svg>',
    '<svg><style>@im/**/port "https://evil.test/x.css"</style></svg>',
    '<svg><style>@font-face{src:"https://evil.test/font.woff"}</style></svg>',
    '<svg><style>.x{background-image:image-set("https://evil.test/x.png")}</style></svg>',
    '<svg mystery="https://evil.test/resource"><path/></svg>',
  ]) assert.equal(isSafeSvg(body), false, body);
  assert.equal(isSafeSvg('<svg><defs><path id="p" d="M0 0h1v1"/></defs><use href="#p"/></svg>'), true);
  assert.equal(isSafeSvg('<svg><image href="data:image/png;base64,iVBORw0KGgo="/></svg>'), true);
});

test('rejects ambiguous namespace casing and excessive XML depth', () => {
  assert.equal(isSafeSvg('<svg XMLNS="http://www.w3.org/2000/svg"><path/></svg>'), false);
  assert.equal(isSafeSvg(`<svg>${'<g>'.repeat(257)}${'</g>'.repeat(257)}</svg>`), false);
});

test('a long pre-root comment cannot hide an unsafe SVG from either candidate path', async () => {
  const active = `<!--${'x'.repeat(66_000)}--><svg viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/><script/></svg>`;
  const item = { source: 'inline-svg', url: 'https://example.test/logo.svg', evidence: {} };
  assert.equal(await extractor.validateCandidateBytes(item, Buffer.from(active), { contentType: 'image/svg+xml' }), null);
});

test('SVG detection handles many comments without an ambiguous prefix regex', () => {
  assert.equal(extractor.imageMetadata(Buffer.from('<!--x-->'.repeat(1_000)), 'image/svg+xml'), null);
  assert.equal(isSafeSvg('<?xml version="1.0" encoding="UTF-7"?><svg/>'), false);
});
