#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { yoink } from '../../src/index.mjs';
import { mapConcurrent } from '../../src/concurrency.mjs';

const command = process.argv[2] ?? 'review';
const sourceRoot = resolve(process.argv[3] ?? '/Users/hendrik/.codex/worktrees/290d/logo-yoink/runs/missing-logo-program-2026-09-19/treatment-final');
const reportPath = join(sourceRoot, 'report.json');
const outputRoot = resolve('reports/missing-logo-library-2026-09-19');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = path => access(path).then(() => true, () => false);
const escapeXml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[character]));

function selectedAsset(row) {
  const valid = (row.assets ?? []).filter(asset => asset.valid && asset.validatedFile);
  return valid.find(asset => (asset.selectedRoles ?? []).length) ?? valid[0] ?? null;
}

async function review() {
  const report = await readJson(reportPath);
  const rows = report.rows.map(row => ({ ...row, asset: selectedAsset(row) })).filter(row => row.asset);
  await mkdir(join(outputRoot, 'review'), { recursive: true });
  const pageSize = 24;
  const columns = 3;
  const cardWidth = 560;
  const cardHeight = 210;
  for (const theme of ['light', 'dark']) {
    const background = theme === 'light' ? '#ffffff' : '#111318';
    const foreground = theme === 'light' ? '#16181d' : '#f4f4f5';
    const border = theme === 'light' ? '#dedfe3' : '#343842';
    for (let page = 0; page < Math.ceil(rows.length / pageSize); page++) {
      const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
      const overlays = [];
      for (let index = 0; index < pageRows.length; index++) {
        const row = pageRows[index];
        const x = (index % columns) * cardWidth;
        const y = Math.floor(index / columns) * cardHeight;
        const roles = (row.asset.selectedRoles ?? []).join('+') || 'valid / role-ineligible';
        const label = Buffer.from(`<svg width="${cardWidth}" height="${cardHeight}">
          <style>text{font-family:Arial,sans-serif;fill:${foreground}}</style>
          <rect x="0.5" y="0.5" width="${cardWidth - 1}" height="${cardHeight - 1}" fill="none" stroke="${border}"/>
          <text x="16" y="25" font-size="17" font-weight="700">${page * pageSize + index + 1}. ${escapeXml(row.name)}</text>
          <text x="16" y="47" font-size="12" opacity=".72">${escapeXml(row.id)} · ${escapeXml(roles)} · ${escapeXml(row.split)}</text>
        </svg>`);
        let rendered;
        try {
          rendered = await sharp(row.asset.validatedFile, { density: 192 })
            .resize(520, 135, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png().toBuffer();
        } catch (error) {
          rendered = Buffer.from(`<svg width="520" height="135"><text x="10" y="70" fill="#d22" font-size="16">Render failed: ${escapeXml(error.message)}</text></svg>`);
        }
        overlays.push({ input: label, left: x, top: y }, { input: rendered, left: x + 20, top: y + 60 });
      }
      const pageRowsCount = Math.ceil(pageRows.length / columns);
      const path = join(outputRoot, 'review', `${theme}-${String(page + 1).padStart(2, '0')}.png`);
      await sharp({ create: { width: columns * cardWidth, height: pageRowsCount * cardHeight, channels: 4, background } })
        .composite(overlays).png().toFile(path);
      console.log(path);
    }
  }
  await writeJson(join(outputRoot, 'candidate-index.json'), {
    sourceReport: 'frozen missing-logo-program treatment-final report',
    sourceReportHash: hash(await readFile(reportPath)),
    generatedAt: new Date().toISOString(),
    rows: await Promise.all(rows.map(async (row, index) => ({
      number: index + 1,
      id: row.id,
      name: row.name,
      domain: row.domain,
      split: row.split,
      roles: row.asset.selectedRoles ?? [],
      failure: row.asset.failure ?? null,
      sourceUrl: row.asset.url,
      sourcePage: row.asset.provenance?.commons_description_url ?? row.asset.evidence?.commons_description_url ?? null,
      license: row.asset.provenance?.license ?? null,
      validatedFile: `treatment-final/validated/${basename(row.asset.validatedFile)}`,
      contentHash: hash(await readFile(row.asset.validatedFile)),
      extension: extname(row.asset.validatedFile).slice(1),
      filename: basename(row.asset.validatedFile),
    }))),
  });
  console.log(`Rendered ${rows.length} validated candidates.`);
}

async function renderRows(rows, directory, titleField = row => row.rolesLabel) {
  await mkdir(directory, { recursive: true });
  const pageSize = 24;
  const columns = 3;
  const cardWidth = 560;
  const cardHeight = 210;
  for (const theme of ['light', 'dark']) {
    const background = theme === 'light' ? '#ffffff' : '#111318';
    const foreground = theme === 'light' ? '#16181d' : '#f4f4f5';
    const border = theme === 'light' ? '#dedfe3' : '#343842';
    for (let page = 0; page < Math.ceil(rows.length / pageSize); page++) {
      const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
      const overlays = [];
      for (let index = 0; index < pageRows.length; index++) {
        const row = pageRows[index];
        const x = (index % columns) * cardWidth;
        const y = Math.floor(index / columns) * cardHeight;
        const label = Buffer.from(`<svg width="${cardWidth}" height="${cardHeight}">
          <style>text{font-family:Arial,sans-serif;fill:${foreground}}</style>
          <rect x="0.5" y="0.5" width="${cardWidth - 1}" height="${cardHeight - 1}" fill="none" stroke="${border}"/>
          <text x="16" y="25" font-size="17" font-weight="700">${row.number}. ${escapeXml(row.name)}</text>
          <text x="16" y="47" font-size="12" opacity=".72">${escapeXml(row.id)} · ${escapeXml(titleField(row))}</text>
        </svg>`);
        let rendered;
        try {
          rendered = await sharp(row.path, { density: 192 })
            .resize(520, 135, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png().toBuffer();
        } catch (error) {
          rendered = Buffer.from(`<svg width="520" height="135"><text x="10" y="70" fill="#d22" font-size="16">Render failed: ${escapeXml(error.message)}</text></svg>`);
        }
        overlays.push({ input: label, left: x, top: y }, { input: rendered, left: x + 20, top: y + 60 });
      }
      const path = join(directory, `${theme}-${String(page + 1).padStart(2, '0')}.png`);
      await sharp({ create: { width: columns * cardWidth, height: Math.ceil(pageRows.length / columns) * cardHeight, channels: 4, background } })
        .composite(overlays).png().toFile(path);
      console.log(path);
    }
  }
}

async function reviewExisting() {
  const manifest = await readJson(resolve('brand-library/v2/manifest.json'));
  const empty = new Map(manifest.brands.filter(brand => !Object.keys(brand.assets ?? {}).length).map(brand => [brand.id, brand]));
  const rows = [];
  for (const [id, brand] of empty) {
    const brandDir = resolve('brand-library/v2/assets', id);
    let roles;
    try { roles = await readdir(brandDir, { withFileTypes: true }); } catch { continue; }
    for (const roleEntry of roles.filter(entry => entry.isDirectory())) {
      const roleDir = join(brandDir, roleEntry.name);
      for (const file of await readdir(roleDir)) {
        const path = join(roleDir, file);
        rows.push({ id, name: brand.name, domain: brand.domain, role: roleEntry.name, file, path });
      }
    }
  }
  rows.sort((left, right) => left.id.localeCompare(right.id) || left.role.localeCompare(right.role) || left.file.localeCompare(right.file));
  rows.forEach((row, index) => { row.number = index + 1; row.rolesLabel = `${row.role} · ${row.file.slice(0, 10)}…`; });
  await renderRows(rows, join(outputRoot, 'existing-review'));
  await writeJson(join(outputRoot, 'existing-candidate-index.json'), {
    generatedAt: new Date().toISOString(),
    rows: await Promise.all(rows.map(async row => ({
      ...row,
      path: row.path.replace(`${process.cwd()}/`, ''),
      contentHash: hash(await readFile(row.path)),
    }))),
  });
  console.log(`Rendered ${rows.length} existing candidate files for ${new Set(rows.map(row => row.id)).size} empty identities.`);
}

async function reviewFinal() {
  const manifest = await readJson(resolve('brand-library/v2/manifest.json'));
  const outcomes = await readJson(join(outputRoot, 'outcomes.json'));
  const approved = new Set(outcomes.outcomes.filter(row => row.status === 'approved').map(row => row.brandId));
  const rows = manifest.brands.filter(brand => approved.has(brand.id)).flatMap(brand =>
    Object.entries(brand.assets ?? {}).map(([role, asset]) => ({
      id: brand.id,
      name: brand.name,
      role,
      asset,
      path: resolve('brand-library/v2', asset.path),
    })));
  rows.sort((left, right) => left.id.localeCompare(right.id) || left.role.localeCompare(right.role));
  rows.forEach((row, index) => {
    row.number = index + 1;
    row.rolesLabel = `${row.role} · ${row.asset.representation ?? 'unspecified'} · ${row.asset.theme}`;
  });
  await renderRows(rows, join(outputRoot, 'final-review'));
  await writeJson(join(outputRoot, 'final-review-index.json'), { generatedAt: new Date().toISOString(), rows: rows.map(row => ({ number: row.number, id: row.id, name: row.name, role: row.role, path: row.asset.path, contentHash: row.asset.contentHash })) });
  console.log(`Rendered ${rows.length} final approved assets for ${approved.size} identities.`);
}

async function visualHash(bytes) {
  try {
    const normalized = await sharp(bytes, { density: 192 })
      .resize(256, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha().raw().toBuffer();
    return hash(normalized);
  } catch {
    return null;
  }
}

async function historicalAssets() {
  const result = new Map();
  const directory = resolve('brand-library/v2/approval-history');
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.json')) continue;
    const snapshot = await readJson(join(directory, file));
    for (const brand of snapshot.brands ?? []) {
      for (const [role, asset] of Object.entries(brand.assets ?? {})) {
        result.set(`${brand.id}:${role}:${asset.contentHash}`, asset);
      }
    }
  }
  return result;
}

async function materializeAsset({ brandId, role, sourcePath, sourceUrl, discoveryPage, sourceKind, representation, provenanceChain = [], transformation = null }, reviewedAt) {
  const bytes = await readFile(resolve(sourcePath));
  const contentHash = hash(bytes);
  const metadata = await sharp(bytes, { density: 192 }).metadata();
  const format = metadata.format === 'svg' ? 'svg' : (metadata.format ?? extname(sourcePath).slice(1));
  const relativePath = `assets/${brandId}/${role}/${contentHash}.${format}`;
  const destination = resolve('brand-library/v2', relativePath);
  if (!await exists(destination)) {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  return {
    role,
    theme: 'light',
    locale: 'global',
    representation,
    path: relativePath,
    format,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    bytes: bytes.length,
    contentHash,
    visualHash: await visualHash(bytes),
    sourceUrl,
    discoveryPage,
    sourceKind,
    provenanceChain,
    transformation,
    verificationStatus: 'approved_ai_visual_review',
    lastCheckedAt: reviewedAt,
    lastConfirmedCurrentAt: reviewedAt,
  };
}

async function applyDecisions() {
  const reviewedAt = new Date().toISOString();
  const manifestPath = resolve('brand-library/v2/manifest.json');
  const manifest = await readJson(manifestPath);
  const baseline = manifest.brands.filter(brand =>
    (!Object.keys(brand.assets ?? {}).length && !Object.values(brand.variants ?? {}).flat().length) ||
    brand.notes?.some(note => note.kind === 'missing-logo-bounded-review'));
  if (baseline.length !== 188) throw new Error(`Expected the assigned 188 empty identities; found ${baseline.length}.`);
  const baselineIds = new Set(baseline.map(brand => brand.id));
  const treatment = await readJson(reportPath);
  const treatmentById = new Map(treatment.rows.map(row => [row.id, row]));
  const reviewedManifest = await readJson(resolve('reports/missing-logo-program-2026-09-19/reviewed-candidates/manifest.json'));
  const reviewedById = new Map((reviewedManifest.candidates ?? reviewedManifest.records ?? reviewedManifest.rows ?? []).map(row => [row.id ?? row.brandId, row]));
  const history = await historicalAssets();
  const approvals = new Map();
  const outcomes = new Map();

  const permissionRestricted = new Set(['alibaba-group', 'best-buy', 'carrefour', 'costco', 'dell', 'digitalocean', 'eaton', 'gopro', 'lululemon', 'marriott', 'shein']);
  const identityRejected = new Map([
    ['ola', 'Currentness mismatch: the candidate glyph differs from the current official header identity.'],
    ['us-bancorp', 'Identity mismatch: the candidate is the U.S. Bank subsidiary identity, not the U.S. Bancorp holding-company identity.'],
    ['pvh', 'The only recovered candidate is the retired Phillips-Van Heusen identity and also failed safe format validation.'],
  ]);
  const iconRepresentations = new Set(['cnooc', 'cummins', 'msc-group', 'rbc']);
  const stackedLogos = new Set(['air-france-klm', 'analog-devices', 'associated-british-foods', 'best-buy', 'digitalocean', 'emirates', 'fendi', 'freeport-mcmoran', 'harman', 'hpe', 'maybelline', 'mckinsey-company', 'qatar-airways', 'saint-gobain', 'saks-fifth-avenue', 'singapore-airlines', 'stmicroelectronics', 'tanishq', 'trend-micro', 'waitrose', 'warner-bros']);
  const compactLogos = new Set(['3m', '8x8', 'aia-group', 'aig', 'b-and-q', 'bolt', 'cartoon-network', 'chevron', 'dell', 'kroger', 'oxxo', 'yum-brands']);

  for (const row of treatment.rows) {
    if (!baselineIds.has(row.id)) continue;
    const candidate = selectedAsset(row);
    if (!candidate) continue;
    if (permissionRestricted.has(row.id) || identityRejected.has(row.id)) continue;
    if (row.id === '8x8') continue;
    let role = (candidate.selectedRoles ?? []).includes('icon') ? 'icon' : 'logo';
    if (!iconRepresentations.has(row.id)) role = 'logo';
    const representation = role === 'icon' ? 'symbol' : stackedLogos.has(row.id) ? 'stacked_lockup' : compactLogos.has(row.id) ? 'compact_wordmark' : 'horizontal_wordmark';
    const reviewed = reviewedById.get(row.id);
    const sourcePath = reviewed?.path ?? reviewed?.file ?? candidate.validatedFile;
    const asset = await materializeAsset({
      brandId: row.id,
      role,
      sourcePath,
      sourceUrl: candidate.url,
      discoveryPage: candidate.provenance?.commons_description_url ?? candidate.evidence?.commons_description_url ?? candidate.url,
      sourceKind: 'wikidata-wikimedia-commons',
      representation,
      provenanceChain: [
        { kind: 'wikidata-official-website-match', entityId: candidate.provenance?.wikidata_entity_id ?? candidate.evidence?.wikidata_entity_id ?? null, evidence: candidate.provenance?.official_website_evidence ?? candidate.evidence?.official_website_evidence ?? [] },
        { kind: 'bounded-recovery-treatment', report: 'reports/missing-logo-library-2026-09-19/treatment-evidence.json' },
        ...(reviewed ? [{ kind: 'preserved-reviewed-candidate', path: sourcePath }] : []),
      ],
      transformation: candidate.rawHash && candidate.rawHash !== hash(await readFile(sourcePath)) ? 'safe-svg-normalization' : null,
    }, reviewedAt);
    approvals.set(`${row.id}:${role}`, { brandId: row.id, role, asset, rationale: 'Identity, currentness, legibility, and role reviewed on light and dark contact sheets.' });
  }

  const historical = [
    ['arthur-j-gallagher', 'logo', '240a5cbf84e50158b1b9abc8cc6f5c782eb134afba42a45e8820a9cb8fb60589', 'horizontal_wordmark'],
    ['bank-of-america', 'logo', '9eda96805415afc705c6a3013b3b792b5d35c9d57884ffedba7e52d476b008d8', 'horizontal_wordmark'],
    ['kraft-heinz', 'logo', 'a91464ae0d0156fb3f380c56c88a045d932285327aba31865e9425f095392e5f', 'horizontal_wordmark'],
    ['exelon', 'logo', 'a47afc59d4ba925260ebcd42a7052dae889facb84de9ee3f42bcccc912528b1a', 'horizontal_wordmark'],
    ['nissan', 'logo', '32aaf43cf757eb9f009328f9e832652f202ad01b2d66d168a9c0da3d0079afb2', 'horizontal_wordmark'],
    ['c3-ai', 'icon', '3b3a9004fc8957d961c6e2b3b79cc26e1ca99ead2db0bdd24879b0e1567654df', 'symbol'],
    ['aqua-security', 'icon', 'c5876fa482ee8d765805468c94884ad43c1f03aa2496fa8342bd78acfa843bbf', 'symbol'],
    ['chowking', 'logo', 'd083d6742996a05e0151b8b80542f084b92dc99c2ee31fdb9e72806bacde5bd7', 'horizontal_wordmark', 'dark'],
    ['rapid7', 'logo', 'b4ce9dd76cbf08c60661d88b6c8c904a26301dbd19bfc218f8891ec6803c0070', 'horizontal_wordmark'],
    ['wechat', 'icon', 'c1e78351ce133b28e919a69a29725f3e1f3a35a2ae3b70e307704ae2a9a2d006', 'symbol', 'dark'],
    ['electronic-arts', 'icon', '40500d8a55687a05bd5cf57718c2c1417f168f87a33ec2cc2524b480a0c3de88', 'symbol'],
    ['character-ai', 'icon', '6b572b79dde98804eb3b1783b2d8e5fea45a75b316178b1398d41679e653ce7f', 'symbol'],
  ];
  for (const [brandId, role, contentHash, representation, theme = 'light'] of historical) {
    const old = history.get(`${brandId}:${role}:${contentHash}`);
    if (!old || !baselineIds.has(brandId)) continue;
    approvals.set(`${brandId}:${role}`, {
      brandId, role,
      asset: { ...old, theme, representation, verificationStatus: 'approved_ai_visual_review', lastCheckedAt: reviewedAt, lastConfirmedCurrentAt: reviewedAt,
        provenanceChain: [...(old.provenanceChain ?? []), { kind: 'restored-after-bounded-visual-review', reviewedAt }] },
      rationale: 'Previously approved first-party asset rechecked in the assigned empty-identity review.',
    });
  }

  const manual = [
    { brandId: '8x8', role: 'logo', sourcePath: 'brand-library/v2/assets/8x8/icon/f7f85e2aa7b4142077b0ef7b3933ae15998aad4d04976d79b7a9611e79dff8f2.png', sourceUrl: 'https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://8x8.com&size=256', discoveryPage: 'https://www.8x8.com/', sourceKind: 'google-favicon', representation: 'compact_wordmark' },
    { brandId: 'afterpay', role: 'logo', sourcePath: 'brand-library/v2/assets/afterpay/logo/0bca7c8aaaab2a78e07385f1f9279656f1d7759bdc41a5c8e97cde30ab809539.svg', sourceUrl: 'https://www.afterpay.com/en-AU', discoveryPage: 'https://www.afterpay.com/en-AU', sourceKind: 'browser-inline-svg', representation: 'horizontal_wordmark' },
    { brandId: 'bsh-home-appliances', role: 'logo', sourcePath: 'brand-library/v2/assets/bsh-home-appliances/logo/21bb526e10a92f6129ca53be4943780e5684299d925e899cf8e0027b73be40a5.svg', sourceUrl: 'https://www.bsh-group.com/', discoveryPage: 'https://www.bsh-group.com/', sourceKind: 'first-party-inline-svg', representation: 'horizontal_wordmark' },
    { brandId: 'lyft', role: 'logo', sourcePath: 'brand-library/v2/assets/lyft/icon/116673474d734a497f4792c6520e40a91de7f6c0a0927e5dcd83235f3f57aa48.svg', sourceUrl: 'https://www.lyft.com/press/media-kit', discoveryPage: 'https://www.lyft.com/press/media-kit', sourceKind: 'official-media-kit-and-first-party-inline-svg', representation: 'compact_wordmark' },
    { brandId: 'pwc', role: 'logo', sourcePath: 'brand-library/v2/assets/pwc/icon/d8830e24ef8f185e6d2f19b71590c343547a673c8a16cb885df0953ef8d0ef31.png', sourceUrl: 'https://www.pwc.com/', discoveryPage: 'https://www.pwc.com/', sourceKind: 'official-touch-icon', representation: 'compact_wordmark' },
    { brandId: 'prime-video', role: 'logo', sourcePath: 'brand-library/v2/assets/prime-video/logo/3a23bbb495d359596d90f6cfffae773cde66062dde7aa50979afc9619addd95d.png', sourceUrl: 'https://m.media-amazon.com/images/G/01/digital/video/web/logo-min-remaster.png', discoveryPage: 'https://primevideo.com/', sourceKind: 'official-homepage-asset', representation: 'horizontal_wordmark', theme: 'dark' },
    { brandId: 'sofitel', role: 'logo', sourcePath: 'brand-library/v2/assets/sofitel/logo/90c8624cf3a1a742457c85adb9739f82f2df5fb2543e71db8812d85ed9d66300.svg', sourceUrl: 'https://sofitel.accor.com/content/dam/brands/sof/global-marketing/brand-identity/logos/2601_mkt_0022.svg', discoveryPage: 'https://sofitel.accor.com/', sourceKind: 'first-party-brand-asset', representation: 'stacked_lockup' },
    { brandId: 'the-new-york-times', role: 'icon', sourcePath: 'brand-library/v2/assets/the-new-york-times/icon/94de5ae7e9bcf74727f45bb30ae37f553db4594012e2704336da5fbbf3357c3e.png', sourceUrl: 'https://www.nytimes.com/favicon.ico', discoveryPage: 'https://www.nytimes.com/', sourceKind: 'official-favicon', representation: 'symbol' },
  ];
  for (const item of manual) {
    if (!baselineIds.has(item.brandId)) continue;
    const asset = await materializeAsset({ ...item, provenanceChain: [{ kind: 'manual-targeted-research-and-visual-review', reviewedAt }] }, reviewedAt);
    if (item.theme) asset.theme = item.theme;
    approvals.set(`${item.brandId}:${item.role}`, { brandId: item.brandId, role: item.role, asset, rationale: 'First-party or official asset independently checked and visually reviewed.' });
  }

  const freshReportPath = join(outputRoot, 'fresh-source', 'report.json');
  const freshReport = await exists(freshReportPath) ? await readJson(freshReportPath) : null;
  const freshById = new Map((freshReport?.results ?? []).map(row => [row.brandId, row]));
  const freshApprovals = [
    ['charter-communications', 'logo', 'logo', 'stacked_lockup', 'light'],
    ['charter-communications', 'icon', 'icon', 'symbol', 'light'],
    ['givenchy', 'logo', 'logo', 'horizontal_wordmark', 'light'],
    ['jollibee', 'logo', 'logo', 'horizontal_wordmark', 'light'],
    ['marsh-mclennan', 'logo', 'logo', 'horizontal_wordmark', 'dark'],
    ['mollie', 'logo', 'icon', 'compact_wordmark', 'light'],
    ['natwest-group', 'logo', 'logo', 'horizontal_wordmark', 'dark'],
    ['newmont', 'logo', 'logo', 'horizontal_wordmark', 'dark'],
    ['northrop-grumman', 'logo', 'logo', 'stacked_lockup', 'dark'],
    ['railway', 'icon', 'icon', 'symbol', 'light'],
    ['rappi', 'logo', 'icon', 'compact_wordmark', 'light'],
    ['textron', 'logo', 'logo', 'horizontal_wordmark', 'light'],
    ['thai-airways', 'logo', 'logo', 'horizontal_wordmark', 'light'],
    ['vultr', 'icon', 'icon', 'symbol', 'light'],
    ['woodside-energy', 'logo', 'icon', 'stacked_lockup', 'light'],
  ];
  for (const [brandId, role, sourceRole, representation, theme] of freshApprovals) {
    const recovered = freshById.get(brandId)?.assets?.[sourceRole];
    if (!recovered?.localPath || !baselineIds.has(brandId)) continue;
    const asset = await materializeAsset({
      brandId,
      role,
      sourcePath: recovered.localPath,
      sourceUrl: recovered.url?.startsWith('data:') ? recovered.sourcePage : recovered.url,
      discoveryPage: recovered.sourcePage ?? manifest.brands.find(brand => brand.id === brandId)?.officialHomepage,
      sourceKind: `official-homepage-${recovered.source}`,
      representation,
      provenanceChain: [{ kind: 'fresh-official-source-recovery', report: 'reports/missing-logo-library-2026-09-19/fresh-source/report.json', attemptedAt: freshById.get(brandId).attemptedAt }],
    }, reviewedAt);
    asset.theme = theme;
    approvals.set(`${brandId}:${role}`, { brandId, role, asset, rationale: 'Fresh first-party homepage candidate passed light/dark visual, identity, role, and usability review.' });
  }

  const alternateReportPath = join(outputRoot, 'fresh-source', 'alternates', 'report.json');
  const alternateReport = await exists(alternateReportPath) ? await readJson(alternateReportPath) : null;
  const alternateById = new Map((alternateReport?.results ?? []).map(row => [row.brandId, row]));
  const alternateApprovals = [
    ['acer', 'logo', 'logo', 'horizontal_wordmark', 'light'],
    ['cme-group', 'icon', 'icon', 'symbol', 'light'],
    ['hisense', 'logo', 'logo', 'horizontal_wordmark', 'light'],
    ['kuaishou', 'logo', 'logo', 'horizontal_wordmark', 'light'],
  ];
  for (const [brandId, role, sourceRole, representation, theme] of alternateApprovals) {
    const recovered = alternateById.get(brandId)?.assets?.[sourceRole];
    if (!recovered?.localPath || !baselineIds.has(brandId)) continue;
    const asset = await materializeAsset({
      brandId,
      role,
      sourcePath: recovered.localPath,
      sourceUrl: recovered.url?.startsWith('data:') ? recovered.sourcePage : recovered.url,
      discoveryPage: recovered.sourcePage ?? alternateById.get(brandId).attemptedUrls[0],
      sourceKind: `official-alternate-page-${recovered.source}`,
      representation,
      provenanceChain: [{ kind: 'alternate-official-page-recovery', report: 'reports/missing-logo-library-2026-09-19/fresh-source/alternates/report.json', attemptedAt: alternateById.get(brandId).attemptedAt }],
    }, reviewedAt);
    asset.theme = theme;
    approvals.set(`${brandId}:${role}`, { brandId, role, asset, rationale: 'Alternate first-party page candidate passed light/dark visual, identity, role, and usability review.' });
  }

  for (const brand of baseline) {
    brand.notes = (brand.notes ?? []).filter(note => note.kind !== 'missing-logo-bounded-review');
    const brandApprovals = [...approvals.values()].filter(item => item.brandId === brand.id);
    if (brandApprovals.length) {
      brand.assets = Object.fromEntries(brandApprovals.map(item => [item.role, item.asset]));
      brand.verificationStatus = brand.assets.icon && brand.assets.logo ? 'approved_complete' : 'approved_with_role_gap';
      brand.lastCheckedAt = reviewedAt;
      for (const item of brandApprovals) {
        const withdrawn = brand.notes.find(note => note.kind === 'approved_asset_withdrawn' && note.role === item.role && note.contentHash === item.asset.contentHash);
        const restored = brand.notes.some(note => note.kind === 'approved_asset_restored' && note.role === item.role && note.contentHash === item.asset.contentHash);
        if (withdrawn && !restored) brand.notes.push({ role: item.role, kind: 'approved_asset_restored', contentHash: item.asset.contentHash, reason: item.rationale, reviewer: 'Codex visual review', reviewedAt });
      }
      brand.notes = [...(brand.notes ?? []), { kind: 'missing-logo-bounded-review', outcome: 'approved', roles: Object.keys(brand.assets), reviewedAt, reviewer: 'Codex visual review' }];
      outcomes.set(brand.id, { brandId: brand.id, name: brand.name, status: 'approved', roles: Object.keys(brand.assets), assets: brandApprovals.map(item => ({ role: item.role, path: item.asset.path, sourceUrl: item.asset.sourceUrl, rationale: item.rationale })) });
      continue;
    }
    let reason;
    let category = 'no_defensible_candidate';
    if (permissionRestricted.has(brand.id)) {
      category = 'permission_restricted';
      reason = brand.id === 'eaton'
        ? 'Eaton’s official media-resources page requires permission for logo use and directs requests to its media team; no asset was approved.'
        : 'An explicit first-party or project-recorded logo-use restriction remains; no distributable asset was approved.';
    } else if (identityRejected.has(brand.id)) {
      category = brand.id === 'us-bancorp' ? 'identity_mismatch' : brand.id === 'ola' ? 'currentness_mismatch' : 'stale_identity_and_format_failure';
      reason = identityRejected.get(brand.id);
    } else {
      const row = treatmentById.get(brand.id);
      const fresh = freshById.get(brand.id);
      const alternate = alternateById.get(brand.id);
      if (alternate?.outcome === 'attempt_failed') reason = `Fresh alternate official-page attempt failed after trying ${alternate.attemptedUrls.join(', ')}: ${alternate.error}`;
      else if (alternate?.outcome === 'no_candidate_recovered') reason = `Fresh alternate official-page extraction tried ${alternate.attemptedUrls.join(', ')} and returned no eligible asset.`;
      else if (alternate?.outcome === 'candidate_recovered_review_required') reason = `Fresh alternate official-page extraction tried ${alternate.attemptedUrls.join(', ')} and recovered candidate files, but none passed final identity, role, format, and legibility review.`;
      else if (fresh?.outcome === 'attempt_failed') reason = `Fresh official-site attempt failed after trying ${fresh.attemptedUrls.join(', ')}: ${fresh.error}`;
      else if (fresh?.outcome === 'no_candidate_recovered') reason = `Fresh official-site extraction tried ${fresh.attemptedUrls.join(', ')} and returned no eligible asset.`;
      else if (fresh?.outcome === 'candidate_recovered_review_required') reason = `Fresh official-site extraction tried ${fresh.attemptedUrls.join(', ')} and recovered candidate files, but none passed final identity, role, format, and legibility review.`;
      else reason = row ? `The bounded treatment produced no candidate that passed format, identity, currentness, legibility, and role review (${row.diagnostics?.status ?? row.assets?.[0]?.failure ?? 'no approved asset'}).` : 'No safely distributable current asset survived the bounded official-source, prior-evidence, and visual-review attempt.';
    }
    brand.verificationStatus = 'unresolved';
    brand.lastCheckedAt = reviewedAt;
    const sourcePage = brand.id === 'eaton' ? 'https://www.eaton.com/us/en-us/company/news-insights/media-resources.html' : undefined;
    brand.notes = [...(brand.notes ?? []), { kind: 'missing-logo-bounded-review', outcome: 'unresolved', category, reason, ...(sourcePage ? { sourcePage } : {}), reviewedAt, reviewer: 'Codex visual review' }];
    outcomes.set(brand.id, { brandId: brand.id, name: brand.name, status: 'unresolved', category, reason, ...(sourcePage ? { sourcePage } : {}) });
  }

  manifest.generatedAt = reviewedAt;
  manifest.approvedFromRun = 'missing-logo-library-2026-09-19';
  await writeJson(manifestPath, manifest);
  const orderedOutcomes = baseline.map(brand => outcomes.get(brand.id));
  const evidence = await Promise.all(treatment.rows.map(async row => ({
    brandId: row.id,
    domain: row.domain,
    status: row.diagnostics?.status ?? null,
    candidates: await Promise.all((row.assets ?? []).map(async asset => ({
      sourceUrl: asset.url,
      discoveryPage: asset.provenance?.commons_description_url ?? asset.evidence?.commons_description_url ?? null,
      valid: asset.valid,
      selectedRoles: asset.selectedRoles ?? [],
      failure: asset.failure ?? null,
      contentHash: asset.validatedFile && await exists(asset.validatedFile) ? hash(await readFile(asset.validatedFile)) : null,
      provenance: asset.provenance ?? null,
    }))),
  })));
  const approvedIdentities = orderedOutcomes.filter(row => row.status === 'approved').length;
  const approvedAssets = [...approvals.values()].length;
  const unresolvedByCategory = orderedOutcomes.filter(row => row.status === 'unresolved').reduce((counts, row) => {
    counts[row.category] = (counts[row.category] ?? 0) + 1;
    return counts;
  }, {});
  const summary = { runId: 'missing-logo-library-2026-09-19', reviewedAt, assignedIdentities: baseline.length, approvedIdentities, approvedAssets, unresolvedIdentities: baseline.length - approvedIdentities, unresolvedByCategory };
  await writeJson(join(outputRoot, 'outcomes.json'), { ...summary, outcomes: orderedOutcomes });
  await writeJson(join(outputRoot, 'treatment-evidence.json'), { sourceReport: 'frozen missing-logo-program treatment-final report', sourceReportHash: hash(await readFile(reportPath)), consolidatedAt: reviewedAt, rows: evidence });
  await writeJson(join(outputRoot, 'report.json'), summary);
  await writeJson(resolve('brand-library/v2/approval-history/missing-logo-library-2026-09-19.json'), { reviewer: 'Codex visual review', reviewedAt, runId: summary.runId, summary, decisions: [...approvals.values()].map(item => ({ action: 'approve', brandId: item.brandId, role: item.role, contentHash: item.asset.contentHash, sourceUrl: item.asset.sourceUrl, rationale: item.rationale })) });
  console.log(JSON.stringify(summary, null, 2));
}

function compactAsset(asset, localPath = null) {
  if (!asset) return null;
  const resolvedUrl = asset.resolvedUrl ?? asset.url ?? null;
  return {
    source: asset.source ?? null,
    url: resolvedUrl?.startsWith('data:') ? `${asset.source_page ?? asset.sourcePage ?? 'inline'}#inline-svg` : resolvedUrl,
    sourcePage: asset.source_page ?? asset.sourcePage ?? null,
    format: asset.format ?? null,
    width: asset.width ?? asset.observed?.width ?? null,
    height: asset.height ?? asset.observed?.height ?? null,
    evidence: asset.evidence ?? null,
    provenance: asset.provenance ?? null,
    variant: asset.variant ?? null,
    localPath,
  };
}

function scrubInlineData(value) {
  if (Array.isArray(value)) return value.map(scrubInlineData);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubInlineData(item)]));
  if (typeof value === 'string' && value.startsWith('data:image')) return '[inline-image-data-omitted]';
  return value;
}

