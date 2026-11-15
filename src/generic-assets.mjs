import { createHash } from 'node:crypto';
import { measureTinyImageSuitability } from './tiny-image-suitability.mjs';
import { matchGenericFingerprint, matchKnownGenericHash, isGenericAssetOwnerDomain } from './generic-asset-fingerprint.mjs';

export { GENERIC_ASSET_CATALOG_VERSION, matchKnownGenericHash, isGenericAssetOwnerDomain } from './generic-asset-fingerprint.mjs';

/** Shared ingestion gate for all providers, including cached or re-encoded images. */
export async function identifyGenericAsset(buffer) {
  const exact = matchKnownGenericHash(createHash('sha256').update(buffer).digest('hex'));
  if (exact) return exact;
  return matchGenericFingerprint((await measureTinyImageSuitability(buffer))?.pixel_fingerprint);
}

export async function genericAssetRejection(buffer, domain) {
  const match = await identifyGenericAsset(buffer);
  return match && !isGenericAssetOwnerDomain(match, domain) ? match : null;
}
