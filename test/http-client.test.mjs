import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { assertPublicUrl, fetchTimed, readLimited, resolvePublicUrl, validatingGet } from '../src/http-client.mjs';
import { isPrivateIp } from '../src/network-safety.mjs';

test('assertPublicUrl accepts public hosts and rejects private DNS results', async () => {
  const publicUrl = await assertPublicUrl('https://example.test/path', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  });
  assert.equal(publicUrl.href, 'https://example.test/path');

  await assert.rejects(() => assertPublicUrl('https://example.test', {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  }), /non-public address/);
  await assert.rejects(() => assertPublicUrl('https://localhost'), /private-network/);
});

test('mapped IPv4 loopback is private in dotted, hexadecimal, and expanded forms', () => {
  for (const address of [
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:127.0.0.1',
    '0000:0000:0000:0000:0000:ffff:7f00:0001',
  ]) assert.equal(isPrivateIp(address), true, address);
});

test('resolvePublicUrl returns only the DNS answers it validated', async () => {
  let calls = 0;
  const result = await resolvePublicUrl('https://example.test/path', {
    lookup: async () => {
      calls += 1;
      return [{ address: '93.184.216.34', family: 4 }];
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.addresses, [{ address: '93.184.216.34', family: 4 }]);
});

test('validatingGet pins the validated DNS answer into the actual request', async () => {
  let pinned;
  const response = await validatingGet('https://example.test/logo.svg', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    requestImpl(_url, options, callback) {
      options.lookup('example.test', {}, (error, address, family) => { pinned = { error, address, family }; });
      const request = new EventEmitter();
      request.end = () => {
        const incoming = new PassThrough();
        incoming.statusCode = 200;
        incoming.statusMessage = 'OK';
        incoming.rawHeaders = ['Content-Type', 'text/plain'];
        callback(incoming);
        incoming.end('ok');
      };
      return request;
    },
  });
  assert.deepEqual(pinned, { error: null, address: '93.184.216.34', family: 4 });
  assert.equal(await response.text(), 'ok');
});

test('private DNS is rejected before a local listener can be reached', async t => {
  let requests = 0;
  const server = createServer((_request, response) => { requests += 1; response.end('unexpected'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  await assert.rejects(validatingGet('http://example.test', {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  }), /non-public address/);
  assert.equal(requests, 0);
});

test('native transport revalidates a public-to-private redirect before connecting', async () => {
  let requests = 0;
  const requestImpl = (_url, _options, callback) => {
    requests += 1;
    const request = new EventEmitter();
    request.end = () => {
      const incoming = new PassThrough();
      incoming.statusCode = 302;
      incoming.statusMessage = 'Found';
      incoming.rawHeaders = ['Location', 'http://private.test/secret'];
      callback(incoming);
      incoming.end();
    };
    return request;
  };

  await assert.rejects(fetchTimed('https://public.test', {
    lookup: async hostname => hostname === 'public.test'
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }],
    requestImpl,
  }), /non-public address/);
  assert.equal(requests, 1);
});

test('fetchTimed revalidates redirects and preserves request diagnostics', async () => {
  const visited = [];
  const diagnostics = { requests: 0 };
  const response = await fetchTimed('https://first.test', {
    diagnostics,
    validateUrl: async value => { visited.push(value); },
    fetchImpl: async value => value === 'https://first.test'
      ? new Response(null, { status: 302, headers: { location: 'https://second.test/logo.svg' } })
      : new Response('ok', { status: 200 }),
  });

  assert.equal(await response.text(), 'ok');
  assert.deepEqual(visited, ['https://first.test', 'https://second.test/logo.svg']);
  assert.equal(diagnostics.requests, 2);
});

test('fetchTimed enforces a caller-supplied redirect ceiling', async () => {
  const diagnostics = { requests: 0 };
  await assert.rejects(fetchTimed('https://first.test', {
    maxRedirects: 1,
    diagnostics,
    validateUrl: async () => {},
    fetchImpl: async value => new Response(null, {
      status: 302,
      headers: { location: value === 'https://first.test' ? 'https://second.test/' : 'https://third.test/' },
    }),
  }), /Too many redirects/);
  assert.equal(diagnostics.requests, 2);
});

test('readLimited accounts for bytes consumed before an oversized response aborts', async () => {
  const diagnostics = { bytesDownloaded: 0 };
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(7));
      controller.enqueue(new Uint8Array(7));
      controller.close();
    },
  }));
  await assert.rejects(readLimited(response, 10, { diagnostics }), /exceeds/);
  assert.equal(diagnostics.bytesDownloaded, 14);
});

