import { extractLogos } from '../src/extractor.mjs';

const MAX_BODY_BYTES = 32 * 1024;

async function readBody(request) {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return request.body;
  }

  if (typeof request.body === 'string' || Buffer.isBuffer(request.body)) {
    const body = Buffer.from(request.body);
    if (body.length > MAX_BODY_BYTES) throw new Error('Request body is too large.');
    return JSON.parse(body.toString('utf8'));
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export default async function handler(request, response) {
  response.setHeader('cache-control', 'no-store');

  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const body = await readBody(request);
    const result = await extractLogos(body.website, {
      besticonUrl: process.env.BESTICON_URL || null,
      jinaApiKey: process.env.JINA_API_KEY || null,
      roleAwareBudget: true,
      contentBoundingWide: true,
      browser: false,
    });
    return response.status(200).json(result);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : 'Logo extraction failed.',
    });
  }
}
