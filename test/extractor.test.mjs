import test from 'node:test';
import assert from 'node:assert/strict';
import { internals, normalizeWebsite } from '../src/extractor.mjs';
import { buildAssetFamilies, genericAssetReason, rankCandidates } from '../src/rank.mjs';

test('normalizes bare company domains', () => {
  const result = normalizeWebsite('www.Example.com/company');
  assert.equal(result.url.href, 'https://www.example.com/company');
  assert.equal(result.domain, 'example.com');
});

test('rejects local and unsupported URLs', () => {
  assert.throws(() => normalizeWebsite('http://127.0.0.1:3000'), /private-network/);
  assert.throws(() => normalizeWebsite('file:///etc/passwd'), /HTTP and HTTPS/);
});

test('builds ordered HTTPS favicon-cache fallbacks without putting the domain in credentials', () => {
  const sources = internals.cachedFaviconSources('example.com');
  assert.deepEqual(sources.map(item => item.source), ['google-favicon', 'duckduckgo-favicon']);
  assert.equal(sources[0].url, 'https://www.google.com/s2/favicons?domain=example.com&sz=256');
  assert.equal(sources[1].url, 'https://icons.duckduckgo.com/ip3/example.com.ico');
});

test('Jina homepage fallback requests rendered HTML without exposing the key in the URL', async () => {
  const calls = [];
  const diagnostics = { requests: 0 };
  const expected = new Response('<html></html>', { status: 200 });
  const response = await internals.fetchJinaHomepage('https://example.com/path', {
    apiKey: 'test-secret',
    timeoutMs: 12_000,
    diagnostics,
    validateUrl: async () => {},
    fetchImpl: async (url, init) => { calls.push({ url, init }); return expected; },
  });
  assert.equal(response, expected);
  assert.equal(diagnostics.requests, 1);
  assert.equal(calls[0].url, 'https://r.jina.ai/https://example.com/path');
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-secret');
  assert.equal(calls[0].init.headers['x-respond-with'], 'html');
  assert.equal(calls[0].init.headers['x-engine'], 'browser');
  assert.equal(calls[0].init.headers['x-timeout'], '12');
  assert.doesNotMatch(calls[0].url, /test-secret/);
});

test('Jina HTML recovery renders an explicitly marked graphic logo but not ordinary home-link text', async () => {
  const logoSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><rect width="240" height="60" fill="white"/><path d="M5 5h50v50H5z" fill="#f40"/><text x="70" y="42" font-size="32">Acme</text></svg>');
  const recovered = await internals.jinaBrandCandidate('https://example.com/', `<header><a href="/"><img class="site-logo" alt="Acme logo" src="data:image/svg+xml,${logoSvg}"></a></header>`);
  assert.equal(recovered.source, 'jina-screenshot');
  assert.equal(recovered.format, 'png');
  assert.ok(recovered.width >= 200);
  assert.ok(recovered.height >= 40);
  assert.match(recovered.dataUrl, /^data:image\/png;base64,/);
  await assert.rejects(
    internals.jinaBrandCandidate('https://example.com/', '<header><a aria-label="Acme Home" href="/">Acme</a></header>'),
    /did not expose a likely home-linked brand element/,
  );
});

test('parses favicon, Apple, manifest, and flexible Schema.org logo markup', () => {
  const html = `
    <link rel="icon" sizes="32x32" href="/favicon.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
    <link rel="manifest" href="/site.webmanifest">
    <script type="application/ld+json">{
      "@type": "Organization",
      "logo": { "contentUrl": "/company-logo.svg" }
    }</script>`;
  const result = internals.parseHomepage(html, 'https://example.com/about');
  assert.deepEqual(result.manifests, ['https://example.com/site.webmanifest']);
  assert.deepEqual(result.candidates.map(item => [item.source, item.url]), [
    ['html-icon', 'https://example.com/favicon.png'],
    ['apple', 'https://example.com/apple.png'],
    ['schema', 'https://example.com/company-logo.svg'],
  ]);
});

test('reads PNG dimensions from image bytes', () => {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(512, 16);
  bytes.writeUInt32BE(256, 20);
  assert.deepEqual(internals.imageMetadata(bytes, 'image/png'), {
    format: 'png', mimeType: 'image/png', width: 512, height: 256,
  });
});

test('does not accept an HTML error page merely because it contains an SVG element', () => {
  const bytes = Buffer.from('<html><body><svg viewBox="0 0 100 20"></svg></body></html>');
  assert.equal(internals.imageMetadata(bytes, 'text/html'), null);
});

test('uses an SVG viewBox when percentage dimensions are non-intrinsic', () => {
  const bytes = Buffer.from('<svg width="100%" height="100%" viewBox="0 0 800 100"></svg>');
  assert.deepEqual(internals.imageMetadata(bytes, 'image/svg+xml'), {
    format: 'svg', mimeType: 'image/svg+xml', width: 800, height: 100,
  });
});

