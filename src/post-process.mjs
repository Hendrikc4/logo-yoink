import sharp from 'sharp';
import { createHash } from 'node:crypto';

const RASTER_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif']);

function dataUrlBytes(dataUrl) {
  const match = String(dataUrl ?? '').match(/^data:[^;,]+;base64,(.+)$/s);
  return match ? Buffer.from(match[1], 'base64') : null;
}

function normalizeUpscale(value) {
  if (value == null || value === false) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 1 || value > 8) throw new TypeError('upscale factor must be greater than 1 and no more than 8.');
    return { factor: value };
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('upscale must be a factor or an object with width and/or height.');
  const width = value.width == null ? null : Number(value.width);
  const height = value.height == null ? null : Number(value.height);
  const factor = value.factor == null ? null : Number(value.factor);
  if (width != null && (!Number.isInteger(width) || width < 1 || width > 8192) ||
      height != null && (!Number.isInteger(height) || height < 1 || height > 8192) ||
      factor != null && (!Number.isFinite(factor) || factor <= 1 || factor > 8) ||
      width == null && height == null && factor == null) {
    throw new TypeError('upscale dimensions must be integers from 1 to 8192, or factor must be greater than 1 and no more than 8.');
  }
  return { width, height, factor };
}

export function normalizePostProcessing(options = {}) {
  return {
    removeBackground: options.removeBackground === true || options.backgroundRemoval === true,
    upscale: normalizeUpscale(options.upscale ?? (options.upscaleFactor == null ? null : Number(options.upscaleFactor))),
  };
}

function targetDimensions(width, height, request) {
  if (!request) return null;
  let scale = request.factor ?? Infinity;
  if (request.width != null) scale = Math.min(scale, request.width / width);
  if (request.height != null) scale = Math.min(scale, request.height / height);
  if (!Number.isFinite(scale)) scale = Math.max(request.width ? request.width / width : 1, request.height ? request.height / height : 1);
  scale = Math.min(scale, 8192 / width, 8192 / height, Math.sqrt((32 * 1024 * 1024) / (width * height)));
  if (scale <= 1) return null;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Only the extractor supplies this request-local ranking context. Public options
// cannot nominate a replacement asset or initiate another download.
async function transparentFamilySource(asset, role, ranked, originalBytes) {
  if (!ranked || !role || !asset.family_id) return null;
  const family = ranked.assetFamilies?.find(item => item.id === asset.family_id);
  const members = family?.candidateIndexes?.map(index => ranked.candidates?.[index]).filter(Boolean) ?? [];
  if (!members.includes(asset)) return null;
  const variant = asset.variant;
  if (!variant || ['theme', 'color'].some(key => !variant[key] || variant[key] === 'unknown')) return null;
  const width = Number(asset.width), height = Number(asset.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 32 * 1024 * 1024) return null;
  let checkedOriginal = false;
  for (const candidate of members) {
    if (candidate === asset || candidate.family_id !== asset.family_id ||
        !candidate.predicted_roles?.includes(role === 'logo' ? 'wide' : role) ||
        candidate.variant?.background !== 'transparent' ||
        ['theme', 'color'].some(key => candidate.variant?.[key] !== variant[key]) ||
        !candidate.width || !candidate.height || Math.abs(candidate.width / candidate.height / (width / height) - 1) > 0.01) continue;
    const source = dataUrlBytes(candidate.dataUrl);
    if (!source) continue;
    try {
      if (!checkedOriginal) {
        const originalPixels = await sharp(originalBytes, { animated: false, limitInputPixels: 32 * 1024 * 1024 }).ensureAlpha().raw().toBuffer();
        for (let i = 3; i < originalPixels.length; i += 4) if (originalPixels[i] < 255) return { alreadyTransparent: true };
        checkedOriginal = true;
      }
      // Rasterize even SVG alternatives to the selected canvas. The caller still
      // returns the canonical input separately and may upscale the derived PNG.
      const bytes = await sharp(source, { animated: false, limitInputPixels: 32 * 1024 * 1024 })
        .resize(width, height, { fit: 'contain', background: '#00000000' }).ensureAlpha().png().toBuffer();
      const pixels = await sharp(bytes).raw().toBuffer();
      let transparent = 0, visible = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] < 16) transparent++;
        if (pixels[i] > 230) visible++;
      }
      if (!transparent || !visible) continue;
      return { bytes, source: candidate };
    } catch { /* An unusable sibling never prevents the canonical result. */ }
  }
  return null;
}

