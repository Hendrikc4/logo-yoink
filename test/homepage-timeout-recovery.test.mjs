import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLogos } from '../src/extractor.mjs';

const assetUrl = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Acme_wordmark.svg';
const candidate = { url: assetUrl, source: 'wikimedia-commons', source_page: 'https://commons.wikimedia.org/wiki/File:Acme_wordmark.svg',
  evidence: { wikidata_identity_verified: true, positive_token: true, commons_canonical_filename: 'Acme wordmark.svg', eligible_roles: ['wide'] } };
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><path fill="#123456" d="M5 5h230v50H5z"/></svg>';
const timeout = () => new DOMException('Homepage request expired', 'AbortError');
const options = extra => ({ jinaApiKey: '', validateUrl: async value => new URL(value),
  fetchImpl: async () => { throw timeout(); },
  wikimediaValidateUrl: async value => new URL(value),
  wikimediaFetch: async url => { assert.equal(url, assetUrl); const response = new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }); Object.defineProperty(response, 'url', { value: assetUrl }); return response; },
  wikimediaResolver: async () => ({ candidates: [candidate], diagnostics: { status: 'ok' } }),
  ...extra });

test('pure homepage timeouts reach verified Commons without root or cached favicon requests', async () => {
  const originalFetch = globalThis.fetch;
  let unexpectedRequests = 0;
  globalThis.fetch = async () => { unexpectedRequests++; throw new Error('Unexpected unverified fallback request'); };
  try {
    let attempts = 0, resolverCalls = 0;
    const result = await extractLogos('https://acme.test/', options({
      fetchImpl: async () => { attempts++; throw timeout(); },
      wikimediaResolver: async () => { resolverCalls++; return { candidates: [candidate], diagnostics: { status: 'ok' } }; },
    }));
    assert.equal(attempts, 2);
    assert.equal(resolverCalls, 1);
    assert.equal(unexpectedRequests, 0);
    assert.equal(result.assets.logo.source, 'wikimedia-commons');
    assert.equal(result.assets.icon, null);
    assert.equal(result.diagnostics.homepageUnavailable, true);
    assert.equal(result.diagnostics.discovered, 0);
    assert.equal(result.diagnostics.cachedFavicon, null);
    assert.ok(result.diagnostics.reachability.every(item => item.failureKind === 'timeout'));
  } finally { globalThis.fetch = originalFetch; }
});

test('empty timeout recovery preserves timeout diagnostics and honors disabled Wikimedia', async () => {
  await assert.rejects(extractLogos('https://acme.test/', options({
    wikimediaResolver: async () => ({ candidates: [], diagnostics: { status: 'no_verified_current_logo' } }),
  })), error => error.diagnostics.failureClass === 'timeout' && error.diagnostics.failureStage === 'public_recovery' &&
    error.diagnostics.wikimedia.status === 'no_verified_current_logo');
  await assert.rejects(extractLogos('https://acme.test/', options({
    wikimediaFallback: false, wikimediaResolver: async () => assert.fail('Disabled resolver called'),
  })), error => error.diagnostics.failureClass === 'timeout' && error.diagnostics.failureStage === 'homepage_acquisition');
});

test('DNS, TLS, redirect failures and mixed timeout sequences do not enable timeout recovery', async () => {
  for (const message of ['getaddrinfo ENOTFOUND acme.test', 'TLS certificate error', 'Too many redirects.']) {
    let attempt = 0;
    await assert.rejects(extractLogos('https://acme.test/', options({
      fetchImpl: async () => { if (attempt++ === 0) throw new Error(message); throw timeout(); },
      wikimediaResolver: async () => assert.fail('Mixed failure resolver called'),
    })), error => error.diagnostics.failureStage === 'homepage_acquisition');
  }
});

test('HTML body timeout cannot masquerade as a successful homepage acquisition', async () => {
  const result = await extractLogos('https://acme.test/', options({
    fetchImpl: async () => {
      const response = new Response(new ReadableStream({ start(controller) { controller.error(timeout()); } }));
      Object.defineProperty(response, 'url', { value: 'https://acme.test/' });
      return response;
    },
  }));
  assert.equal(result.diagnostics.homepageUnavailable, true);
  assert.equal(result.assets.logo.source, 'wikimedia-commons');
});

test('a reached parked homepage remains rejected before public recovery', async () => {
  await assert.rejects(extractLogos('https://acme.test/', options({
    fetchImpl: async () => {
      const response = new Response('<h1>This domain name is for sale</h1>');
      Object.defineProperty(response, 'url', { value: 'https://acme.test/' });
      return response;
    },
    wikimediaResolver: async () => assert.fail('Parked site resolver called'),
  })), error => error.diagnostics.failureClass === 'parked_for_sale');
});

test('mocked Jina timeouts preserve recovery while mixed Jina TLS failures remain closed', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const failure of ['timeout', 'tls']) {
      let jinaRequests = 0, resolverCalls = 0;
      globalThis.fetch = async url => {
        assert.ok(url.startsWith('https://r.jina.ai/'));
        jinaRequests++;
        throw failure === 'timeout' ? timeout() : new Error('TLS certificate failure');
      };
      // The existing injected URL validator avoids DNS; both HTTP paths are
      // mocked and the key is synthetic. Jina receives no actual requests.
      const run = extractLogos('https://acme.test/', options({
        jinaApiKey: 'synthetic-test-key',
        jinaFetchImpl: globalThis.fetch,
        wikimediaResolver: async () => { resolverCalls++; return { candidates: [candidate], diagnostics: { status: 'ok' } }; },
      }));
      if (failure === 'timeout') {
        const result = await run;
        assert.equal(result.assets.logo.source, 'wikimedia-commons');
        assert.equal(result.diagnostics.reachability.at(-1).failureKind, 'timeout');
        assert.equal(resolverCalls, 1);
      } else {
        await assert.rejects(run, error => error.diagnostics.failureStage === 'homepage_acquisition' &&
          error.diagnostics.reachability.at(-1).failureKind === 'tls');
        assert.equal(resolverCalls, 0);
      }
      assert.equal(jinaRequests, 1);
    }
  } finally { globalThis.fetch = originalFetch; }
});
