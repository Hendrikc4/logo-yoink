import { fetchTimed, readLimited } from './http-client.mjs';

const MAX_LINKEDIN_HTML_BYTES = 1024 * 1024;

function decodeHtml(value) {
  return String(value ?? '').replace(/&amp;/gi, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/').replace(/&quot;/gi, '"');
}

function safeCompanyUrl(value, base) {
  try {
    const url = new URL(decodeHtml(value), base);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol !== 'https:' || hostname !== 'linkedin.com' || !/^\/company\/[^/?#]+\/?$/i.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function findLinkedInCompanyUrl(homepageHtml, homepageUrl, explicitUrl) {
  if (explicitUrl) return safeCompanyUrl(explicitUrl, homepageUrl);
  for (const match of String(homepageHtml ?? '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const url = safeCompanyUrl(match[1], homepageUrl);
    if (url) return url;
  }
  return null;
}

function metaContent(html, property) {
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = Object.fromEntries([...tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gs)]
      .map(match => [match[1].toLowerCase(), decodeHtml(match[3])]));
    if ((attributes.property ?? attributes.name)?.toLowerCase() === property) return attributes.content ?? null;
  }
  return null;
}

function mentionsDomain(html, domain) {
  const normalized = String(domain).toLowerCase().replace(/^www\./, '');
  const decoded = decodeHtml(html).toLowerCase().replaceAll('\\/', '/');
  return decoded.includes(normalized) || decoded.includes(encodeURIComponent(normalized).toLowerCase());
}

export async function discoverLinkedInLogo({ domain, homepage, homepageHtml, companyUrl }, {
  timeoutMs = 5_000,
  diagnostics,
  fetchImpl = fetch,
  validateUrl,
} = {}) {
  const linkedInUrl = findLinkedInCompanyUrl(homepageHtml, homepage, companyUrl);
  if (!linkedInUrl) return { candidates: [], diagnostics: { status: companyUrl ? 'invalid_company_url' : 'no_company_link' } };
  const linkedFromHomepage = !companyUrl;
  try {
    const response = await fetchTimed(linkedInUrl, {
      timeoutMs,
      accept: 'text/html,application/xhtml+xml',
      diagnostics,
      fetchImpl,
      ...(validateUrl ? { validateUrl } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { candidates: [], diagnostics: { status: 'http_error', companyUrl: linkedInUrl, httpStatus: response.status } };
    }
    const read = await readLimited(response, MAX_LINKEDIN_HTML_BYTES, { truncate: true, diagnostics, timeoutMs });
    const html = read.bytes.toString('utf8');
    const identityVerified = linkedFromHomepage || mentionsDomain(html, domain);
    if (!identityVerified) return { candidates: [], diagnostics: { status: 'identity_mismatch', companyUrl: linkedInUrl } };
    const rawImageUrl = metaContent(html, 'og:image');
    let imageUrl;
    try { imageUrl = new URL(rawImageUrl, response.url || linkedInUrl).href; } catch { imageUrl = null; }
    if (!imageUrl || !/^https:$/i.test(new URL(imageUrl).protocol)) {
      return { candidates: [], diagnostics: { status: 'no_logo_image', companyUrl: linkedInUrl, identityVerified: true } };
    }
    const imageLabel = `${metaContent(html, 'og:image:alt') ?? ''} ${imageUrl}`;
    if (/(?:linkedin[-_\s]*(?:logo|icon)|li[-_\s]*logo|default[-_\s]*(?:company|share)[-_\s]*image)/i.test(imageLabel)) {
      return { candidates: [], diagnostics: { status: 'generic_platform_image', companyUrl: linkedInUrl, identityVerified: true } };
    }
    return {
      candidates: [{
        url: imageUrl,
        source: 'linkedin',
        source_page: linkedInUrl,
        sizes: '',
        type: metaContent(html, 'og:image:type') ?? '',
        purpose: '',
        declared: {},
        evidence: {
          element: 'og:image',
          linkedin_identity_verified: true,
          identity_verification: linkedFromHomepage ? 'first-party-company-link' : 'exact-domain-on-company-page',
          eligible_roles: ['icon'],
        },
      }],
      diagnostics: { status: 'candidate_found', companyUrl: linkedInUrl, identityVerified: true },
    };
  } catch (error) {
    return { candidates: [], diagnostics: { status: 'error', companyUrl: linkedInUrl, error: error.name === 'AbortError' ? 'timeout' : error.message } };
  }
}
