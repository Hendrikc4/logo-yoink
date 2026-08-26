import { lookup as dnsLookup } from 'node:dns/promises';
import { canonicalHostname, isIpAddress, isPrivateIp } from './network-safety.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function assertPublicUrl(value, { lookup = dnsLookup } = {}) {
  const url = new URL(value);
  const expectedPort = url.protocol === 'http:' ? '80' : url.protocol === 'https:' ? '443' : null;
  if (!expectedPort || url.username || url.password || (url.port && url.port !== expectedPort)) {
    throw new Error('Unsafe or unsupported URL.');
  }

  const hostname = canonicalHostname(url.hostname);
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || isPrivateIp(hostname)) {
    throw new Error('Local and private-network addresses are not supported.');
  }
  if (!isIpAddress(hostname)) {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) {
      throw new Error('Hostname resolves to a non-public address.');
    }
  }
  return url;
}

export async function fetchTimed(url, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  accept = '*/*',
  diagnostics,
  allowPrivate = false,
  headers = {},
  fetchImpl = fetch,
  validateUrl = assertPublicUrl,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = String(url);
    if (current.startsWith('data:')) return await fetchImpl(current, { signal: controller.signal });
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (!allowPrivate) await validateUrl(current);
      if (diagnostics) diagnostics.requests += 1;
      const response = await fetchImpl(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept,
          'user-agent': 'Mozilla/5.0 (compatible; LogoYoink; +https://github.com/Hendrikc4/logo-yoink)',
          ...headers,
        },
      });
      if (!REDIRECT_STATUSES.has(response.status)) return response;
      const location = response.headers.get('location');
      if (!location) return response;
      current = new URL(location, current).href;
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
  if (declared > maxBytes && !truncate) throw new Error(`Response exceeds ${maxBytes} bytes.`);
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
  if (diagnostics) diagnostics.bytesDownloaded += bytes.length;
  return { bytes, truncated: truncated || declared > maxBytes };
}
