import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const host = '127.0.0.1';
const port = await availablePort(host);
const origin = `http://${host}:${port}`;
const child = spawn(process.execPath, ['src/server.mjs'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    HOST: host,
    PORT: String(port),
    BROWSER_DISCOVERY: '0',
    PUBLIC_DEMO_BROWSER: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });

try {
  await waitUntilReady(child, () => output.includes(`Logo Yoink is running at ${origin}`));

  const page = await fetch(`${origin}/`);
  const html = await page.text();
  if (!page.ok || !html.includes('<title>Logo Yoink')) {
    throw new Error(`Homepage check failed with HTTP ${page.status}.`);
  }

  const docsPage = await fetch(`${origin}/docs`);
  const docsHtml = await docsPage.text();
  if (!docsPage.ok || !docsHtml.includes('<title>Documentation — Logo Yoink</title>')) {
    throw new Error(`Documentation check failed with HTTP ${docsPage.status}.`);
  }

  const api = await fetch(`${origin}/api/extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ website: '' }),
  });
  const payload = await api.json();
  if (api.status !== 400 || typeof payload.error !== 'string') {
    throw new Error(`API validation check failed with HTTP ${api.status}.`);
  }

  console.log(`Local smoke test passed at ${origin} (homepage + docs + API validation).`);
} catch (error) {
  if (output.trim()) console.error(output.trim());
  throw error;
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
}

async function availablePort(address) {
  const server = createServer();
  server.unref();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, address, resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitUntilReady(childProcess, ready) {
  const timeoutMs = 10_000;
  const startedAt = Date.now();
  while (!ready()) {
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      throw new Error(`Local server exited with ${childProcess.signalCode ?? `code ${childProcess.exitCode}`}.`);
    }
    if (Date.now() - startedAt >= timeoutMs) throw new Error(`Local server did not start within ${timeoutMs} ms.`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
