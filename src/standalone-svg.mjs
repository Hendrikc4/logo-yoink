import { Parser } from 'htmlparser2';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\([^)]{1,80}\)|hsla?\([^)]{1,80}\)|[a-z]{3,24})$/i;
const DOCUMENT_DEPENDENT_COLOR = /^(?:currentcolor|inherit|initial|unset|revert(?:-layer)?|var\s*\()/i;

const STATIC_SVG_ELEMENTS = new Set('svg g path rect circle ellipse line polyline polygon defs linearGradient radialGradient stop clipPath mask pattern use title desc'.split(' '));
const STATIC_STYLE_PROPERTIES = new Set('fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity display visibility clip-path clip-rule mask color stop-color stop-opacity'.split(' '));
const SVG11_DOCTYPE = /<!DOCTYPE\s+svg\s+PUBLIC\s+(["'])-\/\/W3C\/\/DTD SVG 1\.1\/\/EN\1\s+(["'])https?:\/\/www\.w3\.org\/Graphics\/SVG\/1\.1\/DTD\/svg11\.dtd\2\s*>/;

/**
 * Remove the inert, canonical SVG 1.1 declaration emitted by older editors.
 * Never load a DTD or resolve entities. Only a static, self-contained subset is
 * eligible; other documents retain the normal validator's fail-closed behavior.
 * This is deliberately separate from standalone normalization and BIMI rules.
 */
export function normalizeLegacySvgDoctype(bytes) {
  const original = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes ?? ''));
  let markup;
  try { markup = new TextDecoder('utf-8', { fatal: true }).decode(original); }
  catch { return null; }
  if (!/<!DOCTYPE/i.test(markup)) return null;
  const declaration = markup.match(SVG11_DOCTYPE);
  if (!declaration) return null;
  const before = markup.slice(0, declaration.index);
  if (!/^\s*(?:<\?xml\s+[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*$/.test(before)) return null;
  const encoding = before.match(/\bencoding\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (encoding && !/^utf-8$/i.test(encoding)) return null;
  markup = before + markup.slice(declaration.index + declaration[0].length);
  if (/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)|@import|\\/i.test(markup)) return null;
  // A canonical external DTD must not supply any non-XML entities to the art.
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(markup)) return null;
  let safe = true, roots = 0, depth = 0;
  const parser = new Parser({
    onopentag(name, attributes) {
      if (!STATIC_SVG_ELEMENTS.has(name)) safe = false;
      if (depth++ === 0 && (++roots !== 1 || name !== 'svg')) safe = false;
      for (const [key, value] of Object.entries(attributes)) {
        if (/^on/i.test(key) || key === 'xml:base') safe = false;
        if (key === 'xmlns' && value !== SVG_NAMESPACE) safe = false;
        if (key === 'xmlns:xlink' && value !== 'http://www.w3.org/1999/xlink') safe = false;
        if (key.includes(':') && !['xlink:href', 'xml:space'].includes(key) && !key.startsWith('xmlns:')) safe = false;
        if (/(?:^|:)href$/i.test(key) && !/^#[A-Za-z_][\w:.-]*$/.test(value.trim())) safe = false;
        if (/[\\@]/.test(value) || /\/\*/.test(value)) safe = false;
        const withoutLocalUrls = value.replace(/url\(\s*(["']?)#[A-Za-z_][\w:.-]*\1\s*\)/gi, '');
        if (/url\s*\(/i.test(withoutLocalUrls)) safe = false;
        if (key === 'style') {
          for (const rule of value.split(';').filter(rule => rule.trim())) {
            const match = rule.match(/^\s*([\w-]+)\s*:\s*([^{}<>]+)\s*$/);
            if (!match || !STATIC_STYLE_PROPERTIES.has(match[1].toLowerCase())) safe = false;
          }
        }
      }
    },
    onclosetag() { depth--; },
    ontext(value) { if (depth === 0 && value.trim()) safe = false; },
    onerror() { safe = false; },
  }, { xmlMode: true, decodeEntities: true });
  parser.end(markup);
  if (!safe || roots !== 1 || depth !== 0) return null;
  return { bytes: Buffer.from(markup), transformation: 'remove-canonical-svg11-doctype' };
}

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
