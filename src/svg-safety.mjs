import { parseDocument } from 'htmlparser2';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const SAFE_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'switch', 'title', 'desc', 'metadata',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'lineargradient', 'radialgradient', 'stop', 'pattern', 'clippath', 'mask',
  'marker', 'filter', 'feblend', 'fecolormatrix', 'fecomponenttransfer',
  'fecomposite', 'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap',
  'fedistantlight', 'fedropshadow', 'feflood', 'fefunca', 'fefuncb', 'fefuncg',
  'fefuncr', 'fegaussianblur', 'feimage', 'femerge', 'femergenode',
  'femorphology', 'feoffset', 'fepointlight', 'fespecularlighting',
  'fespotlight', 'fetile', 'feturbulence', 'image', 'text', 'tspan', 'textpath',
  'style', 'view',
]);
const URL_ATTRIBUTES = new Set(['href', 'xlink:href', 'src']);
const DATA_IMAGE = /^data:image\/(?:png|gif|jpe?g|webp);base64,[a-z0-9+/]+={0,2}$/i;
const SAFE_ATTRIBUTES = new Set(`accent-height alignment-baseline baseline-shift cap-height class clip clip-path clip-rule color color-interpolation color-interpolation-filters color-profile color-rendering cursor cx cy d direction display dominant-baseline dx dy edgeMode elevation enable-background fill fill-opacity fill-rule filter filterUnits flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight fx fy glyph-name glyph-orientation-horizontal glyph-orientation-vertical gradientTransform gradientUnits height href id image-rendering in in2 intercept k k1 k2 k3 k4 kernelMatrix kernelUnitLength letter-spacing lighting-color limitingConeAngle marker-end marker-mid marker-start markerHeight markerUnits markerWidth mask maskContentUnits maskUnits mode numOctaves offset opacity operator order orient orientation origin overflow paint-order pathLength patternContentUnits patternTransform patternUnits pointer-events points preserveAlpha preserveAspectRatio primitiveUnits r radius refX refY rendering-intent result role rotate rx ry scale seed shape-rendering slope spacing specularConstant specularExponent spreadMethod stdDeviation stitchTiles stop-color stop-opacity stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width style surfaceScale systemLanguage tableValues targetX targetY text-anchor text-decoration text-rendering transform transform-origin type unicode-bidi vector-effect version viewBox visibility width word-spacing writing-mode x x1 x2 xChannelSelector xlink:href xml:space xmlns xmlns:xlink y y1 y2 yChannelSelector z zoomAndPan`.split(/\s+/).map(value => value.toLowerCase()));
const SAFE_CSS_PROPERTIES = new Set(`alignment-baseline baseline-shift clip clip-path clip-rule color color-interpolation color-interpolation-filters color-rendering direction display dominant-baseline fill fill-opacity fill-rule filter flood-color flood-opacity font-family font-size font-stretch font-style font-variant font-weight letter-spacing lighting-color marker-end marker-mid marker-start mask opacity overflow paint-order pointer-events shape-rendering stop-color stop-opacity stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering transform transform-origin unicode-bidi vector-effect visibility word-spacing writing-mode`.split(/\s+/));

