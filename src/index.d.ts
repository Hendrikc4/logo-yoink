export type Scraper = 'browser' | 'jina';
export type Theme = 'any' | 'light' | 'dark';
export type Color = 'any' | 'color' | 'white' | 'black';
export type Background = 'any' | 'transparent' | 'opaque';

export interface AssetPreference {
  theme?: Theme;
  color?: Color;
  background?: Background;
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
  cachedFavicon?: boolean;
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
  [field: string]: unknown;
}

export interface YoinkResult {
  icon: LogoAsset | null;
  logo: LogoAsset | null;
  assets: { icon: LogoAsset | null; logo: LogoAsset | null };
  assetVariants: { icon: LogoAsset[]; logo: LogoAsset[] };
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
}>;

export function yoink(website: string, options?: YoinkOptions): Promise<YoinkResult>;
export function extractLogos(website: string, options?: Record<string, unknown>): Promise<YoinkResult>;
export function normalizeWebsite(website: string): { url: URL; domain: string };
export default yoink;
