import { extractLogos, normalizeWebsite } from '../extractor.mjs';
import {
  createDemoGuard,
  demoLimits,
  DemoHttpError,
  publicDemoExtractionOptions,
  readDemoJson,
} from './security.mjs';

function errorResponse(error) {
  const isDemoError = error instanceof DemoHttpError;
  const headers = {};
  if (isDemoError && error.retryAfter) headers['retry-after'] = String(error.retryAfter);
  return {
    status: isDemoError ? error.status : 400,
    headers,
    payload: { error: isDemoError ? error.message : 'We could not inspect that website.' },
  };
}

/**
 * Shared request workflow for the local Node server and the serverless adapter.
 * Transport-specific response writing stays in those adapters.
 */
export function createDemoExtractionService({
  environment = process.env,
  limits = demoLimits(environment),
  guard = createDemoGuard({ ...limits, environment }),
  extract = extractLogos,
  normalize = normalizeWebsite,
  extractionOptions = () => publicDemoExtractionOptions(environment),
} = {}) {
  return {
    async handle(request) {
      try {
        const rate = guard.check(request);
        const body = await readDemoJson(request, limits.bodyBytes);
        const target = normalize(body.website);
        const result = await guard.run(target.url.href, () => extract(target.url.href, extractionOptions()));
        return {
          status: 200,
          headers: {
            'ratelimit-limit': String(rate.limit),
            'ratelimit-remaining': String(rate.remaining),
          },
          payload: result,
        };
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