test('infers a missing SVG dimension from the viewBox aspect ratio', () => {
  const heightOnly = Buffer.from('<svg height="20" viewBox="0 0 300 100"></svg>');
  const widthOnly = Buffer.from('<svg width="90" viewBox="0 0 300 100"></svg>');
  assert.deepEqual(internals.imageMetadata(heightOnly, 'image/svg+xml'), {
    format: 'svg', mimeType: 'image/svg+xml', width: 60, height: 20,
  });
  assert.deepEqual(internals.imageMetadata(widthOnly, 'image/svg+xml'), {
    format: 'svg', mimeType: 'image/svg+xml', width: 90, height: 30,
  });
});

test('ranking rewards square high-resolution candidates', () => {
  const square = internals.scoreCandidate({ source: 'manifest', squareish: true, highResolution: true, scalable: false, width: 512, height: 512 });
  const wordmark = internals.scoreCandidate({ source: 'schema', squareish: false, highResolution: true, scalable: false, width: 1200, height: 200 });
  assert.ok(square > wordmark);
});

test('discovers visible logo images, lazy sources, picture srcsets, metadata, and inline header SVG', () => {
  const html = `
    <meta property="og:logo" content="/meta-logo.svg">
    <meta property="og:image" content="/launch-banner.jpg">
    <header><a href="/" aria-label="Acme home">
      <img class="site-logo" alt="Acme" src="/logo.svg" data-src="/logo-lazy.svg">
      <svg viewBox="0 0 200 40" aria-label="Acme logo"><path d="M0 0h20v20z"/></svg>
    </a></header>
    <picture><source srcset="/wordmark-1x.png 1x, /wordmark-2x.png 2x"></picture>`;
  const result = internals.parseHomepage(html, 'https://acme.test/products', { companyName: 'Acme Inc.' });
  const bySource = Object.groupBy(result.candidates, item => item.source);
  assert.equal(bySource['og-logo'][0].url, 'https://acme.test/meta-logo.svg');
  assert.equal(bySource['social-banner'][0].evidence.banner, true);
  assert.equal(bySource['dom-img'].length, 2);
  assert.equal(bySource['dom-img'][0].evidence.dom_region, 'header');
  assert.equal(bySource['dom-img'][0].evidence.home_linked, true);
  assert.equal(bySource['dom-picture'].length, 2);
  assert.match(bySource['inline-svg'][0].url, /^data:image\/svg\+xml;base64,/);
});

test('browser conversion retains localized-home evidence', () => {
  const browser = internals.browserCandidateDisposition({
    kind: 'external', source: 'browser-img', url: 'https://acme.test/mark.svg',
    evidence: [{ domRegion: 'nav', homeLinked: true, renderedBox: { width: 180, height: 40 } }],
  }, 'https://acme.test/de/');
  assert.equal(browser.stage, 'retained');
});

test('null-like URLs are rejected without suppressing inline SVG evidence', () => {
  const staticResult = internals.parseHomepage('<header><img class="logo" src="null"><svg class="logo" viewBox="0 0 180 40"><path d="M0 0h20v20z"/></svg></header>', 'https://acme.test/');
  assert.equal(staticResult.candidates.some(item => /\/null$/.test(item.url)), false);
  assert.equal(staticResult.candidates.some(item => item.source === 'inline-svg'), true);
  const inline = internals.browserCandidateDisposition({
    kind: 'inline-svg', source: 'browser-inline-svg', inlineSvg: '<svg viewBox="0 0 180 40"/>',
    evidence: [{ domRegion: 'header', homeLinked: true, renderedBox: { width: 180, height: 40 } }],
  }, 'https://acme.test/');
  assert.equal(inline.stage, 'retained');
});

test('browser retention admits only wide weak-text placements and reserves two existing-budget slots', () => {
  const weakWide = internals.browserCandidateDisposition({
    kind: 'external', source: 'browser-img', url: 'https://cdn.test/acme.png',
    evidence: [{ domRegion: 'header', homeLinked: false, renderedBox: { width: 200, height: 40 } }],
  }, 'https://acme.test/');
  const weakSquare = internals.browserCandidateDisposition({
    kind: 'external', source: 'browser-img', url: 'https://cdn.test/photo.png',
    evidence: [{ domRegion: 'header', homeLinked: false, renderedBox: { width: 40, height: 40 } }],
  }, 'https://acme.test/');
  assert.equal(weakWide.stage, 'retained');
  assert.equal(weakSquare.stage, 'semantic_filter');
  const ordinary = Array.from({ length: 8 }, (_, index) => ({ url: `https://test/icon-${index}.svg`, source: 'browser-inline-svg', declared: { width: 40, height: 40 }, evidence: { positive_token: true } }));
  const reserved = [weakWide.candidate, { ...weakWide.candidate, url: 'https://cdn.test/acme-dark.png' }];
  const selection = internals.selectBrowserCandidates([...ordinary, ...reserved], 8, 2);
  assert.equal(selection.chosen.length, 8);
  assert.deepEqual(selection.reserved, reserved);
  assert.ok(reserved.every(item => selection.chosen.includes(item)));
});

