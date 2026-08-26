import './load-env.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoExtractionService } from './demo/extraction-service.mjs';
import { demoLimits, publicDemoExtractionOptions, securityHeaders } from './demo/security.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = join(projectRoot, 'public');
const port = Number(process.env.PORT ?? 4310);
const host = process.env.HOST ?? '127.0.0.1';
const besticonUrl = process.env.BESTICON_URL || null;
const jinaApiKey = process.env.JINA_API_KEY || null;
const browserDiscovery = process.env.BROWSER_DISCOVERY !== '0';
const limits = demoLimits();
const demoService = createDemoExtractionService({
  limits,
  extractionOptions: () => {
    const options = publicDemoExtractionOptions(process.env);
    return { ...options, besticonUrl, browser: browserDiscovery && options.browser };
  },
});

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { ...securityHeaders, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  response.end(body);
}

async function serveFile(pathname, response) {
  const requested = pathname === '/' ? 'index.html' : ['/docs', '/docs/'].includes(pathname) ? 'docs.html' : pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  const path = join(publicRoot, safePath);
  if (!path.startsWith(publicRoot)) return json(response, 404, { error: 'Not found.' });
  try {
    const bytes = await readFile(path);
    response.writeHead(200, { ...securityHeaders, 'content-type': mimeTypes[extname(path)] ?? 'application/octet-stream', 'content-length': bytes.length, 'cache-control': path.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
    response.end(bytes);
  } catch {
    json(response, 404, { error: 'Not found.' });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? `${host}:${port}`}`);
  if (request.method === 'POST' && url.pathname === '/api/extract') {
    const result = await demoService.handle(request);
    for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
    return json(response, result.status, result.payload);
  }
  if (request.method === 'GET') return serveFile(url.pathname, response);
  return json(response, 405, { error: 'Method not allowed.' });
});

server.listen(port, host, () => {
  console.log(`Logo Yoink is running at http://${host}:${port}`);
  console.log(besticonUrl ? `Besticon fallback: ${besticonUrl}` : 'Besticon fallback: disabled');
  console.log(jinaApiKey && process.env.PUBLIC_DEMO_ALLOW_JINA !== '0' ? 'Public demo Jina fallback: enabled' : 'Public demo Jina fallback: disabled');
  console.log(`Public demo rendered fallback: ${browserDiscovery && process.env.PUBLIC_DEMO_BROWSER !== '0' ? 'enabled for missing roles' : 'disabled'}`);
  console.log(`Public demo Wikimedia fallback: ${process.env.PUBLIC_DEMO_WIKIMEDIA !== '0' ? 'enabled for missing roles' : 'disabled'}`);
});

server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;
server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
