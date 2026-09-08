import { describeAssetVariant, matchesRequiredPreferences, normalizeAssetPreferences } from './asset-model.mjs';
import { describesEmbeddedLogo } from './logo-semantics.mjs';

const SOURCE_WEIGHT = {
  schema: 30, 'og-logo': 27, microdata: 26, 'inline-svg': 24, 'browser-inline-svg': 24, 'browser-img': 12,
  'browser-css-background': 8, 'dom-img': 10, 'dom-picture': 10, 'noscript-img': 8,
  manifest: 22, apple: 20, 'mask-icon': 20, bimi: 18, 'ms-tile': 17, 'html-icon': 16, 'jina-screenshot': 18, besticon: 12, 'google-favicon': 10, 'duckduckgo-favicon': 9, 'root-favicon': 5, 'social-banner': -30,
  'wikimedia-commons': 24,
};
const RANKING_VERSION = 11;
export const ROLE_VARIANT_MIN_SCORE = 45;
const DELIVERY_QUERY_PARAMS = new Set(['w', 'h', 'width', 'height', 'size', 's', 'dpr', 'q', 'quality', 'fit', 'resize', 'format', 'fm']);

function round(value) { return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10; }
function companyAgreement(item, companyName) {
  const company = String(companyName ?? '').toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|company|co)\b\.?/g, ' ').match(/[a-z0-9]+/g) ?? [];
  if (!company.length) return false;
  let path = '';
  try { path = decodeURIComponent(new URL(item.url).pathname); } catch { /* Inline/data candidates have no useful filename. */ }
  const haystack = `${path} ${item.evidence?.alt ?? ''} ${item.evidence?.aria_label ?? ''}`.toLowerCase();
  return company.some(token => token.length >= 3 && haystack.includes(token));
}

function firstPartyPlacedLogoPath(item) {
  if (item.source !== 'browser-img' || !['header', 'nav'].includes(item.evidence?.dom_region)) return false;
  try {
    const asset = new URL(item.resolvedUrl ?? item.resolved_url ?? item.url);
    const source = new URL(item.source_page);
    const normalizedHost = url => url.hostname.toLowerCase().replace(/^www\./, '');
    if (normalizedHost(asset) !== normalizedHost(source)) return false;
    const path = decodeURIComponent(asset.pathname).toLowerCase();
    return /(?:^|[\/_.-])(?:logo|brand|wordmark)(?:[\/_.-]|$)/.test(path);
  } catch {
    return false;
  }
}

const AUTHORITATIVE_SOURCES = ['schema', 'og-logo', 'microdata'];
const FAVICON_SOURCES = ['manifest', 'apple', 'mask-icon', 'bimi', 'ms-tile', 'html-icon', 'besticon', 'google-favicon', 'duckduckgo-favicon', 'root-favicon'];
const DECLARED_ICON_SOURCES = new Set(['manifest', 'apple', 'mask-icon', 'ms-tile', 'html-icon', 'google-favicon', 'duckduckgo-favicon', 'root-favicon']);
const DECLARED_ICON_MIN_SCORE = 49;
const PLATFORM_NAMES = ['namecheap', 'matomo', 'piwik', 'wix', 'vercel', 'lovable', 'webflow', 'squarespace', 'shopify', 'godaddy', 'netlify', 'framer'];
const KNOWN_GENERIC_HASHES = new Map([
  ['33c1436f8c40ca2582d091c449fccc34ed9bf73f02526c5fdef44f4f06c6321b', 'Wix default favicon'],
  ['c965a500f698483526faf92ac286047cecd825608cd1d83276de392b30a13a83', 'WordPress default favicon'],
  ['9ea4f4da7050c0cc408926f6a39c253624e9babb1d43c7977cd821445a60b461', 'Create React App default logo'],
  ['dddd3a41217d3acee3effdec02946e4a26eba182c5994398e7d9dde4d585cebe', 'repurposed casino favicon'],
  ['788f0397eb26c7151af4afc25d5478ef692b39c10035774158b500b187b4a431', 'photographic avatar mislabeled as logo'],
  ['3646840f40e10d4b14e9d62f41087a09ffe0384628d093f47337580305b18353', 'foreign RealReports app icon'],
  ['2f3184d54e08fe74380ab6618c1e03390638714f074b6b63fc0f9ae40212b72a', 'foreign JWSatInfo favicon'],
  ['242351f0a1c0aee2c1d819844cdb6334140058b4487b4bbe9477c3cc33707616', 'foreign RealReports app icon'],
  ['edf01f937bdf9c38ebcd30d84cb5acde5e2101e9c64c1c9b3a4a1351ea7886a0', 'foreign RealReports favicon'],
  ['c386396ec70db3608075b5fbfaac4ab1ccaa86ba05a68ab393ec551eb66c3e00', 'Create React App default logo'],
]);
const KNOWN_HASH_OWNERS = new Map([
  ['33c1436f8c40ca2582d091c449fccc34ed9bf73f02526c5fdef44f4f06c6321b', ['wix']],
  ['c965a500f698483526faf92ac286047cecd825608cd1d83276de392b30a13a83', ['wordpress']],
  ['9ea4f4da7050c0cc408926f6a39c253624e9babb1d43c7977cd821445a60b461', ['react']],
  ['dddd3a41217d3acee3effdec02946e4a26eba182c5994398e7d9dde4d585cebe', ['leon', 'casino']],
  ['3646840f40e10d4b14e9d62f41087a09ffe0384628d093f47337580305b18353', ['realreports']],
  ['2f3184d54e08fe74380ab6618c1e03390638714f074b6b63fc0f9ae40212b72a', ['jwsatinfo']],
  ['242351f0a1c0aee2c1d819844cdb6334140058b4487b4bbe9477c3cc33707616', ['realreports']],
  ['edf01f937bdf9c38ebcd30d84cb5acde5e2101e9c64c1c9b3a4a1351ea7886a0', ['realreports']],
  ['c386396ec70db3608075b5fbfaac4ab1ccaa86ba05a68ab393ec551eb66c3e00', ['react']],
]);
const GENERIC_OWNER_DOMAINS = { wix: ['wix.com'], wordpress: ['wordpress.org', 'wordpress.com'] };

