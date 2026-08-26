import assert from 'node:assert/strict';
import test from 'node:test';
import { bimiCandidate, bimiQueryDomains, internals as bimiInternals, isSafeBimiSvg, lookupBimiAssertion, parseBimiRecord } from '../src/discover-bimi.mjs';
import { internals as extractorInternals } from '../src/extractor.mjs';
import { rankCandidates } from '../src/rank.mjs';

const SAFE_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#123456"/></svg>');

test('joins split TXT chunks and parses whitespace and tag casing', async () => {
  const cache = new Map();
  const result = await lookupBimiAssertion('Example.COM', {
    cache,
    resolveTxt: async name => {
      assert.equal(name, 'default._bimi.example.com');
      return [[' V = biMi1 ; ', ' L = https://cdn.example/logo.svg ; ', ' A = https://authority.example/vmc.pem ']];
    },
  });
  assert.equal(result.status, 'accepted');
  assert.equal(result.logoUrl, 'https://cdn.example/logo.svg');
  assert.equal(result.authorityPointer, 'present_unverified');
  assert.equal(result.certificateValidation, 'not_performed');
  assert.equal(result.evidenceDocumentPresent, true);
  assert.match(result.recordDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.rawRecord, undefined);
});

test('abstains on multiple assertion records even when one is otherwise valid', async () => {
  const result = await lookupBimiAssertion('example.com', {
    cache: new Map(),
    resolveTxt: async () => [
      ['v=BIMI1; l=https://one.example/logo.svg'],
      ['v=BIMI1; l=https://two.example/logo.svg'],
    ],
  });
  assert.equal(result.status, 'ambiguous_records');

  const malformed = await lookupBimiAssertion('example.com', { cache: new Map(), resolveTxt: async () => [['v=BIMI1 l=https://one.example/logo.svg']] });
  assert.equal(malformed.status, 'invalid_record');
});

test('strict parser rejects malformed, duplicate, empty, and non-HTTPS logo locations', () => {
  assert.equal(parseBimiRecord('v=BIMI1; l').reason, 'malformed_record');
  assert.equal(parseBimiRecord('v=BIMI1; l=https://a.test/a.svg; L=https://a.test/b.svg').reason, 'duplicate_tag');
  assert.equal(parseBimiRecord('v=BIMI1; l= ; a=').reason, 'empty_logo_location');
  assert.equal(parseBimiRecord('v=BIMI1; l=http://a.test/logo.svg').reason, 'unsafe_logo_url');
  assert.equal(parseBimiRecord('v=DMARC1; l=https://a.test/logo.svg').reason, 'not_bimi1');
  assert.equal(parseBimiRecord('l=https://a.test/logo.svg; v=BIMI1').reason, 'version_not_first');
});

test('models missing and invalid certificate pointers without claiming verification', () => {
  const missing = parseBimiRecord('v=BIMI1; l=https://a.test/logo.svg');
  assert.equal(missing.authorityPointer, 'absent');
  assert.equal(missing.evidenceDocumentPresent, false);
  assert.equal(missing.certificateValidation, 'not_performed');
  const invalid = parseBimiRecord('v=BIMI1; l=https://a.test/logo.svg; a=http://a.test/vmc.pem');
  assert.equal(invalid.ok, true);
  assert.equal(invalid.authorityPointer, 'invalid');
  assert.equal(invalid.authorityUrl, null);
  assert.equal(invalid.evidenceDocumentPresent, false);
});

