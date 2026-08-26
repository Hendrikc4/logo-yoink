import assert from 'node:assert/strict';
import test from 'node:test';
import { currentLogoClaimDisposition, discoverWikimediaLogoCandidates, registrableDomain, selectCurrentLogoClaims } from '../src/wikimedia-fallback.mjs';
import { internals as extractorInternals } from '../src/extractor.mjs';
import { rankCandidates } from '../src/rank.mjs';
import { normalizeAssetPreferences } from '../src/asset-model.mjs';

const NOW = new Date('2026-08-25T12:00:00Z');

function statement(property, value, { id = `${property}$1`, rank = 'normal', qualifiers } = {}) {
  return { id, rank, mainsnak: { property, snaktype: 'value', datavalue: { type: 'string', value } }, ...(qualifiers ? { qualifiers } : {}) };
}

function timeQualifier(property, time) {
  return [{ property, snaktype: 'value', datavalue: { type: 'time', value: { time, precision: 11 } } }];
}

function yearQualifier(property, year) {
  return [{ property, snaktype: 'value', datavalue: { type: 'time', value: { time: `+${year}-00-00T00:00:00Z`, precision: 9 } } }];
}

function entity(id, website, filename, options = {}) {
  return {
    id,
    claims: {
      P856: website ? [statement('P856', website, { id: `${id}$website`, rank: options.websiteRank ?? 'normal' })] : [],
      P154: filename ? [statement('P154', filename, { id: `${id}$logo`, rank: options.logoRank ?? 'normal', qualifiers: options.logoQualifiers })] : [],
    },
  };
}

function commonsPage(filename, overrides = {}) {
  return {
    title: `File:${filename}`,
    imageinfo: [{
      url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Apple_logo.svg',
      descriptionurl: `https://commons.wikimedia.org/wiki/File:${filename.replace(/ /g, '_')}`,
      mime: 'image/svg+xml', width: 512, height: 512, timestamp: '2025-01-02T00:00:00Z',
      extmetadata: {
        LicenseShortName: { value: 'Public domain' },
        LicenseUrl: { value: 'https://creativecommons.org/publicdomain/mark/1.0/' },
        AttributionRequired: { value: 'false' },
      },
      ...overrides,
    }],
  };
}

