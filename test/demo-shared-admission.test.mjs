import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedDemoAdmission, DEMO_FIREWALL_RULES } from '../src/demo/shared-admission.mjs';
import { createDemoExtractionService } from '../src/demo/extraction-service.mjs';

const environment = { VERCEL: '1', NODE_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'logo-yoink.test' };
const request = ip => ({ headers: { host: 'attacker.test', 'x-real-ip': ip, 'content-type': 'application/json' }, body: { website: 'example.com', scrapers: [] } });

test('independent serverless services share client and aggregate admission counters', async () => {
  const counts = new Map();
  const check = async (rule, options) => {
    assert.deepEqual(options.headers, { host: 'logo-yoink.test' });
    const key = `${rule}/${options.rateLimitKey}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return { rateLimited: count > (rule === DEMO_FIREWALL_RULES.client ? 1 : 3) };
  };
  let extractions = 0;
  const make = () => createDemoExtractionService({ environment,
    sharedAdmission: createSharedDemoAdmission({ environment, check }),
    extract: async () => { extractions += 1; return {}; },
  });
  const first = make(), second = make();
  assert.equal((await first.handle(request('1.1.1.1'))).status, 200);
  assert.equal((await second.handle(request('1.1.1.1'))).status, 429);
  assert.equal((await second.handle(request('8.8.8.8'))).status, 200);
  assert.equal((await first.handle(request('9.9.9.9'))).status, 429);
  assert.equal(extractions, 2);
});

test('unconfigured, failed and stalled shared limiters never start extraction', async () => {
  for (const check of [async () => ({ rateLimited: false, error: 'not-found' }), async () => { throw new Error('backend down'); }, async () => new Promise(() => {})]) {
    const service = createDemoExtractionService({ environment,
      sharedAdmission: createSharedDemoAdmission({ environment, check, timeoutMs: 10 }),
      extract: async () => assert.fail('must fail closed'),
    });
    assert.equal((await service.handle(request('1.1.1.1'))).status, 503);
  }
});

test('Vercel development SDK bypass and missing canonical host fail closed', async () => {
  for (const overrides of [{ NODE_ENV: 'development' }, { VERCEL_PROJECT_PRODUCTION_URL: '' }]) {
    const admit = createSharedDemoAdmission({ environment: { ...environment, ...overrides }, check: async () => assert.fail('must not call SDK') });
    await assert.rejects(admit(request('1.1.1.1')), error => error.status === 503);
  }
});

test('local installations need no shared service and Jina requires explicit server opt-in', async () => {
  await createSharedDemoAdmission({ environment: {}, check: async () => assert.fail('local must not use WAF') })(request('1.1.1.1'));
  const service = createDemoExtractionService({ environment: { JINA_API_KEY: 'unused-test-key' }, extract: async () => assert.fail('Jina must be disabled') });
  const req = request('1.1.1.1'); req.body.scrapers = ['jina'];
  const result = await service.handle(req);
  assert.equal(result.status, 400);
  assert.match(result.payload.error, /not configured/);
});
