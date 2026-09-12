import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  decodeSitemap,
  discoverSitemapBrandAssets as discoverSitemapBrandAssetsUnsafe,
  internals,
  parseRobotsSitemaps,
  parseSitemapXml,
  scoreSitemapPageUrl,
} from '../src/discover-sitemap.mjs';

function discoverSitemapBrandAssets(input, options) {
  return discoverSitemapBrandAssetsUnsafe({
    ...input,
    validateUrl: input.validateUrl ?? (async value => new URL(value)),
  }, options);
}

function resource(url, bytes, { status = 200, type = 'application/xml', requestCount = 1 } = {}) {
  return { ok: status >= 200 && status < 300, status, url, headers: new Headers({ 'content-type': type }), bytes: Buffer.from(bytes), requestCount, downloadedBytes: Buffer.byteLength(bytes), durationMs: 5 };
}

test('robots sitemap declarations are case-insensitive, resolved, bounded, and deduplicated', () => {
  const text = 'Sitemap: /sitemap.xml\nsitemap: https://www.acme.test/sitemap.xml\nSITEMAP: https://www.acme.test/other.xml # note';
  assert.deepEqual(parseRobotsSitemaps(text, 'https://www.acme.test/robots.txt'), [
    'https://www.acme.test/sitemap.xml',
    'https://www.acme.test/other.xml',
  ]);
});

test('sitemap XML parsing handles urlsets and indexes without accepting HTML or entities', () => {
  const urlset = parseSitemapXml('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://acme.test/brand-assets</loc><lastmod>2026-01-01</lastmod></url></urlset>', 'https://acme.test/sitemap.xml');
  assert.deepEqual(urlset, { type: 'urlset', entries: [{ url: 'https://acme.test/brand-assets', lastmod: '2026-01-01' }] });
  const index = parseSitemapXml('<sitemapindex><sitemap><loc>/pages.xml</loc></sitemap></sitemapindex>', 'https://acme.test/sitemap.xml');
  assert.deepEqual(index.entries, [{ url: 'https://acme.test/pages.xml', lastmod: null }]);
  assert.throws(() => parseSitemapXml('<html><body>not a sitemap</body></html>', 'https://acme.test/sitemap.xml'), /root/);
  assert.throws(() => parseSitemapXml('<urlset><url><loc>https://acme.test/brand</loc></url>', 'https://acme.test/sitemap.xml'), /truncated/);
  assert.throws(() => parseSitemapXml('<urlset><url><loc>https://acme.test/brand</url></urlset>', 'https://acme.test/sitemap.xml'), /truncated/);
  assert.throws(() => decodeSitemap(Buffer.from('<!DOCTYPE html><html></html>')), /HTML/);
  assert.throws(() => decodeSitemap(Buffer.from('<!DOCTYPE x [<!ENTITY y "z">]><urlset/>')), /entity/);
});

test('gzip sitemap decoding enforces compressed and expanded limits', () => {
  const bytes = gzipSync(Buffer.from('<urlset><url><loc>https://acme.test/brand</loc></url></urlset>'));
  const decoded = decodeSitemap(bytes, new Headers(), { maxSitemapCompressedBytes: bytes.length, maxSitemapUncompressedBytes: 200 });
  assert.match(decoded.text, /urlset/);
  assert.equal(decoded.compressedBytes, bytes.length);
  assert.throws(() => decodeSitemap(bytes, new Headers(), { maxSitemapCompressedBytes: bytes.length - 1, maxSitemapUncompressedBytes: 200 }), /Compressed/);
  assert.throws(() => decodeSitemap(bytes, new Headers(), { maxSitemapCompressedBytes: bytes.length, maxSitemapUncompressedBytes: 10 }), /gzip sitemap/);
});

