import sharp from 'sharp';

/** Recover a single CSS sprite viewport at native resolution, without resampling. */
export async function cropCssSprite(bytes, image, css) {
  if (!css || !['png', 'webp', 'jpg'].includes(image.format)) return null;
  const px = value => /^-?\d+(?:\.\d+)?px$/.test(String(value)) ? Number.parseFloat(value) : null;
  const x = px(css.positionX), y = px(css.positionY);
  if (x == null || y == null || x > 0 || y > 0 || !Number.isFinite(css.width) || !Number.isFinite(css.height)) return null;
  const parts = String(css.size).trim().split(/\s+/);
  let renderedWidth = image.width, renderedHeight = image.height;
  if (parts[0] !== 'auto') {
    renderedWidth = px(parts[0]);
    if (!(renderedWidth > 0)) return null;
    renderedHeight = !parts[1] || parts[1] === 'auto' ? image.height * renderedWidth / image.width : px(parts[1]);
  } else if (parts[1] && parts[1] !== 'auto') return null;
  if (!(renderedWidth > 0 && renderedHeight > 0)) return null;
  const scaleX = image.width / renderedWidth, scaleY = image.height / renderedHeight;
  const raw = [-x * scaleX, -y * scaleY, css.width * scaleX, css.height * scaleY];
  // Fractional boundaries can silently cut off strokes; abstain on ambiguous geometry.
  if (raw.some(value => !Number.isFinite(value) || Math.abs(value - Math.round(value)) > 0.05)) return null;
  const [left, top, width, height] = raw.map(Math.round);
  if (left < 0 || top < 0 || width < 16 || height < 8 || width / height < 2.2 || width / height > 12 ||
      left + width > image.width || top + height > image.height || width * height >= image.width * image.height || width * height > 4 * 1024 * 1024) return null;
  const rect = { left, top, width, height };
  return { bytes: await sharp(bytes, { limitInputPixels: 64 * 1024 * 1024 }).extract(rect).png().toBuffer(), rect };
}