export async function processAsset(asset, options = {}, context = {}) {
  const normalized = normalizePostProcessing(options);
  const original = asset ?? null;
  const base = { original, enhanced: null, transformations: [] };
  if (!asset || (!normalized.removeBackground && !normalized.upscale)) return base;
  if (asset.scalable || asset.format === 'svg') {
    return { ...base, transformations: [{ type: 'post-processing', applied: false, reason: 'vector-unchanged' }] };
  }
  if (!RASTER_FORMATS.has(String(asset.format).toLowerCase())) {
    return { ...base, transformations: [{ type: 'post-processing', applied: false, reason: 'unsupported-raster-format' }] };
  }
  const originalBytes = dataUrlBytes(asset.dataUrl);
  if (!originalBytes) return { ...base, transformations: [{ type: 'post-processing', applied: false, reason: 'missing-image-data' }] };

  let bytes = originalBytes;
  const transformations = [];
  if (normalized.removeBackground) {
    const alternate = process.env.VERCEL ? null : await transparentFamilySource(asset, context.role, context.ranked, originalBytes);
    if (alternate?.alreadyTransparent) {
      transformations.push({ type: 'background-removal', applied: false, reason: 'already-transparent' });
    } else if (alternate) {
      bytes = alternate.bytes;
      transformations.push({ type: 'background-removal', applied: true, method: 'alternate-source',
        sourceUrl: alternate.source.resolvedUrl ?? alternate.source.resolved_url ?? alternate.source.url,
        sourceFamily: asset.family_id, sourceFormat: alternate.source.format,
        message: 'Used a validated transparent variant from the same asset family, role and theme without model inference.' });
    } else {
      const { removeLocalBackground } = await import('./background-removal.mjs');
      const key = createHash('sha256').update(bytes).digest('hex');
      let pending = context.removals?.get(key);
      if (!pending) {
        pending = removeLocalBackground(bytes);
        context.removals?.set(key, pending);
      }
      const removal = await pending;
      transformations.push({ type: 'background-removal', applied: removal.applied,
        ...(removal.method ? { method: removal.method, model: removal.model, revision: removal.revision, preset: removal.preset } : {}),
        ...(removal.attempts ? { attempts: removal.attempts } : {}),
        ...(removal.message ? { message: removal.message } : {}), ...(removal.reason ? { reason: removal.reason } : {}) });
      bytes = removal.bytes;
    }
  }

  if (!normalized.upscale && !transformations.some(item => item.applied)) return { ...base, transformations };
  let currentMetadata;
  try { currentMetadata = await sharp(bytes, { animated: false, limitInputPixels: 64 * 1024 * 1024 }).metadata(); }
  catch (error) { return { ...base, transformations: [...transformations, { type: 'upscale', applied: false, reason: 'invalid-image-data', message: error.message }] }; }
  const dimensions = targetDimensions(currentMetadata.width, currentMetadata.height, normalized.upscale);
  if (normalized.upscale) {
    if (dimensions) {
      bytes = await sharp(bytes, { animated: false }).resize(dimensions.width, dimensions.height, { kernel: sharp.kernel.lanczos3 }).png().toBuffer();
      transformations.push({ type: 'upscale', applied: true, method: 'lanczos3', artifactRisk: 'resampling-cannot-restore-missing-detail', from: { width: currentMetadata.width, height: currentMetadata.height }, to: dimensions });
    } else transformations.push({ type: 'upscale', applied: false, reason: 'source-meets-requested-size' });
  }
  if (!transformations.some(item => item.applied)) return { ...base, transformations };
  const metadata = await sharp(bytes).metadata();
  const enhanced = {
    ...asset,
    ...(transformations.some(item => item.type === 'background-removal' && item.applied) ? { background: 'transparent', ...(asset.variant ? { variant: { ...asset.variant, background: 'transparent' } } : {}) } : {}),
    resolvedUrl: `${asset.resolvedUrl ?? asset.resolved_url ?? asset.url}#logo-yoink-enhanced`,
    resolved_url: `${asset.resolvedUrl ?? asset.resolved_url ?? asset.url}#logo-yoink-enhanced`,
    format: 'png',
    mimeType: 'image/png',
    width: metadata.width,
    height: metadata.height,
    bytes: bytes.length,
    scalable: false,
    dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    transformation: { derivedFrom: asset.resolvedUrl ?? asset.resolved_url ?? asset.url, transformations },
  };
  return { original, enhanced, transformations };
}

export async function processSelectedAssets(assets, options = {}, ranked = null) {
  const removals = new Map();
  if (assets?.icon && assets.icon === assets.logo && !ranked) {
    const processed = await processAsset(assets.icon, options, { removals });
    return { icon: processed, logo: processed };
  }
  const [icon, logo] = await Promise.all(['icon', 'logo'].map(role =>
    processAsset(assets?.[role], options, { removals, ranked, role })));
  return { icon, logo };
}