test('weak-text header admission still needs independent company identity to become wide-eligible', () => {
  const disposition = url => internals.browserCandidateDisposition({
    kind: 'external', source: 'browser-img', url,
    evidence: [{ domRegion: 'header', homeLinked: false, renderedBox: { width: 240, height: 48 } }],
  }, 'https://acme.test/');
  const partner = disposition('https://cdn.example/partner-wordmark.svg');
  const company = disposition('https://cdn.example/acme-wordmark.svg');
  assert.equal(partner.stage, 'retained');
  assert.equal(company.stage, 'retained');

  const validated = item => ({ ...item.candidate, width: 240, height: 48, highResolution: true, scalable: true, bytes: 100 });
  assert.equal(rankCandidates([validated(partner)], { companyName: 'Acme' }).selectedByRole.wide, null);
  assert.equal(rankCandidates([validated(company)], { companyName: 'Acme' }).selectedByRole.wide.url, company.candidate.url);
});

test('first-party logo paths provide narrow production wide evidence without a company name', () => {
  const common = {
    source: 'browser-img', source_page: 'https://www.raywatt.com/', width: 620, height: 155,
    highResolution: true, scalable: true, bytes: 100,
    evidence: { dom_region: 'nav', home_linked: false, positive_token: false, eligible_roles: ['wide'] },
  };
  const firstParty = { ...common, url: 'https://raywatt.com/eng/image/common/raywatt_logo.svg' };
  const thirdParty = { ...common, url: 'https://cdn.example/raywatt_logo.svg' };
  const body = { ...common, url: 'https://raywatt.com/eng/image/common/raywatt_logo.svg', evidence: { ...common.evidence, dom_region: 'body' } };
  assert.equal(rankCandidates([firstParty]).selectedByRole.wide.url, firstParty.url);
  assert.equal(rankCandidates([thirdParty]).selectedByRole.wide, null);
  assert.equal(rankCandidates([body]).selectedByRole.wide, null);
});

test('resolves document-relative assets against the first base element', () => {
  const result = internals.parseHomepage('<base href="https://cdn.example.com/site/"><img class="logo" src="brand.svg">', 'https://example.com/');
  assert.equal(result.candidates[0].url, 'https://cdn.example.com/site/brand.svg');
  assert.equal(result.candidates[0].source_page, 'https://example.com/');
});

test('negative partner context is retained as ranking evidence', () => {
  const { candidates } = internals.parseHomepage('<section class="customer-partners"><img class="logo" alt="Other" src="/other.svg"></section>', 'https://acme.test/');
  assert.equal(candidates[0].evidence.negative_context, true);
  const result = rankCandidates([{ ...candidates[0], width: 200, height: 50, highResolution: true, scalable: true, bytes: 100 }], { companyName: 'Acme' });
  assert.ok(result.candidates[0].score_reasons.includes('negative context -35'));
});

test('role-specific ranking keeps a wide logo separate from an icon', () => {
  const common = { highResolution: true, scalable: true, bytes: 100, evidence: { positive_token: true, dom_region: 'header', home_linked: true } };
  const icon = { ...common, url: 'https://acme.test/icon.svg', source: 'dom-img', width: 256, height: 256 };
  const wide = { ...common, url: 'https://acme.test/acme-logo.svg', source: 'dom-img', width: 800, height: 160 };
  const result = rankCandidates([icon, wide], { companyName: 'Acme' });
  assert.equal(result.selectedByRole.icon.url, icon.url);
  assert.equal(result.selectedByRole.wide.url, wide.url);
  assert.ok(result.selectedByRole.wide.score_reasons.some(reason => reason.startsWith('wide shape')));
});

test('legacy favicon selection stays independent from the canonical icon selection', () => {
  const common = { highResolution: true, bytes: 100, evidence: {} };
  const largeApple = { ...common, url: 'https://acme.test/apple.png', source: 'apple', width: 180, height: 180, tinySuitability: { score: 50 } };
  const intendedHtml = { ...common, url: 'https://acme.test/favicon.png', source: 'html-icon', width: 32, height: 32, tinySuitability: { score: 80 } };
  const result = rankCandidates([largeApple, intendedHtml], { companyName: 'Acme' });
  assert.equal(result.selectedByRole.icon.url, largeApple.url);
  assert.equal(result.selectedByRole.favicon.url, intendedHtml.url);
  assert.strictEqual(result.assets.icon, result.selectedByRole.icon);
});

test('legacy favicon scoring remains available as candidate metadata', () => {
  const common = { highResolution: true, bytes: 100, evidence: {} };
  const largeMeasured = { ...common, url: 'https://acme.test/apple.png', source: 'apple', width: 180, height: 180, tinySuitability: { score: 20 } };
  const intendedUnmeasured = { ...common, url: 'https://acme.test/favicon.ico', source: 'html-icon', width: 32, height: 32 };
  const result = rankCandidates([largeMeasured, intendedUnmeasured], { companyName: 'Acme' });
  assert.ok(result.candidates.every(candidate => Number.isFinite(candidate.role_scores.favicon)));
  assert.equal(result.selectedByRole.favicon.url, intendedUnmeasured.url);
});

