import { lookup as dnsLookup } from 'node:dns/promises';
import { createBrowserEgressProxy } from './browser-egress-proxy.mjs';
import { canonicalHostname, isIpAddress, isPrivateIp } from './network-safety.mjs';

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_HYDRATION_MS = 700;
// Modern split bundles can require >160 small scripts before the header mounts.
// The independent 12s deadline and 8 MiB declared-transfer cap still apply.
const DEFAULT_MAX_REQUESTS = 300;
const DEFAULT_MAX_TRANSFER_BYTES = 8 * 1024 * 1024;
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
export const HARDENED_CHROMIUM_ARGS = Object.freeze([
  '--disable-quic',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
]);

/**
 * Discover logo candidates that only exist in the rendered DOM.
 *
 * This adapter deliberately does not download or trust candidate bytes. The
 * caller must run returned URLs and inline SVG through the normal validation
 * and sanitisation pipeline before storing, rendering, or serving them.
 */
export async function discoverBrowserLogos(input, options = {}) {
  const startedAt = performance.now();
  const timeoutMs = positiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const deadlineAt = performance.now() + timeoutMs;
  const hydrationMs = Math.min(positiveNumber(options.hydrationMs, DEFAULT_HYDRATION_MS), 3_000);
  const maxRequests = positiveNumber(options.maxRequests, DEFAULT_MAX_REQUESTS);
  const maxTransferBytes = positiveNumber(options.maxTransferBytes, DEFAULT_MAX_TRANSFER_BYTES);
  const diagnostics = {
    status: 'pending',
    browserReused: Boolean(options.browser),
    finalUrl: null,
    requests: 0,
    declaredTransferBytes: 0,
    transferBytes: 0,
    blockedRequests: 0,
    resourceLimitHit: false,
    themesInspected: options.darkMode ? ['light', 'dark'] : ['light'],
    errors: [],
  };

  let browser = options.browser ?? null;
  let ownsBrowser = false;
  let proxy = null;
  let context = null;
  let page = null;
  let budget = { requests: 0, declaredBytes: 0, blocked: 0, limitHit: false };

  try {
    const target = normaliseInput(input);
    proxy = await withinDeadline(
      (options.createEgressProxy ?? createBrowserEgressProxy)({
        lookup: options.lookup,
        connect: options.proxyConnect,
        maxTransferBytes,
        maxConnections: maxRequests,
        timeoutMs: Math.max(1, Math.ceil(deadlineAt - performance.now())),
      }),
      deadlineAt,
      'starting the browser egress proxy',
      boundedClose,
    );
    if (!browser) {
      let playwright;
      try {
        playwright = options.playwright ?? await withinDeadline(
          (options.importPlaywright ?? (() => import('playwright')))(),
          deadlineAt,
          'loading Playwright',
        );
      } catch (error) {
        diagnostics.status = 'unavailable';
        diagnostics.errors.push(`Playwright is unavailable: ${error.message}`);
        return result([], diagnostics, startedAt);
      }
      const chromium = playwright?.chromium ?? playwright?.default?.chromium;
      if (!chromium?.launch) {
        diagnostics.status = 'unavailable';
        diagnostics.errors.push('Playwright does not expose a Chromium launcher.');
        return result([], diagnostics, startedAt);
      }
      const launchOptions = typeof options.launchOptions === 'function'
        ? await withinDeadline(options.launchOptions(), deadlineAt, 'resolving Chromium launch options')
        : options.launchOptions;
      const configuredArgs = [...new Set([...(launchOptions?.args ?? []), ...HARDENED_CHROMIUM_ARGS])];
      browser = await withinDeadline(
        chromium.launch({ headless: true, ...launchOptions, args: configuredArgs }),
        deadlineAt,
        'launching Chromium',
        boundedClose,
      );
      ownsBrowser = true;
    } else {
      // Injected browsers are caller-managed and cannot be retrofitted with
      // process launch flags. Their per-discovery context is still isolated and
      // forced through the validating proxy below.
    }

    if (!browser?.newContext) throw new Error('Browser does not support isolated proxy contexts.');
    context = await withinDeadline(browser.newContext({
      viewport: options.viewport ?? DEFAULT_VIEWPORT,
      ...(options.userAgent ? { userAgent: options.userAgent } : {}),
      serviceWorkers: 'block',
      proxy: { server: proxy.server, bypass: '<-loopback>' },
    }), deadlineAt, 'creating an isolated browser context', boundedClose);
    page = await withinDeadline(context.newPage(), deadlineAt, 'creating a browser page', boundedClose);
    page.setDefaultTimeout?.(timeoutMs);
    page.setDefaultNavigationTimeout?.(timeoutMs);

    await withinDeadline(
      installResourceLimits(context, budget, { maxRequests, maxTransferBytes }),
      deadlineAt,
      'installing browser network limits',
    );

    const remainingMs = Math.max(0, deadlineAt - performance.now());
    const candidates = await withDeadline(async () => {
      await page.emulateMedia?.({ colorScheme: 'light', reducedMotion: 'reduce' });
      const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      diagnostics.httpStatus = response?.status?.() ?? null;
      if (diagnostics.httpStatus >= 400) throw new Error(`Browser homepage returned HTTP ${diagnostics.httpStatus}.`);
      await boundedHydration(page, hydrationMs, timeoutMs);
      diagnostics.finalUrl = page.url?.() ?? target.url;

      let light = await inspectRenderedCandidates(page, {
        theme: 'light',
        company: target.company,
        domain: target.domain,
        headerRetention: options.headerRetention !== false,
      });
      // Some shells reach network-idle between their chunk load and header mount.
      // Retry only an empty observation, within the same overall deadline.
      if (!light.length) {
        await page.waitForTimeout?.(1_500);
        diagnostics.emptyObservationRetried = true;
        light = await inspectRenderedCandidates(page, { theme: 'light', company: target.company, domain: target.domain, headerRetention: options.headerRetention !== false });
      }
      if (!options.darkMode) return light;

      await page.emulateMedia?.({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await boundedHydration(page, Math.min(hydrationMs, 400), timeoutMs);
      const dark = await inspectRenderedCandidates(page, {
        theme: 'dark',
        company: target.company,
        domain: target.domain,
        headerOnly: true,
        headerRetention: options.headerRetention !== false,
      });
      return [...light, ...dark];
    }, remainingMs, () => boundedClose(context));

    Object.assign(diagnostics, {
      status: 'ok',
      requests: budget.requests,
      declaredTransferBytes: budget.declaredBytes,
      transferBytes: proxy.stats.bytes,
      blockedRequests: budget.blocked,
      resourceLimitHit: budget.limitHit || proxy.stats.limitHit,
    });
    const discoveryTrace = {};
    const deduped = dedupeCandidates(candidates, discoveryTrace);
    diagnostics.discovery = discoveryTrace;
    return result(deduped, diagnostics, startedAt);
  } catch (error) {
    diagnostics.status = error?.code === 'LOGO_YOINK_BROWSER_TIMEOUT' ? 'timeout' : 'error';
    diagnostics.errors.push(error.message);
    return result([], diagnostics, startedAt);
  } finally {
    Object.assign(diagnostics, {
      requests: budget.requests,
      declaredTransferBytes: budget.declaredBytes,
      transferBytes: proxy?.stats?.bytes ?? 0,
      blockedRequests: budget.blocked + (proxy?.stats?.blocked ?? 0),
      resourceLimitHit: budget.limitHit || Boolean(proxy?.stats?.limitHit),
    });
    await Promise.all([
      boundedClose(context),
      boundedClose(page),
      ownsBrowser ? boundedClose(browser) : undefined,
      boundedClose(proxy),
    ]);
  }
}

async function installResourceLimits(context, budget, limits) {
  context.on?.('response', response => {
    const length = Number(response.headers?.()['content-length'] ?? 0);
    if (Number.isFinite(length) && length > 0) budget.declaredBytes += length;
    if (budget.declaredBytes > limits.maxTransferBytes) budget.limitHit = true;
  });

  if (!context.route || !context.routeWebSocket) throw new Error('Browser context lacks required network interception APIs.');
  await context.routeWebSocket('**/*', webSocket => webSocket.close());
  await context.route('**/*', async route => {
    budget.requests += 1;
    const request = route.request?.();
    const type = request?.resourceType?.() ?? '';
    const overBudget = budget.requests > limits.maxRequests || budget.declaredBytes > limits.maxTransferBytes;
    const safeTarget = isHttpBrowserUrl(request?.url?.());
    if (overBudget || !safeTarget || type === 'media' || type === 'font') {
      budget.blocked += 1;
      if (overBudget) budget.limitHit = true;
      await route.abort();
      return;
    }
    await route.continue();
  });
}

function isHttpBrowserUrl(value) {
  try { return /^https?:$/.test(new URL(value).protocol); } catch { return false; }
}

async function boundedHydration(page, hydrationMs, timeoutMs) {
  if (!hydrationMs) return;
  try {
    await page.waitForLoadState?.('networkidle', { timeout: Math.min(hydrationMs, timeoutMs) });
  } catch {
    await page.waitForTimeout?.(hydrationMs);
  }
}

async function inspectRenderedCandidates(page, context) {
  return page.evaluate(({ theme, company, domain, headerOnly = false, headerRetention = true }) => {
    const clean = value => String(value ?? '').trim();
    const httpUrl = value => {
      const raw = clean(value);
      if (!raw || /^(?:null|undefined|about:blank|blob:)/i.test(raw) || /(?:^|\/)null(?:[?#].*)?$/i.test(raw)) return null;
      try {
        const url = new URL(raw, document.baseURI);
        return /^https?:$/.test(url.protocol) ? url.href : null;
      } catch { return null; }
    };
    const visible = (element, rect, style) => rect.width >= 4 && rect.height >= 4 &&
      style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    const srcsetUrls = value => {
      const source = clean(value);
      if (!source) return [];
      return source.split(/\s*,\s+(?=\S)/).flatMap(part => {
        const match = part.trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?[wx]))?$/i);
        return match && !/^[,\s]+$/.test(match[1]) ? [match[1]] : [];
      });
    };
    const homeLink = element => {
      const anchor = element.closest('a[href]');
      if (!anchor) return { anchorHref: null, homeLinked: false };
      const href = httpUrl(anchor.href);
      if (!href) return { anchorHref: null, homeLinked: false };
      const parsed = new URL(href);
      const path = parsed.pathname.replace(/\/+$/, '') || '/';
      const localizedRoot = /^\/[a-z]{2}(?:-[a-z]{2})?(?:\/index(?:\.html?)?)?$/i.test(path);
      const hostname = value => value.replace(/^www\./, '');
      return { anchorHref: href, homeLinked: hostname(parsed.hostname) === hostname(location.hostname) && (path === '/' || (headerRetention && localizedRoot)) };
    };
    const region = element => element.closest('header') ? 'header' :
      element.closest('nav') ? 'nav' : element.closest('footer') ? 'footer' : element.closest('[role="banner"]') ? 'banner' : 'document';
    const evidence = (element, rect, style) => {
      const link = homeLink(element);
      const localNodes = [element, element.parentElement, element.parentElement?.parentElement].filter(Boolean);
      const componentLabel = localNodes.flatMap(node => [...node.attributes]
        .filter(attribute => /^(?:data-(?:uia|ux|testid|hawkins-id)|title)$/.test(attribute.name))
        .map(attribute => attribute.value.replace(/([a-z])([A-Z])/g, '$1 $2'))).join(' ');
      return {
        theme,
        domRegion: region(element),
        renderedBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        backgroundColor: clean(style.backgroundColor),
        alt: clean(element.getAttribute('alt')),
        title: clean(element.getAttribute('title') || element.querySelector(':scope > title')?.textContent),
        ariaLabel: clean(element.getAttribute('aria-label') || element.closest('[aria-label]')?.getAttribute('aria-label')),
        anchorText: clean(element.closest('a')?.textContent).slice(0, 120),
        componentLabel,
        id: clean(element.id),
        className: typeof element.className === 'string' ? clean(element.className) : clean(element.getAttribute('class')),
        company,
        domain,
        ...link,
      };
    };
    const structuralRoots = [...document.querySelectorAll('header, nav, [role="banner"]')].slice(0, 80);
    const allHomeRoots = headerOnly ? [] : [...document.querySelectorAll('a[href]')].filter(anchor => homeLink(anchor).homeLinked);
    const homeRoots = allHomeRoots.filter(anchor => {
      const rect = anchor.getBoundingClientRect();
      return visible(anchor, rect, getComputedStyle(anchor)) && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    }).slice(0, 80);
    const roots = [...structuralRoots, ...homeRoots];
    const logoScope = headerOnly ? 'header, nav, [role="banner"]' : 'body';
    const scope = document.querySelector(logoScope) ?? document.body;
    const images = new Set(scope.querySelectorAll('img[alt*="logo" i], img[class*="logo" i], img[id*="logo" i]'));
    const svgs = new Set(scope.querySelectorAll('svg[aria-label*="logo" i], svg[class*="logo" i], svg[id*="logo" i]'));
    for (const title of [...scope.querySelectorAll('svg > title')].slice(0, 80)) {
      if (/logo|wordmark|brand/i.test(title.textContent || '')) svgs.add(title.parentElement);
    }
    for (const wrapper of [...scope.querySelectorAll('[aria-label*="logo" i], [class*="logo" i], [id*="logo" i], [data-uia*="logo" i]')].slice(0, 80)) {
      wrapper.querySelectorAll('img').forEach(image => images.add(image));
      wrapper.querySelectorAll('svg').forEach(svg => svgs.add(svg));
    }
    const structuralBackgrounds = new Set();
    const homeBackgrounds = new Set(homeRoots);
    for (const root of roots) {
      if (root.matches('header, nav, [role="banner"]')) structuralBackgrounds.add(root);
      for (const image of root.querySelectorAll('img')) images.add(image);
      for (const svg of root.querySelectorAll('svg')) svgs.add(svg);
      for (const child of root.querySelectorAll('[style*="background" i], [class*="logo" i], [id*="logo" i]')) structuralBackgrounds.add(child);
    }

    const output = [];
    for (const image of [...images].slice(0, 80)) {
      const rect = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      if (!visible(image, rect, style)) continue;
      const rawSources = headerRetention ? [image.currentSrc, image.getAttribute('src'), image.getAttribute('data-src')] : [image.currentSrc || image.src || image.getAttribute('data-src')];
      if (headerRetention) {
        for (const attribute of ['srcset', 'data-srcset']) {
          rawSources.push(...srcsetUrls(image.getAttribute(attribute)));
        }
        for (const source of image.closest('picture')?.querySelectorAll('source[srcset],source[data-srcset]') ?? []) {
          for (const attribute of ['srcset', 'data-srcset']) {
            rawSources.push(...srcsetUrls(source.getAttribute(attribute)));
          }
        }
      }
      for (const url of new Set(rawSources.map(httpUrl).filter(Boolean))) {
        output.push({ url, source: 'browser-img', kind: 'external', evidence: evidence(image, rect, style) });
      }
    }

    for (const svg of [...svgs].slice(0, 30)) {
      const rect = svg.getBoundingClientRect();
      const style = getComputedStyle(svg);
      if (!visible(svg, rect, style)) continue;
      const clone = svg.cloneNode(true);
      const originalNodes = [svg, ...svg.querySelectorAll('*')].slice(0, 400);
      const cloneNodes = [clone, ...clone.querySelectorAll('*')];
      for (let index = 0; index < originalNodes.length; index++) {
        const computed = getComputedStyle(originalNodes[index]);
        cloneNodes[index]?.setAttribute('style', [
          `fill:${computed.fill}`, `stroke:${computed.stroke}`, `color:${computed.color}`,
          `opacity:${computed.opacity}`, `display:${computed.display}`, `visibility:${computed.visibility}`,
        ].join(';'));
      }
      let cloneDefs = clone.querySelector('defs');
      for (const reference of clone.outerHTML.matchAll(/(?:url\(#|(?:href|xlink:href)=["']#)([-\w:.]+)/g)) {
        if (clone.querySelector(`#${CSS.escape(reference[1])}`)) continue;
        const definition = document.getElementById(reference[1]);
        if (!definition) continue;
        if (!cloneDefs) {
          cloneDefs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
          clone.prepend(cloneDefs);
        }
        cloneDefs.append(definition.cloneNode(true));
      }
      clone.querySelectorAll('script, foreignObject').forEach(node => node.remove());
      clone.querySelectorAll('*').forEach(node => {
        for (const attribute of [...node.attributes]) {
          if (/^on/i.test(attribute.name) || (/^(?:href|xlink:href)$/i.test(attribute.name) && !attribute.value.startsWith('#'))) {
            node.removeAttribute(attribute.name);
          }
        }
      });
      const inlineSvg = new XMLSerializer().serializeToString(clone);
      if (inlineSvg.length > 256 * 1024) continue;
      output.push({
        source: 'browser-inline-svg',
        kind: 'inline-svg',
        inlineSvg,
        evidence: evidence(svg, rect, style),
      });
    }

    const backgrounds = [...new Set([...structuralBackgrounds].slice(0, 100).concat([...homeBackgrounds].slice(0, 80)))];
    for (const element of backgrounds) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!visible(element, rect, style) || !style.backgroundImage || style.backgroundImage === 'none') continue;
      for (const match of style.backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const url = httpUrl(match[1]);
        if (url) output.push({ url, source: 'browser-css-background', kind: 'external', evidence: {
          ...evidence(element, rect, style),
          ...(!style.backgroundImage.includes(',') && style.transform === 'none' && style.backgroundOrigin === 'padding-box' ? { cssBackground: {
            width: element.clientWidth, height: element.clientHeight,
            positionX: style.backgroundPositionX, positionY: style.backgroundPositionY, size: style.backgroundSize,
          } } : {}),
        } });
      }
    }
    return output;
  }, context);
}

function parseSrcsetCandidates(value) {
  const source = String(value ?? '').trim();
  if (!source) return [];
  return source.split(/\s*,\s+(?=\S)/).flatMap(part => {
    const match = part.trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?[wx]))?$/i);
    return match && !/^[,\s]+$/.test(match[1]) ? [match[1]] : [];
  });
}

