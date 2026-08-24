import { Buffer } from 'node:buffer';
import { isIP } from 'node:net';
import { DomUtils, parseDocument } from 'htmlparser2';

const POSITIVE = /(?:^|[-_\s])(logo|brand|wordmark|identity|masthead)(?:$|[-_\s])/i;
const NEGATIVE = /customer|partner|sponsor|testimonial|payment|app.?store|flag|avatar|badge|award|client/i;
const UI_CONTROL = /(?:^|[-_\s])(hamburger|menu-toggle|toggle-menu|close|search|chevron|arrow|whatsapp|tasks?|translate|language-switcher|button-icon)(?:$|[-_\s])|(?:^|[-_\s])fa-(?:language|magnifying-glass|search|bars|xmark|close|chevron-(?:left|right|up|down)|arrow-(?:left|right|up|down)|whatsapp)(?:$|[-_\s])/i;
const HIGH_INTENT = /(?:^|[^a-z0-9])(brand(?:ing)?|press(?:room|\s+kit)?|media(?:\s+kit)?|news(?:room)?|logo(?:\s+kit)?|visual\s+identity|company)(?:[^a-z0-9]|$)/i;
const CONTEXT_INTENT = /(?:^|[^a-z0-9])(brand(?:ing)?|press(?:room|\s+kit)?|media(?:\s+kit)?|logo(?:\s+kit)?|visual\s+identity)(?:[^a-z0-9]|$)/i;

