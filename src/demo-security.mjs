import { createHash } from 'node:crypto';

const DEFAULTS = {
  bodyBytes: 2 * 1024,
  clientBurst: 2,
  clientWindowMs: 30 * 60 * 1000,
  globalBurst: 10,
  globalWindowMs: 60 * 1000,
  maxConcurrent: 1,
};

export class DemoHttpError extends Error {
  constructor(status, message, { retryAfter = null } = {}) {
    super(message);
    this.name = 'DemoHttpError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function demoLimits(environment = process.env) {
  return {
    bodyBytes: boundedInteger(environment.DEMO_BODY_BYTES, DEFAULTS.bodyBytes, 512, 32 * 1024),
    clientBurst: boundedInteger(environment.DEMO_RATE_LIMIT, DEFAULTS.clientBurst, 1, 100),
    clientWindowMs: boundedInteger(environment.DEMO_RATE_WINDOW_MS, DEFAULTS.clientWindowMs, 1_000, 60 * 60 * 1000),
    globalBurst: boundedInteger(environment.DEMO_GLOBAL_RATE_LIMIT, DEFAULTS.globalBurst, 1, 1_000),
    globalWindowMs: boundedInteger(environment.DEMO_GLOBAL_RATE_WINDOW_MS, DEFAULTS.globalWindowMs, 1_000, 60 * 60 * 1000),
    maxConcurrent: boundedInteger(environment.DEMO_MAX_CONCURRENT, DEFAULTS.maxConcurrent, 1, 16),
  };
}

function header(request, name) {
  const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function expectedOrigin(request) {
  const host = header(request, 'host');
  if (!host || /[\s\\/]/.test(host)) return null;
  const forwarded = String(header(request, 'x-forwarded-proto') ?? '').split(',')[0].trim();
  const protocol = forwarded === 'https' || forwarded === 'http'
    ? forwarded
    : request.socket?.encrypted ? 'https' : 'http';
  return `${protocol}://${host}`;
}

export function assertDemoRequestOrigin(request) {
  if (String(header(request, 'sec-fetch-site') ?? '').toLowerCase() === 'cross-site') {
    throw new DemoHttpError(403, 'Cross-site demo requests are not allowed.');
  }
  const origin = header(request, 'origin');
  const expected = expectedOrigin(request);
  if (!origin || !expected) return;
  let normalized;
  try { normalized = new URL(origin).origin; } catch { throw new DemoHttpError(403, 'Invalid request origin.'); }
  if (normalized !== expected) throw new DemoHttpError(403, 'Cross-site demo requests are not allowed.');
}

function validatePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DemoHttpError(400, 'Expected a JSON object.');
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'website') throw new DemoHttpError(400, 'Only the website field is accepted.');
  if (typeof value.website !== 'string') throw new DemoHttpError(400, 'Website must be a string.');
  const website = value.website.trim();
  if (!website || website.length > 2_048 || /[\u0000-\u001f\u007f]/.test(website)) throw new DemoHttpError(400, 'Enter a valid website URL.');
  return { website };
}

export async function readDemoJson(request, maxBytes = DEFAULTS.bodyBytes) {
  const contentType = String(header(request, 'content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new DemoHttpError(415, 'Content-Type must be application/json.');
  const declared = Number(header(request, 'content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new DemoHttpError(413, 'Request body is too large.');

  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) return validatePayload(request.body);
  const chunks = [];
  let size = 0;
  if (typeof request.body === 'string' || Buffer.isBuffer(request.body)) {
    const bytes = Buffer.from(request.body);
    if (bytes.length > maxBytes) throw new DemoHttpError(413, 'Request body is too large.');
    chunks.push(bytes);
  } else {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBytes) throw new DemoHttpError(413, 'Request body is too large.');
      chunks.push(chunk);
    }
  }
  try { return validatePayload(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch (error) {
    if (error instanceof DemoHttpError) throw error;
    throw new DemoHttpError(400, 'Request body must be valid JSON.');
  }
}

export function demoClientKey(request, environment = process.env) {
  let address = request.socket?.remoteAddress ?? 'unknown';
  if (environment.VERCEL) {
    address = String(header(request, 'x-vercel-forwarded-for') ?? header(request, 'x-real-ip') ?? address).split(',')[0].trim();
  }
  return createHash('sha256').update(address || 'unknown').digest('hex').slice(0, 24);
}

function createWindowCounter(limit, windowMs, now) {
  const entries = new Map();
  return key => {
    const time = now();
    let entry = entries.get(key);
    if (!entry || time >= entry.resetAt) entry = { count: 0, resetAt: time + windowMs };
    entry.count += 1;
    entries.set(key, entry);
    if (entries.size > 10_000) {
      for (const [storedKey, stored] of entries) if (time >= stored.resetAt) entries.delete(storedKey);
    }
    return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), resetAt: entry.resetAt };
  };
}

export function createDemoGuard(options = {}) {
  const limits = { ...DEFAULTS, ...options };
  const now = options.now ?? Date.now;
  const clientCounter = createWindowCounter(limits.clientBurst, limits.clientWindowMs, now);
  const globalCounter = createWindowCounter(limits.globalBurst, limits.globalWindowMs, now);
  const inFlight = new Map();
  let active = 0;

  return {
    check(request) {
      assertDemoRequestOrigin(request);
      const global = globalCounter('global');
      const client = clientCounter(demoClientKey(request, options.environment));
      if (!global.allowed || !client.allowed) {
        const resetAt = Math.max(global.allowed ? 0 : global.resetAt, client.allowed ? 0 : client.resetAt);
        throw new DemoHttpError(429, 'Too many demo requests. Please wait and try again.', {
          retryAfter: Math.max(1, Math.ceil((resetAt - now()) / 1_000)),
        });
      }
      return { limit: limits.clientBurst, remaining: client.remaining, resetAt: client.resetAt };
    },
    run(key, work) {
      const existing = inFlight.get(key);
      if (existing) return existing;
      if (active >= limits.maxConcurrent) throw new DemoHttpError(503, 'The demo is busy. Please try again shortly.', { retryAfter: 5 });
      active += 1;
      const promise = Promise.resolve().then(work).finally(() => {
        active -= 1;
        inFlight.delete(key);
      });
      inFlight.set(key, promise);
      return promise;
    },
  };
}

export const securityHeaders = {
  'content-security-policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'sha256-I4+VFXPI8ZXV5Lggcb0i3DJtx2c3zxFQU01+8r0NQAA='; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

export function publicDemoExtractionOptions(environment = process.env) {
  return {
    besticonUrl: environment.BESTICON_URL || null,
    jinaApiKey: environment.PUBLIC_DEMO_ALLOW_JINA === '0' ? null : environment.JINA_API_KEY || null,
    roleAwareBudget: true,
    contentBoundingWide: true,
    browser: environment.PUBLIC_DEMO_BROWSER !== '0',
    cachedFavicon: true,
    maxCandidates: boundedInteger(environment.DEMO_MAX_CANDIDATES, 8, 3, 16),
    maxImageBytes: boundedInteger(environment.DEMO_MAX_IMAGE_BYTES, 768 * 1024, 128 * 1024, 3 * 1024 * 1024),
    timeoutMs: boundedInteger(environment.DEMO_FETCH_TIMEOUT_MS, 8_000, 2_000, 10_000),
  };
}