test('canonical icon prefers a true icon and otherwise falls back to the best favicon role', () => {
  const common = { highResolution: false, bytes: 100, evidence: { eligible_roles: ['favicon'] } };
  const favicon = { ...common, url: 'https://acme.test/favicon.png', source: 'html-icon', width: 32, height: 32, tinySuitability: { score: 90 } };
  const result = rankCandidates([favicon], { companyName: 'Acme' });
  assert.deepEqual(result.candidates[0].predicted_roles, ['favicon']);
  assert.equal(result.assets.icon.url, favicon.url);

  const icon = { ...common, highResolution: true, url: 'https://acme.test/icon.png', source: 'dom-img', width: 256, height: 256, evidence: { positive_token: true, home_linked: true, dom_region: 'header' } };
  const withIcon = rankCandidates([favicon, icon], { companyName: 'Acme' });
  assert.equal(withIcon.assets.icon.url, icon.url);
  assert.equal(withIcon.selectedByRole.favicon.url, favicon.url);
});

test('declared icons displace unlinked DOM squares but never a home-linked logo', () => {
  const declared = { source: 'apple', url: 'https://acme.test/apple.png', width: 180, height: 180, highResolution: true, bytes: 100, evidence: {} };
  const unlinked = { source: 'dom-img', url: 'https://acme.test/acme-icon.png', width: 512, height: 512, highResolution: true, scalable: true, bytes: 200,
    evidence: { positive_token: true, dom_region: 'body', home_linked: false } };
  assert.equal(rankCandidates([unlinked, declared], { companyName: 'Acme' }).selectedByRole.icon.url, declared.url);
  const homeLinked = { ...unlinked, evidence: { ...unlinked.evidence, dom_region: 'header', home_linked: true } };
  assert.equal(rankCandidates([homeLinked, declared], { companyName: 'Acme' }).selectedByRole.icon.url, homeLinked.url);
});

