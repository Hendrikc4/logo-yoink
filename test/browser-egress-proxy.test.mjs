import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect as netConnect, createServer as createTcpServer } from 'node:net';
import test from 'node:test';
import { createBrowserEgressProxy } from '../src/browser-egress-proxy.mjs';

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function proxyRequest(proxyUrl, targetUrl, headers = '') {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: proxy.hostname, port: proxy.port });
    let response = Buffer.alloc(0);
    socket.once('connect', () => socket.write(`GET ${targetUrl} HTTP/1.1\r\nHost: attacker.invalid\r\n${headers}Connection: close\r\n\r\n`));
    socket.on('data', chunk => { response = Buffer.concat([response, chunk]); });
    socket.once('end', () => resolve(response));
    socket.once('error', reject);
  });
}

test('pins an accepted public hostname while preserving its Host header', async t => {
  let receivedHost;
  let receivedHeaders;
  const upstream = createServer((request, response) => {
    receivedHost = request.headers.host;
    receivedHeaders = request.headers;
    response.end('proxied');
  });
  const upstreamPort = await listen(upstream);
  t.after(() => new Promise(resolve => upstream.close(resolve)));

  const egress = await createBrowserEgressProxy({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    connect: options => netConnect({ ...options, host: '127.0.0.1', port: upstreamPort }),
  });
  t.after(() => egress.close());

  const response = await proxyRequest(egress.server, 'http://public.example/logo.svg', 'Proxy-Authorization: secret\r\nConnection: X-Hop\r\nX-Hop: secret\r\n');
  assert.match(response.toString(), /^HTTP\/1\.1 200 OK/);
  assert.match(response.toString(), /proxied$/);
  assert.equal(receivedHost, 'public.example');
  assert.equal(receivedHeaders['proxy-authorization'], undefined);
  assert.equal(receivedHeaders['x-hop'], undefined);
  assert.ok(egress.stats.bytes > 0);
});

test('closing during DNS resolution prevents a late outbound connection', async () => {
  let releaseLookup;
  let markStarted;
  let connectCalls = 0;
  const started = new Promise(resolve => { markStarted = resolve; });
  const egress = await createBrowserEgressProxy({
    lookup: async () => {
      markStarted();
      return await new Promise(resolve => { releaseLookup = resolve; });
    },
    connect: options => { connectCalls += 1; return netConnect(options); },
  });
  const pending = proxyRequest(egress.server, 'http://public.example/').catch(() => Buffer.alloc(0));
  await started;
  const closing = egress.close();
  releaseLookup([{ address: '93.184.216.34', family: 4 }]);
  await Promise.all([pending, closing]);
  assert.equal(connectCalls, 0);
});

test('blocks private DNS answers before opening an upstream connection', async t => {
  let connectCalls = 0;
  const egress = await createBrowserEgressProxy({
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    connect: options => { connectCalls += 1; return netConnect(options); },
  });
  t.after(() => egress.close());

  const response = await proxyRequest(egress.server, 'http://private.example/');
  assert.match(response.toString(), /^HTTP\/1\.1 403 Forbidden/);
  assert.equal(connectCalls, 0);
  assert.equal(egress.stats.blocked, 1);
});

test('CONNECT tunnels TLS bytes to the pinned address and rejects non-HTTPS ports', async t => {
  const upstream = createTcpServer(socket => socket.pipe(socket));
  const upstreamPort = await listen(upstream);
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const egress = await createBrowserEgressProxy({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    connect: options => netConnect({ ...options, host: '127.0.0.1', port: upstreamPort }),
  });
  t.after(() => egress.close());
  const proxy = new URL(egress.server);

  const tunneled = await new Promise((resolve, reject) => {
    const socket = netConnect({ host: proxy.hostname, port: proxy.port });
    let response = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write('CONNECT public.example:443 HTTP/1.1\r\nHost: public.example:443\r\n\r\n'));
    socket.on('data', chunk => {
      response += chunk;
      if (response.endsWith('\r\n\r\n')) socket.write('tls-bytes');
      if (response.endsWith('tls-bytes')) {
        socket.destroy();
        resolve(response);
      }
    });
    socket.once('error', reject);
  });
  assert.match(tunneled, /^HTTP\/1\.1 200 Connection Established/);
  assert.match(tunneled, /tls-bytes$/);

  const rejected = await new Promise((resolve, reject) => {
    const socket = netConnect({ host: proxy.hostname, port: proxy.port });
    let response = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write('CONNECT public.example:8443 HTTP/1.1\r\nHost: public.example:8443\r\n\r\n'));
    socket.on('data', chunk => { response += chunk; });
    socket.once('end', () => resolve(response));
    socket.once('error', reject);
  });
  assert.match(rejected, /^HTTP\/1\.1 403 Forbidden/);
});

test('hard-stops all sockets when aggregate inbound bytes exceed the cap', async t => {
  const upstream = createServer((_request, response) => response.end('x'.repeat(4_096)));
  const upstreamPort = await listen(upstream);
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const egress = await createBrowserEgressProxy({
    maxTransferBytes: 128,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    connect: options => netConnect({ ...options, host: '127.0.0.1', port: upstreamPort }),
  });
  t.after(() => egress.close());

  await proxyRequest(egress.server, 'http://public.example/').catch(() => {});
  assert.equal(egress.stats.limitHit, true);
  assert.ok(egress.stats.bytes > 128);
});

test('a truncated upstream response does not crash the proxy or prevent its next request', async t => {
  const upstream = createServer((request, response) => {
    if (request.url === '/truncated') {
      response.writeHead(200, { 'content-length': '100' });
      response.write('partial');
      setTimeout(() => response.destroy(), 10);
    } else response.end('healthy');
  });
  const upstreamPort = await listen(upstream);
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const egress = await createBrowserEgressProxy({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    connect: options => netConnect({ ...options, host: '127.0.0.1', port: upstreamPort }),
  });
  t.after(() => egress.close());
  await proxyRequest(egress.server, 'http://public.example/truncated').catch(() => {});
  assert.match((await proxyRequest(egress.server, 'http://public.example/healthy')).toString(), /healthy$/);
});
