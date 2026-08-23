import './load-env.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLogos } from './extractor.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = join(projectRoot, 'public');
const port = Number(process.env.PORT ?? 4310);
const host = process.env.HOST ?? '127.0.0.1';
const besticonUrl = process.env.BESTICON_URL || null;
const jinaApiKey = process.env.JINA_API_KEY || null;
const browserDiscovery = process.env.BROWSER_DISCOVERY !== '0';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function serveFile(pathname, response) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  const path = join(publicRoot, safePath);
  if (!path.startsWith(publicRoot)) return json(response, 404, { error: 'Not found.' });
  try {
    const bytes = await readFile(path);
    response.writeHead(200, { 'content-type': mimeTypes[extname(path)] ?? 'application/octet-stream', 'content-length': bytes.length });
    response.end(bytes);
  } catch {
    json(response, 404, { error: 'Not found.' });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? `${host}:${port}`}`);
  if (request.method === 'POST' && url.pathname === '/api/extract') {
    try {
      const body = await readJson(request);
      const result = await extractLogos(body.website, {
        besticonUrl,
        jinaApiKey,
        roleAwareBudget: true,
        contentBoundingWide: true,
        browser: browserDiscovery,
      });
      return json(response, 200, result);
    } catch (error) {
      return json(response, 400, { error: error instanceof Error ? error.message : 'Logo extraction failed.' });
    }
  }
  if (request.method === 'GET') return serveFile(url.pathname, response);
  return json(response, 405, { error: 'Method not allowed.' });
});

server.listen(port, host, () => {
  console.log(`Logo Yoink is running at http://${host}:${port}`);
  console.log(besticonUrl ? `Besticon fallback: ${besticonUrl}` : 'Besticon fallback: disabled');
  console.log(jinaApiKey ? 'Jina reachability fallback: enabled' : 'Jina reachability fallback: disabled');
  console.log(`Rendered fallback: ${browserDiscovery ? 'enabled for missing roles' : 'disabled'}`);
});
