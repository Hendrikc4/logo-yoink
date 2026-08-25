import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHostname, isIpAddress, isPrivateIp } from '../src/network-safety.mjs';

test('canonicalHostname normalizes URL hostname syntax', () => {
  assert.equal(canonicalHostname('[2001:DB8::1].'), '2001:db8::1');
  assert.equal(canonicalHostname('Example.COM.'), 'example.com');
  assert.equal(isIpAddress('[2001:db8::1]'), true);
  assert.equal(isIpAddress('example.com'), false);
});

test('isPrivateIp recognizes reserved IPv4 and IPv6 address ranges', () => {
  for (const address of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1',
    '172.16.0.1', '192.0.2.1', '192.168.0.1', '198.18.0.1', '203.0.113.1',
    '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '2001:db8::1', '::ffff:7f00:1',
  ]) assert.equal(isPrivateIp(address), true, address);

  for (const address of ['8.8.8.8', '93.184.216.34', '2001:4860:4860::8888', 'example.com', '']) {
    assert.equal(isPrivateIp(address), false, address);
  }
});