function dedupeCandidates(candidates, trace = null) {
  const output = [];
  const positions = new Map();
  let invalidExternal = 0, duplicates = 0;
  for (const item of candidates ?? []) {
    if (!item || (item.kind === 'external' && !/^https?:\/\//i.test(item.url ?? ''))) { invalidExternal += 1; continue; }
    const key = item.kind === 'inline-svg' ? `svg:${item.inlineSvg}` : `url:${item.url}:${JSON.stringify(item.evidence?.cssBackground ?? null)}`;
    const existing = positions.get(key);
    if (existing === undefined) {
      positions.set(key, output.length);
      output.push({ ...item, evidence: [item.evidence] });
    } else {
      duplicates += 1;
      output[existing].evidence.push(item.evidence);
    }
  }
  if (trace) Object.assign(trace, { observed: candidates?.length ?? 0, invalid_external: invalidExternal, duplicates, retained: output.length });
  return output;
}

function normaliseInput(input) {
  const record = typeof input === 'string' || input instanceof URL ? { url: input } : input ?? {};
  const url = new URL(String(record.url ?? ''));
  const expectedPort = url.protocol === 'http:' ? '80' : '443';
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && url.port !== expectedPort)) {
    throw new Error('Browser discovery requires an HTTP(S) URL without credentials.');
  }
  const hostname = canonicalHostname(url.hostname);
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || isPrivateIp(hostname)) {
    throw new Error('Local and private-network addresses are not supported.');
  }
  return {
    url: url.href,
    domain: String(record.domain ?? hostname.replace(/^www\./, '')),
    company: String(record.company ?? ''),
  };
}