async function persistFreshAsset(brandId, role, asset) {
  if (!asset?.dataUrl) return compactAsset(asset);
  const comma = asset.dataUrl.indexOf(',');
  if (comma < 0) return compactAsset(asset);
  const bytes = Buffer.from(asset.dataUrl.slice(comma + 1), 'base64');
  const format = asset.format ?? 'bin';
  const path = join(outputRoot, 'fresh-source', 'assets', brandId, `${role}-${hash(bytes)}.${format}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return compactAsset(asset, path.replace(`${process.cwd()}/`, ''));
}

async function recoverFresh() {
  const outcomes = await readJson(join(outputRoot, 'outcomes.json'));
  const manifest = await readJson(resolve('brand-library/v2/manifest.json'));
  const byId = new Map(manifest.brands.map(brand => [brand.id, brand]));
  const resultDirectory = join(outputRoot, 'fresh-source', 'results');
  await mkdir(resultDirectory, { recursive: true });
  const checkpointIds = new Set((await readdir(resultDirectory)).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5)));
  const outcomeById = new Map(outcomes.outcomes.map(row => [row.brandId, row]));
  const targetIds = new Set([...outcomes.outcomes.filter(row => row.status === 'unresolved' && row.category === 'no_defensible_candidate').map(row => row.brandId), ...checkpointIds]);
  const targets = [...targetIds].map(brandId => outcomeById.get(brandId) ?? { brandId });
  await mapConcurrent(targets, Number(process.env.LOGO_RECOVERY_WORKERS ?? 2), async target => {
    const path = join(resultDirectory, `${target.brandId}.json`);
    if (await exists(path)) return;
    const brand = byId.get(target.brandId);
    const attemptedAt = new Date().toISOString();
    try {
      const result = await yoink(brand.officialHomepage ?? `https://${brand.domain}/`, {
        companyName: brand.name,
        scrapers: ['browser'],
        deep: true,
        spaBundles: true,
        wikimedia: false,
        cachedFavicon: true,
        timeoutMs: 12_000,
        preferences: { logo: { theme: 'light' }, icon: { theme: 'light' } },
      });
      const logo = await persistFreshAsset(brand.id, 'logo', result.assets?.logo);
      const icon = await persistFreshAsset(brand.id, 'icon', result.assets?.icon);
      await writeJson(path, {
        brandId: brand.id,
        name: brand.name,
        domain: brand.domain,
        attemptedAt,
        attemptedUrls: [...new Set([brand.officialHomepage ?? `https://${brand.domain}/`, ...(result.diagnostics?.reachability ?? []).map(item => item.url).filter(Boolean)])],
        outcome: logo || icon ? 'candidate_recovered_review_required' : 'no_candidate_recovered',
        assets: { logo, icon },
        diagnostics: {
          homepage: result.diagnostics?.homepage ?? null,
          reachability: result.diagnostics?.reachability ?? [],
          browser: result.diagnostics?.browser ?? null,
          deepWide: result.diagnostics?.deepWide ?? null,
          network: result.diagnostics?.network ?? result.network ?? null,
        },
      });
      console.log(`${brand.id}: ${logo ? 'logo' : '-'} ${icon ? 'icon' : '-'}`);
    } catch (error) {
      await writeJson(path, { brandId: brand.id, name: brand.name, domain: brand.domain, attemptedAt, attemptedUrls: [brand.officialHomepage ?? `https://${brand.domain}/`], outcome: 'attempt_failed', error: error.message });
      console.log(`${brand.id}: failed (${error.message})`);
    }
  });
  const results = [];
  for (const target of targets) {
    const path = join(resultDirectory, `${target.brandId}.json`);
    const result = scrubInlineData(await readJson(path));
    for (const asset of Object.values(result.assets ?? {})) {
      if (asset?.url?.startsWith('data:') || asset?.url === '[inline-image-data-omitted]') asset.url = `${asset.sourcePage ?? 'inline'}#inline-svg`;
    }
    await writeJson(path, result);
    results.push(result);
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    targets: targets.length,
    candidateIdentities: results.filter(row => row.outcome === 'candidate_recovered_review_required').length,
    noCandidate: results.filter(row => row.outcome === 'no_candidate_recovered').length,
    failed: results.filter(row => row.outcome === 'attempt_failed').length,
    results,
  };
  await writeJson(join(outputRoot, 'fresh-source', 'report.json'), summary);
  console.log(JSON.stringify({ targets: summary.targets, candidateIdentities: summary.candidateIdentities, noCandidate: summary.noCandidate, failed: summary.failed }, null, 2));
}

