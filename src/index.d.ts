export type Scraper = 'browser' | 'jina';
export type Theme = 'any' | 'light' | 'dark';
export type Color = 'any' | 'color' | 'white' | 'black';
export type Background = 'any' | 'transparent' | 'opaque';

export interface AssetPreference {
  theme?: Theme;
  color?: Color;
  background?: Background;
  /** Require exact known variants and sufficient contrast on a requested surface. Default: false. */
  strict?: boolean;
}

export interface YoinkOptions {
  /** Optional scraper fallbacks. Default: ["browser"]. Use [] for static-only. */
  scrapers?: Scraper[];
  /** Jina key used only when scrapers includes "jina". Defaults to JINA_API_KEY. */
  jinaApiKey?: string;
  /** Follow bounded first-party brand pages when a logo is missing. Default: true. */
  deep?: boolean;
  /** Inspect one same-origin SPA bundle during deep discovery. Default: same as deep. */
  spaBundles?: boolean;
  /** Exact-domain Wikidata/Wikimedia missing-role fallback. Default: true. */
  wikimedia?: boolean;
  /** Experimental BIMI icon fallback. Default: false. */
  bimi?: boolean;
  /** Bounded robots/sitemap recovery for a missing wide logo. Default: false. */
  sitemap?: boolean;
  cachedFavicon?: boolean;
  /** Try a verified LinkedIn company-page logo only when first-party icon quality is low. Default: false. */
  linkedinFallback?: boolean;
  /** Optional canonical https://www.linkedin.com/company/... URL. */
  linkedinCompanyUrl?: string;
  /** Optional local background removal. Reuses a verified transparent family variant when available; otherwise requires `logo-yoink setup-background-removal`. Default: false. Originals are preserved; model processing may make one bounded retry. */
  removeBackground?: boolean;
  /** Upscale small raster selections by a factor or toward target dimensions. Vectors remain unchanged. */
  upscale?: number | { width?: number; height?: number; factor?: number };
  /** Alias for a numeric upscale factor. */
  upscaleFactor?: number;
  preferences?: { icon?: AssetPreference; logo?: AssetPreference };
  timeoutMs?: number;
  companyName?: string;
  [option: string]: unknown;
}

export interface LogoAsset {
  resolvedUrl: string;
  dataUrl: string;
  format: string;
  width: number;
  height: number;
  source: string;
  /** True for a native-resolution CSS sprite crop. The complete source stays in original. */
  derived?: boolean;
  original?: { url: string; dataUrl: string; format: string; width: number; height: number; byte_hash: string };
  transformations?: Record<string, unknown>[];
  wordmark_caution?: 'stacked-logo' | 'explicit-symbol' | 'ambiguous-compact-mark' | null;
  [field: string]: unknown;
}

export interface YoinkResult {
  icon: LogoAsset | null;
  logo: LogoAsset | null;
  assets: { icon: LogoAsset | null; logo: LogoAsset | null };
  processedAssets?: {
    icon: { original: LogoAsset | null; enhanced: LogoAsset | null; transformations: Record<string, unknown>[] };
    logo: { original: LogoAsset | null; enhanced: LogoAsset | null; transformations: Record<string, unknown>[] };
  };
  assetVariants: { icon: LogoAsset[]; logo: LogoAsset[] };
  preferenceMatch: { icon: 'exact' | 'fallback' | 'unmatched'; logo: 'exact' | 'fallback' | 'unmatched' };
  candidates: LogoAsset[];
  diagnostics: Record<string, unknown>;
  [field: string]: unknown;
}

export const DEFAULT_OPTIONS: Readonly<{
  scrapers: readonly ['browser'];
  deep: true;
  wikimedia: true;
  bimi: false;
  cachedFavicon: true;
  sitemap: false;
}>;

export function yoink(website: string, options?: YoinkOptions): Promise<YoinkResult>;
export function extractLogos(website: string, options?: Record<string, unknown>): Promise<YoinkResult>;
export function normalizeWebsite(website: string): { url: URL; domain: string };
export default yoink;
