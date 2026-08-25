import { describeAssetVariant, logoPreferenceScore, normalizeAssetPreferences } from './asset-model.mjs';
import { describesEmbeddedLogo } from './logo-semantics.mjs';

const SOURCE_WEIGHT = {
  schema: 30, 'og-logo': 27, microdata: 26, 'inline-svg': 24, 'browser-inline-svg': 24, 'browser-img': 12,
  'browser-css-background': 8, 'dom-img': 10, 'dom-picture': 10, 'noscript-img': 8,
  manifest: 22, apple: 20, 'mask-icon': 20, 'ms-tile': 17, 'html-icon': 16, 'jina-screenshot': 18, besticon: 12, 'google-favicon': 10, 'duckduckgo-favicon': 9, 'root-favicon': 5, 'social-banner': -30,
};
const RANKING_VERSION = 7;
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
const FAVICON_SOURCES = ['manifest', 'apple', 'mask-icon', 'ms-tile', 'html-icon', 'besticon', 'google-favicon', 'duckduckgo-favicon', 'root-favicon'];
const DECLARED_ICON_SOURCES = new Set(['manifest', 'apple', 'mask-icon', 'ms-tile', 'html-icon', 'google-favicon', 'duckduckgo-favicon', 'root-favicon']);
const DECLARED_ICON_MIN_SCORE = 49;
const PLATFORM_NAMES = ['namecheap', 'matomo', 'piwik', 'wix', 'vercel', 'webflow', 'squarespace', 'shopify', 'godaddy', 'netlify', 'framer'];
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