async function reviewFresh() {
  const report = await readJson(join(outputRoot, 'fresh-source', 'report.json'));
  const rows = report.results.flatMap(result => Object.entries(result.assets ?? {}).flatMap(([role, asset]) => asset?.localPath ? [{ id: result.brandId, name: result.name, role, asset, path: resolve(asset.localPath) }] : []));
  rows.sort((left, right) => left.id.localeCompare(right.id) || left.role.localeCompare(right.role));
  rows.forEach((row, index) => {
    row.number = index + 1;
    row.rolesLabel = `${row.role} · ${row.asset.source ?? 'unknown'} · ${row.asset.width ?? '?'}×${row.asset.height ?? '?'}`;
  });
  await renderRows(rows, join(outputRoot, 'fresh-source', 'review'));
  await writeJson(join(outputRoot, 'fresh-source', 'review-index.json'), { generatedAt: new Date().toISOString(), rows: rows.map(row => ({ number: row.number, id: row.id, name: row.name, role: row.role, source: row.asset.source, sourceUrl: row.asset.url, sourcePage: row.asset.sourcePage, localPath: row.asset.localPath })) });
  console.log(`Rendered ${rows.length} fresh candidate assets for ${new Set(rows.map(row => row.id)).size} identities.`);
}

async function recoverAlternates() {
  const manifest = await readJson(resolve('brand-library/v2/manifest.json'));
  const byId = new Map(manifest.brands.map(brand => [brand.id, brand]));
  const targets = [
    ['abb', 'https://www.abb.com/global/en/company/media'],
    ['united-airlines', 'https://www.united.com/en/us/newsroom'],
    ['etihad-airways', 'https://www.etihad.com/en/news'],
    ['cme-group', 'https://brand.cmegroup.com/logo.html'],
    ['lg-uplus', 'https://www.lguplus.com/about/en'],
    ['sinopec', 'http://www.sinopecgroup.com/group/en/'],
    ['petrochina', 'https://www.petrochina.com.cn/ptr/'],
    ['namshi', 'https://www.namshi.com/uae-en/'],
    ['hisense', 'https://global.hisense.com/'],
    ['acer', 'https://news.acer.com/'],
    ['transformers', 'https://shop.hasbro.com/en-us/brands/transformers'],
    ['monopoly', 'https://shop.hasbro.com/en-us/brands/monopoly'],
    ['ralph-lauren', 'https://corporate.ralphlauren.com/'],
    ['kuaishou', 'https://ir.kuaishou.com/'],
  ];
  const directory = join(outputRoot, 'fresh-source', 'alternates', 'results');
  await mkdir(directory, { recursive: true });
  await mapConcurrent(targets, 2, async ([brandId, url]) => {
    const brand = byId.get(brandId);
    const path = join(directory, `${brandId}.json`);
    const attemptedAt = new Date().toISOString();
    try {
      const result = await yoink(url, { companyName: brand.name, scrapers: ['browser'], deep: true, spaBundles: true, wikimedia: false, cachedFavicon: true, timeoutMs: 12_000, preferences: { logo: { theme: 'light' }, icon: { theme: 'light' } } });
      const logo = await persistFreshAsset(brandId, 'alternate-logo', result.assets?.logo);
      const icon = await persistFreshAsset(brandId, 'alternate-icon', result.assets?.icon);
      const record = { brandId, name: brand.name, domain: brand.domain, attemptedAt, attemptedUrls: [url, ...(result.diagnostics?.reachability ?? []).map(item => item.url).filter(Boolean)], outcome: logo || icon ? 'candidate_recovered_review_required' : 'no_candidate_recovered', assets: { logo, icon }, diagnostics: { reachability: result.diagnostics?.reachability ?? [], browser: result.diagnostics?.browser ?? null, network: result.diagnostics?.network ?? result.network ?? null } };
      await writeJson(path, record);
      console.log(`${brandId}: ${logo ? 'logo' : '-'} ${icon ? 'icon' : '-'}`);
    } catch (error) {
      await writeJson(path, { brandId, name: brand.name, domain: brand.domain, attemptedAt, attemptedUrls: [url], outcome: 'attempt_failed', error: error.message });
      console.log(`${brandId}: failed (${error.message})`);
    }
  });
  const results = await Promise.all(targets.map(([brandId]) => readJson(join(directory, `${brandId}.json`))));
  await writeJson(join(outputRoot, 'fresh-source', 'alternates', 'report.json'), { generatedAt: new Date().toISOString(), targets: targets.length, candidateIdentities: results.filter(row => row.outcome === 'candidate_recovered_review_required').length, results });
}

