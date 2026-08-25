const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\([^)]{1,80}\)|hsla?\([^)]{1,80}\)|[a-z]{3,24})$/i;
const DOCUMENT_DEPENDENT_COLOR = /^(?:currentcolor|inherit|initial|unset|revert(?:-layer)?|var\s*\()/i;

function rootColor(markup, inheritedColor) {
  const root = markup.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const candidates = [
    root.match(/\bcolor\s*=\s*["']([^"']+)["']/i)?.[1],
    root.match(/\bstyle\s*=\s*["'][^"']*\bcolor\s*:\s*([^;"']+)/i)?.[1],
    inheritedColor,
  ];
  return candidates.map(value => String(value ?? '').trim())
    .find(value => SAFE_COLOR.test(value) && !DOCUMENT_DEPENDENT_COLOR.test(value)) ?? '#000000';
}

/** Make accepted SVG markup independent of the HTML document it came from. */
export function normalizeStandaloneSvg(bytes, { inheritedColor } = {}) {
  let markup = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes ?? '');
  const match = markup.match(/<svg\b[^>]*>/i);
  if (!match) return null;
  let root = match[0];
  if (!/\bxmlns\s*=/i.test(root)) root = root.replace(/^<svg\b/i, `<svg xmlns="${SVG_NAMESPACE}"`);
  if (/\bcurrentColor\b/i.test(markup)) {
    const color = rootColor(markup, inheritedColor);
    const attribute = root.match(/\bcolor\s*=\s*(["'])([^"']+)\1/i);
    const style = root.match(/(\bstyle\s*=\s*["'][^"']*\bcolor\s*:\s*)([^;"']+)/i);
    const usableRootColor = [attribute?.[2], style?.[2]].some(value => SAFE_COLOR.test(String(value ?? '').trim()) && !DOCUMENT_DEPENDENT_COLOR.test(String(value).trim()));
    if (attribute && !usableRootColor) root = root.replace(attribute[0], `color="${color}"`);
    else if (style && !usableRootColor) root = root.replace(style[0], `${style[1]}${color}`);
    else if (!usableRootColor) root = root.replace(/>$/, ` color="${color}">`);
  }
  markup = `${markup.slice(0, match.index)}${root}${markup.slice(match.index + match[0].length)}`;
  return Buffer.from(markup);
}
