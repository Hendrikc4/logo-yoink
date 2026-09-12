import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { assessMask } from "../../src/background-removal-safety.mjs";
const dir = path.join(
  homedir(),
  ".cache/logo-yoink/background-removal/experiments",
);
const corpus = JSON.parse(
  await readFile("test/fixtures/background-removal/manifest.json"),
);
let rows = [];
for (const model of ["isnet", "birefnet"])
  for (const suffix of ["", "-stress"]) {
    let results;
    try {
      results = JSON.parse(
        await readFile(path.join(dir, `results-${model}${suffix}.json`)),
      );
    } catch {
      continue;
    }
    for (const result of results) {
      const item = corpus.find((x) => x.id === result.id);
      const { data, info } = await sharp(
        path.join("test/fixtures/background-removal", item.file),
      )
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const mask = await sharp(path.join(dir, result.file))
        .extractChannel("alpha")
        .raw()
        .toBuffer();
      let removed = 0,
        retained = 0;
      for (const value of mask) {
        if (value < 128) removed++;
        if (value > 240) retained++;
      }
      const reason =
        removed / mask.length < 0.01 ||
        retained / mask.length < 0.005 ||
        removed / mask.length > 0.995
          ? "unsafe-mask"
          : assessMask(data, mask, info.width, info.height);
      rows.push({ ...result, reason, accepted: !reason });
    }
  }
rows = rows.filter(
  (row, index) =>
    rows.findIndex(
      (other) =>
        other.model === row.model &&
        other.mode === row.mode &&
        other.preset === row.preset &&
        other.id === row.id,
    ) === index,
);
await writeFile(
  path.join(dir, "acceptance.json"),
  JSON.stringify(rows, null, 2),
);
for (const model of ["isnet", "birefnet"])
  for (const mode of ["native", "pad"])
    for (const preset of ["soft", "refine"]) {
      const subset = rows.filter(
        (r) => r.model === model && r.mode === mode && r.preset === preset,
      );
      console.log(
        model,
        mode,
        preset,
        subset.filter((r) => r.accepted).map((r) => r.id),
        "accepted",
        subset.filter((r) => r.accepted).length,
        "/",
        subset.length,
      );
    }
