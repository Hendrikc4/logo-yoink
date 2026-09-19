import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { extractLogosWithLibrary } from '../src/approved-library.mjs';
import { createDemoExtractionService } from '../src/demo/extraction-service.mjs';

function liveAsset(role, overrides = {}) {
  return {
    url: `https://live.test/${role}.svg`,
    resolvedUrl: `https://live.test/${role}.svg`,
    resolved_url: `https://live.test/${role}.svg`,
    dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
    format: 'svg', mimeType: 'image/svg+xml', width: role === 'icon' ? 32 : 200, height: 32,
    source: 'dom-img', variant: { theme: 'dark', color: 'color', background: 'transparent' },
    predicted_roles: [role === 'logo' ? 'wide' : 'icon'],
    observed: { byte_hash: `live-${role}` },
    ...overrides,
  };
}

function liveResult(website, { icon = null, logo = null, iconMatch = 'unmatched', logoMatch = 'unmatched' } = {}) {
  const candidates = [icon, logo].filter(Boolean);
  return {
    input: website, domain: new URL(website.includes('://') ? website : `https://${website}`).hostname, homepage: website,
    icon, logo, assets: { icon, logo },
    preferences: {}, preferenceMatch: { icon: iconMatch, logo: logoMatch },
    assetVariants: { icon: icon ? [icon] : [], logo: logo ? [logo] : [] },
    selected: icon ?? logo,
    selectedByRole: { icon, wide: logo, favicon: icon },
    candidates, assetFamilies: [], diagnostics: { requests: 3, bytesDownloaded: 50 },
  };
}

test('approved library serves exact domains and verified aliases without live extraction', async () => {
  let liveCalls = 0;
  const liveExtract = async () => { liveCalls++; throw new Error('live extraction should not run'); };
  const exact = await extractLogosWithLibrary('https://www.microsoft.com/en-au', {}, { liveExtract });
  const alias = await extractLogosWithLibrary('https://microsoftonline.com/', { roles: ['icon'] }, { liveExtract });

  assert.equal(liveCalls, 0);
  assert.equal(exact.diagnostics.library.brandId, 'microsoft');
  assert.equal(exact.diagnostics.library.matchedBy, 'domain');
  assert.equal(alias.diagnostics.library.matchedBy, 'alias');
  assert.equal(exact.assets.icon.source, 'approved-library');
  assert.equal(exact.assets.logo.source, 'approved-library');
  assert.match(exact.assets.logo.dataUrl, /^data:image\/png;base64,/);
  assert.equal(exact.assets.logo.observed.byte_hash, exact.assets.logo.content_hash);
  assert.equal(exact.preferenceMatch.logo, 'exact');
  assert.equal(exact.diagnostics.requests, 0);
});

test('library matching never widens to arbitrary subdomains and supports an explicit live opt-out', async () => {
  const calls = [];
  const liveExtract = async (website, options) => {
    calls.push({ website, options });
    return liveResult(website, { icon: liveAsset('icon'), iconMatch: 'exact' });
  };

  const subdomain = await extractLogosWithLibrary('https://shop.microsoft.com/', {}, { liveExtract });
  const bypass = await extractLogosWithLibrary('https://microsoft.com/', { library: false }, { liveExtract });

  assert.equal(calls.length, 2);
  assert.equal(subdomain.assets.icon.source, 'dom-img');
  assert.equal(subdomain.diagnostics.library, undefined);
  assert.equal(bypass.assets.icon.source, 'dom-img');
});

test('conflicting explicit aliases fail closed to live discovery', async () => {
  const icon = liveAsset('icon');
  let liveCalls = 0;
  const result = await extractLogosWithLibrary('shared.test', {}, {
    manifestPath: join(tmpdir(), 'unused-library-manifest.json'),
    libraryRoot: tmpdir(),
    manifest: {
      libraryId: 'collision-test',
      brands: [
        { id: 'one', domain: 'one.test', aliases: ['shared.test'], assets: {} },
        { id: 'two', domain: 'two.test', aliases: ['shared.test'], assets: {} },
      ],
    },
    liveExtract: async website => {
      liveCalls++;
      return liveResult(website, { icon, iconMatch: 'exact' });
    },
  });
  assert.equal(liveCalls, 1);
  assert.equal(result.assets.icon, icon);
});

test('requested roles avoid unnecessary discovery and specific approved theme variants are selected', async () => {
  let liveCalls = 0;
  const result = await extractLogosWithLibrary('linear.app', {
    roles: ['logo'],
    preferences: { logo: { theme: 'dark' } },
  }, { liveExtract: async () => { liveCalls++; throw new Error('unexpected live call'); } });

  assert.equal(liveCalls, 0);
  assert.equal(result.assets.icon, null);
  assert.equal(result.assets.logo.theme, 'dark');
  assert.equal(result.assets.logo.representation, 'wordmark_or_lockup');
  assert.equal(result.preferenceMatch.logo, 'exact');
  assert.equal(result.assetVariants.logo.length, 2);
});