function isGenericAssetOwner(owners, requestedWords, sourcePage) {
  if (!Array.isArray(owners)) return false;
  if (requestedWords.size) return owners.some(owner => requestedWords.has(owner));
  try {
    const host = new URL(sourcePage).hostname.toLowerCase();
    return owners.some(owner => GENERIC_OWNER_DOMAINS[owner]?.some(domain =>
      host === domain || host.endsWith(`.${domain}`)));
  } catch { return false; }
}

function normalizedWords(value) {
  return String(value ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function companyWords(companyName) {
  return normalizedWords(companyName).filter(word => !['inc', 'llc', 'ltd', 'corp', 'corporation', 'company', 'co'].includes(word));
}

function explicitLogoSubject(item) {
  const label = `${item.evidence?.alt ?? ''} ${item.evidence?.aria_label ?? ''}`.trim();
  const match = label.match(/^\s*(.+?)\s+(?:company\s+)?(?:logo|wordmark|brandmark|logomark)\s*$/i);
  if (!match) return [];
  return normalizedWords(match[1]).filter(word => !['the', 'official'].includes(word));
}

function exactCompanyLabel(item, companyName) {
  const subject = explicitLogoSubject(item);
  const requested = companyWords(companyName || item.evidence?.company_name);
  return subject.length > 0 && requested.length > 0 && subject.length === requested.length &&
    subject.every((word, index) => word === requested[index]);
}

function foreignOrganizationContext(item) {
  const semantic = `${item.evidence?.semantic_text ?? ''} ${item.evidence?.class_tokens?.join?.(' ') ?? ''}`;
  return /(?:carousel|customer|partner|investor|sponsor|backed(?:[-_\s]*by)?|testimonial|card[-_\s]|dropdown|menuitem|listitem|product|subbrand)/i.test(semantic);
}

function explicitForeignOrganization(item, companyName) {
  if (item.evidence?.home_linked || !foreignOrganizationContext(item)) return false;
  const subject = explicitLogoSubject(item);
  if (!subject.length) return false;
  const requested = companyWords(companyName || item.evidence?.company_name);
  return requested.length > 0 && !subject.some(word => requested.some(companyWord =>
    word.length >= 3 && companyWord.length >= 3 && (word.startsWith(companyWord) || companyWord.startsWith(word))));
}

function sameOriginAsset(item) {
  try {
    const asset = new URL(item.resolvedUrl ?? item.resolved_url ?? item.url);
    const page = new URL(item.source_page);
    return asset.hostname.replace(/^www\./, '') === page.hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
}

const PORTRAIT_CONTEXT = /(?:^|[^a-z0-9])(?:avatar|headshot|portrait|profile[-_\s]*(?:image|photo|picture)|team[-_\s]*member|staff[-_\s]*(?:image|photo|picture)|employee[-_\s]*(?:image|photo|picture)|founder[-_\s]*(?:image|photo|picture)|author[-_\s]*(?:image|photo|picture)|speaker[-_\s]*(?:image|photo|picture))(?:[^a-z0-9]|$)/i;
const NON_NAME_FILENAME_WORDS = new Set(['bg', 'background', 'big', 'desktop', 'final', 'hero', 'image', 'img', 'large', 'main', 'new', 'photo', 'pic', 'picture', 'site', 'small', 'web', 'website']);

function portraitBodyPhoto(item, companyName) {
  if (!['dom-img', 'dom-picture', 'browser-img', 'noscript-img'].includes(item.source) || item.scalable ||
    (item.evidence?.dom_region && item.evidence.dom_region !== 'body') || item.evidence?.home_linked) return false;
  const ratio = item.width && item.height ? item.width / item.height : null;
  if (ratio == null || ratio < 0.72 || ratio > 1.4) return false;

  let pathname = '';
  try { pathname = decodeURIComponent(new URL(item.resolvedUrl ?? item.resolved_url ?? item.url).pathname); } catch { return false; }
  const semantic = `${item.evidence?.semantic_text ?? ''} ${item.evidence?.alt ?? ''} ${item.evidence?.aria_label ?? ''}`;
  // Ancestor classes are useful context but are not an assertion about the image itself.
  const portraitContext = PORTRAIT_CONTEXT.test(`${pathname} ${semantic}`);
  const exactBrandIdentity = exactCompanyLabel(item, companyName) ||
    /(?:^|[\/_.-])(?:logo|wordmark|brandmark|logomark)(?:[\/_.-]|$)/i.test(pathname) &&
      companyAgreement(item, companyName || item.evidence?.company_name);
  if (exactBrandIdentity && !portraitContext) return false;
  if (!/\.(?:avif|jpe?g|png|webp)$/i.test(pathname) &&
    !['avif', 'jpeg', 'jpg', 'png', 'webp'].includes(item.format ?? item.observed?.format)) return false;
  if (portraitContext) return true;
  if (companyAgreement(item, companyName || item.evidence?.company_name)) return false;

  // CMS uploads commonly preserve a person's First_Last filename. Require two adjacent
  // title-cased words so ordinary lower-case asset slugs do not look like names.
  const basename = pathname.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
  const tokens = basename.split(/[-_\s]+/).filter(Boolean);
  return tokens.some((token, index) => {
    const next = tokens[index + 1];
    return /^[A-Z][a-z]{2,}$/.test(token) && /^[A-Z][a-z]{2,}$/.test(next ?? '') &&
      !NON_NAME_FILENAME_WORDS.has(token.toLowerCase()) && !NON_NAME_FILENAME_WORDS.has(next.toLowerCase());
  });
}

export function genericAssetReason(item, companyName = '') {
  const structuralSemantic = `${item.evidence?.semantic_text ?? ''} ${item.evidence?.class_tokens?.join?.(' ') ?? ''}`.toLowerCase();
  const semantic = `${item.evidence?.semantic_text ?? ''} ${item.evidence?.alt ?? ''} ${item.evidence?.aria_label ?? ''}`.toLowerCase();
  const url = String(item.resolvedUrl ?? item.resolved_url ?? item.url ?? '').toLowerCase();
  const requestedCompanyWords = new Set(normalizedWords(companyName || item.evidence?.company_name));
  const companyWords = new Set(requestedCompanyWords);
  try {
    for (const word of normalizedWords(new URL(item.source_page).hostname)) companyWords.add(word);
  } catch { /* Inline and synthetic candidates may not have a source page. */ }
  const itemHash = item.observed?.byte_hash ?? item.content_hash;
  const knownHashReason = KNOWN_GENERIC_HASHES.get(itemHash);
  const knownHashOwners = KNOWN_HASH_OWNERS.get(itemHash) ?? [];
  if (knownHashReason && !isGenericAssetOwner(knownHashOwners, requestedCompanyWords, item.source_page)) return knownHashReason;
  const visualGeneric = item.observed?.generic_asset;
  if (visualGeneric?.reason && Array.isArray(visualGeneric.owners) &&
      !isGenericAssetOwner(visualGeneric.owners, requestedCompanyWords, item.source_page)) {
    return `${visualGeneric.reason} via ${visualGeneric.method ?? 'visual fingerprint'}`;
  }
  const foreignPlatform = PLATFORM_NAMES.find(platform => !companyWords.has(platform) && (
    new RegExp(`(?:^|[^a-z0-9])${platform}(?:[\\s_-]+)(?:logo|favicon|brand)(?:[^a-z0-9]|$)`, 'i').test(semantic) ||
    new RegExp(`(?:powered|hosted|secured)[\\s_-]+by[\\s_-]+${platform}(?:[^a-z0-9]|$)`, 'i').test(semantic)
  ));
  if (foreignPlatform) return `foreign platform brand: ${foreignPlatform}`;
  if (!companyWords.has('wix') && /static\.parastorage\.com\/client\/pfavico\.ico(?:[?#]|$)/i.test(url)) return 'Wix default favicon';
  if (!companyWords.has('matomo') && !companyWords.has('piwik') && (
    /(?:^|[-_\s])default-piwik-logo(?:$|[-_\s])/i.test(semantic) ||
    /\/plugins\/morpheus\/images\/logo\.svg(?:\?matomo)?$/i.test(url) ||
    /\/plugins\/corehome\/images\/(?:applogo_\d+|favicon)\.(?:png|ico|svg)(?:[?#]|$)/i.test(url)
  )) return 'Matomo default application logo';
  if (!companyWords.has('godaddy') && /img1\.wsimg\.com\/isteam\/ip\/static\/pwa-app\/logo-default\.png/i.test(url)) return 'GoDaddy default PWA logo';
  if (!companyWords.has('789bet') && !companyWords.has('meriamhoki') && !companyWords.has('90phut') && /(?:789bet|dewancash|meriamhoki|90phut)/i.test(`${semantic} ${url}`)) return 'foreign gambling brand';
  if (/(?:^|[-_\s])(?:logo[-_\s]*)?soc[-_\s]*2(?:$|[-_\s])/i.test(`${semantic} ${url}`)) return 'SOC 2 compliance badge';
  if (item.evidence?.dom_region === 'footer' && /(?:badge|award|certif(?:ied|ication)|compliant|trustmark|trustpilot)/i.test(semantic)) return 'footer trust badge';
  if (/(?:^|[-_\s])fa[-_\s]*(?:language|magnifying-glass|search|bars|xmark|close|chevron-(?:left|right|up|down)|arrow-(?:left|right|up|down)|whatsapp)(?:$|[-_\s])/i.test(semantic)) return 'Font Awesome UI control';
  if (/(?:^|[^a-z0-9])(?:instagram|twitter|facebook|linkedin|youtube|tiktok|pinterest)(?:[-_\s]*(?:logo|icon|glyph))?(?:[^a-z0-9]|$)/i.test(`${semantic} ${url}`)) return 'social-media glyph';
  const candidateRatio = item.width && item.height ? item.width / item.height : null;
  if (['dom-img', 'dom-picture', 'browser-img'].includes(item.source) && item.evidence?.dom_region === 'body' && !item.evidence?.home_linked &&
    describesEmbeddedLogo(item.evidence?.alt)) return 'logo embedded in body content image';
  if (item.source === 'inline-svg' && (
    /(?:icon[-_\s]*play|play[-_\s]*circle|play[-_\s]*video|video[-_\s]*(?:wrapper|column)|e-far-play|tabler[-_\s]*icon[-_\s]*(?:copyright|menu|search|play)|chakra[-_\s]*icon|kb[-_\s]*svg[-_\s]*icon|fxfa[-_\s]*icon[\s\S]*menuitem|pointer-events-off[^\n]{0,80}nav[-_\s]*main[-_\s]*link|exp[-_\s]*selector[-_\s]*icon)/i.test(semantic) ||
    candidateRatio >= 0.72 && candidateRatio <= 1.4 && /presentation[^\n]{0,240}wixui[-_\s]*vector[-_\s]*image/i.test(semantic)
  )) return 'inline UI control';
  if (['dom-img', 'dom-picture', 'browser-img'].includes(item.source) && (
    /^\s*menu\s*$/i.test(item.evidence?.alt ?? '') || /menu[-_\s]*item__icon|ico[-_\s]*gnb[-_\s]*menu|userpilot[-_\s]*enterprise[-_\s]*icon/i.test(`${semantic} ${url}`)
  )) return 'menu UI control';
  if (/untitled[-_\s]*ui[-_\s]*logo/i.test(url)) return 'Untitled UI template logo';
  const archiveProduct = String(item.evidence?.archive_member ?? '').match(/(?:^|[\s/_.-])(copilot|claude|connect|checkout|terminal|atlas|slackbot|salesforce)(?:$|[\s/_.-])/i)?.[1]?.toLowerCase();
  if (item.source === 'official-archive' && archiveProduct && !normalizedWords(companyName).includes(archiveProduct)) return 'product or subbrand archive member';
  if (/(?:works[-_\s]*with[-_\s]*logos|enterprises?[-_\s]*logo[-_\s]*\d+)/i.test(`${semantic} ${url}`) ||
    /(?:customer[-_\s]*logos?|partner[-_\s]*logos?)/i.test(`${semantic} ${url}`) && !companyAgreement(item, companyName || item.evidence?.company_name)) return 'customer or partner logo';
  if (/(?:investor|sponsor|backed(?:[-_\s]*by)?)[-_\s]*(?:logos?|marks?)/i.test(structuralSemantic) &&
    !companyAgreement(item, companyName || item.evidence?.company_name)) return 'investor, sponsor, or backer logo';
  if (explicitForeignOrganization(item, companyName)) return 'foreign organization named in product or partner context';
  if (/sloane[-_\s]*logo[-_\s]*2\.webp/i.test(url)) return 'photographic avatar mislabeled as logo';

  if (portraitBodyPhoto(item, companyName)) return 'portrait or team-member body photo';

  const ratio = item.width && item.height ? item.width / item.height : null;
  const rasterBodyImage = ['dom-img', 'dom-picture', 'browser-img'].includes(item.source) && !item.scalable &&
    item.evidence?.dom_region === 'body' && !item.evidence?.home_linked;
  const explicitBrandAsset = /(?:logo|wordmark|brandmark|logomark)/i.test(`${semantic} ${url}`) && !/logo[-_\s]*editor/i.test(semantic);
  if (item.evidence?.dom_region === 'body' && !item.evidence?.home_linked && !item.evidence?.positive_token && ratio >= 0.72 && ratio <= 1.4 && !explicitBrandAsset && ['dom-img', 'dom-picture', 'browser-img'].includes(item.source)) return 'unlinked square body illustration';
  if (rasterBodyImage && ratio >= 0.72 && ratio <= 1.4 && !explicitBrandAsset) return 'unlinked square body image';
  if (item.evidence?.dom_region === 'body' && !item.evidence?.home_linked && !item.evidence?.positive_token && !explicitBrandAsset && /(?:^|[-_\s])hero(?:$|[-_\s])/i.test(`${semantic} ${url}`)) return 'hero image';
  if (rasterBodyImage && /(?:app[-_\s]*demo|screenshot|dashboard|mockup|hero[-_\s]*photo|homepage[-_\s]*hero|adobestock|main[-_\s]*story[-_\s]*image|cover__image-background|picture of (?:a|an|the)|inbox with uploaded|logo[-_\s]*(?:editor|color[-_\s]*selection)|editable[-_\s]*brand[-_\s]*palette)/i.test(`${semantic} ${url}`)) return 'body content image';
  if (/(?:product[-_\s]*image|featured[-_\s]*products)/i.test(`${semantic} ${url}`)) return 'product image';
  if (ratio >= 1.8 && ratio <= 2.1 && /(?:^|[\/_-])og[-_\s]*default(?:[.\/_-]|$)/i.test(url) && !explicitBrandAsset) return 'default social-card image';
  if (item.source === 'schema' && /(?:^|[\/_-])og[-_\s]*image(?:[.\/_-]|$)/i.test(url) && !explicitBrandAsset) return 'generic social-card image';

  const alt = String(item.evidence?.alt ?? '').toLowerCase();
  const matchesCompanyPrefix = word => [...companyWords].some(companyWord => word.length >= 4 && (companyWord.startsWith(word) || word.startsWith(companyWord)));
  const namedLogo = /(?:^|[^a-z0-9])logos?(?:[^a-z0-9]|$)/i.test(`${alt} ${url}`) && normalizedWords(alt).some(word =>
    word.length >= 3 && !companyWords.has(word) && !matchesCompanyPrefix(word) && !['logo', 'icon', 'brand', 'header', 'footer', 'light', 'dark', 'white', 'black', 'mode'].includes(word));
  // ponytail: same-origin placed header/nav marks with a positive token are first-party even when
  // the alt text names some other word; only withhold foreign-hosted or unplaced look-alikes.
  const placedFirstParty = item.evidence?.positive_token && ['header', 'nav'].includes(item.evidence?.dom_region) && sameOriginAsset(item);
  if (!item.evidence?.home_linked && !placedFirstParty && namedLogo && !companyAgreement(item, companyName || item.evidence?.company_name)) return 'foreign named logo';
  return null;
}

export function hasWideEvidence(item, companyName = '') {
  const placedLogo = Boolean(item.evidence?.home_linked || (item.evidence?.positive_token && ['header', 'nav'].includes(item.evidence?.dom_region)));
  const deepOfficial = item.evidence?.deep_official && (Number(item.evidence?.archive_score) >= 40 || companyAgreement(item, companyName || item.evidence?.company_name));
  const spaLiteral = item.source === 'spa-bundle' && item.evidence?.spa_bundle_entry && item.evidence?.same_origin && item.evidence?.strong_logo_filename && item.evidence?.spa_identity_agreement;
  return AUTHORITATIVE_SOURCES.includes(item.source) || (item.source === 'wikimedia-commons' && item.evidence?.wikidata_identity_verified === true) || companyAgreement(item, companyName || item.evidence?.company_name) || placedLogo || firstPartyPlacedLogoPath(item) || deepOfficial || spaLiteral;
}

const CLIPPING_PRONE_SOURCES = new Set([
  'dom-img', 'dom-picture', 'browser-img', 'browser-picture', 'jina-screenshot',
  'html-icon', 'root-favicon', 'google-favicon', 'duckduckgo-favicon',
]);

function clippingAssessment(item) {
  const quality = item.tinySuitability;
  const opposing = quality?.opposing_edge_contacts;
  const box = quality?.foreground_box;
  const canvasAspect = item.width && item.height ? item.width / item.height : 1;
  // The sampler stretches every source to 32x32. Restore the source aspect so the
  // measured box describes artwork geometry in the original canvas coordinates.
  const aspect = Number(box?.aspect_ratio) * canvasAspect;
  const squareCanvas = canvasAspect >= 0.72 && canvasAspect <= 1.4;
  const horizontalContact = squareCanvas && opposing?.horizontal === true;
  const verticalContact = squareCanvas && opposing?.vertical === true;
  const horizontal = horizontalContact && aspect >= 1.8;
  const vertical = verticalContact && aspect > 0 && aspect <= 1 / 1.8;
  const opposingElongated = horizontal || vertical;
  const semantic = `${item.url ?? ''} ${item.evidence?.alt ?? ''} ${item.evidence?.aria_label ?? ''} ${item.evidence?.class ?? ''}`;
  const wordmarkEvidence = /wordmark|word[-_\s]*mark|logotype/i.test(semantic);
  const clippingProneSource = CLIPPING_PRONE_SOURCES.has(item.source) || FAVICON_SOURCES.includes(item.source) || /screenshot|favicon/i.test(item.source ?? '');
  const lowResolution = Boolean(item.width && item.height && Math.min(item.width, item.height) < 96);
  let risk = opposingElongated ? 0.55 : 0;
  const wordmarkCrop = wordmarkEvidence && ((horizontalContact && aspect >= 1.15) || (verticalContact && aspect <= 1 / 1.15));
  if (wordmarkCrop) risk += 0.55;
  // Opposing edges are common in deliberate infinity, wing, and ribbon app marks. Source and
  // resolution only strengthen an explicit wordmark crop enough to turn suspicion into a veto.
  if (wordmarkCrop && clippingProneSource) risk += 0.25;
  else if (opposingElongated && clippingProneSource) risk += 0.1;
  if (wordmarkCrop && lowResolution) risk += 0.1;
  else if (opposingElongated && lowResolution) risk += 0.05;
  risk = Math.min(1, risk);
  return {
    risk,
    likely_clipped: risk >= 0.75,
    axis: horizontal || (wordmarkCrop && horizontalContact) ? 'horizontal' : vertical || wordmarkCrop ? 'vertical' : null,
    measured_content_aspect_ratio: Number.isFinite(aspect) ? aspect : null,
    wordmark_evidence: wordmarkEvidence,
    clipping_prone_source: clippingProneSource,
  };
}

export function scoreCandidate(item, { companyName = '' } = {}) {
  const reasons = [];
  const add = (label, points) => { reasons.push(`${label} ${points >= 0 ? '+' : ''}${points}`); return points; };
  let confidence = add(`source:${item.source}`, SOURCE_WEIGHT[item.source] ?? 0);
  if (item.evidence?.positive_token || /logo|brand|wordmark/i.test(item.url)) confidence += add('logo semantic', 15);
  if (item.evidence?.dom_region === 'header' || item.evidence?.dom_region === 'nav') confidence += add(`${item.evidence.dom_region} placement`, 18);
  if (item.evidence?.home_linked) confidence += add('home linked', 12);
  const agreesWithCompany = companyAgreement(item, companyName || item.evidence?.company_name);
  const genericReason = genericAssetReason(item, companyName);
  if (agreesWithCompany) confidence += add('company agreement', 12);
  if (exactCompanyLabel(item, companyName)) confidence += add('exact company label', 6);
  if (item.evidence?.negative_context) confidence += add('negative context', -35);
  if (genericReason) confidence += add(`generic exclusion (${genericReason})`, -100);
  if (item.source === 'social-banner') confidence += add('banner exclusion', -30);
  if (item.highResolution) confidence += add('adequate resolution', 8);
  if (item.scalable) confidence += add('vector', 7);
  if (item.evidence?.theme === 'color') confidence += add('color variant', 3);
  else if (item.evidence?.theme === 'unknown' && ['official-archive', 'spa-bundle'].includes(item.source)) confidence += add('default variant', 2);
  if (item.width && item.height && Math.min(item.width, item.height) < 32) confidence += add('tiny edge', -15);

  const ratio = item.width && item.height ? item.width / item.height : null;
  const square = ratio != null && ratio >= 0.72 && ratio <= 1.4;
  const faviconSource = FAVICON_SOURCES.includes(item.source);
  const authoritativeSource = AUTHORITATIVE_SOURCES.includes(item.source);
  const externallyVerifiedIdentity = item.source === 'wikimedia-commons' && item.evidence?.wikidata_identity_verified === true;
  const contentRatio = item.contentBox?.width > 0 && item.contentBox?.height > 0 ? item.contentBox.width / item.contentBox.height : null;
  const wideRatio = contentRatio ?? ratio;
  const strongWideEvidence = Boolean(item.evidence?.home_linked || (['header', 'nav'].includes(item.evidence?.dom_region)) || authoritativeSource);
  // ponytail: padded wordmarks ship on square canvases; trust the measured content box and a
  // relaxed 1.45 bound only when first-party placement or authoritative metadata backs it.
  const wideRelaxed = ratio != null && ratio >= 1.45 && ratio < 1.8 &&
    item.width >= 120 && Math.min(item.width, item.height) >= 36 && strongWideEvidence;
  const wide = (wideRatio != null && wideRatio >= 1.8 && (wideRatio <= 12 || wideRatio <= 14 && strongWideEvidence)) || wideRelaxed;
  const paddedWordmark = contentRatio != null && contentRatio >= 1.8 && ratio != null && ratio < 1.8;
  // BIMI profile conformance is not verified, so canonical icon admission must
  // fail closed unless the rendered artwork itself was measured as icon-shaped.
  const bimiIconShapeOk = item.source !== 'bimi' || (contentRatio != null && contentRatio < 1.8 && square);
  const placedLogo = Boolean(item.evidence?.home_linked || (item.evidence?.positive_token && ['header', 'nav'].includes(item.evidence?.dom_region)));
  const safeContext = !item.evidence?.negative_context && !genericReason;
  const usableIconSize = !item.width || !item.height || Math.min(item.width, item.height) >= 32 || (item.scalable && (item.evidence?.positive_token || agreesWithCompany));
  const clipping = clippingAssessment(item);
  if (clipping.likely_clipped) confidence += add('likely clipped artwork', -55);
  // Ambiguous contact must neither remove eligibility nor outweigh a useful resolution gain.
  else if (clipping.risk >= 0.5) add('possible edge clipping (ranking only)', -3);
  const roleEligible = role => !Array.isArray(item.evidence?.eligible_roles) || item.evidence.eligible_roles.includes(role);
  const icon = round(confidence + (square ? add('square shape', 28) : add('non-square icon', -12)) + (faviconSource ? 5 : 0));
  const wideScore = round(confidence + (wide ? add(contentRatio != null ? 'wide shape (content box)' : 'wide shape', 30) : add('non-wide shape', -18)) + (faviconSource ? -18 : 0));
  const favicon = round(confidence + (faviconSource ? add('favicon source', 28) : add('non-favicon source', -22)) + (square ? 8 : 0));
  const role_scores = { icon, wide: wideScore, favicon };
  const score = Math.max(...Object.values(role_scores));
  const predicted_roles = [
    ...(roleEligible('icon') && icon >= 35 && safeContext && usableIconSize && (square || ratio == null) &&
      bimiIconShapeOk && !clipping.likely_clipped && (faviconSource || authoritativeSource || externallyVerifiedIdentity || agreesWithCompany || placedLogo) ? ['icon'] : []),
    ...(roleEligible('wide') && wideScore >= 35 && safeContext && !clipping.likely_clipped && (wide || ratio == null) && hasWideEvidence(item, companyName) ? ['wide'] : []),
    ...(favicon >= 35 && faviconSource && !clipping.likely_clipped ? ['favicon'] : []),
  ];
  return { ...item, variant: describeAssetVariant(item), padded_wordmark: paddedWordmark, bimi_icon_shape_ok: bimiIconShapeOk, clipping, role_scores, predicted_roles, score, score_reasons: [...new Set(reasons)], confidence_band: score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low' };
}

const ICON_FALLBACK_MIN_EDGE = 14;
const ICON_MIN_FOREGROUND_OCCUPANCY = 0.015;
const ICON_MIN_BOX_OCCUPANCY = 0.08;
const ICON_MIN_SURFACE_CONTRAST = 0.08;

function iconQualityRejections(candidate, preferences = {}) {
  const quality = candidate.tinySuitability;
  if (!quality) return [];
  const reasons = [];
  if (Number.isFinite(quality.foreground_occupancy) && quality.foreground_occupancy < ICON_MIN_FOREGROUND_OCCUPANCY) reasons.push('negligible foreground occupancy');
  if (Number.isFinite(quality.box_occupancy) && quality.box_occupancy < ICON_MIN_BOX_OCCUPANCY) reasons.push('visible content box is too small');
  const requestedSurface = preferences?.theme;
  const contrasts = quality.surface_contrast;
  if (quality.canvas_background === 'transparent' && contrasts && (requestedSurface === 'light' || requestedSurface === 'dark')) {
    if ((Number(contrasts[requestedSurface]) || 0) < ICON_MIN_SURFACE_CONTRAST) reasons.push(`insufficient contrast on ${requestedSurface} surface`);
  } else if (quality.canvas_background === 'transparent' && contrasts && Math.max(Number(contrasts.light) || 0, Number(contrasts.dark) || 0) < ICON_MIN_SURFACE_CONTRAST) {
    reasons.push('insufficient contrast on light and dark surfaces');
  }
  return reasons;
}

function iconUsable(candidate, preferences) {
  return iconQualityRejections(candidate, preferences).length === 0;
}

function iconSizeBonus(candidate) {
  if (!FAVICON_SOURCES.includes(candidate.source)) return 0;
  const edge = Math.min(Number(candidate.width) || Infinity, Number(candidate.height) || Infinity);
  return edge >= 180 ? 8 : edge >= 96 ? 4 : 0;
}

function nearDimensions(a, b) {
  const near = (x, y) => Math.abs(x - y) <= Math.max(4, 0.12 * Math.max(x, y));
  return near(Number(a?.width) || 0, Number(b?.width) || 0) && near(Number(a?.height) || 0, Number(b?.height) || 0);
}

export function iconEffectiveScore(candidate) {
  return (candidate.role_scores?.icon ?? 0) - (candidate.padded_wordmark ? 40 : 0) - (candidate.clipping?.risk >= 0.5 && !candidate.clipping?.likely_clipped ? 3 : 0) + iconSizeBonus(candidate);
}

function compareRoleCandidates(a, b, role, preferences) {
  if (role === 'icon' && Boolean(a.padded_wordmark) !== Boolean(b.padded_wordmark)) return a.padded_wordmark ? 1 : -1;
  const requested = preferences[role];
  const preferenceScore = candidate => {
    let score = 0;
    for (const key of ['theme', 'color', 'background']) {
      if (requested[key] === 'any') continue;
      const value = candidate.variant?.[key] ?? 'unknown';
      if (value === requested[key]) score += 2;
      else if (value === 'any') score += 1;
      else if (value !== 'unknown') score -= 2;
    }
    return score;
  };
  const preferenceDifference = preferenceScore(b) - preferenceScore(a);
  if (preferenceDifference) return preferenceDifference;
  if (role === 'icon') return iconEffectiveScore(b) - iconEffectiveScore(a) || b.bytes - a.bytes;
  return (b.role_scores?.wide ?? 0) - (a.role_scores?.wide ?? 0) || b.bytes - a.bytes;
}

function strictPreferenceEligible(candidate, requested) {
  return !requested.strict || matchesRequiredPreferences(candidate, requested);
}

function pickIconCandidate(eligible, allCandidates, preferences, companyName = '') {
  const usable = eligible.filter(candidate => iconUsable(candidate, preferences.icon) && strictPreferenceEligible(candidate, preferences.icon));
  let winner = usable.sort((a, b) => compareRoleCandidates(a, b, 'icon', preferences))[0];
  let decision = { action: 'ranked', reason: 'highest-effective-score', selectedUrl: winner?.url ?? null };
  // Unlinked DOM squares are often page content that happens to carry a strong filename or alt
  // match. When the page also declares a viable icon, prefer that bounded first-party signal.
  // A home-linked DOM mark remains authoritative and is never displaced by this rule.
  if (winner && ['dom-img', 'dom-picture', 'browser-img'].includes(winner.source) && !winner.evidence?.home_linked) {
    const declared = usable.filter(candidate => DECLARED_ICON_SOURCES.has(candidate.source) &&
      Number(candidate.role_scores?.icon) >= DECLARED_ICON_MIN_SCORE)
      .sort((a, b) => compareRoleCandidates(a, b, 'icon', preferences))[0];
    if (declared) {
      const protectedPageMark = likelyFirstPartyPageMark(winner, companyName);
      const corroboration = declaredIconCorroboration(declared, allCandidates, companyName);
      if (!protectedPageMark || corroboration.length) {
        decision = {
          action: 'declared-icon-displaced-page-mark',
          reason: protectedPageMark ? 'declared-icon-corroborated' : 'page-mark-not-corroborated',
          selectedUrl: declared.url, displacedUrl: winner.url, corroboration,
        };
        winner = declared;
      } else {
        decision = {
          action: 'declared-icon-abstained', reason: 'declared-icon-lacks-corroboration',
          selectedUrl: winner.url, rejectedUrl: declared.url, corroboration,
        };
      }
    }
  }
  if (!winner || winner.source !== 'inline-svg') return { winner: winner ?? null, decision };
  const twin = allCandidates.find(candidate => candidate.source === 'browser-inline-svg' &&
    iconUsable(candidate, preferences.icon) && candidate.predicted_roles?.includes('icon') &&
    strictPreferenceEligible(candidate, preferences.icon) &&
    !candidate.score_reasons?.some(reason => reason.startsWith('generic exclusion')) &&
    nearDimensions(candidate, winner));
  if (!twin || iconEffectiveScore(twin) < iconEffectiveScore(winner) - 5) return { winner, decision };
  return { winner: twin, decision: { action: 'rendered-twin-selected', reason: 'rendered-inline-svg-corroboration', selectedUrl: twin.url, displacedUrl: winner.url } };
}

function genericApplicationIcon(item) {
  try {
    const filename = decodeURIComponent(new URL(item.resolvedUrl ?? item.resolved_url ?? item.url).pathname).split('/').pop() ?? '';
    return /^(?:app|application)[-_]?(?:ico|icon)(?:[-_.]|$)/i.test(filename);
  } catch {
    return false;
  }
}

function corporateIconEvidence(candidate, companyName) {
  return Boolean(candidate.evidence?.home_linked || exactCompanyLabel(candidate, companyName) ||
    AUTHORITATIVE_SOURCES.includes(candidate.source));
}

function likelyFirstPartyPageMark(candidate, companyName) {
  return ['dom-img', 'dom-picture', 'browser-img'].includes(candidate?.source) &&
    ['header', 'nav'].includes(candidate.evidence?.dom_region) &&
    Boolean(candidate.evidence?.positive_token || companyAgreement(candidate, companyName) || exactCompanyLabel(candidate, companyName));
}

function declaredIconCorroboration(candidate, candidates, companyName) {
  const evidence = [];
  if (exactCompanyLabel(candidate, companyName)) evidence.push('exact-company-label');
  else if (companyAgreement(candidate, companyName)) evidence.push('company-name-agreement');
  const requested = companyWords(companyName);
  const manifestAgreement = (candidate.evidence?.manifest_names ?? []).some(name => {
    const manifest = companyWords(name);
    return requested.length > 0 && manifest.length === requested.length && manifest.every((word, index) => word === requested[index]);
  });
  if (manifestAgreement) evidence.push('manifest-name-agreement');
  if (candidates.some(other => other !== candidate && other.family_id === candidate.family_id &&
    other.predicted_roles?.includes('icon') && !other.icon_quality_rejections?.length &&
    (corporateIconEvidence(other, companyName) || likelyFirstPartyPageMark(other, companyName)))) evidence.push('corporate-family-match');
  return evidence;
}

function shouldAbstainFromApplicationIcon(winner, candidates, companyName) {
  if (!winner || !DECLARED_ICON_SOURCES.has(winner.source) || winner.evidence?.home_linked ||
    !genericApplicationIcon(winner) || exactCompanyLabel(winner, companyName)) return false;
  const sameFamilyCorroborated = candidates.some(candidate => candidate.family_id === winner.family_id &&
    candidate !== winner && corporateIconEvidence(candidate, companyName));
  const otherCorporateIcon = candidates.some(candidate => candidate.family_id !== winner.family_id &&
    candidate.predicted_roles?.includes('icon') && corporateIconEvidence(candidate, companyName));
  return !sameFamilyCorroborated && !otherCorporateIcon;
}

function roleScore(candidate, role) {
  return Number(candidate?.role_scores?.[role === 'logo' ? 'wide' : role]) || 0;
}

function roleCertainty(candidate, role) {
  const score = roleScore(candidate, role);
  return { score, band: score >= 70 ? 'high' : score >= ROLE_VARIANT_MIN_SCORE ? 'medium' : 'low' };
}

function variantSignature(candidate) {
  const variant = candidate?.variant ?? describeAssetVariant(candidate ?? {});
  return ['theme', 'color', 'background'].map(key => `${key}:${variant[key] ?? 'unknown'}`).join('|');
}

function buildRoleVariants(role, selected, candidates, preferences) {
  if (!selected) return [];
  const ranked = candidates
    .filter(candidate => candidate.predicted_roles?.includes(role === 'logo' ? 'wide' : role) &&
      strictPreferenceEligible(candidate, preferences[role]) &&
      !(role === 'icon' && candidate.padded_wordmark) && roleScore(candidate, role) >= ROLE_VARIANT_MIN_SCORE)
    .sort((a, b) => compareRoleCandidates(a, b, role, preferences));
  const ordered = [selected, ...ranked];
  const seenAssets = new Set();
  const seenVariants = new Set();
  const result = [];
  for (const candidate of ordered) {
    const assetKey = candidate.family_id ?? candidate.dataUrl ?? candidate.resolvedUrl ?? candidate.resolved_url ?? candidate.url;
    const signature = variantSignature(candidate);
    if (!assetKey || seenAssets.has(assetKey) || seenVariants.has(signature)) continue;
    seenAssets.add(assetKey);
    seenVariants.add(signature);
    result.push({ ...candidate, certainty: roleCertainty(candidate, role) });
  }
  return result;
}

export function rankCandidates(items, options = {}) {
  const preferences = normalizeAssetPreferences(options.preferences);
  const ranked = items.map(item => {
    const scored = scoreCandidate(item, options);
    const icon_quality_rejections = iconQualityRejections(scored, preferences.icon);
    return { ...scored, icon_quality_rejections,
      score_reasons: [...scored.score_reasons, ...icon_quality_rejections.map(reason => `icon quality rejected: ${reason}`)] };
  }).sort((a, b) => b.score - a.score || b.bytes - a.bytes);
  const { candidates, assetFamilies } = buildAssetFamilies(ranked);
  const eligible = candidates.filter(item => item.source !== 'social-banner');
  const selectedByRole = Object.fromEntries(['icon', 'wide'].map(role => [role, [...eligible].filter(item => item.predicted_roles.includes(role) &&
    strictPreferenceEligible(item, preferences[role === 'wide' ? 'logo' : role])).sort((a, b) => {
    return compareRoleCandidates(a, b, role === 'wide' ? 'logo' : role, preferences);
  })[0] ?? null]));
  let iconSelection = pickIconCandidate(eligible.filter(item => item.predicted_roles.includes('icon')), candidates, preferences, options.companyName);
  selectedByRole.icon = iconSelection.winner;
  const applicationIconAbstention = shouldAbstainFromApplicationIcon(selectedByRole.icon, candidates, options.companyName);
  if (applicationIconAbstention) {
    iconSelection = { winner: null, decision: { action: 'icon-abstained', reason: 'uncorroborated-generic-application-icon', rejectedUrl: selectedByRole.icon.url } };
    selectedByRole.icon = null;
  }
  if (!selectedByRole.icon && !applicationIconAbstention) {
    // A favicon-role candidate is the bounded fallback for the canonical icon when no true icon
    // candidate qualifies. Prefer the asset intended for favicon use, not an arbitrary source.
    const fallback = eligible.filter(item => item.predicted_roles.includes('favicon') &&
      iconUsable(item, preferences.icon) &&
      strictPreferenceEligible(item, preferences.icon) &&
      item.bimi_icon_shape_ok !== false &&
      Math.min(Number(item.width) || Infinity, Number(item.height) || Infinity) >= ICON_FALLBACK_MIN_EDGE)
      .sort((a, b) => faviconRankScore(b) - faviconRankScore(a) || b.bytes - a.bytes)[0];
    if (fallback) {
      selectedByRole.icon = fallback;
      iconSelection = { winner: fallback, decision: { action: 'favicon-fallback-selected', reason: 'no-qualified-icon', selectedUrl: fallback.url } };
    }
  }
  if (selectedByRole.icon?.source === 'inline-svg') {
    iconSelection = pickIconCandidate([selectedByRole.icon], candidates, preferences, options.companyName);
    selectedByRole.icon = iconSelection.winner;
  }
  // Legacy API/CLI consumers still receive the independently ranked best favicon. It does not
  // participate in the canonical `assets` model, whose only roles are icon and logo.
  selectedByRole.favicon = eligible.filter(item => item.predicted_roles.includes('favicon'))
    .sort((a, b) => faviconRankScore(b) - faviconRankScore(a) || b.bytes - a.bytes)[0] ?? null;
  const assets = { icon: selectedByRole.icon, logo: selectedByRole.wide };
  const preferenceMatch = Object.fromEntries(['icon', 'logo'].map(role => {
    const selected = assets[role];
    if (!selected) return [role, 'unmatched'];
    const exact = preferences[role].strict
      ? strictPreferenceEligible(selected, preferences[role])
      : ['theme', 'color', 'background'].every(key => {
          const value = selected.variant?.[key] ?? 'unknown';
          return preferences[role][key] === 'any' || value === preferences[role][key] || value === 'any';
        });
    return [role, exact ? 'exact' : 'fallback'];
  }));
  const assetVariants = {
    icon: buildRoleVariants('icon', assets.icon, candidates, preferences),
    logo: buildRoleVariants('logo', assets.logo, candidates, preferences),
  };
  return {
    candidates, assetFamilies, assets, assetVariants,
    variantPolicy: { minimumRoleScore: ROLE_VARIANT_MIN_SCORE },
    preferences, preferenceMatch, selectedByRole, selected: assets.icon ?? assets.logo ?? null,
    diagnostics: { iconSelection: iconSelection.decision },
  };
}

export function faviconRankScore(candidate) {
  const edge = Math.min(Number(candidate.width) || Infinity, Number(candidate.height) || Infinity);
  const intendedSize = edge <= 64 ? 40 : edge <= 128 ? 25 : edge <= 256 ? 10 : 0;
  const iconAgreement = candidate.predicted_roles?.includes('icon') ? 8 : 0;
  const sourceTie = candidate.source === 'html-icon' ? 1 : 0;
  const pixelSuitability = Number.isFinite(candidate.tinySuitability?.score) ? candidate.tinySuitability.score : 0;
  return intendedSize + 0.6 * pixelSuitability + iconAgreement + sourceTie + 0.01 * (candidate.role_scores?.favicon ?? 0);
}

function familyShape(item) {
  const ratio = item.contentBox?.width > 0 && item.contentBox?.height > 0
    ? item.contentBox.width / item.contentBox.height
    : item.width && item.height ? item.width / item.height : null;
  if (ratio == null) return 'unknown';
  if (ratio >= 1.8) return 'wide';
  if (ratio >= 0.72 && ratio <= 1.4) return 'square';
  return 'other';
}

function familyKey(item, index) {
  const value = item.resolvedUrl ?? item.resolved_url ?? item.url;
  if (!value || String(value).startsWith('data:')) return `unique:${index}`;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return `unique:${index}`;
    url.hash = '';
    for (const name of [...url.searchParams.keys()]) {
      if (DELIVERY_QUERY_PARAMS.has(name.toLowerCase())) url.searchParams.delete(name);
    }
    url.pathname = url.pathname
      .replace(/\/:\/rs=[^/]+/gi, '')
      .replace(/([_-])\d{2,4}x\d{2,4}(?=\.[a-z0-9]+$)/i, '')
      .replace(/@(?:2|3)x(?=\.[a-z0-9]+$)/i, '');
    return `${familyShape(item)}:${url.href}`;
  } catch {
    return `unique:${index}`;
  }
}

export function buildAssetFamilies(items) {
  const groups = new Map();
  const candidates = items.map((item, index) => {
    const key = familyKey(item, index);
    let group = groups.get(key);
    if (!group) {
      group = { id: `family-${groups.size + 1}`, candidateIndexes: [] };
      groups.set(key, group);
    }
    group.candidateIndexes.push(index);
    return { ...item, family_id: group.id };
  });

  const assetFamilies = [...groups.values()].map(group => {
    const members = group.candidateIndexes.map(index => candidates[index]);
    const roles = [...new Set(members.flatMap(item => item.predicted_roles ?? []))];
    const bestByRole = Object.fromEntries(['icon', 'wide'].map(role => {
      const best = group.candidateIndexes
        .filter(index => candidates[index].predicted_roles?.includes(role))
        .sort((a, b) => (candidates[b].role_scores?.[role] ?? 0) - (candidates[a].role_scores?.[role] ?? 0))[0];
      return [role, best ?? null];
    }));
    bestByRole.favicon = group.candidateIndexes
      .filter(index => candidates[index].predicted_roles?.includes('favicon'))
      .sort((a, b) => faviconRankScore(candidates[b]) - faviconRankScore(candidates[a]))[0] ?? null;
    return {
      id: group.id,
      candidateIndexes: group.candidateIndexes,
      representativeIndex: group.candidateIndexes[0],
      variantCount: group.candidateIndexes.length,
      roles,
      bestByRole,
    };
  });

  return { candidates, assetFamilies };
}

export { RANKING_VERSION, SOURCE_WEIGHT };
