export interface GenericAssetMatch {
  family: string;
  reason: string;
  owners: string[];
  ownerDomains?: string[];
  method: string;
  distance?: number;
  rasterDistance?: number;
}
export const GENERIC_ASSET_CATALOG_VERSION: string;
export function matchKnownGenericHash(sha256: string | null | undefined): GenericAssetMatch | null;
export function isGenericAssetOwnerDomain(match: GenericAssetMatch, domain: string): boolean;
export function identifyGenericAsset(buffer: Uint8Array): Promise<GenericAssetMatch | null>;
export function genericAssetRejection(buffer: Uint8Array, domain: string): Promise<GenericAssetMatch | null>;
