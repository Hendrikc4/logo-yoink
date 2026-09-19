// Render offline before/after evidence. Images always come from captured API bytes.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { rankCandidates } from '../../src/rank.mjs';
const [root] = process.argv.slice(2);
if (!root) throw new Error('Usage: node scripts/review/wordmark-comparison.mjs CAPTURE_ROOT');
const groups = { makerperks: ['linear.app', 'neon.tech', 'posthog.com'], openmonetis: ['nubank.com.br', 'itau.com.br', 'inter.co'], moneymatter: ['netflix.com', 'amazon.com', 'revolut.com'], regression1: ['stripe.com', 'github.com', 'slack.com'], regression2: ['anthropic.com', 'openai.com', 'vercel.com'], regression3: ['cloudflare.com', 'wise.com', 'monzo.com'], regression4: ['shopify.com', 'figma.com', 'notion.so'] };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const result = async (run, domain) => { try { return JSON.parse(await readFile(resolve(root, run, domain, 'result.json'), 'utf8')); } catch { try { return JSON.parse(await readFile(resolve(root, run, domain, 'error.json'), 'utf8')); } catch { return { error: 'Capture unavailable' }; } } };
const dimensions = a => a ? `${Math.round(a.width * 10) / 10} × ${Math.round(a.height * 10) / 10} · ${a.format?.toUpperCase()}${a.derived ? ' · derived crop' : ''}` : 'No eligible asset';
const preview = (a, role) => a?.dataUrl ? `<img class="${role}" src="${esc(a.dataUrl)}" alt="${role}">` : `<span class="missing ${role}">No ${role === 'logo' ? 'wordmark' : 'icon'}</span>`;
const panels = assets => ['light', 'dark'].map(theme => `<div class="surface ${theme}"><span class="tag">${theme}</span>${preview(assets?.icon, 'icon')}${preview(assets?.logo, 'logo')}</div>`).join('');
const meta = assets => `<div class="meta"><span>ICON ${esc(dimensions(assets?.icon))}</span><span>WORDMARK ${esc(dimensions(assets?.logo))}</span></div>`;
const style = `<style>*{box-sizing:border-box}body{margin:0;background:#eceff2;color:#1e2632;font-family:Arial,sans-serif;padding:32px;width:1440px}h1{font-size:30px;margin:0 0 10px}p{font-size:16px;margin:0 0 22px;line-height:1.5;color:#505c69}.row{margin:18px 0 0}h2{font-size:21px;margin:0 0 9px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{background:white;border:1px solid #c6ccd3;padding:12px;border-radius:8px}h3{font-size:15px;letter-spacing:.3px;margin:0 0 10px}.surface{height:94px;display:flex;align-items:center;gap:30px;padding:12px 18px;position:relative;border:1px solid #ddd;overflow:hidden}.light{background:#fff;color:#667}.dark{background:#17191e;color:#aaa;border-color:#17191e}.surface+.surface{margin-top:4px}.icon{width:64px;height:64px;object-fit:contain;margin-left:28px;flex-shrink:0}.logo{width:395px;height:62px;object-fit:contain}.tag{position:absolute;top:5px;left:7px;font-size:9px;text-transform:uppercase}.missing{display:flex;align-items:center;justify-content:center;font-size:13px}.meta{display:flex;gap:18px;justify-content:space-between;font-size:11px;color:#52606e;margin:10px 0 0}.notice{font-size:12px;color:#974300;margin:7px 0 0}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.tile{background:white;padding:10px}.tile .surface{height:105px;justify-content:center}.tile img{max-width:95%;max-height:82px}.tile .meta{display:block;overflow-wrap:anywhere;line-height:1.5}</style>`;
await mkdir(resolve(root, 'sheets'), { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 100 }, deviceScaleFactor: 1 });
async function save(name, body) {
  const html = `<!doctype html><meta charset="utf-8">${style}${body}`;
  const path = resolve(root, 'sheets', `${name}.html`);
  await writeFile(path, html);
  await page.goto(pathToFileURL(path).href);
  await page.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
  const failed = await page.evaluate(() => [...document.images].filter(image => !image.naturalWidth).length);
  if (failed) throw new Error(`${name}: ${failed} previews failed to render`);
  await page.screenshot({ path: resolve(root, 'sheets', `${name}.png`), fullPage: true });
}
const metrics = [];
try {
for (const [group, domains] of Object.entries(groups)) {
  let rows = '', themedRows = '';
  for (const domain of domains) {
    const before = await result('matched-before', domain), after = await result('after', domain);
    rows += `<section class="row"><h2>${esc(domain)}</h2><div class="columns">` + [[before, 'BASELINE · v0.3.0'], [after, 'UPDATED · automatic selection']].map(([r, label]) => `<article class="card"><h3>${label}</h3>${panels(r.assets)}${meta(r.assets)}${r.error || r.diagnostics?.homepageUnavailable ? '<div class="notice">Homepage blocked / unavailable; any shown asset is a fallback.</div>' : ''}</article>`).join('') + '</div></section>';
    const themes = Object.fromEntries(['light', 'dark'].map(theme => [theme, rankCandidates(after.candidates ?? [], { preferences: { icon: { theme }, logo: { theme } } })]));
    themedRows += `<section class="row"><h2>${esc(domain)}</h2><div class="columns">` + Object.entries(themes).map(([theme, r]) => `<article class="card"><h3>${theme.toUpperCase()} SURFACE · preference-based selection</h3><div class="surface ${theme}">${preview(r.assets.icon, 'icon')}${preview(r.assets.logo, 'logo')}</div>${meta(r.assets)}</article>`).join('') + '</div></section>';
    metrics.push({ domain, before: { assets: before.assets ? Object.fromEntries(Object.entries(before.assets).map(([role, a]) => [role, a ? { source: a.source, format: a.format, width: a.width, height: a.height } : null])) : null, homepageDiscovered: before.diagnostics?.discovered, validated: before.candidates?.length, durationMs: before.diagnostics?.durationMs, error: before.error }, after: { assets: after.assets ? Object.fromEntries(Object.entries(after.assets).map(([role, a]) => [role, a ? { source: a.source, format: a.format, width: a.width, height: a.height, derived: Boolean(a.derived), sourcePage: a.source_page } : null])) : null, homepageDiscovered: after.diagnostics?.discovered, validated: after.candidates?.length, durationMs: after.diagnostics?.durationMs, error: after.error, homepageUnavailable: after.diagnostics?.homepageUnavailable } });
    // All candidates for remaining wordmark gaps, plus the recovered rendered mark.
    if (!after.assets?.logo || ['inter.co', 'posthog.com'].includes(domain)) {
      const candidates = after.candidates ?? [];
      for (let start = 0; start < candidates.length; start += 12) {
        const tiles = candidates.slice(start, start + 12).map((a, i) => `<article class="tile"><h3>Candidate ${start + i} · ${esc(a.source)}</h3>${['light', 'dark'].map(theme => `<div class="surface ${theme}"><img src="${esc(a.dataUrl)}"></div>`).join('')}<div class="meta">${esc(dimensions(a))}<br>Eligible: ${esc(a.predicted_roles?.join(', ') || 'none')}<br>${esc(a.wordmark_caution)}<br>${esc(a.evidence?.alt || a.evidence?.aria_label || '')}</div></article>`).join('');
        await save(`${domain}-candidates-${start / 12 + 1}`, `<h1>${esc(domain)} · all captured candidates ${start}–${Math.min(start + 11, candidates.length - 1)}</h1><p>Candidate numbers match result.json. No manual replacements.</p><div class="grid">${tiles}</div>`);
      }
    }
  }
  await save(`${group}-before-after`, `<h1>Logo Yoink · ${esc(group)} · automatic before / after</h1><p>Same selected files shown on light and dark surfaces. Missing roles remain empty. Raster preview scaling adds no source detail.<br>Sources, all candidates and access diagnostics are preserved in the adjacent capture folders.</p>${rows}`);
  if (['makerperks', 'openmonetis', 'moneymatter'].includes(group)) await save(`${group}-theme-choices`, `<h1>Logo Yoink · ${esc(group)} · theme-aware choices</h1><p>Automatic ranking of the same captured candidates with light/dark preferences. Original colors are preserved.<br>Preferences are best effort: a site may expose no suitable alternative.</p>${themedRows}`);
}
await writeFile(resolve(root, 'comparison.json'), JSON.stringify(metrics, null, 2));
} finally { await browser.close(); }
