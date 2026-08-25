import { createDemoExtractionService } from '../src/demo/extraction-service.mjs';
import { publicDemoExtractionOptions, securityHeaders } from '../src/demo/security.mjs';
import { serverlessBrowserLaunchOptions } from '../src/demo/serverless-browser.mjs';

const demoService = createDemoExtractionService({
  extractionOptions: () => ({
    ...publicDemoExtractionOptions(),
    browserLaunchOptions: serverlessBrowserLaunchOptions,
  }),
});

export default async function handler(request, response) {
  for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
  response.setHeader('cache-control', 'no-store');

  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed.' });
  }

  const result = await demoService.handle(request);
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  return response.status(result.status).json(result.payload);
}
