import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createPredictor } from "../../src/background-removal-inference.mjs";
import { removeLocalBackground } from "../../src/background-removal.mjs";
const dir = path.join(
    homedir(),
    ".cache/logo-yoink/background-removal/experiments",
  ),
  root = "test/fixtures/background-removal";
const corpus = JSON.parse(await readFile(path.join(root, "manifest.json")));
const predict = await createPredictor({
  modelPath: path.join(dir, "birefnet.onnx"),
  runtimeDirectory: path.join(dir, "../runtime"),
  architecture: "birefnet",
  padding: true,
});
const rows = [];
for (const item of corpus) {
  const bytes = await readFile(path.join(root, item.file));
  const start = performance.now();
  const result = await removeLocalBackground(bytes, { client: { predict } });
  await writeFile(path.join(dir, `production-${item.id}.png`), result.bytes);
  rows.push({
    id: item.id,
    split: item.split,
    applied: result.applied,
    reason: result.reason ?? null,
    ms: performance.now() - start,
    rssMB: process.memoryUsage().rss / 1024 ** 2,
  });
  console.log(rows.at(-1));
  await writeFile(
    path.join(dir, "production.json"),
    JSON.stringify(rows, null, 2),
  );
}
await predict.close();
