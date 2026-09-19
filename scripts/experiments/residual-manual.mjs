// Curated-source downloads and audit artifacts for the final 57-identity review.
// This is deliberately not a discovery crawler: new URLs are selected manually.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, extname } from 'node:path';
import sharp from 'sharp';

const root = 'reports/missing-logo-library-2026-09-19';
const dir = `${root}/manual-tail`;
const json = async p => JSON.parse(await readFile(p, 'utf8'));
const save = async (p, v) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, JSON.stringify(v, null, 2) + '\n'); };
const sha = b => createHash('sha256').update(b).digest('hex');
const xml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const command = process.argv[2];

if (command === 'decide') {
  let decisions;
  try { decisions = await json(`${dir}/decisions.json`); } catch { decisions = (await json(`${dir}/baseline.json`)).map(b => ({ brandId: b.id, identitySource: b.officialHomepage, category: 'pending_manual_review', reason: 'Manual review in progress.', approvals: [] })); }
  for (const d of JSON.parse(process.argv[3])) {
    const i = decisions.findIndex(r => r.brandId === d.brandId);
    if (i < 0) throw new Error(`Out of scope: ${d.brandId}`);
    decisions[i] = { ...decisions[i], ...d };
    if (decisions[i].approvals.length) delete decisions[i].category;
  }
  await save(`${dir}/decisions.json`, decisions);
  console.log(`Visually accepted ${decisions.filter(d => d.approvals.length).length}/57; pending: ${decisions.filter(d=>d.category==='pending_manual_review').map(d=>d.brandId).join(', ')}`);
} else if (command === 'add') {
  const rows = await json(`${dir}/candidates.json`);
  for (const r of JSON.parse(process.argv[3])) {
    if (rows.some(x => x.key === r.key)) continue;
    if (r.commonsFile) {
      const url = new URL('https://commons.wikimedia.org/w/api.php');
      url.search = new URLSearchParams({ action: 'query', format: 'json', titles: `File:${r.commonsFile}`, prop: 'imageinfo', iiprop: 'url|extmetadata', redirects: '1' });
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const info = Object.values((await response.json()).query.pages)[0].imageinfo?.[0];
      if (!info) { console.log(`${r.brandId}: Commons file missing`); continue; }
      r.sourceUrl = info.url; r.discoveryPage = info.descriptionurl; r.evidence = info.extmetadata; r.sourceKind = 'manual-wikimedia-commons';
    }
    rows.push(r); await save(`${dir}/candidates.json`, rows); console.log(`${r.brandId}: ${r.sourceUrl}`);
  }
  await save(`${dir}/candidates.json`, rows);
} else if (command === 'stage') {
  const manifest = await json('brand-library/v2/manifest.json');
  const residual = manifest.brands.filter(b => !Object.keys(b.assets).length);
  const ids = new Set(residual.map(b => b.id));
  await save(`${dir}/baseline.json`, residual);
  const history = new Map();
  for (const file of await readdir('brand-library/v2/approval-history')) {
    if (!file.endsWith('.json')) continue;
    for (const b of (await json(`brand-library/v2/approval-history/${file}`)).brands ?? []) {
      for (const a of Object.values(b.assets ?? {})) history.set(`${b.id}:${a.contentHash}`, a);
    }
  }
  const rows = [];
  const add = r => { if (!rows.some(x => x.brandId === r.brandId && x.contentHash === r.contentHash)) rows.push(r); };
  for (const r of (await json(`${root}/existing-candidate-index.json`)).rows.filter(r => ids.has(r.id))) {
    const h = history.get(`${r.id}:${r.contentHash}`);
    if (h?.sourceUrl) add({ brandId: r.id, sourcePath: r.path, contentHash: r.contentHash, sourceUrl: h.sourceUrl, discoveryPage: h.discoveryPage ?? manifest.brands.find(b => b.id === r.id).officialHomepage, sourceKind: h.sourceKind, priorRole: r.role });
  }
  for (const p of ['fresh-source/report.json', 'fresh-source/alternates/report.json']) {
    for (const r of (await json(`${root}/${p}`)).results.filter(r => ids.has(r.brandId))) {
      for (const [role, a] of Object.entries(r.assets ?? {})) {
        if (a?.localPath && !a.url?.startsWith('data:')) add({ brandId: r.brandId, sourcePath: a.localPath, contentHash: sha(await readFile(a.localPath)), sourceUrl: a.url, discoveryPage: a.sourcePage ?? r.attemptedUrls[0], sourceKind: `official-${a.source}`, priorRole: role });
      }
    }
  }
  rows.sort((a, b) => a.brandId.localeCompare(b.brandId));
  await save(`${dir}/candidates.json`, rows.map((r, i) => ({ key: `existing-${i + 1}`, ...r })));
  console.log(`Staged ${rows.length} candidates for ${new Set(rows.map(r => r.brandId)).size} residual identities.`);
} else if (command === 'fetch') {
  const rows = await json(`${dir}/candidates.json`);
  for (const r of rows.filter(r => !r.sourcePath)) {
    try {
      const response = await fetch(r.sourceUrl, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'LogoLibraryReview/1.0' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const extension = extname(new URL(response.url).pathname).slice(1) || (await sharp(bytes).metadata()).format;
      r.sourcePath = `${dir}/assets/${r.brandId}-${r.key}.${extension}`;
      await mkdir(dirname(r.sourcePath), { recursive: true }); await writeFile(r.sourcePath, bytes);
      r.contentHash = sha(bytes); r.retrievedAt = new Date().toISOString(); r.resolvedUrl = response.url;
      console.log(`${r.brandId}: downloaded ${bytes.length} bytes`);
    } catch (e) { r.error = e.message; console.log(`${r.brandId}: ${e.message}`); }
  }
  await save(`${dir}/candidates.json`, rows);
} else if (command === 'review') {
  const rows = (await json(`${dir}/candidates.json`)).filter(r => r.sourcePath);
  await mkdir(`${dir}/rendered`, { recursive: true });
  for (const r of rows) {
    r.renderPath = r.sourcePath;
    if (extname(r.sourcePath) === '.ico') {
      r.renderPath = `${dir}/rendered/${r.key}.png`;
      try { execFileSync('sips', ['-s', 'format', 'png', r.sourcePath, '--out', r.renderPath], { stdio: 'pipe' }); r.transformation = { kind: 'format-conversion', sourceFormat: 'ico', outputFormat: 'png', sourceHash: r.contentHash, method: 'macOS sips native ICO decoding; no artwork changes' }; } catch (e) { r.renderError = e.message; }
    }
    try { const m = await sharp(r.renderPath).metadata(); r.width = m.width; r.height = m.height; } catch(e) { r.renderError = e.message; }
  }
  for (const theme of ['light', 'dark']) {
    const bg = theme === 'light' ? '#ffffff' : '#111318'; const fg = theme === 'light' ? '#17191c' : '#f7f7f7';
    for (let page = 0; page < Math.ceil(rows.length / 24); page++) {
      const batch = rows.slice(page * 24, (page + 1) * 24); const overlays = [];
      for (const [i, r] of batch.entries()) {
        const x = (i % 3) * 480, y = Math.floor(i / 3) * 170;
        overlays.push({ input: Buffer.from(`<svg width="480" height="170"><rect width="480" height="170" fill="none" stroke="#888"/><text x="12" y="23" fill="${fg}" font-family="Arial" font-size="15">${xml(r.key)} · ${xml(r.brandId)}</text><text x="12" y="44" fill="${fg}" font-family="Arial" font-size="12">${r.width ?? '?'}×${r.height ?? '?'} · ${xml(r.priorRole ?? r.role ?? 'candidate')}</text></svg>`), left: x, top: y });
        try {
          const b = await sharp(r.renderPath, { density: 144 }).resize(450, 105, { fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
          overlays.push({ input: b.data, left: x + Math.floor((480-b.info.width)/2), top: y+55+Math.floor((105-b.info.height)/2) });
        } catch { /* The dimensions/error in the index document render failures. */ }
      }
      await sharp({ create: { width: 1440, height: Math.ceil(batch.length / 3) * 170, channels: 4, background: bg } }).composite(overlays).png().toFile(`${dir}/review-${theme}-${page+1}.png`);
    }
  }
  await save(`${dir}/review-index.json`, rows); console.log(`Rendered ${rows.length} curated candidates at native raster size or smaller.`);
} else if (command === 'apply') {
  const manifest = await json('brand-library/v2/manifest.json');
  const baseline = await json(`${dir}/baseline.json`); const ids = new Set(baseline.map(b => b.id));
  const rows = new Map((await json(`${dir}/review-index.json`)).map(r => [r.key, r]));
  const decisions = await json(`${dir}/decisions.json`); const reviewedAt = new Date().toISOString();
  if (decisions.length !== 57 || new Set(decisions.map(d => d.brandId)).size !== 57 || decisions.some(d => !ids.has(d.brandId) || d.category === 'pending_manual_review')) throw new Error('Require exactly one audited outcome per original residual identity.');
  const existing = await json(`${root}/outcomes.json`); const outcomes = new Map(existing.outcomes.map(r => [r.brandId, r]));
  const approvals = [];
  for (const d of decisions) {
    const b = manifest.brands.find(b => b.id === d.brandId);
    for (const a of d.approvals ?? []) {
      const r = rows.get(a.key); if (!r || r.brandId !== b.id || r.renderError) throw new Error(`Invalid reviewed candidate ${a.key}`);
      r.sourceKind ??= new URL(r.sourceUrl).hostname.endsWith('wikimedia.org') ? 'manual-wikimedia-commons' : 'manual-official-source';
      const bytes = await readFile(r.renderPath); const m = await sharp(bytes).metadata(); const contentHash = sha(bytes);
      if (b.assets[a.role] && b.assets[a.role].contentHash !== contentHash) throw new Error(`Refusing to overwrite ${b.id}/${a.role}`);
      const path = `assets/${b.id}/${a.role}/${contentHash}.${m.format}`;
      await mkdir(dirname(`brand-library/v2/${path}`), { recursive: true }); await writeFile(`brand-library/v2/${path}`, bytes);
      const asset = { role: a.role, theme: a.theme, locale: a.locale ?? 'global', representation: a.representation, path, format: m.format, width: m.width, height: m.height, bytes: bytes.length, contentHash, visualHash: sha(await sharp(bytes, { density: 192 }).resize(256,128,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).ensureAlpha().raw().toBuffer()), sourceUrl: r.sourceUrl.startsWith('data:') ? r.discoveryPage : r.sourceUrl, discoveryPage: r.discoveryPage, sourceKind: r.sourceKind ?? 'manual-official-source', provenanceChain: [{ kind: 'manual-targeted-review', candidate: a.key, identitySource: d.identitySource, evidence: r.evidence ?? null }], transformation: r.transformation ?? null, verificationStatus: 'approved_ai_visual_review', lastCheckedAt: reviewedAt, lastConfirmedCurrentAt: reviewedAt };
      if (d.usageNote) asset.usageNote = d.usageNote;
      b.assets[a.role] = asset;
      if (b.notes?.some(n => n.kind === 'approved_asset_withdrawn' && n.contentHash === contentHash)) b.notes.push({ kind: 'approved_asset_restored', role: a.role, contentHash, reason: d.reason, reviewer: 'Codex manual visual review', reviewedAt });
      approvals.push({ action: 'approve', brandId: b.id, role: a.role, contentHash, sourceUrl: r.sourceUrl, rationale: d.reason });
    }
    const approved = Object.keys(b.assets).length > 0;
    b.notes = (b.notes ?? []).filter(n => n.kind !== 'missing-logo-manual-tail-review');
    b.notes.push({ kind: 'missing-logo-manual-tail-review', outcome: approved ? 'approved' : 'unresolved', reason: d.reason, identitySource: d.identitySource, usageNote: d.usageNote, category: approved ? undefined : d.category, reviewedAt, reviewer: 'Codex manual visual review' });
    b.verificationStatus = approved ? (b.assets.icon && b.assets.logo ? 'approved_complete' : 'approved_with_role_gap') : 'unresolved'; b.lastCheckedAt = reviewedAt;
    outcomes.set(b.id, approved ? { brandId: b.id, name: b.name, status: 'approved', roles: Object.keys(b.assets), assets: Object.entries(b.assets).map(([role,a])=>({ role, path:a.path, sourceUrl:a.sourceUrl, rationale:d.reason })) } : { brandId:b.id,name:b.name,status:'unresolved',category:d.category,reason:d.reason,sourcePage:d.identitySource });
  }
  const ordered = existing.outcomes.map(o => outcomes.get(o.brandId));
  const unresolved = ordered.filter(o => o.status !== 'approved');
  const summary = { runId: 'missing-logo-library-2026-09-19', reviewedAt, assignedIdentities: 188, approvedIdentities: 188-unresolved.length, approvedAssets: ordered.reduce((sum,o)=>sum+(o.assets?.length??0),0), unresolvedIdentities:unresolved.length, unresolvedByCategory: unresolved.reduce((a,o)=>(a[o.category]=(a[o.category]??0)+1,a),{}) };
  manifest.generatedAt = reviewedAt;
  await save('brand-library/v2/manifest.json',manifest); await save(`${root}/outcomes.json`,{...summary,outcomes:ordered}); await save(`${root}/report.json`,summary);
  await writeFile(`${root}/residual.tsv`,unresolved.map(o=>`${o.brandId}\t${o.category}\t${o.reason}`).join('\n')+'\n');
  await save('brand-library/v2/approval-history/missing-logo-manual-tail-2026-09-19.json',{reviewer:'Codex manual visual review',reviewedAt,summary,decisions:approvals,residualReview:decisions,brands:manifest.brands.filter(b=>ids.has(b.id))});
  console.log(JSON.stringify(summary,null,2));
} else throw new Error('Use stage, fetch, review, or apply');