function mockApi({ searches, entities, commons, status = 200, malformed = false }) {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    const parsed = new URL(url);
    const action = parsed.searchParams.get('action');
    let payload;
    if (action === 'wbsearchentities') payload = { search: searches[parsed.searchParams.get('search')] ?? [] };
    else if (action === 'wbgetentities') payload = { entities };
    else payload = { query: { pages: commons } };
    return new Response(malformed ? '{' : JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

const noDnsValidation = async value => new URL(value);

test('computes public-suffix-aware registrable domains and rejects deceptive suffix matches', () => {
  assert.equal(registrableDomain('https://www.brand.example.co.uk/path'), 'example.co.uk');
  assert.equal(registrableDomain('https://apple.com.evil.example/'), 'evil.example');
  assert.equal(registrableDomain('not a host'), null);
});

test('selects a current preferred P154 claim, rejects history, and abstains on ambiguity', () => {
  const ended = statement('P154', 'Old.svg', { rank: 'preferred', qualifiers: { P582: timeQualifier('P582', '+2020-01-01T00:00:00Z') } });
  const current = statement('P154', 'Current.svg', { id: 'P154$current', rank: 'normal' });
  assert.equal(currentLogoClaimDisposition(ended, NOW), 'ended');
  assert.deepEqual(selectCurrentLogoClaims([ended, current], NOW).claims[0].filename, 'Current.svg');
  assert.equal(selectCurrentLogoClaims([current, statement('P154', 'Other.svg', { id: 'P154$other' })], NOW).ambiguous, true);
  const historical = statement('P154', 'At-2019.svg', { qualifiers: { P585: timeQualifier('P585', '+2019-01-01T00:00:00Z') } });
  assert.equal(currentLogoClaimDisposition(historical, NOW), 'historical_point_in_time');
  const yearStarted = statement('P154', 'Current.svg', { rank: 'preferred', qualifiers: { P580: yearQualifier('P580', '2023') } });
  assert.equal(currentLogoClaimDisposition(yearStarted, NOW), 'current');
});

test('resolves multiple Apple name candidates only through exact P856 domain evidence and preserves provenance', async () => {
  const api = mockApi({
    searches: {
      'apple.com': [{ id: 'Q89' }, { id: 'Q312' }],
      apple: [{ id: 'Q89' }, { id: 'Q312' }],
    },
    entities: {
      Q89: entity('Q89', 'https://fruit.example/', null),
      Q312: entity('Q312', 'http://www.apple.com/company/', 'Apple logo black.svg', { logoRank: 'preferred' }),
    },
    commons: [commonsPage('Apple logo black.svg')],
  });
  const result = await discoverWikimediaLogoCandidates({ domain: 'store.apple.com', missingRoles: ['icon', 'wide'] }, {
    fetchImpl: api.fetchImpl, validateUrl: noDnsValidation, now: () => NOW, cache: new Map(), diagnostics: { requests: 0, bytesDownloaded: 0 },
  });
  assert.equal(result.diagnostics.status, 'ok');
  assert.equal(result.diagnostics.entityId, 'Q312');
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.evidence.wikidata_identity_verified, true);
  assert.deepEqual(candidate.evidence.eligible_roles, ['icon', 'wide']);
  assert.deepEqual(candidate.evidence.wikidata_statement_ids, ['Q312$logo']);
  assert.equal(candidate.evidence.official_website_evidence[0].statement_id, 'Q312$website');
  assert.equal(candidate.provenance.license.license_short_name, 'Public domain');
  assert.match(candidate.provenance.license.trademark_notice, /does not waive trademark restrictions/);
  assert.equal(api.calls.length, 4);
});

test('handles Amazon river/company collisions, absent P856, and mismatched domains by abstaining', async () => {
  for (const entities of [
    { Q1: entity('Q1', null, 'Amazon.svg'), Q2: entity('Q2', 'https://amazon-river.example', 'Amazon.svg') },
    { Q1: entity('Q1', 'https://amazon.com.evil.example', 'Amazon.svg') },
  ]) {
    const api = mockApi({ searches: { 'amazon.com': [{ id: 'Q1' }, { id: 'Q2' }], amazon: [{ id: 'Q2' }] }, entities, commons: [] });
    const result = await discoverWikimediaLogoCandidates({ domain: 'amazon.com', missingRoles: ['wide'] }, {
      fetchImpl: api.fetchImpl, validateUrl: noDnsValidation, now: () => NOW, cache: new Map(),
    });
    assert.equal(result.candidates.length, 0);
    assert.equal(result.diagnostics.status, 'no_verified_current_logo');
  }
});

test('does not let a product subdomain prove corporate identity but permits corporate and language hosts', async () => {
  for (const [website, expected] of [
    ['https://wiki.example.com/', 'no_verified_current_logo'],
    ['https://corporate.example.com/', 'ok'],
    ['https://fr.example.com/', 'ok'],
  ]) {
    const api = mockApi({ searches: { 'example.com': [{ id: 'Q1' }], example: [{ id: 'Q1' }] }, entities: { Q1: entity('Q1', website, 'Example.svg') }, commons: [commonsPage('Example.svg')] });
    const result = await discoverWikimediaLogoCandidates({ domain: 'example.com', missingRoles: ['wide'] }, { fetchImpl: api.fetchImpl, validateUrl: noDnsValidation, cache: new Map(), now: () => NOW });
    assert.equal(result.diagnostics.status, expected);
  }
});

test('abstains when two entities or two current files remain domain-verified', async () => {
  const twoEntities = mockApi({
    searches: { 'example.com': [{ id: 'Q1' }, { id: 'Q2' }], example: [{ id: 'Q1' }, { id: 'Q2' }] },
    entities: { Q1: entity('Q1', 'https://example.com', 'One.svg'), Q2: entity('Q2', 'https://www.example.com', 'Two.svg') }, commons: [],
  });
  const ambiguousEntities = await discoverWikimediaLogoCandidates({ domain: 'example.com', missingRoles: ['wide'] }, { fetchImpl: twoEntities.fetchImpl, validateUrl: noDnsValidation, cache: new Map(), now: () => NOW });
  assert.equal(ambiguousEntities.diagnostics.status, 'ambiguous_entities');

  const ambiguous = entity('Q1', 'https://example.com', 'One.svg');
  ambiguous.claims.P154.push(statement('P154', 'Two.svg', { id: 'Q1$two' }));
  const twoFiles = mockApi({ searches: { 'example.com': [{ id: 'Q1' }], example: [{ id: 'Q1' }] }, entities: { Q1: ambiguous }, commons: [] });
  const ambiguousFiles = await discoverWikimediaLogoCandidates({ domain: 'example.com', missingRoles: ['wide'] }, { fetchImpl: twoFiles.fetchImpl, validateUrl: noDnsValidation, cache: new Map(), now: () => NOW });
  assert.equal(ambiguousFiles.diagnostics.status, 'ambiguous_logo_claims');
});

test('identity ambiguity includes exact-domain entities that have no logo claim', async () => {
  const api = mockApi({
    searches: { 'example.com': [{ id: 'Q1' }, { id: 'Q2' }], example: [{ id: 'Q1' }, { id: 'Q2' }] },
    entities: {
      Q1: entity('Q1', 'https://example.com/', null),
      Q2: entity('Q2', 'https://www.example.com/', 'Product.svg'),
    },
    commons: [commonsPage('Product.svg')],
  });
  const result = await discoverWikimediaLogoCandidates({ domain: 'example.com', missingRoles: ['wide'] }, {
    fetchImpl: api.fetchImpl, validateUrl: noDnsValidation, cache: new Map(), now: () => NOW,
  });
  assert.equal(result.diagnostics.status, 'ambiguous_entities');
  assert.deepEqual(result.diagnostics.domainMatchedEntityIds, ['Q1', 'Q2']);
  assert.equal(api.calls.length, 3);
});

test('examines the full bounded two-search candidate union before declaring identity unique', async () => {
  const first = [], second = [], entities = {};
  for (let index = 1; index <= 20; index += 1) {
    const id = `Q${index}`;
    (index <= 10 ? first : second).push({ id });
    const exact = index === 1 || index === 20;
    entities[id] = entity(id, exact ? `https://${index === 1 ? '' : 'www.'}example.com/` : `https://unrelated-${index}.example/`, exact ? `${id}.svg` : null);
  }
  const api = mockApi({ searches: { 'example.com': first, example: second }, entities, commons: [] });
  const result = await discoverWikimediaLogoCandidates({ domain: 'example.com', missingRoles: ['wide'] }, {
    fetchImpl: api.fetchImpl, validateUrl: noDnsValidation, cache: new Map(), now: () => NOW,
  });
  assert.equal(result.diagnostics.searchCandidateCount, 20);
  assert.equal(result.diagnostics.searchCandidatesTruncated, false);
  assert.equal(result.diagnostics.status, 'ambiguous_entities');
  assert.deepEqual(result.diagnostics.domainMatchedEntityIds, ['Q1', 'Q20']);
});

test('rejects unsafe Commons file URLs and survives malformed, rate-limited, and timed-out APIs', async () => {
  const base = {
    searches: { 'example.com': [{ id: 'Q1' }], example: [{ id: 'Q1' }] },
    entities: { Q1: entity('Q1', 'https://example.com', 'Example.svg') },
  };
  const unsafe = mockApi({ ...base, commons: [commonsPage('Example.svg', { url: 'https://127.0.0.1/logo.svg' })] });
  const unsafeResult = await discoverWikimediaLogoCandidates({ domain: 'example.com', missingRoles: ['icon'] }, { fetchImpl: unsafe.fetchImpl, validateUrl: noDnsValidation, cache: new Map(), now: () => NOW });
  assert.equal(unsafeResult.diagnostics.status, 'unsafe_or_missing_commons_file');

  for (const api of [mockApi({ ...base, commons: [], malformed: true }), mockApi({ ...base, commons: [], status: 429 })]) {
    const result = await discoverWikimediaLogoCandidates({ domain: 'example.com', missingRoles: ['icon'] }, { fetchImpl: api.fetchImpl, validateUrl: noDnsValidation, cache: new Map(), now: () => NOW });
    assert.equal(result.candidates.length, 0);
    assert.ok(['error', 'rate_limited'].includes(result.diagnostics.status));
  }
  const timedOut = await discoverWikimediaLogoCandidates({ domain: 'example.com', missingRoles: ['icon'] }, {
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    validateUrl: noDnsValidation, timeoutMs: 250, cache: new Map(), now: () => NOW,
  });
  assert.equal(timedOut.diagnostics.status, 'timeout');
});

test('cache avoids repeat API requests', async () => {
  const api = mockApi({ searches: { 'none.example': [], none: [] }, entities: {}, commons: [] });
  const cache = new Map();
  const args = { domain: 'none.example', missingRoles: ['icon'] };
  await discoverWikimediaLogoCandidates(args, { fetchImpl: api.fetchImpl, validateUrl: noDnsValidation, cache, now: () => NOW });
  const result = await discoverWikimediaLogoCandidates(args, { fetchImpl: api.fetchImpl, validateUrl: noDnsValidation, cache, now: () => NOW });
  assert.equal(api.calls.length, 2);
  assert.equal(result.diagnostics.cacheHits, 2);
});

test('rejects product paths, requires license evidence, and skips wide files for icon-only requests', async () => {
  for (const [website, page, expected] of [
    ['https://www.example.com/music', commonsPage('Example.svg'), 'no_verified_current_logo'],
    ['https://example.com/', commonsPage('Example.svg', { extmetadata: {} }), 'unsafe_or_missing_commons_file'],
    ['https://example.com/', commonsPage('Example.svg', { width: 800, height: 100 }), 'unsafe_or_missing_commons_file'],
  ]) {
    const api = mockApi({ searches: { example: [{ id: 'Q1' }] }, entities: { Q1: entity('Q1', website, 'Example.svg') }, commons: [page] });
    const result = await discoverWikimediaLogoCandidates({ domain: 'example.com', missingRoles: ['icon'] }, {
      fetchImpl: api.fetchImpl, validateUrl: noDnsValidation, cache: new Map(), now: () => NOW,
    });
    assert.equal(result.diagnostics.status, expected);
    assert.equal(result.candidates.length, 0);
  }
});

test('retries maxlag responses without caching the transient error', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify(calls === 1 ? { error: { code: 'maxlag' } } : { search: [] }), { headers: { 'content-type': 'application/json' } });
  };
  const result = await discoverWikimediaLogoCandidates({ domain: 'example.com', missingRoles: ['wide'] }, {
    fetchImpl, validateUrl: noDnsValidation, cache: new Map(), now: () => NOW, delay: async () => {},
  });
  assert.equal(result.diagnostics.status, 'no_search_candidates');
  assert.equal(result.diagnostics.retries, 1);
  assert.equal(calls, 3);
});