test('URL scoring prefers focused brand pages, supports newsroom information, and penalizes posts', () => {
  assert.ok(scoreSitemapPageUrl('https://acme.test/company/brand-assets').score >= 100);
  assert.ok(scoreSitemapPageUrl('https://acme.test/newsroom/information').score >= 80);
  assert.ok(scoreSitemapPageUrl('https://acme.test/newsroom/2026/08/product-launch').score < 55);
  assert.ok(scoreSitemapPageUrl('https://acme.test/press/product-launch').score < 55);
  assert.ok(scoreSitemapPageUrl('https://acme.test/docs/api/resources/media').score < 55);
  assert.ok(scoreSitemapPageUrl('https://acme.test/docs/api/overview/about').score < 25);
  assert.ok(scoreSitemapPageUrl('https://acme.test/docs/brand').score >= 55);
  assert.ok(scoreSitemapPageUrl('https://acme.test/news/newsroom/corporate/new-brand-creative-agency').score < 55);
  assert.ok(scoreSitemapPageUrl('https://acme.test/docs/sdk/python-style-guide').score < 55);
  assert.ok(scoreSitemapPageUrl('https://shop.test/b/ALFI-BRAND/N-123').score < 55);
  assert.doesNotThrow(() => scoreSitemapPageUrl('https://acme.test/brand-assets/%E0%A4%A'));
});

test('bounded discovery follows an index once, rejects cross-domain URLs, and emits wide-only provenance', async () => {
  const responses = new Map([
    ['https://www.acme.test/robots.txt', resource('https://www.acme.test/robots.txt', 'Sitemap: https://www.acme.test/index.xml', { type: 'text/plain' })],
    ['https://www.acme.test/index.xml', resource('https://www.acme.test/index.xml', '<sitemapindex><sitemap><loc>https://www.acme.test/pages.xml</loc></sitemap><sitemap><loc>https://evil.test/pages.xml</loc></sitemap></sitemapindex>')],
    ['https://www.acme.test/pages.xml', resource('https://www.acme.test/pages.xml', '<urlset><url><loc>https://www.acme.test/company/brand-assets</loc></url><url><loc>https://evil.test/brand</loc></url></urlset>')],
    ['https://www.acme.test/company/brand-assets', resource('https://www.acme.test/company/brand-assets', '<!doctype html><html><header><a href="/"><img alt="Acme logo" src="/assets/acme-wordmark.svg"></a></header></html>', { type: 'text/html' })],
  ]);
  const seen = [];
  const result = await discoverSitemapBrandAssets({
    homepage: 'https://www.acme.test/', companyName: 'Acme',
    fetchResource: async url => { seen.push(url); const response = responses.get(url); if (!response) throw new Error(`unexpected ${url}`); return response; },
  }, { seedMode: 'robots-only' });
  assert.deepEqual(seen, [
    'https://www.acme.test/robots.txt',
    'https://www.acme.test/index.xml',
    'https://www.acme.test/pages.xml',
    'https://www.acme.test/company/brand-assets',
  ]);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].evidence.eligible_roles, ['wide']);
  assert.equal(result.candidates[0].evidence.sitemap_official_page, true);
  assert.equal(result.candidates[0].provenance_chain.at(-2).kind, 'sitemap-official-page');
  assert.equal(result.diagnostics.urlsConsidered, 4);
});

test('discovery rejects HTML masquerading as XML, loops, oversized bodies, and off-domain redirects without escaping budgets', async () => {
  const calls = [];
  const result = await discoverSitemapBrandAssets({
    homepage: 'https://acme.test/', companyName: 'Acme',
    fetchResource: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/robots.txt')) return resource(url, 'Sitemap: https://acme.test/sitemap.xml', { type: 'text/plain' });
      if (url.endsWith('/sitemap.xml')) return resource(url, '<html>blocked</html>', { type: 'text/html' });
      throw new Error('unexpected fetch');
    },
  }, { seedMode: 'robots-only', limits: { maxSitemapDocuments: 1, maxPages: 1 } });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.diagnostics.sitemapDocumentsAttempted, 1);
  assert.match(result.diagnostics.documents[0].error, /HTML/);
  assert.equal(calls[1].options.maxRedirects, 3);
});