test('expanded IPv6 special-use addresses cannot bypass public-only resolution', async () => {
  for (const address of ['0:0:0:0:0:0:0:1', '0:0:0:0:0:0:0:0', 'ff02::1', '64:ff9b::7f00:1']) {
    await assert.rejects(resolvePublicUrl('https://example.test', { lookup: async () => [{ address, family: 6 }] }), /non-public/);
  }
});

test('stalled DNS respects the fetch deadline without ever opening a connection', async () => {
  await assert.rejects(fetchTimed('https://example.test', {
    timeoutMs: 10, lookup: () => new Promise(() => {}), requestImpl: () => assert.fail('must not connect'),
  }), error => error.name === 'AbortError');
});

test('cross-origin redirects strip credentials', async () => {
  const seen = [];
  await fetchTimed('https://first.test/', {
    headers: { Authorization: 'harmless-test-marker', Cookie: 'session=test' },
    validateUrl: async () => {},
    fetchImpl: async (url, options) => {
      seen.push(new Headers(options.headers));
      return url.includes('first.test') ? new Response(null, { status: 302, headers: { location: 'https://second.test/' } }) : new Response('ok');
    },
  });
  assert.equal(seen[0].get('authorization'), 'harmless-test-marker');
  assert.equal(seen[1].get('authorization'), null);
  assert.equal(seen[1].get('cookie'), null);
});

test('native requests use the pinned lookup for all-address calls and preserve Host', async t => {
  const http = await import('node:http');
  const { gzipSync } = await import('node:zlib');
  let host;
  const server = createServer((request, response) => {
    host = request.headers.host;
    response.writeHead(200, { 'content-encoding': 'gzip' });
    response.end(gzipSync('safe logo bytes'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  let dnsCalls = 0;
  const result = await fetchTimed('http://public.test/logo', {
    lookup: async () => [{ address: ++dnsCalls === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }],
    requestImpl(url, options, callback) {
      const pinnedLookup = options.lookup;
      return http.request(url, { ...options, port: server.address().port, headers: { ...options.headers, host: url.host },
        lookup(name, opts, done) {
          // Test-only mapping of an approved public IP to the isolated listener.
          pinnedLookup(name, { all: true }, (error, addresses) => {
            assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]);
            if (opts.all) done(error, [{ address: '127.0.0.1', family: 4 }]);
            else done(error, '127.0.0.1', 4);
          });
        },
      }, callback);
    },
  });
  assert.equal((await readLimited(result, 100)).bytes.toString(), 'safe logo bytes');
  assert.equal(host, 'public.test');
  assert.equal(dnsCalls, 1);
});

test('cancelling a decompressed body closes the upstream socket', async t => {
  const http = await import('node:http');
  const { createGzip, constants } = await import('node:zlib');
  let closed;
  const closeObserved = new Promise(resolve => { closed = resolve; });
  const server = createServer((_request, response) => {
    response.on('close', closed);
    response.writeHead(200, { 'content-encoding': 'gzip' });
    const gzip = createGzip();
    gzip.pipe(response);
    gzip.write('x'.repeat(2048));
    gzip.flush(constants.Z_SYNC_FLUSH);
    response.on('close', () => gzip.destroy());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await validatingGet('http://public.test/', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    requestImpl(url, options, callback) {
      return http.request(url, { ...options, port: server.address().port, family: 4,
        lookup(_name, opts, cb) { if (opts.all) cb(null, [{ address: '127.0.0.1', family: 4 }]); else cb(null, '127.0.0.1', 4); },
      }, callback);
    },
  });
  await assert.rejects(readLimited(response, 32), /exceeds/);
  await Promise.race([closeObserved, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('upstream stayed open')), 1_000); timer.unref(); })]);
});
