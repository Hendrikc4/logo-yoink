import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

export const IDENTITY_PROMPT_VERSION = 'identity-veto-v1';
export const IDENTITY_MODEL = 'gpt-4o-mini-2024-07-18';

export const IDENTITY_PROMPT = readFileSync(new URL('../prompts/identity-veto-v1.md', import.meta.url), 'utf8').trim();

const REASONS = {
  accept: new Set(['requested_identity_visible', 'coherent_current_identity', 'no_identity_conflict']),
  reject: new Set(['different_brand_visible', 'third_party_or_partner_mark', 'not_a_logo', 'declared_identity_conflict']),
  ambiguous: new Set(['visual_identity_unclear', 'identity_transition_unclear', 'insufficient_context']),
};

export const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    judgment: { type: 'string', enum: ['accept', 'reject', 'ambiguous'] },
    reason: { type: 'string', enum: [...new Set(Object.values(REASONS).flatMap(set => [...set]))] },
  },
  required: ['judgment', 'reason'],
};

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

export function identityCacheKey({ contentHash, company, domain, promptVersion = IDENTITY_PROMPT_VERSION }) {
  return sha256(canonicalJson({
    content_hash: requiredText(contentHash, 'contentHash'),
    company: requiredText(company, 'company'),
    domain: requiredText(domain, 'domain').toLowerCase(),
    prompt_version: requiredText(promptVersion, 'promptVersion'),
  }));
}

export function validateVerdict(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Model verdict must be an object.');
  if (!REASONS[value.judgment]?.has(value.reason)) throw new Error('Model returned an invalid judgment/reason pair.');
  if (Object.keys(value).some(key => !['judgment', 'reason'].includes(key))) throw new Error('Model verdict has unexpected fields.');
  return { judgment: value.judgment, reason: value.reason };
}

export function shouldWithhold(verdict) {
  return validateVerdict(verdict).judgment !== 'accept';
}

function icoInput(bytes) {
  if (bytes.length < 22 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return null;
  const count = bytes.readUInt16LE(4);
  if (!count || bytes.length < 6 + count * 16) throw new Error('Invalid ICO directory.');
  const entries = Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    const width = bytes[offset] || 256;
    const height = bytes[offset + 1] || 256;
    return { width, height, bits: bytes.readUInt16LE(offset + 6), size: bytes.readUInt32LE(offset + 8), offset: bytes.readUInt32LE(offset + 12) };
  }).sort((a, b) => (b.width * b.height * b.bits) - (a.width * a.height * a.bits));
  const entry = entries[0];
  const frame = bytes.subarray(entry.offset, entry.offset + entry.size);
  if (frame.length !== entry.size) throw new Error('Truncated ICO frame.');
  if (frame.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { input: frame, options: {} };

  const headerSize = frame.readUInt32LE(0);
  const width = frame.readInt32LE(4);
  const storedHeight = frame.readInt32LE(8);
  const height = Math.abs(storedHeight) / 2;
  const bits = frame.readUInt16LE(14);
  const compression = frame.readUInt32LE(16);
  if (headerSize < 40 || width < 1 || !Number.isInteger(height) || height < 1 || bits !== 32 || compression !== 0) {
    throw new Error('ICO frame is not an embedded PNG or uncompressed 32-bit DIB.');
  }
  const xorStart = headerSize;
  const xorBytes = width * height * 4;
  if (frame.length < xorStart + xorBytes) throw new Error('Truncated ICO pixel data.');
  const rgba = Buffer.alloc(xorBytes);
  let hasAlpha = false;
  for (let y = 0; y < height; y++) {
    const sourceY = storedHeight > 0 ? height - y - 1 : y;
    for (let x = 0; x < width; x++) {
      const source = xorStart + (sourceY * width + x) * 4;
      const target = (y * width + x) * 4;
      rgba[target] = frame[source + 2];
      rgba[target + 1] = frame[source + 1];
      rgba[target + 2] = frame[source];
      rgba[target + 3] = frame[source + 3];
      hasAlpha ||= rgba[target + 3] !== 0;
    }
  }
  if (!hasAlpha) {
    const maskStart = xorStart + xorBytes;
    const maskStride = Math.ceil(width / 32) * 4;
    for (let y = 0; y < height; y++) {
      const sourceY = storedHeight > 0 ? height - y - 1 : y;
      for (let x = 0; x < width; x++) {
        const mask = frame[maskStart + sourceY * maskStride + Math.floor(x / 8)] ?? 0;
        rgba[(y * width + x) * 4 + 3] = mask & (0x80 >> (x % 8)) ? 0 : 255;
      }
    }
  }
  return { input: rgba, options: { raw: { width, height, channels: 4 } } };
}