test('robots-declared private subdomains are rejected before a sitemap request', async () => {
  const seen = [];
  const result = await discoverSitemapBrandAssetsUnsafe({
    homepage: 'https://acme.test/', companyName: 'Acme',
    validateUrl: async value => {
      const url = new URL(value);
      if (url.hostname === 'private.acme.test') throw new Error('Resolved to a private address.');
      return url;
    },
    fetchResource: async url => {
      seen.push(url);
      return resource(url, 'Sitemap: https://private.acme.test/sitemap.xml', { type: 'text/plain' });
    },
  }, { seedMode: 'robots-only' });
  assert.deepEqual(seen, ['https://acme.test/robots.txt']);
  assert.equal(result.diagnostics.sitemapDocumentsAttempted, 1);
  assert.match(result.diagnostics.documents[0].error, /private address/);
});

test('page and candidate budgets are enforced and cross-registrable-domain assets are excluded', async () => {
  const sitemap = '<urlset><url><loc>https://acme.test/brand-assets</loc></url><url><loc>https://acme.test/media-kit</loc></url></urlset>';
  const html = '<header><img alt="Acme logo" src="https://cdn.evil.test/acme.svg"><img alt="Acme logo" src="/one.svg"><img alt="Acme logo" src="/two.svg"></header>';
  const result = await discoverSitemapBrandAssets({
    homepage: 'https://acme.test/', companyName: 'Acme',
    fetchResource: async url => url.endsWith('/robots.txt')
      ? resource(url, 'Sitemap: https://acme.test/sitemap.xml', { type: 'text/plain' })
      : url.endsWith('/sitemap.xml') ? resource(url, sitemap) : resource(url, html, { type: 'text/html' }),
  }, { seedMode: 'robots-only', limits: { maxPages: 1, maxCandidates: 1 } });
  assert.equal(result.diagnostics.pagesAttempted, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(new URL(result.candidates[0].url).hostname, 'acme.test');
});

test('generic header thumbnails are not promoted from a sitemap-discovered page', async () => {
  const result = await discoverSitemapBrandAssets({
    homepage: 'https://acme.test/', companyName: 'Acme',
    fetchResource: async url => url.endsWith('/robots.txt')
      ? resource(url, 'Sitemap: https://acme.test/sitemap.xml', { type: 'text/plain' })
      : url.endsWith('/sitemap.xml')
        ? resource(url, '<urlset><url><loc>https://acme.test/brand-assets</loc></url></urlset>')
        : resource(url, '<header><img alt="Connected businesses" src="/navigation/connected-businesses-thumb.jpg"></header>', { type: 'text/html' }),
  }, { seedMode: 'robots-only' });
  assert.equal(result.candidates.length, 0);
});

test('candidate URL deduplication keeps the strongest provenance', () => {
  const weak = { url: 'https://acme.test/logo.svg', source: 'dom-img', evidence: { home_linked: true } };
  const strong = { url: 'https://acme.test/logo.svg', source: 'schema', evidence: { positive_token: true, dom_region: 'header' } };
  assert.equal(internals.uniqueCandidatesByPriority([weak, strong], 4)[0].source, 'schema');
  assert.deepEqual(internals.uniqueCandidatesByPriority([strong], 0), []);
});

test('union mode prioritizes robots declarations before conventional guesses', async () => {
  const seen = [];
  await discoverSitemapBrandAssets({
    homepage: 'https://acme.test/', companyName: 'Acme',
    fetchResource: async url => {
      seen.push(url);
      return url.endsWith('/robots.txt')
        ? resource(url, 'Sitemap: https://acme.test/brand-sitemap.xml', { type: 'text/plain' })
        : resource(url, '<urlset></urlset>');
    },
  }, { seedMode: 'robots-and-conventional', limits: { maxSitemapDocuments: 1 } });
  assert.deepEqual(seen, ['https://acme.test/robots.txt', 'https://acme.test/brand-sitemap.xml']);
});

test('official-page CDN policy admits exact body logos but rejects unrelated labeled artwork', async () => {
  const result = await discoverSitemapBrandAssets({
    homepage: 'https://acme.test/', companyName: 'Acme Holdings',
    fetchResource: async url => url.endsWith('/robots.txt')
      ? resource(url, 'Sitemap: https://acme.test/sitemap.xml', { type: 'text/plain' })
      : url.endsWith('/sitemap.xml')
        ? resource(url, '<urlset><url><loc>https://acme.test/logos</loc></url></urlset>')
        : resource(url, '<main><img class="logo" alt="Acme logo" src="https://cdn.test/acme-wide.svg"><img class="logo" alt="Partner logo" src="https://cdn.test/partner.svg"></main>', { type: 'text/html' }),
  }, { seedMode: 'robots-only', assetHostPolicy: 'official-page' });
  assert.deepEqual(result.candidates.map(item => item.url), ['https://cdn.test/acme-wide.svg']);
  assert.equal(result.candidates[0].evidence.sitemap_exact_identity, true);
  assert.equal(result.candidates[0].evidence.sitemap_cross_domain_asset, true);
});

test('shallow corporate pages require exact company-logo evidence even for home-linked header assets', async () => {
  const result = await discoverSitemapBrandAssets({
    homepage: 'https://acme.test/', companyName: 'Acme',
    fetchResource: async url => url.endsWith('/robots.txt')
      ? resource(url, 'Sitemap: https://acme.test/sitemap.xml', { type: 'text/plain' })
      : url.endsWith('/sitemap.xml')
        ? resource(url, '<urlset><url><loc>https://acme.test/about</loc></url></urlset>')
        : resource(url, '<header><a href="/"><img class="logo" src="/header.svg"></a><img class="logo" alt="Acme logo" src="/acme-wordmark.svg"></header>', { type: 'text/html' }),
  }, { seedMode: 'robots-only', minPageScore: 25, assetHostPolicy: 'official-page' });
  assert.deepEqual(result.candidates.map(item => item.url), ['https://acme.test/acme-wordmark.svg']);
  assert.equal(result.candidates[0].evidence.sitemap_exact_identity, true);
  assert.equal(result.candidates[0].evidence.sitemap_low_intent_identity_gate, true);
});

test('shallow corporate pages admit an exact-labeled inline wordmark without reading identity from its data payload', async () => {
  const result = await discoverSitemapBrandAssets({
    homepage: 'https://acme.test/', companyName: 'Acme',
    fetchResource: async url => url.endsWith('/robots.txt')
      ? resource(url, 'Sitemap: https://acme.test/sitemap.xml', { type: 'text/plain' })
      : url.endsWith('/sitemap.xml')
        ? resource(url, '<urlset><url><loc>https://acme.test/company</loc></url></urlset>')
        : resource(url, '<main><svg class="LogoWordmark logo-static" aria-label="Acme" width="570" height="64" viewBox="0 0 570 64"><path d="M0 0h570v64H0z"/></svg></main>', { type: 'text/html' }),
  }, { seedMode: 'robots-only', minPageScore: 25, assetHostPolicy: 'official-page' });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source, 'inline-svg');
  assert.equal(result.candidates[0].evidence.sitemap_exact_identity, true);
  assert.equal(internals.exactCompanyLogoEvidence({
    url: 'data:image/svg+xml,Acme-logo',
    evidence: { semantic_text: 'logo' },
  }, 'Acme'), false);
});

