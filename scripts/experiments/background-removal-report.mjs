import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
const dir =
  process.env.QA_OUTPUT ||
  path.join(homedir(), ".cache/logo-yoink/background-removal/experiments");
const manifest = JSON.parse(
  await readFile("test/fixtures/background-removal/manifest.json"),
);
let all = [];
for (const model of ["isnet", "birefnet"]) {
  try {
    all.push(
      ...JSON.parse(await readFile(path.join(dir, `results-${model}.json`))),
    );
  } catch {}
  try {
    all.push(
      ...JSON.parse(
        await readFile(path.join(dir, `results-${model}-stress.json`)),
      ),
    );
  } catch {}
}
all = all.filter(
  (row, index) =>
    all.findIndex(
      (other) =>
        other.model === row.model &&
        other.mode === row.mode &&
        other.preset === row.preset &&
        other.id === row.id,
    ) === index,
);
const groups = [];
for (const model of ["isnet", "birefnet"])
  for (const mode of ["native", "pad"])
    for (const preset of ["soft", "refine"])
      for (const split of ["tuning", "heldout"]) {
        const rows = all.filter(
          (r) =>
            r.model === model &&
            r.mode === mode &&
            r.preset === preset &&
            r.split === split,
        );
        if (!rows.length) continue;
        const mean = (k) => {
          const v = rows.filter((x) => x[k] != null);
          return v.reduce((s, r) => s + r[k], 0) / (v.length || 1);
        };
        groups.push({
          model,
          mode,
          preset,
          split,
          n: rows.length,
          foregroundLoss: mean("foregroundLoss"),
          remainingBackground: mean("remainingBackground"),
          edgeError: mean("edgeError"),
          meanMs: mean("ms"),
          maxRssMB: Math.max(...rows.map((r) => r.rssMB)),
        });
      }
await writeFile(
  path.join(dir, "summary.json"),
  JSON.stringify(groups, null, 2),
);
console.table(groups);
for (const model of ["isnet", "birefnet"])
  for (const mode of ["native", "pad"]) {
    const rows = all.filter(
      (r) => r.model === model && r.mode === mode && r.preset === "refine",
    );
    if (rows.length < 32) continue;
    const layers = [];
    const width = 1500,
      rowHeight = 130;
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j],
        item = manifest.find((i) => i.id === r.id),
        label = Buffer.from(
          `<svg width="1500" height="24"><text x="8" y="18" font-family="Arial" font-size="15">${r.id} ${r.split} foreground loss ${r.foregroundLoss?.toFixed(3) ?? "unknown"}</text></svg>`,
        );
      layers.push({ input: label, left: 0, top: j * rowHeight });
      const original = await sharp(
        path.join("test/fixtures/background-removal", item.file),
      )
        .resize(350, 95, { fit: "inside" })
        .png()
        .toBuffer();
      layers.push({ input: original, left: 0, top: j * rowHeight + 25 });
      for (let b = 0; b < 3; b++) {
        const bg = b === 0 ? "#fff" : b === 1 ? "#111" : "#929292";
        const tile = await sharp(path.join(dir, r.file))
          .flatten({ background: bg })
          .resize(350, 95, { fit: "contain", background: bg })
          .png()
          .toBuffer();
        layers.push({
          input: tile,
          left: 375 * (b + 1),
          top: j * rowHeight + 25,
        });
      }
    }
    await sharp({
      create: {
        width,
        height: rows.length * rowHeight,
        channels: 3,
        background: "#ddd",
      },
    })
      .composite(layers)
      .png()
      .toFile(path.join(dir, `sheet-${model}-${mode}.png`));
  }
// Unresized and nearest-neighbour 4x exports over white, black, checkerboard.
for (const id of [
  "s0-0-thin",
  "s1-0-dots",
  "s2-0-white-detail",
  "s4-0-tiny",
  "s5-2-wide",
  "s7-0-disconnected",
  "real-0",
]) {
  for (const model of ["isnet", "birefnet"])
    for (const mode of ["native", "pad"]) {
      const row = all.find(
        (r) =>
          r.id === id &&
          r.model === model &&
          r.mode === mode &&
          r.preset === "refine",
      );
      if (!row) continue;
      const input = path.join(dir, row.file),
        { width: w, height: h } = await sharp(input).metadata();
      let checks = Buffer.alloc(w * h * 3);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const v = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 190 : 240;
          checks.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3);
        }
      const parts = [];
      for (let b = 0; b < 3; b++) {
        const p =
          b === 2
            ? await sharp(checks, { raw: { width: w, height: h, channels: 3 } })
                .composite([{ input }])
                .png()
                .toBuffer()
            : await sharp(input)
                .flatten({ background: b ? "#111" : "white" })
                .png()
                .toBuffer();
        parts.push({ input: p, left: 0, top: b * h });
      }
      const one = await sharp({
        create: { width: w, height: h * 3, channels: 3, background: "white" },
      })
        .composite(parts)
        .png()
        .toBuffer();
      await writeFile(
        path.join(dir, `detail-${model}-${mode}-${id}-1x.png`),
        one,
      );
      await sharp(one)
        .resize(w * 4, h * 12, { kernel: "nearest" })
        .png()
        .toFile(path.join(dir, `detail-${model}-${mode}-${id}-4x.png`));
    }
}