export function resolveHttpUrl(value, base) {
  try {
    const raw = String(value ?? '').trim();
    if (!raw || /^(?:null|undefined|about:blank|blob:)/i.test(raw) || /(?:^|\/)null(?:[?#].*)?$/i.test(raw)) return null;
    const url = new URL(raw, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isLocalAddress(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

function isLocalAddress(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (!isIP(host)) return false;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  const parts = host.split('.').map(Number);
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

function attrs(node) { return node?.attribs ?? {}; }
function ancestors(node) {
  const output = [];
  for (let current = node?.parent; current; current = current.parent) output.push(current);
  return output;
}
function context(node) {
  const lineage = [node, ...ancestors(node)].filter(DomUtils.isTag);
  const link = lineage.find(item => item.name === 'a');
  const region = lineage.find(item => item.name === 'header' || item.name === 'nav' || item.name === 'footer')?.name ?? 'body';
  const values = lineage.flatMap(item => [attrs(item).id, attrs(item).class, attrs(item)['aria-label'], attrs(item).role]).filter(Boolean);
  return { lineage, link, region, tokens: values.join(' ') };
}
function isHomeLink(value, base) {
  const target = resolveHttpUrl(value, base);
  if (!target) return false;
  const a = new URL(target), b = new URL(base);
  return a.hostname === b.hostname && (a.pathname === '/' || a.pathname === '') && !a.search;
}
function evidence(node, base, order, extra = {}) {
  const a = attrs(node), surroundings = context(node);
  const linkAttributes = attrs(surroundings.link);
  const localSemantic = [a.id, a.class, a.alt, a['aria-label'], a.title, a['data-ux'], linkAttributes.id, linkAttributes.class, linkAttributes['aria-label'], linkAttributes.title].filter(Boolean).join(' ');
  const semantic = [a.id, a.class, a.alt, a['aria-label'], a.title, surroundings.tokens].filter(Boolean).join(' ');
  return {
    element: node.name,
    dom_region: surroundings.region,
    home_linked: Boolean(surroundings.link && isHomeLink(attrs(surroundings.link).href, base)),
    alt: a.alt ?? '',
    aria_label: a['aria-label'] ?? '',
    class_tokens: String(a.class ?? '').split(/\s+/).filter(Boolean),
    semantic_text: semantic,
    positive_token: POSITIVE.test(localSemantic),
    negative_context: NEGATIVE.test(semantic) || UI_CONTROL.test(localSemantic) || surroundings.region === 'footer' && /badge|award|partner/i.test(semantic),
    discovery_order: order,
    ...extra,
  };
}
function makeCandidate(url, source, { sizes = '', type = '', purpose = '', declared = {}, evidence: proof = {}, sourcePage = null } = {}) {
  return { url, source, source_page: sourcePage, sizes: String(sizes ?? ''), type: String(type ?? ''), purpose: String(purpose ?? ''), declared, evidence: proof };
}
function firstSrcset(value, base) {
  return String(value ?? '').split(',').map(part => {
    const [raw, descriptor = ''] = part.trim().split(/\s+/, 2);
    return { url: resolveHttpUrl(raw, base), descriptor };
  }).filter(item => item.url);
}
function dimensions(a) {
  const width = Number.parseFloat(a.width), height = Number.parseFloat(a.height);
  return { width: Number.isFinite(width) ? width : null, height: Number.isFinite(height) ? height : null };
}
function boundedText(node, limit = 600) {
  return DomUtils.textContent(node ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}
function linkEvidence(node, href) {
  const a = attrs(node);
  const lineage = ancestors(node).filter(DomUtils.isTag);
  const container = lineage.find(item => ['article', 'section', 'li'].includes(item.name)) ??
    lineage.find(item => item.name === 'div') ?? node.parent;
  const heading = lineage.flatMap(item => DomUtils.findAll(child => DomUtils.isTag(child) && /^h[1-6]$/.test(child.name), item.children ?? []))[0];
  const anchorText = boundedText(node, 240);
  const surroundingText = boundedText(container, 600);
  const headingText = heading ? boundedText(heading, 160) : '';
  const directText = [anchorText, a['aria-label'], a.title, href].filter(Boolean).join(' ');
  const semanticText = [directText, attrs(node.parent).class, headingText, surroundingText].filter(Boolean).join(' ');
  return { anchor_text: anchorText, aria_label: a['aria-label'] ?? '', title: a.title ?? '', heading: headingText, surrounding_text: surroundingText, semantic_text: semanticText, high_intent: HIGH_INTENT.test(directText) || CONTEXT_INTENT.test(`${headingText} ${surroundingText}`) };
}
function isSelfContainedSvg(markup) {
  if (/<script\b|\bon\w+\s*=|@import\b/i.test(markup)) return false;
  for (const match of markup.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    const value = match[1].trim();
    if (value.startsWith('#')) {
      const id = value.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`\\bid=["']${id}["']`).test(markup)) return false;
    } else if (!value.startsWith('data:')) return false;
  }
  for (const match of markup.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi)) if (!match[1].startsWith('#') && !match[1].startsWith('data:')) return false;
  return true;
}

export function parseHomepage(html, base, { companyName = '', collectDeepLinks = false } = {}) {
  const document = parseDocument(html, { decodeEntities: true, lowerCaseAttributeNames: true });
  const nodes = DomUtils.findAll(DomUtils.isTag, document.children);
  const baseElement = nodes.find(node => node.name === 'base' && attrs(node).href);
  const documentBase = baseElement ? resolveHttpUrl(attrs(baseElement).href, base) ?? base : base;
  const candidates = [], manifests = [], brandPages = [], highIntentLinks = [], entryScripts = [];
  const pageTitle = collectDeepLinks ? boundedText(nodes.find(node => node.name === 'title'), 200) : '';
  let order = 0;
  const add = (url, source, options = {}) => {
    if (!url) return;
    const proof = { ...(options.evidence ?? {}), company_name: companyName || undefined };
    candidates.push(makeCandidate(url, source, { ...options, evidence: proof, sourcePage: base }));
  };

  for (const node of nodes) {
    const a = attrs(node);
    if (node.name === 'link') {
      const rel = String(a.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const url = resolveHttpUrl(a.href, documentBase);
      if (url && rel.includes('manifest')) manifests.push(url);
      if (collectDeepLinks && url && (rel.includes('modulepreload') || rel.includes('preload') && a.as === 'script')) entryScripts.push(url);
      if (url && rel.some(token => token.startsWith('apple-touch-icon'))) add(url, 'apple', { sizes: a.sizes, type: a.type, evidence: evidence(node, documentBase, order++) });
      else if (url && rel.includes('mask-icon')) add(url, 'mask-icon', { sizes: a.sizes, type: a.type, declared: { color: a.color ?? null }, evidence: evidence(node, documentBase, order++) });
      else if (url && (rel.includes('icon') || rel.includes('shortcut'))) add(url, 'html-icon', { sizes: a.sizes, type: a.type, evidence: evidence(node, documentBase, order++) });
    }
    if (collectDeepLinks && node.name === 'script' && a.src) {
      const url = resolveHttpUrl(a.src, documentBase);
      if (url && (String(a.type).toLowerCase() === 'module' || /(?:^|\/)(?:main|app|index)[-.][^/]+\.m?js(?:[?#]|$)/i.test(url))) entryScripts.push(url);
    }
    if (node.name === 'meta') {
      const key = String(a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
      const url = resolveHttpUrl(a.content, documentBase);
      if (url && (key === 'og:logo' || key === 'logo')) add(url, key === 'og:logo' ? 'og-logo' : 'microdata', { evidence: evidence(node, documentBase, order++) });
      if (url && ['og:image', 'twitter:image', 'twitter:image:src'].includes(key)) add(url, 'social-banner', { evidence: evidence(node, documentBase, order++, { banner: true, negative_context: true }) });
      if (url && /msapplication-(?:tileimage|square\d+x\d+logo)/.test(key)) add(url, 'ms-tile', { evidence: evidence(node, documentBase, order++) });
    }
    if (node.name === 'img') {
      const proof = evidence(node, documentBase, order++);
      const itemprop = String(a.itemprop ?? '').toLowerCase();
      const source = itemprop.split(/\s+/).includes('logo') ? 'microdata' : 'dom-img';
      const values = [a.src, a['data-src'], a['data-lazy-src'], a['data-original'], a['data-url']];
      for (const raw of values) add(resolveHttpUrl(raw, documentBase), source, { type: a.type, declared: dimensions(a), evidence: proof });
      for (const name of ['srcset', 'data-srcset', 'data-lazy-srcset']) for (const item of firstSrcset(a[name], documentBase)) add(item.url, source, { declared: { ...dimensions(a), srcset: item.descriptor }, evidence: proof });
    }
    if (node.name === 'source') {
      const picture = ancestors(node).find(item => item.name === 'picture');
      if (picture) for (const name of ['srcset', 'data-srcset']) for (const item of firstSrcset(a[name], documentBase)) add(item.url, 'dom-picture', { type: a.type, declared: { srcset: item.descriptor, media: a.media ?? null }, evidence: evidence(picture, documentBase, order++) });
    }
    if (node.name === 'svg') {
      const proof = evidence(node, documentBase, order++);
      const declared = dimensions(a);
      const largeEnoughHomeMark = proof.home_linked && (!declared.width || !declared.height || Math.min(declared.width, declared.height) >= 32);
      const eligible = !proof.negative_context && (proof.positive_token || largeEnoughHomeMark);
      const markup = eligible ? DomUtils.getOuterHTML(node) : '';
      if (eligible && markup && isSelfContainedSvg(markup)) {
        add(`data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')}`, 'inline-svg', { declared, evidence: proof });
      }
    }
    if (node.name === 'noscript') {
      const nested = parseHomepage(DomUtils.textContent(node), documentBase, { companyName, collectDeepLinks });
      for (const item of nested.candidates.filter(item => ['dom-img', 'dom-picture', 'microdata'].includes(item.source))) candidates.push({ ...item, source: 'noscript-img', evidence: { ...item.evidence, discovery_order: order++ } });
    }
    if (node.name === 'a') {
      const href = resolveHttpUrl(a.href, documentBase);
      const legacyLabel = `${DomUtils.textContent(node)} ${a.href ?? ''}`;
      if (href && /(?:^|[\s/_-])(brand|press|media|newsroom|about|company)(?:$|[\s/?#_-])/i.test(legacyLabel)) {
        const target = new URL(href), origin = new URL(base);
        if (target.hostname === origin.hostname) brandPages.push(href);
      }
      const proof = collectDeepLinks && href ? linkEvidence(node, href) : null;
      if (href && proof?.high_intent) highIntentLinks.push({ url: href, source_page: base, evidence: proof });
    }
  }

  function collectSchemaLogo(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return void node.forEach(collectSchemaLogo);
    const types = (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).filter(Boolean);
    if (types.some(type => /(Organization|Corporation|Business|Brand|NGO)$/i.test(String(type))) && node.logo) {
      for (const value of Array.isArray(node.logo) ? node.logo : [node.logo]) {
        const raw = typeof value === 'string' ? value : value?.contentUrl ?? value?.url;
        add(resolveHttpUrl(raw, documentBase), 'schema', { evidence: { element: 'script', dom_region: 'head', discovery_order: order++, company_name: companyName || undefined } });
      }
    }
    Object.values(node).forEach(collectSchemaLogo);
  }
  for (const node of nodes.filter(item => item.name === 'script' && /application\/ld\+json/i.test(attrs(item).type ?? ''))) {
    try { collectSchemaLogo(JSON.parse(DomUtils.textContent(node).trim())); } catch { /* Publisher JSON-LD is frequently malformed. */ }
  }
  return { candidates, manifests: [...new Set(manifests)], brandPages: [...new Set(brandPages)], highIntentLinks: [...new Map(highIntentLinks.map(item => [item.url, item])).values()], entryScripts: [...new Set(entryScripts)], pageTitle };
}

export const internals = { context, evidence, firstSrcset, isSelfContainedSvg, linkEvidence };
