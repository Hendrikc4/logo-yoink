import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeLegacySvgDoctype } from '../src/standalone-svg.mjs';
import { internals } from '../src/extractor.mjs';

const doctype = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">';
const body = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="60"><path fill="#2255aa" d="M0 0H320V60H0Z"/></svg>';

test('normalizes only canonical, self-contained SVG 1.1 declarations without changing art', async () => {
  const original = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<!-- editor -->\n${doctype}\n${body}`);
  const normalized = normalizeLegacySvgDoctype(original);
  assert.ok(normalized);
  assert.equal(normalized.transformation, 'remove-canonical-svg11-doctype');
  assert.equal(normalized.bytes.toString(), original.toString().replace(doctype, ''));
  assert.equal(internals.imageMetadata(original), null);
  assert.equal(await internals.isRenderableSvg(normalized.bytes), true);
  assert.equal(normalizeLegacySvgDoctype(normalized.bytes), null);
});

test('normalization permits local gradients, clipping and static presentation styles', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><path id="mark" d="M0 0H10V10Z"/></defs><use xlink:href="#mark" style="fill: #2255aa; opacity: .8"/></svg>';
  assert.ok(normalizeLegacySvgDoctype(doctype + svg));
  assert.ok(normalizeLegacySvgDoctype(doctype + body.replace('fill="#2255aa"', 'fill="url(#gradient)"')));
});

test('normalization rejects internal subsets, alternate DTDs, extra declarations and entity dependencies', () => {
  for (const declaration of [
    doctype.replace('>', ' [<!ENTITY mark "unsafe">]>'),
    doctype.replace('http://www.w3.org', 'http://127.0.0.1'),
    '<!DOCTYPE svg SYSTEM "https://example.test/svg.dtd">',
    '<!DOCTYPE svg>',
    doctype + doctype,
    doctype + '<!ENTITY mark "unsafe">',
  ]) assert.equal(normalizeLegacySvgDoctype(declaration + body), null, declaration);
  assert.equal(normalizeLegacySvgDoctype(doctype + body.replace('</svg>', '<desc>&mark;</desc></svg>')), null);
  assert.equal(normalizeLegacySvgDoctype(`<?xml-stylesheet href="https://example.test/x.css"?>${doctype}${body}`), null);
  assert.equal(normalizeLegacySvgDoctype(`<?xml version="1.0" encoding="ISO-8859-1"?>${doctype}${body}`), null);
});

test('normalization rejects active, externally dependent and obfuscated markup across the full document', () => {
  for (const dangerous of [
    '<script>alert(1)</script>', '<foreignObject/>', '<animate attributeName="href"/>',
    '<set attributeName="href"/>', '<image href="https://example.test/a.png"/>',
    '<use href="https://example.test/a.svg#mark"/>', '<use href="&#104;ttps://example.test/a.svg#mark"/>',
    '<use href="data:image/svg+xml,foo"/>', '<g xml:base="https://example.test/"><use href="#mark"/></g>',
    '<path onload="alert(1)"/>', '<style>@import "https://example.test/x.css";</style>',
    '<path style="fill:url(https://example.test/a.svg#mark)"/>',
    '<path style="fill: u&#114;l(https://example.test/a.svg#mark)"/>',
    '<path style="fill: u&#92;72l(https://example.test/a.svg#mark)"/>',
    '<path style="fill: url/**/(https://example.test/a.svg#mark)"/>',
    '<path style="background: red"/>', '<g xmlns="http://www.w3.org/1999/xhtml"/>',
  ]) {
    const svg = body.replace('</svg>', `${' '.repeat(70_000)}${dangerous}</svg>`);
    assert.equal(normalizeLegacySvgDoctype(doctype + svg), null, dangerous);
  }
});

test('normalization rejects malformed encodings and non-SVG document wrappers', () => {
  assert.equal(normalizeLegacySvgDoctype(Buffer.concat([Buffer.from(doctype + body), Buffer.from([0xff])])), null);
  assert.equal(normalizeLegacySvgDoctype(`<html>${doctype}${body}</html>`), null);
  assert.equal(normalizeLegacySvgDoctype(doctype + body + body), null);
});

test('network and byte validators preserve normalized SVG provenance while BIMI stays strict', async () => {
  const bytes = Buffer.from(doctype + body);
  const candidate = { url: 'https://example.test/logo.svg', source: 'header-img' };
  const requestOptions = {
    validateUrl: async value => new URL(value),
    fetchImpl: async () => {
      const response = new Response(bytes, { headers: { 'content-type': 'image/svg+xml' } });
      Object.defineProperty(response, 'url', { value: candidate.url });
      return response;
    },
  };
  const network = await internals.validateCandidate(candidate, 2000, { requests: 0, bytesDownloaded: 0 }, undefined, requestOptions);
  const local = await internals.validateCandidateBytes(candidate, bytes);
  for (const result of [network, local]) {
    assert.ok(result);
    assert.equal(result.provenance.svg_normalization, 'remove-canonical-svg11-doctype');
    assert.equal(result.provenance.original_byte_hash, createHash('sha256').update(bytes).digest('hex'));
    assert.notEqual(result.observed.byte_hash, result.provenance.original_byte_hash);
    assert.equal(Buffer.from(result.dataUrl.split(',')[1], 'base64').toString().includes('<!DOCTYPE'), false);
  }
  assert.equal(await internals.validateCandidate({ ...candidate, source: 'bimi' }, 2000, {}, undefined, requestOptions), null);
  assert.equal(await internals.validateCandidateBytes({ ...candidate, source: 'bimi' }, bytes), null);
  const malicious = Buffer.from(doctype.replace('>', ' [<!ENTITY external SYSTEM "file:///etc/passwd">]>') + body);
  assert.equal(await internals.validateCandidateBytes(candidate, malicious), null);
});
