import { extractLogos, normalizeWebsite } from '../extractor.mjs';
import { createSharedDemoAdmission } from './shared-admission.mjs';
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
  allowBackgroundRemoval = false,
  sharedAdmission = createSharedDemoAdmission({ environment }),
} = {}) {
  return {
    async handle(request) {
      try {
        const rate = guard.check(request);
        const body = await readDemoJson(request, limits.bodyBytes);
        if (body.removeBackground === true && !allowBackgroundRemoval) {
          throw new DemoHttpError(400, 'Model background removal is available only in local installs.');
        }
        await sharedAdmission(request);
        const target = normalize(body.website);
        const options = { ...extractionOptions(), preferences: body.preferences };
        const requestedScrapers = body.scrapers ?? (options.browser ? ['browser'] : []);
        if (requestedScrapers.includes('browser') && !options.browser) {
          throw new DemoHttpError(400, 'The browser scraper is disabled on this server.');
        }
        const configuredJinaKey = environment.PUBLIC_DEMO_ALLOW_JINA === '1' ? environment.JINA_API_KEY || null : null;
        if (requestedScrapers.includes('jina') && !configuredJinaKey) {
          throw new DemoHttpError(400, 'The Jina scraper is not configured on this server.');
        }
        options.browser = requestedScrapers.includes('browser');
        options.jinaApiKey = requestedScrapers.includes('jina') ? configuredJinaKey : null;
        if (body.wikimediaFallback !== undefined) options.wikimediaFallback = body.wikimediaFallback;
        if (body.linkedinFallback !== undefined) options.linkedinFallback = body.linkedinFallback;
        if (body.linkedinCompanyUrl !== undefined) options.linkedinCompanyUrl = body.linkedinCompanyUrl;
        if (body.removeBackground !== undefined) options.removeBackground = body.removeBackground;
        if (body.upscale !== undefined) options.upscale = body.upscale;
        const requestKey = `${target.url.href}\n${JSON.stringify(body.preferences)}\n${JSON.stringify(requestedScrapers)}\n${options.wikimediaFallback !== false}\n${JSON.stringify({ linkedinFallback: options.linkedinFallback, linkedinCompanyUrl: options.linkedinCompanyUrl, removeBackground: options.removeBackground, upscale: options.upscale })}`;
        const result = await guard.run(requestKey, () => extract(target.url.href, options));
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