async function isAllowedBrowserUrl(value, cache, lookup = dnsLookup) {
  let url;
  try { url = new URL(value); } catch { return false; }
  const expectedPort = url.protocol === 'http:' ? '80' : url.protocol === 'https:' ? '443' : null;
  if (!expectedPort || url.username || url.password || (url.port && url.port !== expectedPort)) return false;
  const hostname = canonicalHostname(url.hostname);
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || isPrivateIp(hostname)) return false;
  if (isIpAddress(hostname)) return true;
  if (!cache.has(hostname)) {
    cache.set(hostname, Promise.resolve(lookup(hostname, { all: true, verbatim: true }))
      .then(addresses => addresses.length > 0 && addresses.every(item => !isPrivateIp(item.address)))
      .catch(() => false));
  }
  return cache.get(hostname);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function withDeadline(work, timeoutMs, onTimeout) {
  let timer;
  return Promise.race([
    work(),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        onTimeout?.();
        const error = new Error(`Rendered-browser discovery exceeded ${timeoutMs}ms.`);
        error.code = 'LOGO_YOINK_BROWSER_TIMEOUT';
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function withinDeadline(promise, deadlineAt, operation, cleanupLate) {
  const remaining = Math.max(0, deadlineAt - performance.now());
  let timer;
  let expired = false;
  const tracked = Promise.resolve(promise).then(async value => {
    if (expired && cleanupLate) await cleanupLate(value);
    return value;
  });
  return Promise.race([
    tracked,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        const error = new Error(`Rendered-browser discovery timed out while ${operation}.`);
        error.code = 'LOGO_YOINK_BROWSER_TIMEOUT';
        reject(error);
      }, remaining);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function boundedClose(value) {
  if (!value?.close) return;
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => value.close()).catch(() => {}),
      new Promise(resolve => { timer = setTimeout(resolve, 1_000); }),
    ]);
  } finally { clearTimeout(timer); }
}

function result(candidates, diagnostics, startedAt) {
  diagnostics.durationMs = Math.round(performance.now() - startedAt);
  diagnostics.candidates = candidates.length;
  return { candidates, diagnostics };
}

export const internals = { dedupeCandidates, inspectRenderedCandidates, isAllowedBrowserUrl, isPrivateIp, normaliseInput, parseSrcsetCandidates };
