import test from 'node:test';
import assert from 'node:assert/strict';
import { serverlessBrowserLaunchOptions } from '../src/demo/serverless-browser.mjs';

test('serverless browser options stay dormant outside Vercel or Lambda', async () => {
  const chromium = { executablePath: async () => { throw new Error('must stay lazy'); } };
  assert.equal(await serverlessBrowserLaunchOptions({}, chromium), undefined);
});

test('serverless browser options resolve the packaged executable on Vercel', async () => {
  const chromium = { args: ['--serverless'], setGraphicsMode: true, executablePath: async () => '/tmp/chromium' };
  assert.deepEqual(await serverlessBrowserLaunchOptions({ VERCEL: '1' }, chromium), {
    args: ['--serverless'], executablePath: '/tmp/chromium', headless: true,
  });
  assert.equal(chromium.setGraphicsMode, false);
});
