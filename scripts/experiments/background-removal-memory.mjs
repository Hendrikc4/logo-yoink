import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createPredictor } from "../../src/background-removal-inference.mjs";
const directory = join(
  homedir(),
  ".cache/logo-yoink/background-removal/experiments",
);
const predictor = await createPredictor({
  modelPath: join(directory, "birefnet.onnx"),
  runtimeDirectory: join(directory, "../runtime"),
  architecture: "birefnet",
  padding: true,
});
const corpus = JSON.parse(
  await readFile("test/fixtures/background-removal/manifest.json", "utf8"),
);
const rows = [];
let peakMB = 0;
const sampler = setInterval(() => {
  peakMB = Math.max(peakMB, process.memoryUsage().rss / 1024 ** 2);
}, 50);
try {
for (const id of ["s0-0-thin", "s2-0-white-detail", "s5-0-wide"]) {
  const item = corpus.find((item) => item.id === id),
    bytes = await readFile(join("test/fixtures/background-removal", item.file));
  const start = performance.now();
  const result = await predictor(bytes);
  const reference = await sharp(join(directory, `birefnet-pad-soft-${id}.png`))
    .extractChannel("alpha")
    .raw()
    .toBuffer();
  let maxDifference = 0,
    totalDifference = 0;
  for (let pixel = 0; pixel < reference.length; pixel++) {
    const difference = Math.abs(reference[pixel] - result.mask[pixel]);
    maxDifference = Math.max(maxDifference, difference);
    totalDifference += difference;
  }
  rows.push({
    id,
    ms: performance.now() - start,
    rssMB: process.memoryUsage().rss / 1024 ** 2,
    peakMB,
    maxMaskDifference: maxDifference,
    meanMaskDifference: totalDifference / reference.length,
  });
  console.log(rows.at(-1));
  await writeFile(
    join(directory, "memory-benchmark.json"),
    JSON.stringify(rows, null, 2),
  );
}
} finally {
  clearInterval(sampler);
  await predictor.close();
}
