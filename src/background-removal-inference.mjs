import sharp from 'sharp';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// Kept independent of the worker so the quality experiment can compare exact production preprocessing.
export async function createPredictor({ modelPath, runtimeDirectory, architecture = 'isnet', size = 1024, padding = true, tiles = false }) {
  const requireRuntime = createRequire(join(runtimeDirectory, 'package.json'));
  const ort = requireRuntime('onnxruntime-node');
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1, graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false });
  const predictMask = async (bytes, overrides = {}) => {
    const usePadding = overrides.padding ?? padding;
    const { width, height } = await sharp(bytes).metadata();
    const scale = Math.min(size / width, size / height);
    const fittedWidth = usePadding ? Math.max(1, Math.round(width * scale)) : size;
    const fittedHeight = usePadding ? Math.max(1, Math.round(height * scale)) : size;
    const left = Math.floor((size - fittedWidth) / 2);
    const top = Math.floor((size - fittedHeight) / 2);
    const input = await sharp(bytes).flatten({ background: '#ffffff' }).removeAlpha().toColourspace('srgb').resize(fittedWidth, fittedHeight, { fit: 'fill', kernel: sharp.kernel.linear }).extend({ left, top, right: size - fittedWidth - left, bottom: size - fittedHeight - top, background: '#ffffff' }).raw().toBuffer();
    const tensor = new Float32Array(3 * size * size);
    const means = architecture === 'birefnet' ? [0.485, 0.456, 0.406] : [0.5, 0.5, 0.5];
    const stds = architecture === 'birefnet' ? [0.229, 0.224, 0.225] : [1, 1, 1];
    for (let pixel = 0; pixel < size * size; pixel++) {
      for (let channel = 0; channel < 3; channel++) tensor[channel * size * size + pixel] = architecture === 'isnet' ? (input[pixel * 3 + channel] - 128) / 256 : (input[pixel * 3 + channel] / 255 - means[channel]) / stds[channel];
    }
    const inputTensor = new ort.Tensor('float32', tensor, [1, 3, size, size]);
    let outputs;
    try { outputs = await session.run({ [session.inputNames[0]]: inputTensor }); }
    finally { inputTensor.dispose(); }
    try {
    const output = outputs[session.outputNames[0]];
    const outHeight = output.dims.at(-2);
    const outWidth = output.dims.at(-1);
    const values = architecture === 'birefnet' ? Float32Array.from(output.data, value => 1 / (1 + Math.exp(-value))) : output.data;
    let min = Infinity, max = -Infinity;
    for (let index = 0; index < outHeight * outWidth; index++) { min = Math.min(min, values[index]); max = Math.max(max, values[index]); }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-6) throw Object.assign(new Error('Model produced an empty or invalid foreground mask.'), { code: 'unsafe-mask' });
    const mask = Buffer.alloc(outHeight * outWidth);
    for (let index = 0; index < mask.length; index++) mask[index] = Math.round(255 * (architecture === 'birefnet' ? values[index] : (values[index] - min) / (max - min)));
    let image = sharp(mask, { raw: { width: outWidth, height: outHeight, channels: 1 } });
    if (usePadding) {
      const outLeft = Math.floor(left * outWidth / size), outTop = Math.floor(top * outHeight / size);
      image = image.extract({ left: outLeft, top: outTop, width: Math.min(outWidth - outLeft, Math.max(1, Math.round(fittedWidth * outWidth / size))), height: Math.min(outHeight - outTop, Math.max(1, Math.round(fittedHeight * outHeight / size))) });
    }
    return { mask: await image.resize(width, height, { kernel: sharp.kernel.linear }).greyscale().raw().toBuffer(), width, height };
    } finally { for (const output of Object.values(outputs)) output.dispose(); }
  };
  const predict = tiles ? bytes => predictOverlappingCrops(bytes, predictMask) : predictMask;
  predict.close = () => session.release();
  return predict;
}

// Increase detail resolution on wide/tall logos without increasing the model's
// peak tensor dimensions. Keep operations sequential and safety-check the whole
// assembled mask afterward; maximum alpha in the overlap favors preservation.
export async function predictOverlappingCrops(bytes, predict) {
  const { width, height } = await sharp(bytes).metadata();
  if (Math.max(width / height, height / width) < 2.5) return predict(bytes);
  const horizontal = width >= height;
  const long = horizontal ? width : height;
  const cropLength = Math.ceil(long * 0.6);
  const mask = Buffer.alloc(width * height);
  for (const offset of [0, long - cropLength]) {
    const region = horizontal ? { left: offset, top: 0, width: cropLength, height } : { left: 0, top: offset, width, height: cropLength };
    const prediction = await predict(await sharp(bytes).extract(region).png().toBuffer());
    if (prediction.mask?.length !== region.width * region.height) throw Object.assign(new Error('The model returned incorrect crop mask dimensions.'), { code: 'unsafe-mask' });
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
      const pixel = (y + region.top) * width + x + region.left;
      mask[pixel] = Math.max(mask[pixel], prediction.mask[y * region.width + x]);
    }
  }
  return { mask, width, height };
}
