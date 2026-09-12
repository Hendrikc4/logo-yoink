// Model-guided edge matting experiment; never a standalone color remover.
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { matteEdges } from "../../src/background-removal-matting.mjs";
export { matteEdges };
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = path.join(
      homedir(),
      ".cache/logo-yoink/background-removal/experiments",
    ),
    root = "test/fixtures/background-removal";
  const corpus = JSON.parse(await readFile(path.join(root, "manifest.json")));
  const rows = [];
  for (const item of corpus) {
    const file = path.join(dir, `birefnet-pad-soft-${item.id}.png`);
    let data, info;
    try {
      ({ data, info } = await sharp(file)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }));
    } catch {
      continue;
    }
    const matting = matteEdges(data, info.width, info.height),
      out = matting.data;
    await sharp(out, { raw: info })
      .png()
      .toFile(path.join(dir, `matting-${item.id}.png`));
    if (!item.truth) continue;
    const truth = await sharp(path.join(root, item.truth))
      .ensureAlpha()
      .raw()
      .toBuffer();
    let before = 0,
      after = 0,
      loss = 0,
      fg = 0;
    for (let p = 0; p < data.length; p += 4) {
      for (let c = 0; c < 3; c++) {
        let t = (truth[p + c] * truth[p + 3]) / 255;
        before += Math.abs((data[p + c] * data[p + 3]) / 255 - t);
        after += Math.abs((out[p + c] * out[p + 3]) / 255 - t);
      }
      if (truth[p + 3] >= 250) {
        loss += 1 - out[p + 3] / 255;
        fg++;
      }
    }
    rows.push({
      id: item.id,
      reason: matting.reason,
      edgeCandidates: matting.edgeCandidates,
      unresolved: matting.unresolvedPixels,
      before: before / ((data.length / 4) * 3 * 255),
      after: after / ((data.length / 4) * 3 * 255),
      foregroundLoss: loss / (fg || 1),
    });
    if (
      [
        "s0-0-thin",
        "s1-0-dots",
        "s2-0-white-detail",
        "s3-0-gradient",
        "s4-0-tiny",
        "s7-0-disconnected",
      ].includes(item.id)
    ) {
      const layers = [];
      for (const [i, bytes] of [truth, data, out].entries()) {
        const tile = await sharp(bytes, { raw: info })
          .flatten({ background: "#111" })
          .png()
          .toBuffer();
        layers.push({ input: tile, left: 0, top: i * info.height });
      }
      const joined = await sharp({
        create: {
          width: info.width,
          height: info.height * 3,
          channels: 3,
          background: "#111",
        },
      })
        .composite(layers)
        .png()
        .toBuffer();
      await sharp(joined)
        .resize(info.width * 4, info.height * 12, { kernel: "nearest" })
        .png()
        .toFile(path.join(dir, `matting-detail-${item.id}.png`));
    }
  }
  await writeFile(
    path.join(dir, "matting-metrics.json"),
    JSON.stringify(rows, null, 2),
  );
  console.table(rows);
}
