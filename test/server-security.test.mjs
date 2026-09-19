import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { connect } from 'node:net';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../src/server.mjs', import.meta.url));

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start')), 10_000);
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/Logo Yoink is running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(Number(match[1]));
    });
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Server exited before listening (code ${code})`));
    });
  });
}

function rawRequest(port, request) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let response = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.end(request));
    socket.on('data', chunk => { response += chunk; });
    socket.once('end', () => resolve(response));
    socket.once('error', reject);
  });
}

function requestHomepage(port) {
  return new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path: '/' }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.once('end', () => resolve({ status: response.statusCode, body }));
    }).once('error', reject);
  });
}

test('malformed Host gets a bounded 400 and does not terminate the server', async t => {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', BROWSER_DISCOVERY: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());

  const port = await waitForServer(child);
  const malformed = await rawRequest(port, 'GET / HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n');
  assert.match(malformed, /^HTTP\/1\.1 400 Bad Request\r\n/);
  assert.ok(Buffer.byteLength(malformed) < 1_024);

  const homepage = await requestHomepage(port);
  assert.equal(homepage.status, 200);
  assert.match(homepage.body, /Logo Yoink/i);
  assert.equal(child.exitCode, null);
});
