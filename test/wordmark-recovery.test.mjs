import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { parseHomepage } from '../src/discover-static.mjs';
import { discoverOfficialBrandAssets } from '../src/discover-deep.mjs';
import { extractLogos, internals } from '../src/extractor.mjs';
import { rankCandidates, genericAssetReason } from '../src/rank.mjs';
import { cropCssSprite } from '../src/css-sprite.mjs';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 50"><path fill="#236" d="M10 10h220v30H10z"/></svg>';
const asset = (extra = {}) => ({ url: 'https://acme.test/mark.svg', source_page: 'https://acme.test/', source: 'inline-svg', width: 240, height: 50, scalable: true, bytes: 200, evidence: { home_linked: true }, ...extra });

test('explicit foreign identity overrides a home link even without a supplied company name', () => {
  assert.match(genericAssetReason(asset({ evidence: { home_linked: true, alt: 'Partner Labs logo' } })), /foreign organization/);
  assert.equal(genericAssetReason(asset({ evidence: { home_linked: true, alt: 'Acme logo' } })), null);
  assert.equal(genericAssetReason(asset({ source_page: 'https://brand.acme.co.uk/', evidence: { home_linked: true, alt: 'Acme logo' } })), null);
});

test('home navigation glyphs are excluded while a branded home link is preserved', () => {
  const result = parseHomepage(`<a href="/"><span>${svg}</span>Home</a><header><a href="/" aria-label="Acme logo">${svg}</a></header>`, 'https://acme.test/');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].evidence.positive_token, true);
});

test('component branding reaches discovery and the wide queue without inheriting the whole header', () => {
  const result = parseHomepage('<header><span data-uia="header+logo"><img data-hawkins-id="BrandAcmeLogotype" src="/opaque.svg" width="240" height="50"></span><img src="/chevron.svg" width="20" height="20"></header>', 'https://acme.test/');
  assert.equal(result.candidates[0].evidence.positive_token, true);
  assert.equal(internals.provisionalQueue(result.candidates[0]), 'wide');
  assert.equal(result.candidates[1].evidence.positive_token, false);
});

test('same-document SVG symbols and nested definitions become standalone; missing and external references abstain', async () => {
  const html = '<svg style="display:none"><defs><path id="shape" d="M0 0h240v50H0z"/><symbol id="mark" viewBox="0 0 240 50"><use href="#shape"/></symbol></defs></svg><a href="/" aria-label="Acme logo"><svg viewBox="0 0 240 50"><use href="#mark"/></svg></a>';
  const found = parseHomepage(html, 'https://acme.test/').candidates;
  assert.equal(found.length, 1);
  assert.ok(await internals.validateCandidate(found[0], 1000, {}));
  const external = html.replace('href="#mark"', 'href="https://other.test/sprite.svg#mark"');
  assert.equal(parseHomepage(external, 'https://acme.test/').candidates.length, 0);
  assert.equal(parseHomepage(html.replace('id="shape"', 'id="missing"'), 'https://acme.test/').candidates.length, 0);
});

test('compact glyphs and stacked logos do not claim wordmarks; explicit short wordmarks remain eligible', () => {
  const compact = asset({ width: 264, height: 146 });
  assert.equal(rankCandidates([compact]).assets.logo, null);
  assert.equal(rankCandidates([compact]).candidates[0].wordmark_caution, 'ambiguous-compact-mark');
  assert.ok(rankCandidates([{ ...compact, evidence: { home_linked: true, local_semantic: 'Acme wordmark' } }]).assets.logo);
  const stacked = asset({ url: 'https://acme.test/logo-stacked.svg', source: 'schema', width: 480, height: 430 });
  const favicon = asset({ source: 'html-icon', url: 'https://acme.test/favicon.svg', width: 300, height: 300, evidence: {} });
  assert.equal(rankCandidates([stacked, favicon]).assets.icon.url, favicon.url);
  assert.equal(rankCandidates([stacked]).assets.logo, null);
});

test('measured contrast chooses source variants for each theme without changing image bytes', () => {
  const dark = asset({ width: 32, height: 32, url: 'https://acme.test/a.svg', dataUrl: 'original-a', background: 'transparent', tinySuitability: { surface_contrast: { light: 0.9, dark: 0 } } });
  const light = asset({ ...dark, url: 'https://acme.test/b.svg', dataUrl: 'original-b', tinySuitability: { surface_contrast: { light: 0.09, dark: 0.8 } } });
  assert.equal(rankCandidates([light, dark], { preferences: { icon: { theme: 'light' } } }).assets.icon.dataUrl, 'original-a');
  assert.equal(rankCandidates([dark, light], { preferences: { icon: { theme: 'dark' } } }).assets.icon.dataUrl, 'original-b');
});

test('brand-page discovery retains displayed official logos and caps failed probes', async () => {
  const requests = [];
  const result = await discoverOfficialBrandAssets({ homepage: 'https://acme.test/', companyName: 'Acme', parsed: { highIntentLinks: [] }, fetchResource: async url => {
    requests.push(url);
    return { ok: true, status: 200, url, headers: new Headers({ 'content-type': 'text/html' }), bytes: Buffer.from('<header><a href="/"><img alt="Acme logo" src="/wordmark.svg"></a></header><section class="partners"><img alt="Partner logo" src="/partner.svg"></section>') };
  } });
  assert.equal(requests.length, 2);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every(c => c.url.endsWith('/wordmark.svg') && c.evidence.eligible_roles.join() === 'wide'));
  let failed = 0;
  await discoverOfficialBrandAssets({ homepage: 'https://acme.test/', companyName: 'Acme', parsed: { highIntentLinks: [] }, fetchResource: async () => { failed++; throw new Error('blocked'); } });
  assert.equal(failed, 2);
});