test('resolver failures and timeouts abstain and cache bounded outcomes', async () => {
  const noRecord = await lookupBimiAssertion('example.com', { cache: new Map(), resolveTxt: async () => { throw Object.assign(new Error('no answer'), { code: 'ENOTFOUND' }); } });
  assert.equal(noRecord.status, 'not_found');
  const failure = await lookupBimiAssertion('example.com', { cache: new Map(), resolveTxt: async () => { throw Object.assign(new Error('resolver failed'), { code: 'SERVFAIL' }); } });
  assert.equal(failure.status, 'resolver_error');
  const timeout = await lookupBimiAssertion('example.com', { cache: new Map(), timeoutMs: 5, resolveTxt: async () => new Promise(() => {}) });
  assert.equal(timeout.status, 'timeout');

  let calls = 0;
  const cache = new Map();
  const resolveTxt = async () => { calls += 1; return [['v=BIMI1; l=https://a.test/logo.svg']]; };
  const first = await lookupBimiAssertion('example.com', { cache, resolveTxt, now: () => 100, cacheTtlMs: 1_000 });
  const second = await lookupBimiAssertion('example.com', { cache, resolveTxt, now: () => 200, cacheTtlMs: 1_000 });
  assert.equal(first.cached, undefined);
  assert.equal(second.cached, true);
  assert.equal(second.dnsRequests, 0);
  assert.equal(calls, 1);

  const bounded = new Map([['older', { expiresAt: 1_000, value: { status: 'not_found' } }]]);
  await lookupBimiAssertion('new.example', { cache: bounded, cacheMaxEntries: 1, resolveTxt, now: () => 100 });
  assert.equal(bounded.size, 1);
  assert.equal(bounded.has('older'), false);

  let isolatedCalls = 0;
  const isolatedResolver = async () => { isolatedCalls += 1; return [['v=BIMI1; l=https://isolated.test/logo.svg']]; };
  await lookupBimiAssertion('isolated.example', { resolveTxt: isolatedResolver });
  await lookupBimiAssertion('isolated.example', { resolveTxt: isolatedResolver });
  assert.equal(isolatedCalls, 2);

  for (const failure of [
    () => new Promise(() => {}),
    () => { throw Object.assign(new Error('temporary failure'), { code: 'SERVFAIL' }); },
  ]) {
    let transientCalls = 0;
    const transientCache = new Map();
    const transientResolver = async () => { transientCalls += 1; return failure(); };
    await lookupBimiAssertion('transient.example', { cache: transientCache, timeoutMs: 5, resolveTxt: transientResolver });
    await lookupBimiAssertion('transient.example', { cache: transientCache, timeoutMs: 5, resolveTxt: transientResolver });
    assert.equal(transientCalls, 2);
    assert.equal(transientCache.size, 0);
  }
});

test('organizational-domain fallback is explicit, bounded, and suffix checked', () => {
  assert.deepEqual(bimiQueryDomains('mail.brand.example'), ['mail.brand.example']);
  assert.deepEqual(bimiQueryDomains('mail.brand.example', { organizationalDomain: 'brand.example' }), ['mail.brand.example', 'brand.example']);
  assert.throws(() => bimiQueryDomains('brand.example', { organizationalDomain: 'other.example' }), /must contain/);
  assert.throws(() => bimiQueryDomains('8.8.8.8'), /valid public domain/);
});

test('runtime BIMI lookup abstains instead of failing extraction for IP literals', async () => {
  const result = await extractorInternals.lookupBimiSafely('93.184.216.34', {});
  assert.equal(result.status, 'unsupported_domain');
  assert.equal(result.dnsRequests, 0);
});

test('organizational-domain success counts every uncached DNS attempt and isolates cached objects', async () => {
  const cache = new Map();
  const result = await lookupBimiAssertion('mail.brand.example', {
    organizationalDomain: 'brand.example', cache,
    resolveTxt: async name => name.includes('mail.brand.example') ? [] : [['v=BIMI1; l=https://brand.example/logo.svg']],
  });
  assert.equal(result.status, 'accepted');
  assert.equal(result.queryDomain, 'brand.example');
  assert.equal(result.dnsRequests, 2);
  result.attempts[1].logoUrl = 'https://mutated.example/logo.svg';
  const cached = await lookupBimiAssertion('mail.brand.example', {
    organizationalDomain: 'brand.example', cache,
    resolveTxt: async () => assert.fail('cache should satisfy both lookups'),
  });
  assert.equal(cached.logoUrl, 'https://brand.example/logo.svg');
  assert.equal(cached.dnsRequests, 0);
});

test('organizational-domain fallback abstains after an ambiguous or failed exact assertion', async () => {
  for (const [exactAnswer, status] of [
    [[['v=BIMI1; l=https://one.example/logo.svg'], ['v=BIMI1; l=https://two.example/logo.svg']], 'ambiguous_records'],
    [Object.assign(new Error('resolver failed'), { code: 'SERVFAIL' }), 'resolver_error'],
  ]) {
    let calls = 0;
    const result = await lookupBimiAssertion('mail.brand.example', {
      organizationalDomain: 'brand.example', cache: new Map(),
      resolveTxt: async () => {
        calls += 1;
        if (exactAnswer instanceof Error) throw exactAnswer;
        return exactAnswer;
      },
    });
    assert.equal(result.status, status);
    assert.equal(result.dnsRequests, 1);
    assert.equal(calls, 1);
  }
});

