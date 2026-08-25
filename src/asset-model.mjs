const THEMES = new Set(['any', 'light', 'dark']);
const BACKGROUNDS = new Set(['any', 'transparent', 'opaque']);

export const DEFAULT_ASSET_PREFERENCES = Object.freeze({
  logo: Object.freeze({ theme: 'any', background: 'any' }),
});

export function normalizeAssetPreferences(value) {
  if (value == null) return { logo: { ...DEFAULT_ASSET_PREFERENCES.logo } };
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Preferences must be an object.');
  const preferenceKeys = Object.keys(value);
  if (preferenceKeys.some(key => key !== 'logo')) throw new Error('Only logo preferences are supported.');
  const logo = value.logo ?? {};
  if (typeof logo !== 'object' || Array.isArray(logo)) throw new Error('Logo preferences must be an object.');
  if (Object.keys(logo).some(key => !['theme', 'background'].includes(key))) {
    throw new Error('Logo preferences only support theme and background.');
  }
  const theme = logo.theme ?? 'any';
  const background = logo.background ?? 'any';
  if (!THEMES.has(theme)) throw new Error('Logo theme must be any, light, or dark.');
  if (!BACKGROUNDS.has(background)) throw new Error('Logo background must be any, transparent, or opaque.');
  return { logo: { theme, background } };
}

function inferredTheme(item) {
  const explicit = [
    ...(Array.isArray(item.evidence?.themes) ? item.evidence.themes : []),
    item.evidence?.theme,
  ].filter(value => value === 'light' || value === 'dark');
  const unique = new Set(explicit);
  if (unique.size > 1) return 'any';
  if (unique.size === 1) return [...unique][0];

  const semantic = `${item.url ?? ''} ${item.evidence?.semantic_text ?? ''}`;
  if (/(?:^|[-_\s./])(?:white|ivory|light|reverse|reversed)(?:$|[-_\s./])/i.test(semantic)) return 'dark';
  if (/(?:^|[-_\s./])(?:black|slate|dark)(?:$|[-_\s./])/i.test(semantic)) return 'light';
  return 'unknown';
}

export function describeAssetVariant(item) {
  return {
    theme: inferredTheme(item),
    background: ['transparent', 'opaque'].includes(item.background) ? item.background : 'unknown',
  };
}

export function logoPreferenceScore(item, preferences) {
  const requested = normalizeAssetPreferences(preferences).logo;
  const variant = item.variant ?? describeAssetVariant(item);
  let score = 0;
  for (const key of ['theme', 'background']) {
    if (requested[key] === 'any') continue;
    if (variant[key] === requested[key]) score += 2;
    else if (variant[key] === 'any') score += 1;
    else if (variant[key] !== 'unknown') score -= 2;
  }
  return score;
}

export function matchesLogoPreferences(item, preferences) {
  if (!item) return false;
  const requested = normalizeAssetPreferences(preferences).logo;
  const variant = item.variant ?? describeAssetVariant(item);
  return ['theme', 'background'].every(key =>
    requested[key] === 'any' || variant[key] === requested[key] || variant[key] === 'any');
}
