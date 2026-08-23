const SOURCE_WEIGHT = {
  schema: 30, 'og-logo': 27, microdata: 26, 'inline-svg': 24, 'browser-inline-svg': 24, 'browser-img': 12,
  'browser-css-background': 8, 'dom-img': 10, 'dom-picture': 10, 'noscript-img': 8,
  manifest: 22, apple: 20, 'mask-icon': 20, 'ms-tile': 17, 'html-icon': 16, besticon: 12, 'root-favicon': 5, 'social-banner': -30,
};
const RANKING_VERSION = 1;

function round(value) { return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10; }
function companyAgreement(item, companyName) {
  const company = String(companyName ?? '').toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|company|co)\b\.?/g, ' ').match(/[a-z0-9]+/g) ?? [];
  if (!company.length) return false;
  let path = '';
  try { path = decodeURIComponent(new URL(item.url).pathname); } catch { /* Inline/data candidates have no useful filename. */ }
  const haystack = `${path} ${item.evidence?.alt ?? ''} ${item.evidence?.aria_label ?? ''}`.toLowerCase();
  return company.some(token => token.length >= 3 && haystack.includes(token));
}

export function scoreCandidate(item, { companyName = '' } = {}) {
  const reasons = [];
  const add = (label, points) => { reasons.push(`${label} ${points >= 0 ? '+' : ''}${points}`); return points; };
  let confidence = add(`source:${item.source}`, SOURCE_WEIGHT[item.source] ?? 0);
  if (item.evidence?.positive_token || /logo|brand|wordmark/i.test(item.url)) confidence += add('logo semantic', 15);
  if (item.evidence?.dom_region === 'header' || item.evidence?.dom_region === 'nav') confidence += add(`${item.evidence.dom_region} placement`, 18);
  if (item.evidence?.home_linked) confidence += add('home linked', 12);
  const agreesWithCompany = companyAgreement(item, companyName || item.evidence?.company_name);
  if (agreesWithCompany) confidence += add('company agreement', 12);
  if (item.evidence?.negative_context) confidence += add('negative context', -35);
  if (item.source === 'social-banner') confidence += add('banner exclusion', -30);
  if (item.highResolution) confidence += add('adequate resolution', 8);
  if (item.scalable) confidence += add('vector', 7);
  if (item.width && item.height && Math.min(item.width, item.height) < 32) confidence += add('tiny edge', -15);

  const ratio = item.width && item.height ? item.width / item.height : null;
  const square = ratio != null && ratio >= 0.72 && ratio <= 1.4;
  const wide = ratio != null && ratio >= 1.8 && ratio <= 12;
  const faviconSource = ['manifest', 'apple', 'mask-icon', 'ms-tile', 'html-icon', 'besticon', 'root-favicon'].includes(item.source);
  const authoritativeSource = ['schema', 'og-logo', 'microdata'].includes(item.source);
  const placedLogo = Boolean(item.evidence?.home_linked || (item.evidence?.positive_token && ['header', 'nav'].includes(item.evidence?.dom_region)));
  const safeContext = !item.evidence?.negative_context;
  const usableIconSize = !item.width || !item.height || Math.min(item.width, item.height) >= 32 || (item.scalable && (item.evidence?.positive_token || agreesWithCompany));
  const roleEligible = role => !Array.isArray(item.evidence?.eligible_roles) || item.evidence.eligible_roles.includes(role);
  const icon = round(confidence + (square ? add('square shape', 28) : add('non-square icon', -12)) + (faviconSource ? 5 : 0));
  const wideScore = round(confidence + (wide ? add('wide shape', 30) : add('non-wide shape', -18)) + (faviconSource ? -18 : 0));
  const favicon = round(confidence + (faviconSource ? add('favicon source', 28) : add('non-favicon source', -22)) + (square ? 8 : 0));
  const role_scores = { icon, wide: wideScore, favicon };
  const score = Math.max(...Object.values(role_scores));
  const predicted_roles = [
    ...(roleEligible('icon') && icon >= 35 && safeContext && usableIconSize && (square || ratio == null) && (faviconSource || authoritativeSource || agreesWithCompany || placedLogo) ? ['icon'] : []),
    ...(roleEligible('wide') && wideScore >= 35 && safeContext && (wide || ratio == null) && (authoritativeSource || agreesWithCompany || placedLogo) ? ['wide'] : []),
    ...(favicon >= 35 && faviconSource ? ['favicon'] : []),
  ];
  return { ...item, role_scores, predicted_roles, score, score_reasons: [...new Set(reasons)], confidence_band: score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low' };
}

export function rankCandidates(items, options = {}) {
  const candidates = items.map(item => scoreCandidate(item, options)).sort((a, b) => b.score - a.score || b.bytes - a.bytes);
  const eligible = candidates.filter(item => item.source !== 'social-banner');
  const selectedByRole = Object.fromEntries(['icon', 'wide', 'favicon'].map(role => [role, [...eligible].filter(item => item.predicted_roles.includes(role)).sort((a, b) => b.role_scores[role] - a.role_scores[role] || b.bytes - a.bytes)[0] ?? null]));
  return { candidates, selectedByRole, selected: selectedByRole.icon ?? selectedByRole.wide ?? selectedByRole.favicon ?? null };
}

export { RANKING_VERSION, SOURCE_WEIGHT };