test('unknown library themes do not satisfy a requested surface and an exact live role fills the gap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logo-yoink-library-'));
  const manifestPath = join(root, 'manifest.json');
  const assetDirectory = join(root, 'assets', 'white', 'logo');
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><path fill="white" d="M0 0h200v40H0z"/></svg>');
  const hash = createHash('sha256').update(bytes).digest('hex');
  await mkdir(assetDirectory, { recursive: true });
  await writeFile(join(assetDirectory, `${hash}.svg`), bytes);
  const manifest = {
    libraryId: 'test-library',
    brands: [{
      id: 'white', name: 'White', domain: 'white.test', aliases: [], officialHomepage: 'https://white.test/',
      assets: { logo: { role: 'logo', theme: 'any', path: `assets/white/logo/${hash}.svg`, format: 'svg', width: 200, height: 40, contentHash: hash, verificationStatus: 'approved_test' } },
      variants: {},
    }],
  };
  let liveCalls = 0;
  const liveLogo = liveAsset('logo');
  const result = await extractLogosWithLibrary('white.test', {
    roles: ['logo'],
    preferences: { logo: { theme: 'light' } },
  }, {
    manifest,
    manifestPath,
    libraryRoot: root,
    liveExtract: async website => {
      liveCalls++;
      return liveResult(website, { logo: liveLogo, logoMatch: 'exact' });
    },
  });

  assert.equal(liveCalls, 1);
  assert.equal(result.assets.logo, liveLogo);
  assert.equal(result.preferenceMatch.logo, 'exact');
  assert.deepEqual(result.diagnostics.library.liveFallback.requestedRoles, ['logo']);
});

test('representation preferences use approved metadata and do not label every logo horizontal', async () => {
  let liveCalls = 0;
  const approved = await extractLogosWithLibrary('cisco.com', {
    roles: ['logo'], preferences: { logo: { representation: 'wordmark' } },
  }, { liveExtract: async () => { liveCalls++; throw new Error('unexpected live call'); } });

  assert.equal(liveCalls, 0);
  assert.equal(approved.assets.logo.representation, 'wordmark');
  assert.deepEqual(approved.assets.logo.predicted_roles, ['logo']);
  assert.equal(approved.selectedByRole.wide, approved.assets.logo);

  const liveLogo = liveAsset('logo', { representation: 'stacked_lockup' });
  const stacked = await extractLogosWithLibrary('cisco.com', {
    roles: ['logo'], preferences: { logo: { representation: 'stacked_lockup' } },
  }, { liveExtract: async website => liveResult(website, { logo: liveLogo, logoMatch: 'exact' }) });
  assert.equal(stacked.assets.logo.representation, 'stacked_lockup');
  assert.equal(stacked.selectedByRole.logo, stacked.assets.logo);
  assert.equal(stacked.selectedByRole.wide, null);

  const strict = await extractLogosWithLibrary('cisco.com', {
    roles: ['logo'], preferences: { logo: { representation: 'stacked_lockup', strict: true } },
  }, { liveExtract: async website => liveResult(website, { logo: liveAsset('logo'), logoMatch: 'fallback' }) });
  assert.equal(strict.assets.logo, null);
  assert.equal(strict.preferenceMatch.logo, 'unmatched');
});

test('a missing optional library falls through to ordinary live extraction', async () => {
  let liveCalls = 0;
  const icon = liveAsset('icon');
  const result = await extractLogosWithLibrary('missing-library.test', {}, {
    manifestPath: join(tmpdir(), `logo-yoink-no-library-${process.pid}`, 'manifest.json'),
    liveExtract: async website => {
      liveCalls++;
      return liveResult(website, { icon, iconMatch: 'exact' });
    },
  });
  assert.equal(liveCalls, 1);
  assert.equal(result.assets.icon, icon);
});

test('demo/API service returns the normal extraction schema for library hits', async () => {
  const service = createDemoExtractionService({
    environment: {},
    extractionOptions: () => ({ browser: false }),
    extract: (website, options) => extractLogosWithLibrary(website, options, {
      liveExtract: async () => { throw new Error('unexpected live call'); },
    }),
  });
  const request = Readable.from([Buffer.from(JSON.stringify({ website: 'microsoft.com', roles: ['icon'] }))]);
  request.headers = { 'content-type': 'application/json' };
  request.socket = { remoteAddress: '203.0.113.10', encrypted: false };

  const response = await service.handle(request);
  assert.equal(response.status, 200);
  assert.equal(response.payload.assets.icon.source, 'approved-library');
  assert.equal(response.payload.assets.logo, null);
  assert.equal(response.payload.selectedByRole.icon, response.payload.assets.icon);
  assert.equal(response.payload.diagnostics.library.brandId, 'microsoft');
});
