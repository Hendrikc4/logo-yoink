import { isIP } from 'node:net';

export function canonicalHostname(hostname) {
  return String(hostname ?? '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
}

export function isIpAddress(hostname) {
  return isIP(canonicalHostname(hostname)) !== 0;
}

export function isPrivateIp(hostname) {
  const value = canonicalHostname(hostname);
  const family = isIP(value);
  if (!family) return false;
  if (family === 6) {
    if (value === '::' || value === '::1' || /^(?:fc|fd|fe[89ab])/i.test(value) || /^2001:db8:/i.test(value)) return true;
    const mapped = value.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i);
    if (mapped) {
      const number = Number.parseInt(mapped[1], 16) * 65536 + Number.parseInt(mapped[2], 16);
      return isPrivateIp(`${number >>> 24}.${number >>> 16 & 255}.${number >>> 8 & 255}.${number & 255}`);
    }
    return false;
  }
  const [a, b, c] = value.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && [0, 2].includes(c)) || (b === 88 && c === 99) || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}
