const THEMES = new Set(['any', 'light', 'dark']);
const COLORS = new Set(['any', 'color', 'white', 'black']);
const BACKGROUNDS = new Set(['any', 'transparent', 'opaque']);
const ROLES = new Set(['icon', 'logo']);

const DEFAULT_ROLE_PREFERENCES = Object.freeze({ theme: 'any', color: 'any', background: 'any' });

export const DEFAULT_ASSET_PREFERENCES = Object.freeze({
  icon: DEFAULT_ROLE_PREFERENCES,
  logo: DEFAULT_ROLE_PREFERENCES,
});

function normalizeRolePreferences(value, label) {
  const preference = value ?? {};
  if (typeof preference !== 'object' || Array.isArray(preference)) throw new Error(`${label} preferences must be an object.`);
  if (Object.keys(preference).some(key => !['theme', 'color', 'background'].includes(key))) {
    throw new Error(`${label} preferences only support theme, color, and background.`);
  }
  const theme = preference.theme ?? 'any';
  const color = preference.color ?? 'any';
  const background = preference.background ?? 'any';
  if (!THEMES.has(theme)) throw new Error(`${label} theme must be any, light, or dark.`);
  if (!COLORS.has(color)) throw new Error(`${label} color must be any, color, white, or black.`);
  if (!BACKGROUNDS.has(background)) throw new Error(`${label} background must be any, transparent, or opaque.`);
  return { theme, color, background };
}

export function normalizeAssetPreferences(value) {
  if (value != null && (typeof value !== 'object' || Array.isArray(value))) throw new Error('Preferences must be an object.');
  const preferences = value ?? {};
  if (Object.keys(preferences).some(key => !ROLES.has(key))) throw new Error('Only icon and logo preferences are supported.');
  return {
    icon: normalizeRolePreferences(preferences.icon, 'Icon'),
    logo: normalizeRolePreferences(preferences.logo, 'Logo'),
  };
}

function semanticText(item) {
  return `${item.url ?? ''} ${item.resolvedUrl ?? item.resolved_url ?? ''} ${item.evidence?.semantic_text ?? ''}`;
}

function inferredTheme(item) {
  const explicit = [
    ...(Array.isArray(item.evidence?.themes) ? item.evidence.themes : []),
    item.evidence?.theme,
  ].filter(value => value === 'light' || value === 'dark');
  const unique = new Set(explicit);
  if (unique.size > 1) return 'any';
  if (unique.size === 1) return [...unique][0];

  const semantic = semanticText(item);
  if (/(?:^|[-_\s./])(?:white|ivory|light|reverse|reversed)(?:$|[-_\s./])/i.test(semantic)) return 'dark';
  if (/(?:^|[-_\s./])(?:black|slate|dark)(?:$|[-_\s./])/i.test(semantic)) return 'light';
  return 'unknown';
}

function inferredColor(item) {
  const explicit = [item.evidence?.color, item.evidence?.theme, item.colorVariant]
    .find(value => ['color', 'white', 'black'].includes(value));
  if (explicit) return explicit;
  const semantic = semanticText(item);
  if (/(?:^|[-_\s./])(?:white|ivory|reverse|reversed)(?:$|[-_\s./])/i.test(semantic)) return 'white';
  if (/(?:^|[-_\s./])(?:black|slate)(?:$|[-_\s./])/i.test(semantic)) return 'black';
  if (/(?:^|[-_\s./])(?:color|colour|fullcolor|full-colou?r)(?:$|[-_\s./])/i.test(semantic)) return 'color';
  return 'unknown';
}

export function describeAssetVariant(item) {
  return {
    theme: inferredTheme(item),
    color: inferredColor(item),
    background: ['transparent', 'opaque'].includes(item.background) ? item.background : 'unknown',
  };
}

export function assetPreferenceScore(item, preferences, role = 'logo') {
  const requested = normalizeAssetPreferences(preferences)[role];
  if (!requested) throw new Error('Asset preference role must be icon or logo.');
  const variant = item.variant ?? describeAssetVariant(item);
  let score = 0;
  for (const key of ['theme', 'color', 'background']) {
    if (requested[key] === 'any') continue;
    if (variant[key] === requested[key]) score += 2;
    else if (variant[key] === 'any') score += 1;
    else if (variant[key] !== 'unknown') score -= 2;
  }
  return score;
}

export function matchesAssetPreferences(item, preferences, role = 'logo') {
  if (!item) return false;
  const requested = normalizeAssetPreferences(preferences)[role];
  if (!requested) return false;
  const variant = item.variant ?? describeAssetVariant(item);
  return ['theme', 'color', 'background'].every(key =>
    requested[key] === 'any' || variant[key] === requested[key] || variant[key] === 'any');
}

// Compatibility exports for integrations that imported the original logo-only helpers.
export function logoPreferenceScore(item, preferences) {
  return assetPreferenceScore(item, preferences, 'logo');
}

export function matchesLogoPreferences(item, preferences) {
  return matchesAssetPreferences(item, preferences, 'logo');
}
