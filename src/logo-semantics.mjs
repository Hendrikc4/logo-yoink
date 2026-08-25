const MARK = /\b(?:logo|wordmark|brand\s+mark)\b/i;
const LOCATION = /\b(?:in|on|at|inside|corner|center|centre|middle|top|bottom|background|image|photo|shot)\b/i;

/** True when alt text describes a logo embedded in a larger scene or product image. */
export function describesEmbeddedLogo(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  const match = MARK.exec(text);
  if (!match) return false;
  const prefix = text.slice(0, match.index).trim();
  const suffix = text.slice(match.index + match[0].length);
  const narrativePrefix = prefix.includes(',') || (prefix.match(/[a-z0-9]+/gi) ?? []).length >= 4;
  return narrativePrefix && LOCATION.test(suffix);
}
