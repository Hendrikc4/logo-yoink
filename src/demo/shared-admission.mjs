import { checkRateLimit } from '@vercel/firewall';
import { DemoHttpError, demoClientKey } from './security.mjs';

export const DEMO_FIREWALL_RULES = {
  client: 'logo-yoink-client',
  aggregate: 'logo-yoink-aggregate',
};

// All Vercel instances consult the same hosting-provider counters. Local
// single-instance installs keep the dependency-free in-process guard.
export function createSharedDemoAdmission({ environment = process.env, check = checkRateLimit, timeoutMs = 2_000 } = {}) {
  return async request => {
    if (!environment.VERCEL) return;
    const host = environment.VERCEL_PROJECT_PRODUCTION_URL;
    // Never forward request-controlled Host, cookies or credentials to the SDK.
    if (environment.NODE_ENV !== 'production' || !host || !/^[a-z0-9.-]+$/i.test(host)) {
      throw new DemoHttpError(503, 'The demo request limiter is unavailable.', { retryAfter: 60 });
    }
    let timer;
    try {
      const results = await Promise.race([
        Promise.all([
          check(DEMO_FIREWALL_RULES.client, { headers: { host }, rateLimitKey: `client:${demoClientKey(request, environment)}` }),
          check(DEMO_FIREWALL_RULES.aggregate, { headers: { host }, rateLimitKey: 'all-extractions' }),
        ]),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Limiter timeout')), timeoutMs); }),
      ]);
      if (results.some(result => result?.rateLimited === true)) {
        throw new DemoHttpError(429, 'Too many demo requests. Please wait and try again.', { retryAfter: 60 });
      }
      // The SDK otherwise fails open for a missing rule (404).
      if (results.some(result => result?.error || result?.rateLimited !== false)) throw new Error('Limiter unavailable');
    } catch (error) {
      if (error instanceof DemoHttpError) throw error;
      throw new DemoHttpError(503, 'The demo request limiter is unavailable.', { retryAfter: 60 });
    } finally {
      clearTimeout(timer);
    }
  };
}
