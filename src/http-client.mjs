import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { canonicalHostname, isIpAddress, isPrivateIp } from './network-safety.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function resolvePublicUrl(value, { lookup = dnsLookup } = {}) {
  const url = new URL(value);
  const expectedPort = url.protocol === 'http:' ? '80' : url.protocol === 'https:' ? '443' : null;
  if (!expectedPort || url.username || url.password || (url.port && url.port !== expectedPort)) {
    throw new Error('Unsafe or unsupported URL.');
  }

  const hostname = canonicalHostname(url.hostname);
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || isPrivateIp(hostname)) {
    throw new Error('Local and private-network addresses are not supported.');
  }
  let addresses;
  if (isIpAddress(hostname)) {
    addresses = [{ address: hostname, family: hostname.includes(':') ? 6 : 4 }];
  } else {
    addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(item => !isIpAddress(item.address) || isPrivateIp(item.address))) {
      throw new Error('Hostname resolves to a non-public address.');
    }
  }
  return { url, addresses: addresses.map(item => ({
    address: canonicalHostname(item.address),
    family: item.family || (String(item.address).includes(':') ? 6 : 4),
  })) };
}

export async function assertPublicUrl(value, options) {
  return (await resolvePublicUrl(value, options)).url;
}

function responseHeaders(rawHeaders) {
  const headers = new Headers();
  for (let index = 0; index < rawHeaders.length; index += 2) headers.append(rawHeaders[index], rawHeaders[index + 1]);
  return headers;
}

function decodedBody(response, headers) {
  const encoding = headers.get('content-encoding')?.toLowerCase().trim();
  let body = response;
  if (encoding === 'gzip' || encoding === 'x-gzip') body = response.pipe(createGunzip());
  else if (encoding === 'deflate') body = response.pipe(createInflate());
  else if (encoding === 'br') body = response.pipe(createBrotliDecompress());
  if (body !== response) {
    headers.delete('content-encoding');
    headers.delete('content-length');
    // Cancellation and upstream failures must cross the decompressor boundary.
    response.on('error', error => body.destroy(error));
    body.on('close', () => response.destroy());
  }
  return Readable.toWeb(body);
}

export async function validatingRequest(value, {
  lookup = dnsLookup,
  signal,
  accept = '*/*',
  headers = {},
  requestImpl,
  method = 'GET',
  body,
} = {}) {
  signal?.throwIfAborted();
  let onAbort;
  const resolved = await Promise.race([
    resolvePublicUrl(value, { lookup }),
    ...(signal ? [new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    })] : []),
  ]).finally(() => { if (onAbort) signal.removeEventListener('abort', onAbort); });
  signal?.throwIfAborted();
  const { url, addresses } = resolved;
  const selected = addresses[0];
  const request = requestImpl ?? (url.protocol === 'https:' ? https.request : http.request);

  return await new Promise((resolve, reject) => {
    const req = request(url, {
      method,
      agent: false,
      signal,
      headers: {
        accept,
        'accept-encoding': 'gzip, deflate, br',
        'user-agent': 'Mozilla/5.0 (compatible; LogoYoink/0.1; +https://github.com/Hendrikc4/logo-yoink)',
        ...headers,
      },
      lookup(_hostname, _options, callback) {
        if (_options?.all) callback(null, [selected]);
        else callback(null, selected.address, selected.family);
      },
      servername: isIpAddress(canonicalHostname(url.hostname)) ? undefined : canonicalHostname(url.hostname),
    }, response => {
      const responseHeadersValue = responseHeaders(response.rawHeaders);
      const status = response.statusCode ?? 500;
      const hasBody = status !== 204 && status !== 205 && status !== 304;
      try {
        if (!hasBody) response.resume();
        const result = new Response(hasBody ? decodedBody(response, responseHeadersValue) : null, {
          status,
          statusText: response.statusMessage,
          headers: responseHeadersValue,
        });
        Object.defineProperty(result, 'url', { value: url.href });
        resolve(result);
      } catch (error) {
        response.destroy();
        reject(error);
      }
    });
    req.once('error', reject);
    req.end(body);
  });
}

export const validatingGet = validatingRequest;

export async function fetchTimed(url, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRedirects = 5,
  accept = '*/*',
  diagnostics,
  allowPrivate = false,
  headers = {},
  fetchImpl,
  validateUrl = assertPublicUrl,
  lookup = dnsLookup,
  requestImpl,
} = {}) {
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 5) throw new Error('Invalid redirect limit.');
  const controller = new AbortController();
  headers = new Headers(headers);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = String(url);
    if (current.startsWith('data:')) return await (fetchImpl ?? fetch)(current, { signal: controller.signal });
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      if (diagnostics) diagnostics.requests += 1;
      let response;
      if (!allowPrivate && !fetchImpl) {
        if (validateUrl !== assertPublicUrl) await validateUrl(current);
        response = await validatingGet(current, { lookup, signal: controller.signal, accept, headers: Object.fromEntries(headers), requestImpl });
      } else {
        if (!allowPrivate) await validateUrl(current);
        response = await (fetchImpl ?? fetch)(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            accept,
            'user-agent': 'Mozilla/5.0 (compatible; LogoYoink/0.1; +https://github.com/Hendrikc4/logo-yoink)',
            ...Object.fromEntries(headers),
          },
        });
      }
      if (!REDIRECT_STATUSES.has(response.status)) return response;
      const location = response.headers.get('location');
      if (!location) return response;
      await response.body?.cancel().catch(() => {});
      const next = new URL(location, current);
      if (next.origin !== new URL(current).origin) {
        headers.delete('authorization');
        headers.delete('cookie');
        headers.delete('proxy-authorization');
      }
      current = next.href;
    }
    throw new Error('Too many redirects.');
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function readLimited(response, maxBytes, {
  truncate = false,
  diagnostics,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes && !truncate) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Response exceeds ${maxBytes} bytes.`);
  }
  if (!response.body) return { bytes: Buffer.alloc(0), truncated: false };

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      await reader.cancel();
      throw new DOMException('Body read timed out.', 'AbortError');
    }
    let timer;
    let read;
    try {
      read = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new DOMException('Body read timed out.', 'AbortError')), remaining);
        }),
      ]);
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
    }
    const { done, value } = read;
    if (done) break;
    if (diagnostics) diagnostics.bytesDownloaded += value.length;
    if (total + value.length > maxBytes) {
      if (!truncate) {
        await reader.cancel();
        throw new Error(`Response exceeds ${maxBytes} bytes.`);
      }
      chunks.push(Buffer.from(value.subarray(0, maxBytes - total)));
      total = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    total += value.length;
    chunks.push(Buffer.from(value));
  }
  const bytes = Buffer.concat(chunks);
  return { bytes, truncated: truncated || declared > maxBytes };
}