async function reviewAlternates() {
  const report = await readJson(join(outputRoot, 'fresh-source', 'alternates', 'report.json'));
  const rows = report.results.flatMap(result => Object.entries(result.assets ?? {}).flatMap(([role, asset]) => asset?.localPath ? [{ id: result.brandId, name: result.name, role, asset, path: resolve(asset.localPath) }] : []));
  rows.sort((left, right) => left.id.localeCompare(right.id) || left.role.localeCompare(right.role));
  rows.forEach((row, index) => { row.number = index + 1; row.rolesLabel = `${row.role} · ${row.asset.source ?? 'unknown'} · ${row.asset.width ?? '?'}×${row.asset.height ?? '?'}`; });
  await renderRows(rows, join(outputRoot, 'fresh-source', 'alternates', 'review'));
  console.log(`Rendered ${rows.length} alternate-page assets for ${new Set(rows.map(row => row.id)).size} identities.`);
}

if (command === 'review') await review();
else if (command === 'review-existing') await reviewExisting();
else if (command === 'review-final') await reviewFinal();
else if (command === 'apply') await applyDecisions();
else if (command === 'recover-fresh') await recoverFresh();
else if (command === 'review-fresh') await reviewFresh();
else if (command === 'recover-alternates') await recoverAlternates();
else if (command === 'review-alternates') await reviewAlternates();
else throw new Error('Usage: node scripts/experiments/missing-empty-library.mjs review|review-existing|review-final|apply|recover-fresh|review-fresh|recover-alternates|review-alternates [treatment-final-dir]');
