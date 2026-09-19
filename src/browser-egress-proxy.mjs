import http, { createServer } from 'node:http';
import { connect as netConnect } from 'node:net';
import { resolvePublicUrl } from './http-client.mjs';

const DEFAULT_MAX_TRANSFER_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_CONNECTIONS = 100;
const DEFAULT_TIMEOUT_MS = 15_000;
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function forwardedHeaders(request, host) {
  const connectionHeaders = new Set(String(request.headers.connection ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  const headers = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (!HOP_BY_HOP.has(name) && !connectionHeaders.has(name) && name !== 'host') headers[name] = value;
  }
  headers.host = host;
  return headers;
}

function connectUrl(authority) {
  if (!/^(?:[a-z\d](?:[a-z\d.-]*[a-z\d])?|\[[\da-f:.]+\]):443$/i.test(authority)) throw new Error('Invalid CONNECT authority.');
  return `https://${authority}/`;
}

export async function createBrowserEgressProxy({ lookup, connect = netConnect, maxTransferBytes = DEFAULT_MAX_TRANSFER_BYTES, maxConnections = DEFAULT_MAX_CONNECTIONS, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  maxTransferBytes = positiveInteger(maxTransferBytes, DEFAULT_MAX_TRANSFER_BYTES);
  maxConnections = positiveInteger(maxConnections, DEFAULT_MAX_CONNECTIONS);
  timeoutMs = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
  const stats = { bytes: 0, blocked: 0, limitHit: false };
  const sockets = new Set();
  const countedSockets = new WeakSet();
  let acceptedConnections = 0;
  let targetConnections = 0;
  let closed = false;

  function track(socket) {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    return socket;
  }
  function shutdownForLimit() {
    if (stats.limitHit) return;
    stats.limitHit = true;
    closed = true;
    for (const socket of sockets) socket.destroy();
    proxy.close();
  }
  function countWireBytes(socket) {
    if (countedSockets.has(socket)) return;
    countedSockets.add(socket);
    socket.prependListener('data', chunk => {
      stats.bytes += chunk.length;
      if (stats.bytes > maxTransferBytes) shutdownForLimit();
    });
  }
  async function resolveTarget(value) {
    if (closed) throw new Error('Proxy closed.');
    if (++targetConnections > maxConnections) {
      shutdownForLimit();
      throw new Error('Proxy target connection limit exceeded.');
    }
    const resolved = await resolvePublicUrl(value, { lookup });
    if (closed) throw new Error('Proxy closed.');
    return resolved;
  }
  function reject(response) {
    stats.blocked += 1;
    const body = 'Proxy destination blocked.';
    response.writeHead(403, { connection: 'close', 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    response.end(body);
  }

  const proxy = createServer(async (request, response) => {
    let outbound;
    try {
      const { url, addresses } = await resolveTarget(request.url);
      if (url.protocol !== 'http:') throw new Error('Forward proxy requests must use HTTP.');
      const selected = addresses[0];
      const agent = new http.Agent({ keepAlive: false });
      agent.createConnection = (_options, callback) => {
        if (closed) {
          queueMicrotask(() => callback(new Error('Proxy closed.')));
          return undefined;
        }
        const socket = track(connect({ host: selected.address, port: 80, family: selected.family }));
        callback(null, socket);
        return socket;
      };
      outbound = http.request({
        protocol: 'http:', hostname: url.hostname, port: 80, method: request.method,
        path: `${url.pathname}${url.search}`, headers: forwardedHeaders(request, url.host), agent,
      }, upstream => {
        if (closed || stats.limitHit) return upstream.destroy();
        upstream.once('error', () => response.destroy());
        response.once('close', () => upstream.destroy());
        response.writeHead(upstream.statusCode ?? 502, upstream.statusMessage, upstream.headers);
        upstream.on('data', chunk => {
          if (!stats.limitHit && !response.write(chunk)) upstream.pause();
        });
        response.on('drain', () => upstream.resume());
        upstream.once('end', () => { if (!stats.limitHit) response.end(); });
      });
      outbound.once('socket', countWireBytes);
      outbound.once('error', () => {
        if (!response.headersSent) reject(response);
        else response.destroy();
      });
      request.once('aborted', () => outbound.destroy());
      request.socket.once('close', () => outbound.destroy());
      request.pipe(outbound);
    } catch {
      outbound?.destroy();
      if (!response.headersSent) reject(response);
    }
  });

  proxy.on('connection', socket => {
    track(socket);
    acceptedConnections += 1;
    if (acceptedConnections > maxConnections) {
      stats.blocked += 1;
      shutdownForLimit();
    }
  });
  proxy.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  proxy.on('connect', async (request, clientSocket, head) => {
    let targetSocket;
    try {
      const { addresses } = await resolveTarget(connectUrl(request.url));
      const selected = addresses[0];
      if (closed) throw new Error('Proxy closed.');
      targetSocket = track(connect({ host: selected.address, port: 443, family: selected.family }));
      countWireBytes(targetSocket);
      clientSocket.once('end', () => targetSocket.end());
      clientSocket.once('close', () => targetSocket.destroy());
      clientSocket.once('error', () => targetSocket.destroy());
      targetSocket.once('connect', () => {
        if (closed) return targetSocket.destroy();
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) targetSocket.write(head);
        clientSocket.pipe(targetSocket);
        targetSocket.pipe(clientSocket);
      });
      targetSocket.once('error', () => clientSocket.destroy());
    } catch {
      targetSocket?.destroy();
      stats.blocked += 1;
      clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    }
  });

  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', resolve);
  });
  const address = proxy.address();
  const timer = setTimeout(shutdownForLimit, timeoutMs);
  timer.unref();
  return {
    server: `http://127.0.0.1:${address.port}`,
    stats,
    async close() {
      clearTimeout(timer);
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => proxy.close(resolve));
    },
  };
}
