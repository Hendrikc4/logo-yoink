import { extractLogos, normalizeWebsite } from '../src/extractor.mjs';
import { createDemoGuard, demoLimits, DemoHttpError, publicDemoExtractionOptions, readDemoJson, securityHeaders } from '../src/demo-security.mjs';
import { serverlessBrowserLaunchOptions } from '../src/serverless-browser.mjs';

const limits = demoLimits();
const demoGuard = createDemoGuard(limits);

export default async function handler(request, response) {
  for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
  response.setHeader('cache-control', 'no-store');

  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const rate = demoGuard.check(request);
    const body = await readDemoJson(request, limits.bodyBytes);
    const target = normalizeWebsite(body.website);
    const result = await demoGuard.run(target.url.href, () => extractLogos(target.url.href, {
      ...publicDemoExtractionOptions(),
      browserLaunchOptions: serverlessBrowserLaunchOptions,
    }));
    response.setHeader('ratelimit-limit', String(rate.limit));
    response.setHeader('ratelimit-remaining', String(rate.remaining));
    return response.status(200).json(result);
  } catch (error) {
    const status = error instanceof DemoHttpError ? error.status : 400;
    if (error instanceof DemoHttpError && error.retryAfter) response.setHeader('retry-after', String(error.retryAfter));
    const message = error instanceof DemoHttpError ? error.message : 'We could not inspect that website.';
    return response.status(status).json({ error: message });
  }
}
