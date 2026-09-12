// Compare optional uniform-background inverse compositing; experiments only.
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
const dir = path.join(
    homedir(),
    ".cache/logo-yoink/background-removal/experiments",
  ),
  root = "test/fixtures/background-removal";
const corpus = JSON.parse(await readFile(path.join(root, "manifest.json")));
const records = [];
for (const model of ["isnet", "birefnet"]) {
  let results;
  try {
    results = JSON.parse(
      await readFile(path.join(dir, `results-${model}.json`)),
    );
  } catch {
    continue;
  }
  for (const r of results.filter((x) => x.mode === "pad")) {
    const item = corpus.find((x) => x.id === r.id);
    if (!item.truth) continue;
    const { data, info } = await sharp(path.join(dir, r.file))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const truth = await sharp(path.join(root, item.truth))
        .ensureAlpha()
        .raw()
        .toBuffer(),
      original = await sharp(path.join(root, item.file))
        .ensureAlpha()
        .raw()
        .toBuffer();
    const bg = [0, 1, 2].map((c) => original[c]);
    const corrected = Buffer.from(data);
    let before = 0,
      after = 0,
      n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      for (let c = 0; c < 3; c++) {
        if (a > 0 && a < 1)
          corrected[i + c] = Math.round(
            Math.max(0, Math.min(255, (data[i + c] - (1 - a) * bg[c]) / a)),
          );
        const expected = (truth[i + c] * truth[i + 3]) / 255;
        before += Math.abs(data[i + c] * a - expected) / 255;
        after += Math.abs(corrected[i + c] * a - expected) / 255;
        n++;
      }
    }
    records.push({
      id: r.id,
      model,
      preset: r.preset,
      before: before / n,
      after: after / n,
    });
    await sharp(corrected, { raw: info })
      .png()
      .toFile(path.join(dir, `defringe-${r.file}`));
    if (
      ["s0-0-thin", "s2-0-white-detail", "s4-0-tiny", "s6-0-outline"].includes(
        r.id,
      ) &&
      r.preset === "soft"
    ) {
      const parts = [];
      for (const [k, bytes] of [truth, data, corrected].entries()) {
        const p = await sharp(bytes, { raw: info })
          .flatten({ background: "#111" })
          .png()
          .toBuffer();
        parts.push({ input: p, left: 0, top: info.height * k });
      }
      const joined = await sharp({
        create: {
          width: info.width,
          height: info.height * 3,
          channels: 3,
          background: "#111",
        },
      })
        .composite(parts)
        .png()
        .toBuffer();
      await sharp(joined)
        .resize(info.width * 4, info.height * 12, { kernel: "nearest" })
        .png()
        .toFile(path.join(dir, `defringe-detail-${model}-${r.id}.png`));
    }
  }
}
await writeFile(
  path.join(dir, "defringe-metrics.json"),
  JSON.stringify(records, null, 2),
);
