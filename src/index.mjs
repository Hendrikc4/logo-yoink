import './load-env.mjs';
import { extractLogos } from './extractor.mjs';

export { extractLogos, normalizeWebsite } from './extractor.mjs';

export const DEFAULT_OPTIONS = Object.freeze({
  scrapers: Object.freeze(['browser']),
  deep: true,
  wikimedia: true,
  bimi: false,
  cachedFavicon: true,
});

const SUPPORTED_SCRAPERS = new Set(['browser', 'jina']);

function normalizeScrapers(value) {
  if (value === undefined) return [...DEFAULT_OPTIONS.scrapers];
  if (!Array.isArray(value)) throw new TypeError('scrapers must be an array containing "browser" and/or "jina".');
  const normalized = [...new Set(value.map(item => String(item).trim().toLowerCase()))];
  const unsupported = normalized.filter(item => !SUPPORTED_SCRAPERS.has(item));
  if (unsupported.length) throw new TypeError(`Unsupported scraper: ${unsupported.join(', ')}. Supported scrapers are "browser" and "jina".`);
  return normalized;
}

/**
 * The simple public API. Static discovery always runs; every scraper is opt-in.
 * Use extractLogos directly when you need the complete low-level option surface.
 */
export async function yoink(website, options = {}) {
  const scrapers = normalizeScrapers(options.scrapers);
  const useJina = scrapers.includes('jina');
  const jinaApiKey = options.jinaApiKey ?? process.env.JINA_API_KEY?.trim() ?? null;
  if (useJina && !jinaApiKey) {
    throw new Error('The Jina scraper was enabled, but no jinaApiKey or JINA_API_KEY was provided.');
  }

  const result = await extractLogos(website, {
    ...options,
    browser: scrapers.includes('browser'),
    jinaApiKey: useJina ? jinaApiKey : null,
    deepWide: options.deep ?? DEFAULT_OPTIONS.deep,
    spaBundles: options.spaBundles ?? (options.deep ?? DEFAULT_OPTIONS.deep),
    wikimediaFallback: options.wikimedia ?? DEFAULT_OPTIONS.wikimedia,
    bimi: options.bimi ?? DEFAULT_OPTIONS.bimi,
    cachedFavicon: options.cachedFavicon ?? DEFAULT_OPTIONS.cachedFavicon,
    roleAwareBudget: options.roleAwareBudget ?? true,
    contentBoundingWide: options.contentBoundingWide ?? true,
  });

  return result;
}

export default yoink;