test('official-page CDN policy requires the company identity in the accessible label, not only the URL', async () => {
  const result = await discoverSitemapBrandAssets({
    homepage: 'https://acme.test/', companyName: 'Acme',
    fetchResource: async url => url.endsWith('/robots.txt')
      ? resource(url, 'Sitemap: https://acme.test/sitemap.xml', { type: 'text/plain' })
      : url.endsWith('/sitemap.xml')
        ? resource(url, '<urlset><url><loc>https://acme.test/logos</loc></url></urlset>')
        : resource(url, '<main><img class="logo" alt="Download logo" src="https://shared-cdn.test/acme-logo.svg"></main>', { type: 'text/html' }),
  }, { seedMode: 'robots-only', assetHostPolicy: 'official-page' });
  assert.equal(result.candidates.length, 0);
});

test('two-letter acronym identity needs an ampersand company name', async () => {
  const discover = companyName => discoverSitemapBrandAssets({
    homepage: 'https://acme.test/', companyName,
    fetchResource: async url => url.endsWith('/robots.txt')
      ? resource(url, 'Sitemap: https://acme.test/sitemap.xml', { type: 'text/plain' })
      : url.endsWith('/sitemap.xml')
        ? resource(url, '<urlset><url><loc>https://acme.test/logos</loc></url></urlset>')
        : resource(url, '<main><img class="logo" alt="AB Logo" src="https://shared-cdn.test/ab-logo.svg"></main>', { type: 'text/html' }),
  }, { seedMode: 'robots-only', assetHostPolicy: 'official-page' });
  assert.equal((await discover('Alpha Beta')).candidates.length, 0);
  assert.equal((await discover('Alpha & Beta')).candidates.length, 1);
});