test('accepted inline SVGs become standalone and empty SVGs fail renderability', async () => {
  const markup = '<svg viewBox="0 0 120 24"><path fill="currentColor" d="M0 0h120v24H0z"/></svg>';
  const item = { url: `data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')}`, source: 'inline-svg', evidence: { inherited_color: '#5b21b6' } };
  const validated = await internals.validateCandidate(item, 1_000, { requests: 0, bytesDownloaded: 0 });
  assert.ok(validated);
  const normalized = Buffer.from(validated.dataUrl.split(',')[1], 'base64').toString('utf8');
  assert.match(normalized, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(normalized, /color="#5b21b6"/);

  const selfReferential = '<svg color="currentColor" viewBox="0 0 10 10"><path fill="currentColor" d="M0 0h10v10H0z"/></svg>';
  const resolved = await internals.validateCandidate({ ...item, url: `data:image/svg+xml;base64,${Buffer.from(selfReferential).toString('base64')}` }, 1_000, { requests: 0, bytesDownloaded: 0 });
  assert.match(Buffer.from(resolved.dataUrl.split(',')[1], 'base64').toString('utf8'), /color="#5b21b6"/);

  const empty = '<svg viewBox="0 0 120 24"></svg>';
  const rejected = await internals.validateCandidate({ ...item, url: `data:image/svg+xml;base64,${Buffer.from(empty).toString('base64')}` }, 1_000, { requests: 0, bytesDownloaded: 0 });
  assert.equal(rejected, null);
});

test('rendered fallback is gated by missing wide output, including empty results', () => {
  assert.equal(internals.needsRenderedWideFallback({ candidates: [], selectedByRole: { icon: null, wide: null } }), true);
  assert.equal(internals.needsRenderedWideFallback({ candidates: [{}], selectedByRole: { icon: {}, wide: null } }), true);
  assert.equal(internals.needsRenderedWideFallback({ candidates: [{}], selectedByRole: { icon: null, wide: {} } }), false);
  assert.equal(internals.needsRenderedWideFallback({ selectedByRole: { wide: { variant: { theme: 'light', background: 'opaque' } } } }, { logo: { theme: 'dark' } }), true);
  assert.equal(internals.needsRenderedWideFallback({ selectedByRole: { wide: { variant: { theme: 'dark', background: 'transparent' } } } }, { logo: { theme: 'dark', background: 'transparent' } }), false);
});

test('groups conservative delivery variants without merging distinct artwork', () => {
  const common = { source: 'html-icon', width: 180, height: 180, predicted_roles: ['icon', 'favicon'], role_scores: { icon: 60, favicon: 80 }, score: 80 };
  const { candidates, assetFamilies } = buildAssetFamilies([
    { ...common, url: 'https://cdn.test/brand.png?w=180&h=180' },
    { ...common, url: 'https://cdn.test/brand.png?w=96&h=96', width: 96, height: 96 },
    { ...common, url: 'https://cdn.test/product.png?w=180&h=180' },
  ]);
  assert.equal(assetFamilies.length, 2);
  assert.deepEqual(assetFamilies.map(family => family.variantCount), [2, 1]);
  assert.equal(candidates[0].family_id, candidates[1].family_id);
  assert.notEqual(candidates[0].family_id, candidates[2].family_id);
  assert.equal(assetFamilies[0].bestByRole.favicon, 1);
});

test('logo preferences select matching theme and background variants with fallback', () => {
  const common = { source: 'official-archive', width: 500, height: 100, highResolution: true, scalable: true, bytes: 100, evidence: { eligible_roles: ['wide'], archive_score: 90, deep_official: true, positive_token: true } };
  const darkOpaque = { ...common, url: 'zip+https://acme.test/kit.zip#Acme_Dark.svg', background: 'opaque', evidence: { ...common.evidence, theme: 'light' } };
  const whiteTransparent = { ...common, url: 'zip+https://acme.test/kit.zip#Acme_White.svg', background: 'transparent', evidence: { ...common.evidence, theme: 'dark' } };
  const preferred = rankCandidates([darkOpaque, whiteTransparent], { companyName: 'Acme', preferences: { logo: { theme: 'dark', background: 'transparent' } } });
  assert.equal(preferred.assets.logo.url, whiteTransparent.url);
  assert.deepEqual(preferred.assets.logo.variant, { theme: 'dark', color: 'white', background: 'transparent' });
  assert.deepEqual(preferred.preferences, {
    icon: { theme: 'any', color: 'any', background: 'any' },
    logo: { theme: 'dark', color: 'any', background: 'transparent' },
  });
  assert.deepEqual(preferred.assetVariants.logo.map(item => item.url), [whiteTransparent.url, darkOpaque.url]);
  assert.deepEqual(preferred.assetVariants.logo.map(item => item.certainty.band), ['medium', 'medium']);
  assert.deepEqual(preferred.variantPolicy, { minimumRoleScore: 45 });

  const fallback = rankCandidates([darkOpaque], { companyName: 'Acme', preferences: { logo: { theme: 'dark', background: 'transparent' } } });
  assert.equal(fallback.assets.logo.url, darkOpaque.url);
});

test('role variants require medium role certainty and icon preferences can select white artwork', () => {
  const commonIcon = { source: 'browser-img', width: 128, height: 128, highResolution: true, bytes: 100, background: 'transparent', evidence: { eligible_roles: ['icon'], positive_token: true, home_linked: true, dom_region: 'header' } };
  const black = { ...commonIcon, url: 'https://acme.test/acme-black.svg', evidence: { ...commonIcon.evidence, theme: 'light' } };
  const white = { ...commonIcon, url: 'https://acme.test/acme-white.svg', evidence: { ...commonIcon.evidence, theme: 'dark' } };
  const iconResult = rankCandidates([black, white], { companyName: 'Acme', preferences: { icon: { color: 'white', theme: 'dark' } } });
  assert.equal(iconResult.assets.icon.url, white.url);
  assert.deepEqual(iconResult.assetVariants.icon.map(item => item.variant.color), ['white', 'black']);

  const commonWide = { source: 'official-archive', width: 500, height: 100, bytes: 100, evidence: { eligible_roles: ['wide'], archive_score: 90, deep_official: true } };
  const certain = { ...commonWide, url: 'zip+https://acme.test/kit.zip#Acme_White.svg', highResolution: true, scalable: true, background: 'transparent' };
  const low = { ...commonWide, url: 'zip+https://acme.test/kit.zip#Acme_Mark.svg', highResolution: true, evidence: { ...commonWide.evidence, theme: 'unknown' } };
  const logoResult = rankCandidates([certain, low], { companyName: 'Acme' });
  assert.ok(logoResult.candidates.find(item => item.url === low.url).predicted_roles.includes('wide'));
  assert.ok(logoResult.candidates.find(item => item.url === low.url).role_scores.wide < logoResult.variantPolicy.minimumRoleScore);
  assert.deepEqual(logoResult.assetVariants.logo.map(item => item.url), [certain.url]);
});

test('image validation distinguishes transparent and opaque backgrounds', async () => {
  const transparent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><path fill="#000" d="M5 5h30v10H5z"/></svg>');
  const opaque = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#fff"/></svg>');
  assert.equal(await internals.imageBackground(transparent, 'svg'), 'transparent');
  assert.equal(await internals.imageBackground(opaque, 'svg'), 'opaque');
});

test('does not serialize inline SVG that depends on an external document', () => {
  const html = '<header><svg class="logo" viewBox="0 0 20 20"><use href="/sprite.svg#logo"/></svg><svg class="logo" viewBox="0 0 20 20"><defs><path id="brand" d="M0 0h2v2z"/></defs><use href="#brand"/></svg></header>';
  const result = internals.parseHomepage(html, 'https://acme.test/');
  assert.equal(result.candidates.filter(item => item.source === 'inline-svg').length, 1);
});

test('does not promote navigation controls or inherit logo semantics from a distant ancestor', () => {
  const html = `
    <header class="logo-bar">
      <a href="/"><svg class="menu-toggle" width="40" height="40"><path d="M0 0h2v2z"/></svg></a>
      <svg class="e-fab-whatsapp" width="448" height="512"><path d="M0 0h2v2z"/></svg>
      <svg width="512" height="512"><path d="M0 0h2v2z"/></svg>
      <a href="/"><svg class="company-logo" width="64" height="64"><path d="M0 0h2v2z"/></svg></a>
    </header>`;
  const result = internals.parseHomepage(html, 'https://acme.test/');
  assert.equal(result.candidates.filter(item => item.source === 'inline-svg').length, 1);
  assert.match(result.candidates.find(item => item.source === 'inline-svg').evidence.semantic_text, /company-logo/);
});

test('does not treat the page hostname as company-name agreement for partner logos', () => {
  const partner = {
    url: 'https://beebizy.com/assets/logo-paramount.svg', source: 'dom-img', width: 320, height: 120,
    highResolution: true, scalable: true, bytes: 100, evidence: { positive_token: true, dom_region: 'body' },
  };
  const result = rankCandidates([partner], { companyName: 'beebizy' });
  assert.equal(result.selectedByRole.wide, null);
  assert.ok(!result.candidates[0].score_reasons.includes('company agreement +12'));
});

test('rejects descriptive product photos that merely mention an embedded logo', () => {
  const applePhoto = {
    url: 'https://www.apple.com/images/apple-card.jpg', source: 'dom-img', source_page: 'https://www.apple.com/',
    width: 1262, height: 580, scalable: false,
    evidence: { dom_region: 'body', home_linked: false, positive_token: true,
      alt: 'Apple Card, front, Apple logo in top left, cardholder name in middle left, card chip in middle right.' },
  };
  const subwayLockup = {
    ...applePhoto, url: 'https://www.subway.com/honey-logo.avif',
    evidence: { ...applePhoto.evidence, alt: 'Subway logo with honey dipper stick and dripping honey.' },
  };
  assert.match(genericAssetReason(applePhoto, 'Apple'), /embedded in body content/);
  assert.equal(genericAssetReason(subwayLockup, 'Subway'), null);

  const parsed = internals.parseHomepage('<main><img alt="Phone, rear view, Acme logo in the center" src="/phone.jpg"></main>', 'https://acme.test/');
  assert.equal(parsed.candidates[0].evidence.negative_context, true);
});

test('rejects known platform defaults, compliance badges, and UI glyphs without blocking the platform itself', () => {
  const common = { source: 'dom-img', width: 240, height: 80, highResolution: true, scalable: false, bytes: 100 };
  const namecheap = { ...common, url: 'https://example.test/logo.svg', evidence: { semantic_text: 'Namecheap Logo', positive_token: true, dom_region: 'header' } };
  const matomo = { ...common, url: 'https://example.test/plugins/Morpheus/images/logo.svg?matomo', evidence: { semantic_text: 'default-piwik-logo Matomo', positive_token: true, dom_region: 'nav' } };
  const matomoApp = { ...common, width: 256, height: 256, source: 'manifest', url: 'https://example.test/plugins/CoreHome/images/applogo_256.png', evidence: {} };
  const badge = { ...common, width: 100, height: 100, url: 'https://example.test/logo-soc-2.svg', evidence: { semantic_text: 'SOC 2 Type I compliant site-footer', positive_token: true, dom_region: 'footer' } };
  const language = { ...common, width: 100, height: 100, source: 'inline-svg', url: 'data:image/svg+xml;base64,PHN2Zy8+', evidence: { semantic_text: 'svg-inline--fa fa-language navbar', home_linked: true, dom_region: 'nav' } };
  for (const item of [namecheap, matomo, matomoApp, badge, language]) {
    const result = rankCandidates([item], { companyName: 'Acme' });
    assert.deepEqual(result.candidates[0].predicted_roles, []);
    assert.match(result.candidates[0].score_reasons.join(' '), /generic exclusion/);
  }
  assert.equal(genericAssetReason(namecheap, 'Namecheap'), null);
  assert.equal(genericAssetReason({ ...namecheap, source_page: 'https://www.namecheap.com/' }), null);
});

test('rejects the shared Wix default favicon but keeps custom Wix-hosted assets', () => {
  const defaultWix = { source: 'html-icon', url: 'https://static.parastorage.com/client/pfavico.ico', width: 16, height: 16, bytes: 100, evidence: {} };
  const customWix = { ...defaultWix, url: 'https://static.wixstatic.com/media/site-specific-id.png', width: 180, height: 180, highResolution: true };
  assert.match(genericAssetReason(defaultWix, 'Acme'), /Wix default favicon/);
  assert.equal(genericAssetReason(customWix, 'Acme'), null);
  assert.match(genericAssetReason({ ...customWix, observed: { byte_hash: '33c1436f8c40ca2582d091c449fccc34ed9bf73f02526c5fdef44f4f06c6321b' } }, 'Acme'), /Wix default favicon/);
  assert.deepEqual(rankCandidates([defaultWix], { companyName: 'Acme' }).candidates[0].predicted_roles, []);
  assert.deepEqual(rankCandidates([customWix], { companyName: 'Acme' }).candidates[0].predicted_roles, ['icon', 'favicon']);
});

test('rejects social glyphs, inline controls, template marks, and content imagery', () => {
  const common = { source: 'dom-img', highResolution: true, scalable: false, bytes: 100, evidence: { dom_region: 'body', home_linked: false } };
  const cases = [
    { ...common, url: 'https://example.test/instagram.svg', width: 448, height: 512, scalable: true, evidence: { semantic_text: 'social-icons instagram', dom_region: 'nav' } },
    { ...common, source: 'inline-svg', url: 'data:image/svg+xml;base64,PHN2Zy8+', width: 64, height: 64, scalable: true, evidence: { semantic_text: 'icon_play lightbox', home_linked: true, dom_region: 'body' } },
    { ...common, url: 'https://cdn.test/untitled-ui-logo.png', width: 400, height: 100, evidence: { semantic_text: 'uui-logo_component', dom_region: 'footer', home_linked: true } },
    { ...common, url: 'https://example.test/article.png', width: 700, height: 650, evidence: { ...common.evidence, alt: 'How to grow your business' } },
    { ...common, url: 'https://example.test/app-demo.jpg', width: 1200, height: 600, evidence: { ...common.evidence, alt: 'Dashboard screenshot' } },
    { ...common, url: 'https://example.test/product.jpg', width: 400, height: 500, evidence: { semantic_text: 'featured-products Product Image', dom_region: 'header' } },
    { ...common, url: 'https://example.test/hero-landscaping.webp', width: 1200, height: 500, evidence: { semantic_text: 'hero-section', dom_region: 'body', home_linked: false, positive_token: false } },
    { ...common, url: 'https://example.test/feature.svg', width: 45, height: 45, scalable: true, evidence: { alt: 'Built for the way you work', dom_region: 'body', home_linked: false, positive_token: false } },
    { ...common, source: 'inline-svg', url: 'data:image/svg+xml;base64,PHN2Zy8+', width: 14, height: 14, scalable: true, evidence: { semantic_text: 'tabler-icon tabler-icon-copyright', dom_region: 'body', home_linked: true } },
    { ...common, url: 'https://example.test/ventionWorksWithLogos/Marca.svg', width: 160, height: 40, scalable: true, evidence: { alt: 'Enterprises logo 9', dom_region: 'body' } },
    { ...common, source: 'schema', url: 'https://example.test/images/og-default.png', width: 1200, height: 630, evidence: { dom_region: 'head' } },
    { ...common, url: 'https://example.test/logo-789bet.png', width: 500, height: 200, evidence: { alt: '789BET', dom_region: 'header', home_linked: true, positive_token: true } },
  ];
  for (const item of cases) assert.deepEqual(rankCandidates([item], { companyName: 'Acme' }).candidates[0].predicted_roles, []);

  const actualBodyLogo = { ...common, url: 'https://example.test/acme-logo.png', width: 512, height: 512, evidence: common.evidence };
  assert.equal(genericAssetReason(actualBodyLogo, 'Acme'), null);
});

test('rejects observed application defaults and repurposed-site assets by exact signature', () => {
  const candidate = hash => ({ source: 'manifest', url: 'https://example.test/logo512.png', width: 512, height: 512, observed: { byte_hash: hash }, evidence: {} });
  assert.match(genericAssetReason(candidate('9ea4f4da7050c0cc408926f6a39c253624e9babb1d43c7977cd821445a60b461'), 'Edificex'), /Create React App/);
  assert.match(genericAssetReason(candidate('3646840f40e10d4b14e9d62f41087a09ffe0384628d093f47337580305b18353'), 'Bhr'), /RealReports/);
  assert.equal(genericAssetReason(candidate('3646840f40e10d4b14e9d62f41087a09ffe0384628d093f47337580305b18353'), 'RealReports'), null);
  assert.match(genericAssetReason(candidate('edf01f937bdf9c38ebcd30d84cb5acde5e2101e9c64c1c9b3a4a1351ea7886a0'), 'Bhr'), /RealReports/);
  assert.equal(genericAssetReason(candidate('edf01f937bdf9c38ebcd30d84cb5acde5e2101e9c64c1c9b3a4a1351ea7886a0'), 'RealReports'), null);
  const godaddy = { ...candidate('custom'), url: 'https://img1.wsimg.com/isteam/ip/static/pwa-app/logo-default.png/:/rs=w:512,h:512,m' };
  assert.match(genericAssetReason(godaddy, 'Trustiu'), /GoDaddy default/);
});

test('rejects a non-home-linked foreign named logo but keeps the company logo', () => {
  const common = { source: 'dom-img', url: 'https://example.test/partner-logo.svg', width: 400, height: 100, scalable: true, evidence: { alt: 'MGH Logo', positive_token: true, dom_region: 'header', home_linked: false } };
  assert.match(genericAssetReason(common, 'Watershed Informatics'), /foreign named logo|customer or partner logo/);
  assert.equal(genericAssetReason({ ...common, url: 'https://example.test/watershed-logo.svg', evidence: { ...common.evidence, alt: 'Watershed Logo' } }, 'Watershed Informatics'), null);
});

test('ignores credentialed and literal private-network asset URLs', () => {
  const html = '<img src="http://127.0.0.1/logo.png"><img src="https://user:pass@example.com/logo.png"><img src="https://cdn.example.com/logo.png">';
  const result = internals.parseHomepage(html, 'https://acme.test/');
  assert.deepEqual(result.candidates.map(item => item.url), ['https://cdn.example.com/logo.png']);
});

test('retains an oversized response prefix and reports truncation and bytes', async () => {
  const diagnostics = { bytesDownloaded: 0 };
  const response = new Response(Buffer.from('head-logo-tail'), { headers: { 'content-length': '14' } });
  const result = await internals.readLimited(response, 9, { truncate: true, diagnostics });
  assert.equal(result.bytes.toString(), 'head-logo');
  assert.equal(result.truncated, true);
  assert.equal(diagnostics.bytesDownloaded, 9);
});

test('keeps a same-origin placed header mark even when its alt names another word', () => {
  const item = { source: 'dom-img', url: 'https://acme.test/images/logo-dark.png', width: 256, height: 100, evidence: { alt: 'Sponsor Logo', positive_token: true, dom_region: 'header', home_linked: false }, source_page: 'https://acme.test/' };
  assert.equal(genericAssetReason(item, 'Acme'), null);
});

test('demotes a padded wordmark canvas for the icon role in favor of a declared square asset', () => {
  const result = rankCandidates([
    { source: 'schema', url: 'https://acme.test/og.png', resolvedUrl: 'https://acme.test/og.png', source_page: 'https://acme.test/', width: 605, height: 605, contentBox: { width: 600, height: 80 }, highResolution: true, evidence: {} },
    { source: 'apple', url: 'https://acme.test/apple-touch-icon.png', resolvedUrl: 'https://acme.test/apple-touch-icon.png', source_page: 'https://acme.test/', width: 180, height: 180, highResolution: true, evidence: {} },
  ], { companyName: 'Acme' });
  assert.equal(result.selectedByRole.icon.source, 'apple');
  assert.equal(result.candidates.find(item => item.source === 'schema').padded_wordmark, true);
});

test('admits a relaxed wide shape when first-party placement or authoritative metadata backs it', () => {
  const placed = { source: 'dom-img', url: 'https://acme.test/uploads/logo-mh-2.png', resolvedUrl: 'https://acme.test/uploads/logo-mh-2.png', source_page: 'https://acme.test/', width: 494, height: 300, highResolution: true, evidence: { dom_region: 'header', home_linked: true } };
  const ranked = rankCandidates([placed], { companyName: 'Acme' }).candidates[0];
  assert.ok(ranked.predicted_roles.includes('wide'));
  assert.ok(ranked.role_scores.wide >= 35);
  const unplaced = { ...placed, evidence: { dom_region: 'body', home_linked: false } };
  const rejected = rankCandidates([unplaced], { companyName: 'Acme' }).candidates[0];
  assert.ok(!rejected.predicted_roles.includes('wide'));
});

test('falls back to declared small favicons when no candidate qualifies as an icon', () => {
  const result = rankCandidates([
    { source: 'html-icon', url: 'https://tiny.test/favicon.ico', resolvedUrl: 'https://tiny.test/favicon.ico', source_page: 'https://tiny.test/', width: 16, height: 16, evidence: {} },
    { source: 'root-favicon', url: 'https://tiny.test/favicon.ico', resolvedUrl: 'https://tiny.test/favicon.ico', source_page: 'https://tiny.test/', width: 12, height: 12, evidence: {} },
  ], { companyName: 'Tiny' });
  assert.equal(result.selectedByRole.icon?.source, 'html-icon');
});

test('prefers a rendered browser twin over a serialized static inline SVG of the same geometry', () => {
  const result = rankCandidates([
    { source: 'inline-svg', url: 'data:image/svg+xml;base64,AAAA', width: 64, height: 64, scalable: true, bytes: 900, highResolution: true, evidence: { dom_region: 'header', home_linked: true } },
    { source: 'browser-inline-svg', url: 'https://acme.test/', width: 64, height: 64, scalable: true, bytes: 900, highResolution: true, evidence: { dom_region: 'header', home_linked: true } },
  ], { companyName: 'Acme' });
  assert.equal(result.selectedByRole.icon.source, 'browser-inline-svg');
});