test('BIMI provenance is domain-controlled but not certificate or license verified', () => {
  const parsed = parseBimiRecord('v=BIMI1; l=https://a.test/logo.svg; a=https://a.test/vmc.pem');
  const item = bimiCandidate({ status: 'accepted', selector: 'default', queryDomain: 'example.com', queryName: 'default._bimi.example.com', ...parsed }, { discoveredAt: '2026-08-25T00:00:00.000Z' });
  assert.deepEqual(item.evidence.eligible_roles, ['icon', 'favicon']);
  assert.equal(item.evidence.certificate_verified, false);
  assert.equal(item.provenance.bimi_record_sha256, parsed.recordDigest);
  assert.equal(item.provenance.bimi_evidence_document_present, true);
  assert.equal(item.provenance.bimi_certificate_validation, 'not_performed');
  assert.equal(item.provenance.trademark_or_license_verified, false);
});

test('BIMI SVG safety gate rejects active and external content', () => {
  assert.equal(isSafeBimiSvg(SAFE_SVG), true);
  assert.equal(isSafeBimiSvg('<svg><script>alert(1)</script></svg>'), false);
  assert.equal(isSafeBimiSvg('<svg><image href="https://tracker.test/a.png"/></svg>'), false);
  assert.equal(isSafeBimiSvg('<svg><animate attributeName="opacity"/></svg>'), false);
  assert.equal(isSafeBimiSvg('<svg><path style="fill:url(https://tracker.test/a)"/></svg>'), false);
});

test('BIMI fetch revalidates unsafe redirects and rejects oversized, active, and wrong-MIME bodies', async () => {
  const item = bimiCandidate({
    status: 'accepted', selector: 'default', queryDomain: 'example.com', queryName: 'default._bimi.example.com',
    logoUrl: 'https://cdn.example/logo.svg', recordDigest: 'a'.repeat(64), authorityUrl: null,
    authorityPointer: 'absent', evidenceDocumentPresent: false, certificateValidation: 'not_performed',
  });
  const diagnostics = { requests: 0, bytesDownloaded: 0 };
  const redirect = await extractorInternals.validateCandidate(item, 100, diagnostics, 128 * 1024, {
    validateUrl: async url => { if (String(url).includes('127.0.0.1')) throw new Error('private'); },
    fetchImpl: async url => String(url).includes('cdn.example')
      ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/logo.svg' } })
      : new Response(SAFE_SVG, { headers: { 'content-type': 'image/svg+xml' } }),
  });
  assert.equal(redirect, null);

  const downgrade = await extractorInternals.validateCandidate(item, 100, { requests: 0, bytesDownloaded: 0 }, 128 * 1024, {
    validateUrl: async () => {},
    fetchImpl: async url => String(url).startsWith('https:')
      ? new Response(null, { status: 302, headers: { location: 'http://public.example/logo.svg' } })
      : new Response(SAFE_SVG, { headers: { 'content-type': 'image/svg+xml' } }),
  });
  assert.equal(downgrade, null);

  const oversized = await extractorInternals.validateCandidate(item, 100, { requests: 0, bytesDownloaded: 0 }, 128 * 1024, {
    validateUrl: async () => {},
    fetchImpl: async () => new Response(SAFE_SVG, { headers: { 'content-type': 'image/svg+xml', 'content-length': String(128 * 1024 + 1) } }),
  });
  assert.equal(oversized, null);

  for (const [body, contentType] of [
    ['<svg viewBox="0 0 10 10"><script/></svg>', 'image/svg+xml'],
    [SAFE_SVG, 'text/plain'],
  ]) {
    const rejected = await extractorInternals.validateCandidate(item, 100, { requests: 0, bytesDownloaded: 0 }, 128 * 1024, {
      validateUrl: async () => {}, fetchImpl: async () => new Response(body, { headers: { 'content-type': contentType } }),
    });
    assert.equal(rejected, null);
  }
});