test('official-page CDN policy does not infer identity from the asset hostname', async () => {
  const result = await discoverSitemapBrandAssets({
    homepage: 'https://vodafone.test/', companyName: 'Vodafone',
    fetchResource: async url => url.endsWith('/robots.txt')
      ? resource(url, 'Sitemap: https://vodafone.test/sitemap.xml', { type: 'text/plain' })
      : url.endsWith('/sitemap.xml')
        ? resource(url, '<urlset><url><loc>https://vodafone.test/logos</loc></url></urlset>')
        : resource(url, '<main><img class="logo" alt="Connected businesses" src="https://vodafone.test/media/navigation/connected-businesses-thumb.jpg"></main>', { type: 'text/html' }),
  }, { seedMode: 'robots-only', assetHostPolicy: 'official-page' });
  assert.equal(result.candidates.length, 0);
});

test('official page is fetched only once after a transient server response', async () => {
  let pageAttempts = 0;
  const result = await discoverSitemapBrandAssets({
    homepage: 'https://acme.test/', companyName: 'Acme',
    fetchResource: async (url, options) => {
      if (url.endsWith('/robots.txt')) return resource(url, 'Sitemap: https://acme.test/sitemap.xml', { type: 'text/plain' });
      if (url.endsWith('/sitemap.xml')) return resource(url, '<urlset><url><loc>https://acme.test/logos</loc></url></urlset>');
      pageAttempts += 1;
      return resource(url, '', { status: 500, type: 'text/html' });
    },
  }, { seedMode: 'robots-only' });
  assert.equal(pageAttempts, 1);
  assert.equal(result.candidates.length, 0);
});

test('global request budget stops sitemap work before a second logical fetch', async () => {
  const result = await discoverSitemapBrandAssets({
    homepage: 'https://acme.test/', companyName: 'Acme',
    fetchResource: async url => resource(url, 'Sitemap: https://acme.test/sitemap.xml', { type: 'text/plain' }),
  }, { seedMode: 'robots-only', limits: { maxRequests: 1 } });
  assert.equal(result.diagnostics.requests, 1);
  assert.equal(result.diagnostics.sitemapDocumentsAttempted, 1);
  assert.match(result.diagnostics.documents[0].error, /request budget/);
});

test('total byte and redirect limits are validated and enforced across documents', async () => {
  const robots = 'Sitemap: https://acme.test/sitemap.xml';
  const result = await discoverSitemapBrandAssets({
    homepage: 'https://acme.test/', companyName: 'Acme',
    fetchResource: async url => resource(url, robots, { type: 'text/plain' }),
  }, { seedMode: 'robots-only', limits: { maxTotalBytes: Buffer.byteLength(robots) } });
  assert.equal(result.diagnostics.bytesDownloaded, Buffer.byteLength(robots));
  assert.match(result.diagnostics.documents[0].error, /total byte budget/);
  await assert.rejects(() => discoverSitemapBrandAssets({
    homepage: 'https://acme.test/', companyName: 'Acme', fetchResource: async () => { throw new Error('not reached'); },
  }, { limits: { maxRedirects: 6 } }), /maxRedirects/);
});
