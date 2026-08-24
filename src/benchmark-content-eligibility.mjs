const LABELABLE_IDENTITIES = new Set(['current', 'related_rebrand']);
// These signatures were independently audited in the frozen 500-company run.
// They are benchmark-integrity exemptions only, never packet/review filters.
const INTEGRITY_EXEMPT_HASHES = new Map([
  ['44ea786ef9f9ad7f0ee37ab3166580818da36d2cd2721f5a480cc8a06d801fa2', 'GoDaddy parked-domain favicon'],
  ['2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932', 'Vercel default favicon'],
  ['dd821076a9b03adc2173c93956226aea3d92482d7578fc4339c5d3a2e9c24586', 'shared unowned default favicon'],
  ['9deb629637088856fe61dc868bf40a7d21ed942e4117659f3d6c3408f59b906b', 'blank default favicon'],
  ['33c1436f8c40ca2582d091c449fccc34ed9bf73f02526c5fdef44f4f06c6321b', 'Wix default favicon'],
  ['a33a47a20c0ec6b0c13af43ae681bf73023e4a35f792cb055700e94d467f236d', 'foreign Google logo'],
]);

function identityOf(capture) {
  return String(capture?.identity_status ?? capture?.identityStatus ?? '').trim().toLowerCase();
}

function contentHashOf(candidate) {
  return String(candidate?.content_hash ?? candidate?.contentHash ?? candidate?.feature_snapshot?.content_hash ?? '').trim().toLowerCase();
}

// Unknown legacy capture state remains eligible to preserve existing packet behavior.
export function isPacketLabelableCapture(capture) {
  const identity = identityOf(capture);
  return !identity || LABELABLE_IDENTITIES.has(identity);
}

export function captureAbstention(capture) {
  if (isPacketLabelableCapture(capture)) return null;
  const identity = identityOf(capture) || 'unclassified';
  const reachability = String(capture?.reachability ?? '').trim().toLowerCase();
  return reachability
    ? `capture identity is ${identity} (${reachability}) rather than current or related target content`
    : `capture identity is ${identity} rather than current or related target content`;
}

export function integrityExemptionReason(candidate) {
  return INTEGRITY_EXEMPT_HASHES.get(contentHashOf(candidate)) ?? null;
}

export function isLeakageRelevantTargetContent(capture, candidate) {
  return isPacketLabelableCapture(capture) && !integrityExemptionReason(candidate);
}