export async function renderIdentityPanels(imageBytes) {
  if (!Buffer.isBuffer(imageBytes) || imageBytes.length === 0) throw new Error('Non-empty candidate image bytes are required.');
  const decoded = icoInput(imageBytes) ?? { input: imageBytes, options: { density: 192, limitInputPixels: 40_000_000, animated: false } };
  const preview = await sharp(decoded.input, decoded.options)
    .resize({ width: 456, height: 456, fit: 'contain', withoutEnlargement: true })
    .png()
    .toBuffer();
  const metadata = await sharp(preview).metadata();
  const top = Math.floor((512 - metadata.height) / 2);
  const leftLight = Math.floor((512 - metadata.width) / 2);
  const leftDark = 512 + leftLight;
  return sharp({ create: { width: 1024, height: 512, channels: 4, background: '#ffffff' } })
    .composite([
      { input: { create: { width: 512, height: 512, channels: 4, background: '#ffffff' } }, left: 0, top: 0 },
      { input: preview, left: leftLight, top },
      { input: { create: { width: 512, height: 512, channels: 4, background: '#15191f' } }, left: 512, top: 0 },
      { input: preview, left: leftDark, top },
    ])
    .png()
    .toBuffer();
}

function requestContext(input) {
  return {
    requested_company: requiredText(input.company, 'company'),
    requested_domain: requiredText(input.domain, 'domain'),
    source_url: input.source_url ?? null,
    placement_evidence: input.placement_evidence ?? {},
    declared_page_identity: input.page_identity ?? {},
  };
}

export function openAiRequest({ input, panelBytes }) {
  return {
    model: IDENTITY_MODEL,
    store: false,
    temperature: 0,
    max_output_tokens: 80,
    instructions: IDENTITY_PROMPT,
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: canonicalJson(requestContext(input)) },
        { type: 'input_image', image_url: `data:image/png;base64,${panelBytes.toString('base64')}`, detail: 'high' },
      ],
    }],
    text: { format: { type: 'json_schema', name: 'identity_verdict', strict: true, schema: VERDICT_SCHEMA } },
  };
}

function outputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  return (response?.output ?? []).flatMap(item => item?.content ?? [])
    .filter(item => item?.type === 'output_text' && typeof item.text === 'string')
    .map(item => item.text).join('');
}

export function parseOpenAiResponse(response) {
  const text = outputText(response);
  if (!text) throw new Error('Model response did not contain output text.');
  return validateVerdict(JSON.parse(text));
}

export async function callOpenAi(request, { fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY } = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for a cache miss.');
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`OpenAI Responses API returned HTTP ${response.status}.`);
  const body = await response.json();
  return { verdict: parseOpenAiResponse(body), usage: body.usage ?? {}, response_id: body.id ?? null };
}

function pricedUsage(usage = {}) {
  const input = Number(usage.input_tokens ?? 0);
  const cached = Number(usage.input_tokens_details?.cached_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  const uncached = Math.max(0, input - cached);
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    total_tokens: Number(usage.total_tokens ?? input + output),
    usd: Number(((uncached * 0.15 + cached * 0.075 + output * 0.60) / 1_000_000).toFixed(8)),
    price_source: 'gpt-4o-mini-2024-07-18-usd-per-1m-0.15-input-0.075-cached-0.60-output',
  };
}

function combinedUsage(usages) {
  return usages.reduce((total, usage = {}) => ({
    input_tokens: total.input_tokens + Number(usage.input_tokens ?? 0),
    output_tokens: total.output_tokens + Number(usage.output_tokens ?? 0),
    total_tokens: total.total_tokens + Number(usage.total_tokens ?? ((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0))),
    input_tokens_details: {
      cached_tokens: total.input_tokens_details.cached_tokens + Number(usage.input_tokens_details?.cached_tokens ?? 0),
    },
  }), { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 } });
}

