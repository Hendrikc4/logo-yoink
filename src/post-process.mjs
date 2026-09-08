import sharp from 'sharp';

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

function colorDistance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

async function removeUniformBackground(bytes) {
  const { data, info } = await sharp(bytes, { animated: false, limitInputPixels: 64 * 1024 * 1024 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => {
    const offset = (y * info.width + x) * info.channels;
    return [...data.subarray(offset, offset + 4)];
  };
  let transparentPixels = 0;
  for (let offset = 3; offset < data.length; offset += info.channels) if (data[offset] < 250) transparentPixels += 1;
  if (transparentPixels > 0) return { applied: false, reason: 'already-transparent', confidence: 1, bytes };

  const corners = [pixel(0, 0), pixel(info.width - 1, 0), pixel(0, info.height - 1), pixel(info.width - 1, info.height - 1)];
  const background = [0, 1, 2].map(channel => Math.round(corners.reduce((sum, value) => sum + value[channel], 0) / corners.length));
  const cornerSpread = Math.max(...corners.map(value => colorDistance(value, background)));
  if (cornerSpread > 28) return { applied: false, reason: 'low-confidence-background', confidence: 0, bytes };

  let borderSamples = 0;
  let matchingBorder = 0;
  const visit = (x, y) => { borderSamples += 1; if (colorDistance(pixel(x, y), background) <= 34) matchingBorder += 1; };
  for (let x = 0; x < info.width; x += 1) { visit(x, 0); if (info.height > 1) visit(x, info.height - 1); }
  for (let y = 1; y < info.height - 1; y += 1) { visit(0, y); if (info.width > 1) visit(info.width - 1, y); }
  const confidence = matchingBorder / Math.max(1, borderSamples);
  if (confidence < 0.72) return { applied: false, reason: 'low-confidence-background', confidence, bytes };

  let removed = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const distance = colorDistance(data.subarray(offset, offset + 3), background);
    const alpha = Math.round(255 * Math.max(0, Math.min(1, (distance - 14) / 30)));
    data[offset + 3] = alpha;
    if (alpha < 128) removed += 1;
  }
  const removedRatio = removed / (info.width * info.height);
  if (removedRatio < 0.01 || removedRatio > 0.94) return { applied: false, reason: 'unsafe-removed-area', confidence, bytes };
  return { applied: true, reason: null, confidence, bytes: await sharp(data, { raw: info }).png().toBuffer() };
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

export async function processAsset(asset, options = {}) {
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
    const removal = await removeUniformBackground(bytes);
    transformations.push({ type: 'background-removal', applied: removal.applied, confidence: Math.round(removal.confidence * 100) / 100, ...(removal.reason ? { reason: removal.reason } : {}) });
    bytes = removal.bytes;
  }
  const currentMetadata = await sharp(bytes, { animated: false, limitInputPixels: 64 * 1024 * 1024 }).metadata();
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

export async function processSelectedAssets(assets, options = {}) {
  const [icon, logo] = await Promise.all([processAsset(assets?.icon, options), processAsset(assets?.logo, options)]);
  return { icon, logo };
}
