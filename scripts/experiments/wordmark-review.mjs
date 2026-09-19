// Capture actual API outputs, including originals, for repeatable visual review.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mapConcurrent } from '../../src/concurrency.mjs';
const [output, modulePath = 'src/index.mjs', ...requested] = process.argv.slice(2);
if (!output) throw new Error('Usage: node scripts/experiments/wordmark-review.mjs OUTPUT [API_MODULE] [DOMAIN ...]');
const { yoink } = await import(pathToFileURL(resolve(modulePath)));
const domains = requested.length ? requested : ['linear.app', 'neon.tech', 'posthog.com', 'nubank.com.br', 'itau.com.br', 'inter.co', 'netflix.com', 'amazon.com', 'revolut.com'];
const summaries = await mapConcurrent(domains, 3, async domain => {
  const dir = resolve(output, domain);
  await mkdir(dir, { recursive: true });
  try {
    const result = await yoink(domain);
    await writeFile(resolve(dir, 'result.json'), JSON.stringify(result, null, 2));
    for (const [role, asset] of Object.entries(result.assets)) {
      if (asset?.dataUrl) await writeFile(resolve(dir, `${role}.${asset.format}`), Buffer.from(asset.dataUrl.split(',')[1], 'base64'));
    }
    const summary = { domain, homepage: result.homepage, assets: Object.fromEntries(Object.entries(result.assets).map(([role, a]) => [role, a ? { source: a.source, url: a.resolvedUrl.startsWith('data:') ? '[inline SVG]' : a.resolvedUrl, width: a.width, height: a.height, format: a.format } : null])), candidates: result.candidates.length, durationMs: result.diagnostics.durationMs };
    await writeFile(resolve(dir, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
    return summary;
  } catch (error) {
    const summary = { domain, error: error.message, diagnostics: error.diagnostics };
    await writeFile(resolve(dir, 'error.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
    return summary;
  }
});
await writeFile(resolve(output, 'summary.json'), JSON.stringify({ capturedAt: new Date().toISOString(), modulePath, summaries }, null, 2));
