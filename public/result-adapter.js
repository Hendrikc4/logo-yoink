export const BRAND_ROLES = Object.freeze([
  Object.freeze({ key: 'icon', label: 'Icon', description: 'Square format for app icons, avatars, browser tabs, and small spaces.' }),
  Object.freeze({ key: 'wide', label: 'Wordmark', description: 'Horizontal logo for headers, navbars, and wide layouts.' }),
]);

export function adaptBrandResults(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const families = Array.isArray(payload?.assetFamilies) ? payload.assetFamilies : [];

  return BRAND_ROLES.map(role => {
    const selected = payload?.selectedByRole?.[role.key] ?? null;
    return {
      ...role,
      selected,
      variants: selected ? collectVariants(selected, candidates, families) : [],
    };
  });
}

export function brandRoleLabel(role) {
  return role === 'wide' ? 'wordmark' : role === 'favicon' ? 'icon' : role;
}

export function describeVariant(item) {
  const labels = [];
  const theme = normalizedValue(
    item?.variant?.theme,
    item?.appearance?.theme,
    item?.theme,
    item?.declared?.theme,
    item?.evidence?.theme,
    singleValue(item?.evidence?.themes),
  );
  const color = normalizedValue(
    item?.variant?.color,
    item?.appearance?.color,
    item?.colorVariant,
  );
  const surface = normalizedValue(
    item?.variant?.surface,
    item?.variant?.transparency,
    item?.appearance?.surface,
    item?.appearance?.transparency,
    item?.surface,
    item?.transparency,
    item?.opacity,
    typeof item?.transparent === 'boolean' ? (item.transparent ? 'transparent' : 'opaque') : null,
    typeof item?.hasAlpha === 'boolean' ? (item.hasAlpha ? 'transparent' : 'opaque') : null,
  );

  if (theme === 'dark') labels.push('For dark');
  if (theme === 'light') labels.push('For light');
  if (theme === 'white' || color === 'white') labels.push('White');
  if (theme === 'black' || color === 'black') labels.push('Black');
  if (surface === 'transparent') labels.push('Transparent');
  if (surface === 'opaque') labels.push('Opaque');
  return labels;
}

function collectVariants(selected, candidates, families) {
  const family = families.find(value => value?.id && value.id === selected.family_id);
  const familyMembers = Array.isArray(family?.candidateIndexes)
    ? family.candidateIndexes.map(index => candidates[index]).filter(Boolean)
    : [];
  // `variants` is the only future-facing UI seam. If the API later returns explicit
  // theme/surface variants, the rendering code does not need to change.
  const explicit = Array.isArray(selected.variants) ? selected.variants.filter(value => value?.dataUrl) : [];
  const matchingExplicit = explicit.find(value => assetKey(value) === assetKey(selected));
  const selectedWithMetadata = matchingExplicit ? { ...selected, ...matchingExplicit } : selected;
  const values = [selectedWithMetadata, ...explicit, ...familyMembers];
  const seen = new Set();
  return values.filter(value => {
    const key = assetKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assetKey(value) {
  return value?.dataUrl ?? value?.resolvedUrl ?? value?.resolved_url ?? value?.url;
}

function singleValue(value) {
  return Array.isArray(value) && value.length === 1 ? value[0] : null;
}

function normalizedValue(...values) {
  const value = values.find(entry => typeof entry === 'string' && entry.trim());
  if (!value) return '';
  const normalized = value.toLowerCase().trim();
  if (['dark', 'reverse', 'reversed', 'on-dark'].includes(normalized)) return 'dark';
  if (['light', 'on-light'].includes(normalized)) return 'light';
  if (['white', 'black'].includes(normalized)) return normalized;
  if (['transparent', 'alpha'].includes(normalized)) return 'transparent';
  if (['opaque', 'solid'].includes(normalized)) return 'opaque';
  return normalized;
}
