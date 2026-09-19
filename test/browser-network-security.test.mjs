import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect as netConnect } from 'node:net';
import test from 'node:test';
import { discoverBrowserLogos } from '../src/discover-browser.mjs';

test('Chromium renders through pinned proxy and blocks private redirects and popup navigation', { timeout: 30_000 }, async t => {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    t.skip('Playwright unavailable');
    return;
  }

  const paths = [];
  const fixture = createServer((request, response) => {
    paths.push(request.url);
    if (request.url === '/redirect') {
      response.writeHead(302, { location: 'http://private.test/secret' });
      response.end();
      return;
    }
    if (request.url === '/logo.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="40"><rect width="180" height="40" fill="navy"/></svg>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<header><img alt="Acme logo" src="/logo.svg" width="180" height="40"></header><iframe src="http://private.test/secret"></iframe><script>open("http://private.test/secret", "_blank");open("http://127.0.0.1:${fixture.address().port}/secret", "_blank")</script>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => fixture.close(resolve)));
  const fixturePort = fixture.address().port;

  const lookup = async hostname => [{
    address: hostname === 'private.test' ? '127.0.0.1' : '93.184.216.34',
    family: 4,
  }];
  const proxyConnect = options => netConnect({ ...options, host: '127.0.0.1', port: fixturePort });

  const rendered = await discoverBrowserLogos({ url: 'http://public.test/', company: 'Acme' }, {
    playwright: { chromium },
    lookup,
    proxyConnect,
    hydrationMs: 200,
    timeoutMs: 8_000,
  });
  assert.equal(rendered.diagnostics.status, 'ok', rendered.diagnostics.errors.join('; '));
  assert.ok(rendered.candidates.some(candidate => candidate.url === 'http://public.test/logo.svg'));
  assert.ok(rendered.diagnostics.blockedRequests >= 3, 'private iframe and both hostname/literal-IP popups should be rejected by the proxy');

  const redirected = await discoverBrowserLogos('http://public.test/redirect', {
    playwright: { chromium },
    lookup,
    proxyConnect,
    hydrationMs: 50,
    timeoutMs: 8_000,
  });
  assert.ok(['ok', 'error'].includes(redirected.diagnostics.status));
  assert.ok(redirected.diagnostics.blockedRequests >= 1, 'private redirect should be rejected by the proxy');
  assert.equal(paths.includes('/secret'), false, 'private destination must never reach the listener');
});
