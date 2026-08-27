const SAMPLE_SIZE = 96;
const LIGHT_LOGO_THRESHOLD = 0.179;

export function contrastingPreviewBackground(pixels) {
  let weightedLuminance = 0;
  let visibleWeight = 0;

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3] / 255;
    if (alpha < 0.04) continue;
    const luminance = relativeLuminance(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    weightedLuminance += luminance * alpha;
    visibleWeight += alpha;
  }

  if (!visibleWeight) return 'white';
  return weightedLuminance / visibleWeight > LIGHT_LOGO_THRESHOLD ? 'black' : 'white';
}

export function recognizeLogoBackground(image) {
  if (!image?.naturalWidth || !image?.naturalHeight) return null;

  const scale = Math.min(SAMPLE_SIZE / image.naturalWidth, SAMPLE_SIZE / image.naturalHeight, 1);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  try {
    context.drawImage(image, 0, 0, width, height);
    return contrastingPreviewBackground(context.getImageData(0, 0, width, height).data);
  } catch {
    return null;
  }
}

function relativeLuminance(red, green, blue) {
  const [r, g, b] = [red, green, blue].map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
