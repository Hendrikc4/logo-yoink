// Replay already-measured model masks through the exact shipping transformation.
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { removeLocalBackground } from "../../src/background-removal.mjs";
const dir = path.join(
  homedir(),
  ".cache/logo-yoink/background-removal/experiments",
);
const root = "test/fixtures/background-removal";
const corpus = JSON.parse(await readFile(path.join(root, "manifest.json"))),
  rows = [];
for (const item of corpus) {
  const bytes = await readFile(path.join(root, item.file));
  const { width, height } = await sharp(bytes).metadata();
  const mask = await sharp(path.join(dir, `birefnet-pad-soft-${item.id}.png`))
    .extractChannel("alpha")
    .raw()
    .toBuffer();
  const result = await removeLocalBackground(bytes, {
    client: { predict: async () => ({ mask, width, height }) },
  });
  await writeFile(
    path.join(dir, `production-refined-${item.id}.png`),
    result.bytes,
  );
  rows.push({
    id: item.id,
    split: item.split,
    applied: result.applied,
    reason: result.reason ?? null,
    preset: result.preset ?? null,
    originalPreserved: result.applied
      ? null
      : Buffer.compare(bytes, result.bytes) === 0,
  });
}
await writeFile(
  path.join(dir, "production-refined.json"),
  JSON.stringify(rows, null, 2),
);
console.table(rows);