test('BIMI can fill icon and favicon roles but can never create a wide-logo answer', async () => {
  const item = bimiCandidate({
    status: 'accepted', selector: 'default', queryDomain: 'example.com', queryName: 'default._bimi.example.com',
    logoUrl: 'https://cdn.example/logo.svg', recordDigest: 'b'.repeat(64), authorityUrl: null,
    authorityPointer: 'absent', evidenceDocumentPresent: false, certificateValidation: 'not_performed',
  });
  const checked = await extractorInternals.validateCandidate(item, 500, { requests: 0, bytesDownloaded: 0 }, 128 * 1024, {
    validateUrl: async () => {}, fetchImpl: async () => new Response(SAFE_SVG, { headers: { 'content-type': 'image/svg+xml' } }),
  });
  assert.equal(checked.provenance.bimi_svg_safety_validated, true);
  assert.equal(checked.provenance.bimi_svg_profile_conformance, 'not_performed');
  const ranked = rankCandidates([{ ...checked, contentBox: { width: 100, height: 100 } }]);
  assert.equal(ranked.selectedByRole.icon.source, 'bimi');
  assert.equal(ranked.selectedByRole.favicon.source, 'bimi');
  assert.equal(ranked.selectedByRole.wide, null);
  assert.equal(ranked.assets.logo, null);

  const paddedWordmark = rankCandidates([{ ...checked, contentBox: { width: 90, height: 30 } }]);
  assert.equal(paddedWordmark.selectedByRole.icon, null);
  assert.equal(paddedWordmark.selectedByRole.wide, null);
  assert.equal(paddedWordmark.selectedByRole.favicon.source, 'bimi');

  const wideCanvas = rankCandidates([{ ...checked, width: 300, height: 100, contentBox: { width: 300, height: 100 } }]);
  assert.equal(wideCanvas.selectedByRole.icon, null);
  assert.equal(wideCanvas.selectedByRole.favicon.source, 'bimi');
  const unmeasured = rankCandidates([{ ...checked, contentBox: undefined }]);
  assert.equal(unmeasured.selectedByRole.icon, null);
  const measuredSquare = rankCandidates([{ ...checked, contentBox: { width: 90, height: 90 } }]);
  assert.equal(measuredSquare.selectedByRole.icon.source, 'bimi');
});

test('SVG safety provenance is emitted only after the inert-content check runs', async () => {
  const ordinary = { url: 'https://cdn.example/logo.svg', source: 'schema', evidence: {}, provenance: {} };
  const safe = await extractorInternals.validateCandidate(ordinary, 500, { requests: 0, bytesDownloaded: 0 }, 128 * 1024, {
    validateUrl: async () => {}, fetchImpl: async () => new Response(SAFE_SVG, { headers: { 'content-type': 'image/svg+xml' } }),
  });
  assert.equal(safe.provenance.svg_safety_validated, true);
  const active = await extractorInternals.validateCandidate(ordinary, 500, { requests: 0, bytesDownloaded: 0 }, 128 * 1024, {
    validateUrl: async () => {}, fetchImpl: async () => new Response('<svg><script/></svg>', { headers: { 'content-type': 'image/svg+xml' } }),
  });
  assert.equal(active, null);
  const embeddedRasterSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image width="10" height="10" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="/></svg>';
  const conservativeMiss = await extractorInternals.validateCandidate(ordinary, 500, { requests: 0, bytesDownloaded: 0 }, 128 * 1024, {
    validateUrl: async () => {}, fetchImpl: async () => new Response(embeddedRasterSvg, { headers: { 'content-type': 'image/svg+xml' } }),
  });
  assert.ok(conservativeMiss);
  assert.equal(conservativeMiss.provenance.svg_safety_validated, undefined);
});

test('duplicate BIMI bytes retain the stronger existing candidate and record duplicate provenance', () => {
  const hash = 'c'.repeat(64);
  const strong = { url: 'https://example.com/logo.svg', resolvedUrl: 'https://example.com/logo.svg', source: 'schema', observed: { byte_hash: hash }, evidence: {}, bytes: 100 };
  const bimi = { url: 'https://cdn.example/logo.svg', resolvedUrl: 'https://cdn.example/logo.svg', source: 'bimi', observed: { byte_hash: hash }, evidence: { eligible_roles: ['icon', 'favicon'] }, provenance: { bimi_record_sha256: 'd'.repeat(64) }, bytes: 100 };
  const [deduped] = extractorInternals.dedupeBytes([strong, bimi]);
  assert.equal(deduped.source, 'schema');
  assert.deepEqual(deduped.evidence.duplicate_sources, ['schema', 'bimi']);
  assert.deepEqual(deduped.evidence.duplicate_urls, ['https://example.com/logo.svg', 'https://cdn.example/logo.svg']);
});

test.after(() => bimiInternals.assertionCache.clear());