test('enforces one overall deadline across headers and body reads', async () => {
  const started = performance.now();
  const result = await discoverWikimediaLogoCandidates({ domain: 'example.com', missingRoles: ['wide'] }, {
    fetchImpl: async () => {
      await new Promise(resolve => setTimeout(resolve, 220));
      const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"search":')); } });
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    },
    validateUrl: noDnsValidation, cache: new Map(), timeoutMs: 300, now: () => NOW,
  });
  assert.equal(result.diagnostics.status, 'timeout');
  assert.ok(performance.now() - started < 500);
});

test('does not retry before a Retry-After delay that exceeds the resolver deadline', async () => {
  let calls = 0, delays = 0;
  const result = await discoverWikimediaLogoCandidates({ domain: 'example.com', missingRoles: ['wide'] }, {
    fetchImpl: async () => { calls += 1; return new Response('', { status: 429, headers: { 'retry-after': '120' } }); },
    validateUrl: noDnsValidation, cache: new Map(), timeoutMs: 500, now: () => NOW,
    delay: async () => { delays += 1; },
  });
  assert.equal(result.diagnostics.status, 'rate_limited');
  assert.equal(calls, 1);
  assert.equal(delays, 0);
});

test('shared SVG safety rejects active content and classifies safe light/dark Commons variants', async () => {
  const base = {
    source: 'wikimedia-commons', url: 'https://upload.wikimedia.org/wikipedia/commons/a/a0/Example.svg',
    evidence: { wikidata_identity_verified: true, positive_token: true, eligible_roles: ['wide'] },
    provenance: { wikidata_entity_id: 'Q1' },
  };
  const unsafe = await extractorInternals.validateCandidateBytes(base, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40"><script>alert(1)</script><path d="M0 0h200v40z"/></svg>'));
  assert.equal(unsafe, null);
  const bytes = color => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40"><path fill="${color}" d="M0 0h200v40H0z"/></svg>`);
  const black = await extractorInternals.validateCandidateBytes({ ...base, url: base.url.replace('Example', 'Example-black') }, bytes('#111'));
  const white = await extractorInternals.validateCandidateBytes({ ...base, url: base.url.replace('Example', 'Example-white') }, bytes('#fff'));
  const light = rankCandidates([black, white], { preferences: { logo: { theme: 'light' } } });
  const dark = rankCandidates([black, white], { preferences: { logo: { theme: 'dark' } } });
  assert.match(light.selectedByRole.wide.url, /black/);
  assert.match(dark.selectedByRole.wide.url, /white/);
});

test('fallback role gate requests only absent or preference-incompatible roles', () => {
  const preferences = normalizeAssetPreferences();
  const ranked = rankCandidates([{
    source: 'schema', url: 'https://example.com/wordmark.svg', width: 300, height: 50,
    scalable: true, highResolution: true, bytes: 100, evidence: { positive_token: true },
  }]);
  assert.deepEqual(extractorInternals.missingWikimediaRoles(ranked, preferences), ['icon']);
});

test('Wikimedia fallback is enabled by default and supports explicit opt-out', () => {
  assert.equal(extractorInternals.wikimediaFallbackEnabled(), true);
  assert.equal(extractorInternals.wikimediaFallbackEnabled({ wikimediaFallback: true }), true);
  assert.equal(extractorInternals.wikimediaFallbackEnabled({ wikimediaFallback: false }), false);
});