function normalizedWords(value) {
  return String(value ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
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

export function genericAssetReason(item, companyName = '') {
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
  if (knownHashReason && !knownHashOwners.some(owner => requestedCompanyWords.has(owner))) return knownHashReason;
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
  if (/sloane[-_\s]*logo[-_\s]*2\.webp/i.test(url)) return 'photographic avatar mislabeled as logo';

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
  return AUTHORITATIVE_SOURCES.includes(item.source) || companyAgreement(item, companyName || item.evidence?.company_name) || placedLogo || firstPartyPlacedLogoPath(item) || deepOfficial || spaLiteral;
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
  const contentRatio = item.contentBox?.width > 0 && item.contentBox?.height > 0 ? item.contentBox.width / item.contentBox.height : null;
  const wideRatio = contentRatio ?? ratio;
  const strongWideEvidence = Boolean(item.evidence?.home_linked || (['header', 'nav'].includes(item.evidence?.dom_region)) || authoritativeSource);
  // ponytail: padded wordmarks ship on square canvases; trust the measured content box and a
  // relaxed 1.45 bound only when first-party placement or authoritative metadata backs it.
  const wideRelaxed = ratio != null && ratio >= 1.45 && ratio < 1.8 &&
    item.width >= 120 && Math.min(item.width, item.height) >= 36 && strongWideEvidence;
  const wide = (wideRatio != null && wideRatio >= 1.8 && wideRatio <= 12) || wideRelaxed;
  const paddedWordmark = contentRatio != null && contentRatio >= 1.8 && ratio != null && ratio < 1.8;
  const placedLogo = Boolean(item.evidence?.home_linked || (item.evidence?.positive_token && ['header', 'nav'].includes(item.evidence?.dom_region)));
  const safeContext = !item.evidence?.negative_context && !genericReason;
  const usableIconSize = !item.width || !item.height || Math.min(item.width, item.height) >= 32 || (item.scalable && (item.evidence?.positive_token || agreesWithCompany));
  const roleEligible = role => !Array.isArray(item.evidence?.eligible_roles) || item.evidence.eligible_roles.includes(role);
  const icon = round(confidence + (square ? add('square shape', 28) : add('non-square icon', -12)) + (faviconSource ? 5 : 0));
  const wideScore = round(confidence + (wide ? add(contentRatio != null ? 'wide shape (content box)' : 'wide shape', 30) : add('non-wide shape', -18)) + (faviconSource ? -18 : 0));
  const favicon = round(confidence + (faviconSource ? add('favicon source', 28) : add('non-favicon source', -22)) + (square ? 8 : 0));
  const role_scores = { icon, wide: wideScore, favicon };
  const score = Math.max(...Object.values(role_scores));
  const predicted_roles = [
    ...(roleEligible('icon') && icon >= 35 && safeContext && usableIconSize && (square || ratio == null) && (faviconSource || authoritativeSource || agreesWithCompany || placedLogo) ? ['icon'] : []),
    ...(roleEligible('wide') && wideScore >= 35 && safeContext && (wide || ratio == null) && hasWideEvidence(item, companyName) ? ['wide'] : []),
    ...(favicon >= 35 && faviconSource ? ['favicon'] : []),
  ];
  return { ...item, variant: describeAssetVariant(item), padded_wordmark: paddedWordmark, role_scores, predicted_roles, score, score_reasons: [...new Set(reasons)], confidence_band: score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low' };
}

const ICON_FALLBACK_MIN_EDGE = 14;

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
  return (candidate.role_scores?.icon ?? 0) - (candidate.padded_wordmark ? 40 : 0) + iconSizeBonus(candidate);
}

function pickIconCandidate(eligible, allCandidates) {
  // ponytail: rendered inline SVG twins beat serialized static copies of the same geometry,
  // whose serialization can render blank outside the page.
  let winner = [...eligible].sort((a, b) => iconEffectiveScore(b) - iconEffectiveScore(a) || b.bytes - a.bytes)[0];
  // Unlinked DOM squares are often page content that happens to carry a strong filename or alt
  // match. When the page also declares a viable icon, prefer that bounded first-party signal.
  // A home-linked DOM mark remains authoritative and is never displaced by this rule.
  if (winner && ['dom-img', 'dom-picture', 'browser-img'].includes(winner.source) && !winner.evidence?.home_linked) {
    const declared = eligible.filter(candidate => DECLARED_ICON_SOURCES.has(candidate.source) &&
      Number(candidate.role_scores?.icon) >= DECLARED_ICON_MIN_SCORE)
      .sort((a, b) => iconEffectiveScore(b) - iconEffectiveScore(a) || b.bytes - a.bytes)[0];
    if (declared) winner = declared;
  }
  if (!winner || winner.source !== 'inline-svg') return winner ?? null;
  const twin = allCandidates.find(candidate => candidate.source === 'browser-inline-svg' &&
    !candidate.score_reasons?.some(reason => reason.startsWith('generic exclusion')) &&
    nearDimensions(candidate, winner));
  if (!twin || iconEffectiveScore(twin) < iconEffectiveScore(winner) - 5) return winner;
  return twin;
}

export function rankCandidates(items, options = {}) {
  const preferences = normalizeAssetPreferences(options.preferences);
  const ranked = items.map(item => scoreCandidate(item, options)).sort((a, b) => b.score - a.score || b.bytes - a.bytes);
  const { candidates, assetFamilies } = buildAssetFamilies(ranked);
  const eligible = candidates.filter(item => item.source !== 'social-banner');
  const selectedByRole = Object.fromEntries(['icon', 'wide'].map(role => [role, [...eligible].filter(item => item.predicted_roles.includes(role)).sort((a, b) => {
    if (role === 'wide') {
      const preferenceDifference = logoPreferenceScore(b, preferences) - logoPreferenceScore(a, preferences);
      if (preferenceDifference) return preferenceDifference;
    }
    if (role === 'icon') {
      const iconDifference = iconEffectiveScore(b) - iconEffectiveScore(a);
      if (iconDifference) return iconDifference;
      return b.bytes - a.bytes;
    }
    return b.role_scores[role] - a.role_scores[role] || b.bytes - a.bytes;
  })[0] ?? null]));
  selectedByRole.icon = pickIconCandidate(eligible.filter(item => item.predicted_roles.includes('icon')), candidates);
  if (!selectedByRole.icon) {
    // A favicon-role candidate is the bounded fallback for the canonical icon when no true icon
    // candidate qualifies. Prefer the asset intended for favicon use, not an arbitrary source.
    const fallback = eligible.filter(item => item.predicted_roles.includes('favicon') &&
      Math.min(Number(item.width) || Infinity, Number(item.height) || Infinity) >= ICON_FALLBACK_MIN_EDGE)
      .sort((a, b) => faviconRankScore(b) - faviconRankScore(a) || b.bytes - a.bytes)[0];
    if (fallback) selectedByRole.icon = fallback;
  }
  // Legacy API/CLI consumers still receive the independently ranked best favicon. It does not
  // participate in the canonical `assets` model, whose only roles are icon and logo.
  selectedByRole.favicon = eligible.filter(item => item.predicted_roles.includes('favicon'))
    .sort((a, b) => faviconRankScore(b) - faviconRankScore(a) || b.bytes - a.bytes)[0] ?? null;
  const assets = { icon: selectedByRole.icon, logo: selectedByRole.wide };
  return { candidates, assetFamilies, assets, preferences, selectedByRole, selected: assets.icon ?? assets.logo ?? null };
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