async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}

function validateCacheArtifact(artifact, expected) {
  if (artifact?.schema_version !== 1 || artifact.prompt_version !== IDENTITY_PROMPT_VERSION || artifact.model !== IDENTITY_MODEL ||
      artifact.cache_key !== expected.key || artifact.content_hash !== expected.contentHash || artifact.company !== expected.company ||
      artifact.domain !== expected.domain || !artifact.metrics || typeof artifact.metrics.network_calls !== 'number') {
    throw new Error('Verifier cache artifact does not match the requested judgment.');
  }
  validateVerdict(artifact.verdict);
  return artifact;
}

export async function verifyIdentity(input, options = {}) {
  const imageBytes = input.image_bytes ?? await readFile(requiredText(input.image_path, 'image_path'));
  const contentHash = sha256(imageBytes);
  if (input.content_hash && input.content_hash !== contentHash) throw new Error('Candidate content_hash does not match image bytes.');
  const key = identityCacheKey({ contentHash, company: input.company, domain: input.domain });
  const cacheDirectory = requiredText(options.cacheDirectory, 'cacheDirectory');
  const cachePath = join(cacheDirectory, `${key}.json`);
  if (existsSync(cachePath)) {
    const bytes = await readFile(cachePath);
    const artifact = JSON.parse(bytes);
    validateCacheArtifact(artifact, { key, contentHash, company: input.company.trim(), domain: input.domain.trim().toLowerCase() });
    return { artifact, bytes, cache_hit: true, network_calls: 0, cache_path: cachePath };
  }
  if (options.replayOnly) throw new Error(`Verifier cache miss for ${key}; replay-only mode forbids network.`);

  const panelBytes = await renderIdentityPanels(imageBytes);
  const request = openAiRequest({ input, panelBytes });
  const provider = options.provider ?? (request => callOpenAi(request, options));
  let result;
  let lastError;
  let networkCalls = 0;
  const attemptUsages = [];
  const started = performance.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    networkCalls++;
    try {
      result = await provider(request);
      attemptUsages.push(result.usage ?? {});
      result.verdict = validateVerdict(result.verdict);
      break;
    } catch (error) {
      lastError = error;
      result = null;
    }
  }
  if (!result) throw new Error(`Identity verifier failed after one retry: ${lastError?.message ?? 'unknown error'}`);
  const artifact = {
    schema_version: 1,
    prompt_version: IDENTITY_PROMPT_VERSION,
    model: IDENTITY_MODEL,
    cache_key: key,
    content_hash: contentHash,
    company: input.company.trim(),
    domain: input.domain.trim().toLowerCase(),
    verdict: result.verdict,
    metrics: { ...pricedUsage(combinedUsage(attemptUsages)), latency_ms: Math.round(performance.now() - started), network_calls: networkCalls },
  };
  const bytes = Buffer.from(`${canonicalJson(artifact)}\n`);
  await atomicWrite(cachePath, bytes);
  return { artifact, bytes, cache_hit: false, network_calls: networkCalls, cache_path: cachePath };
}

export async function calibrateIdentityVerifier(cases, options = {}) {
  const rows = [];
  for (const item of cases) {
    const result = await verifyIdentity(item, options);
    rows.push({ case_id: item.case_id, expected_identity: item.expected_identity, ...result.artifact });
  }
  const counts = {};
  for (const row of rows) {
    const key = `${row.expected_identity}->${row.verdict.judgment}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const accepts = rows.filter(row => row.verdict.judgment === 'accept');
  const correctAccepts = accepts.filter(row => row.expected_identity === 'correct');
  return {
    rows,
    summary: {
      cases: rows.length,
      confusion: counts,
      accept_precision: accepts.length ? correctAccepts.length / accepts.length : null,
      accepts: accepts.length,
      total_tokens: rows.reduce((sum, row) => sum + row.metrics.total_tokens, 0),
      total_usd: Number(rows.reduce((sum, row) => sum + row.metrics.usd, 0).toFixed(8)),
      mean_latency_ms: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.metrics.latency_ms, 0) / rows.length) : null,
    },
  };
}