test('CSS sprite crop preserves native pixels and the original file with explicit derivation metadata', async () => {
  const bytes = await sharp({ create: { width: 200, height: 100, channels: 4, background: '#123456' } }).png().toBuffer();
  const css = { width: 80, height: 20, positionX: '-10px', positionY: '-30px', size: 'auto' };
  const original = await internals.validateCandidateBytes({ url: 'https://acme.test/sprite.png', source: 'browser-css-background', source_page: 'https://acme.test/', evidence: { home_linked: true, positive_token: true, css_background: css } }, bytes);
  const derived = await internals.deriveCssSprite(original);
  assert.deepEqual(derived.transformations[0], { type: 'css-sprite-crop', left: 10, top: 30, width: 80, height: 20, resampled: false, css });
  assert.equal(derived.original.dataUrl, original.dataUrl);
  assert.equal(derived.derived, true);
  assert.deepEqual(await sharp(Buffer.from(derived.dataUrl.split(',')[1], 'base64')).raw().toBuffer(), await sharp(bytes).extract({ left: 10, top: 30, width: 80, height: 20 }).raw().toBuffer());
  assert.equal(await cropCssSprite(bytes, original, { ...css, positionX: '-190px' }), null);
  assert.equal(await cropCssSprite(bytes, original, { ...css, size: 'cover' }), null);
  assert.equal(await cropCssSprite(bytes, original, { ...css, positionX: '-10.5px' }), null);
  assert.equal(await internals.deriveCssSprite({ ...original, evidence: { ...original.evidence, home_linked: false } }), null);
});

test('blocked static HTML reaches browser recovery and preserves failed reachability evidence', async () => {
  const page = { on() {}, async route() {}, setDefaultTimeout() {}, setDefaultNavigationTimeout() {},
    async emulateMedia() {}, async goto() { return { status: () => 200 }; }, async waitForLoadState() {},
    url: () => 'https://acme.test/', async close() {},
    async evaluate() { return [{ source: 'browser-inline-svg', kind: 'inline-svg', inlineSvg: svg, evidence: { theme: 'light', domRegion: 'header', homeLinked: true, ariaLabel: 'Acme logo', renderedBox: { width: 240, height: 50 } } }]; },
  };
  const options = { fetchImpl: async () => new Response('', { status: 403 }), validateUrl: async value => new URL(value), browser: true, browserInstance: { async newPage() { return page; } }, cachedFavicon: false, wikimediaFallback: false, maxCandidates: 0 };
  const result = await extractLogos('https://acme.test/', options);
  assert.ok(result.assets.logo);
  assert.equal(result.diagnostics.homepageUnavailable, true);
  assert.equal(result.diagnostics.reachability.length, 3);
  assert.ok(result.diagnostics.reachability.every(attempt => attempt.status === 403));
  await assert.rejects(extractLogos('https://acme.test/', { ...options, browser: false }), /Could not reach/);
});

test('brand-resource controls and home-linked navigation illustrations are not brand icons', () => {
  assert.match(genericAssetReason(asset({ evidence: { local_semantic: 'Open Brand Guidelines in New Tab', positive_token: true } })), /utility control/);
  assert.match(genericAssetReason(asset({ evidence: { home_linked: true, semantic_text: 'ProductNavigationList_navigationItemIcon__123', alt: 'A bank card icon' } })), /navigation item icon/);
  assert.equal(genericAssetReason(asset({ evidence: { positive_token: true, semantic_text: 'navigationItemIcon', local_semantic: 'Acme logo' } })), null);
});

test('unresolved SVG paint variables preserve the candidate but cannot claim a usable logo', () => {
  const parsed = parseHomepage('<a href="/" aria-label="Acme logo"><svg viewBox="0 0 40 40"><path fill="white" d="M0 0h40v40H0z"/><path fill="var(--ink)" d="M10 10h20v20H10z"/></svg></a>', 'https://acme.test/');
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].evidence.requires_rendering, true);
  assert.match(genericAssetReason(parsed.candidates[0]), /unresolved/);
  assert.deepEqual(parsed.candidates[0].evidence.eligible_roles, []);
});

test('an explicitly labelled first-party footer wordmark needs no supplied companyName', () => {
  const candidate = asset({ source: 'browser-inline-svg', evidence: { rendered: true, dom_region: 'footer', local_semantic: 'wordmark', positive_token: true, aria_label: 'Acme – Home' } });
  assert.ok(rankCandidates([candidate]).assets.logo);
  assert.equal(rankCandidates([{ ...candidate, evidence: { ...candidate.evidence, aria_label: 'Partner – Home' } }]).assets.logo, null);
});

test('near-empty animated frames cannot win a theme preference or appear as wordmark variants', () => {
  const empty = asset({ tinySuitability: { foreground_occupancy: 0, canvas_background: 'transparent' }, evidence: { home_linked: true, themes: ['light'] } });
  const visible = asset({ url: 'https://acme.test/visible.svg', tinySuitability: { foreground_occupancy: 0.3 }, evidence: { home_linked: true, themes: ['dark'] } });
  const r = rankCandidates([empty, visible], { preferences: { logo: { theme: 'light' } } });
  assert.equal(r.assets.logo.url, visible.url);
  assert.ok(r.assetVariants.logo.every(c => c.url !== empty.url));
  const inconclusive = { ...empty, tinySuitability: { foreground_occupancy: 0, canvas_background: 'opaque' } };
  assert.ok(rankCandidates([inconclusive]).assets.logo);
});