function strictlyWellFormed(markup) {
  const stack = [];
  let roots = 0;
  let xmlDeclaration = false;
  for (let index = 0; index < markup.length;) {
    if (markup[index] !== '<') {
      const end = markup.indexOf('<', index);
      const text = markup.slice(index, end < 0 ? markup.length : end);
      if (!stack.length && text.trim()) return false;
      index = end < 0 ? markup.length : end; continue;
    }
    if (markup.startsWith('<!--', index)) {
      const end = markup.indexOf('-->', index + 4);
      if (end < 0 || markup.slice(index + 4, end).includes('--')) return false;
      index = end + 3; continue;
    }
    if (markup.startsWith('<![CDATA[', index)) {
      if (!stack.length) return false;
      const end = markup.indexOf(']]>', index + 9);
      if (end < 0) return false;
      index = end + 3; continue;
    }
    if (markup.startsWith('<?', index)) {
      const end = markup.indexOf('?>', index + 2);
      const declaration = markup.slice(index, end + 2);
      if (end < 0 || !/^<\?xml\s+version\s*=\s*(['"])1\.[01]\1(?:\s+encoding\s*=\s*(['"])[A-Za-z][\w.-]*\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*\?>$/.test(declaration) || xmlDeclaration || roots || stack.length) return false;
      xmlDeclaration = true;
      index = end + 2; continue;
    }
    if (markup.startsWith('<!', index)) return false;
    let end = index + 1, quote = null;
    for (; end < markup.length; end += 1) {
      const char = markup[end];
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
      else if (char === '<') return false;
    }
    if (end >= markup.length || quote) return false;
    const tag = markup.slice(index + 1, end).trim();
    const closing = tag.startsWith('/');
    const selfClosing = !closing && /\/$/.test(tag);
    const body = (closing ? tag.slice(1) : selfClosing ? tag.slice(0, -1) : tag).trim();
    const name = /^([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(?:\s|$)/.exec(body)?.[1];
    if (!name || (closing && body !== name)) return false;
    if (!closing) {
      let attributes = body.slice(name.length), offset = 0;
      const names = new Set();
      while (offset < attributes.length) {
        const match = /^\s+([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\s*=\s*(?:"[^"<]*"|'[^'<]*')/.exec(attributes.slice(offset));
        if (!match || names.has(match[1])) return false;
        names.add(match[1]); offset += match[0].length;
      }
    }
    if (closing) { if (stack.pop() !== name) return false; }
    else {
      if (!stack.length) roots += 1;
      if (!selfClosing) { stack.push(name); if (stack.length > 256) return false; }
    }
    index = end + 1;
  }
  return roots === 1 && stack.length === 0;
}

function decodedUrl(value) {
  let result = String(value).trim();
  for (let count = 0; count < 3; count += 1) {
    try { const decoded = decodeURIComponent(result); if (decoded === result) break; result = decoded; }
    catch { break; }
  }
  return result.replace(/[\u0000-\u0020\u007f]+/g, '');
}

function safeReference(value, { allowData = false } = {}) {
  const decoded = decodedUrl(value);
  return decoded === '' || /^#[A-Za-z_][\w:.-]*$/.test(decoded) || (allowData && DATA_IMAGE.test(decoded));
}

function safeCss(value) {
  const css = String(value);
  if (/[\\@<>]|\/\*/.test(css)) return false;
  const declarations = css.includes('{')
    ? css.split('}').filter(part => part.trim()).flatMap(rule => {
      const separator = rule.indexOf('{');
      if (separator < 1 || !/^(?:[.#]?[\w-]+|\*)?(?:\s*,\s*(?:[.#]?[\w-]+|\*))*$/.test(rule.slice(0, separator).trim())) return [null];
      return rule.slice(separator + 1).split(';');
    })
    : css.split(';');
  for (const declaration of declarations) {
    if (declaration == null) return false;
    if (!declaration.trim()) continue;
    const separator = declaration.indexOf(':');
    if (separator < 1) return false;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim();
    if (!SAFE_CSS_PROPERTIES.has(property) || !safeCssValue(propertyValue)) return false;
  }
  return true;
}

function safeCssValue(value) {
  const css = String(value).trim();
  if (!css || /[\\@<>{}]|\/\*/.test(css)) return false;
  const withoutInternalUrls = css.replace(/url\(\s*(['"]?)#[A-Za-z_][\w:.-]*\1\s*\)/gi, '');
  if (/url\s*\(/i.test(withoutInternalUrls)) return false;
  const safeFunctions = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|calc|min|max|clamp|matrix|matrix3d|translate|translatex|translatey|translate3d|scale|scalex|scaley|scale3d|rotate|rotatex|rotatey|rotatez|skew|skewx|skewy|perspective|rect)$/i;
  for (const match of withoutInternalUrls.matchAll(/([a-z][\w-]*)\s*\(/gi)) if (!safeFunctions.test(match[1])) return false;
  return true;
}

/** Validate an SVG as a complete, inert, standalone XML document. */
export function isSafeSvg(bytes) {
  const markup = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes ?? '');
  if (!markup || /[\u0000\uFFFD]/.test(markup) || !strictlyWellFormed(markup)) return false;
  // Validate and return the same UTF-8 interpretation used by the XML policy.
  const encoding = markup.match(/<\?xml\s[^?]*\bencoding\s*=\s*(['"])([^'"]+)\1/i)?.[2];
  if (encoding && !/^(?:utf-8|us-ascii)$/i.test(encoding)) return false;
  // Reject custom entity definitions before parsing can expand or reinterpret them.
  if (/<!DOCTYPE|<!ENTITY/i.test(markup) || /&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[0-9a-f]+);)/i.test(markup)) return false;
  let document;
  try { document = parseDocument(markup, { xmlMode: true, decodeEntities: true }); } catch { return false; }
  const roots = document.children.filter(node => node.type === 'tag');
  if (roots.length !== 1 || roots[0].name !== 'svg') return false;
  let safe = true;
  const pending = [roots[0]];
  while (safe && pending.length) {
    const node = pending.pop();
    if (node.type === 'script') return false;
    if (node.type === 'tag' || node.type === 'style') {
      const name = node.name.toLowerCase();
      if (node.name.includes(':') || !SAFE_ELEMENTS.has(name)) return false;
      for (const [rawName, value] of Object.entries(node.attribs ?? {})) {
        const attribute = rawName.toLowerCase();
        if (/^on/.test(attribute)) return false;
        if (!SAFE_ATTRIBUTES.has(attribute) && !/^(?:aria|data)-[a-z0-9_.:-]+$/.test(attribute)) return false;
        if ((attribute === 'xmlns' && rawName !== 'xmlns') || (attribute === 'xmlns:xlink' && rawName !== 'xmlns:xlink')) return false;
        if (attribute === 'xmlns' && (name !== 'svg' || value !== SVG_NAMESPACE)) return false;
        if (attribute === 'xmlns:xlink' && value !== XLINK_NAMESPACE) return false;
        if (attribute.includes(':') && !['xlink:href', 'xml:space', 'xmlns:xlink'].includes(attribute)) return false;
        if (URL_ATTRIBUTES.has(attribute) && !safeReference(value, { allowData: name === 'image' || name === 'feimage' })) return false;
        if (attribute === 'style' ? !safeCss(value) : !safeCssValue(value)) return false;
      }
      if (name === 'style' && !safeCss((node.children ?? []).map(child => child.data ?? '').join(''))) return false;
    }
    for (const child of node.children ?? []) pending.push(child);
  }
  return safe;
}

export const internals = { strictlyWellFormed, safeReference, safeCss, safeCssValue };
