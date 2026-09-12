// Reproducible local CPU model comparison. Models/runtime are explicit local inputs.
import sharp from "sharp";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
const root = path.resolve("test/fixtures/background-removal");
const out =
  process.env.QA_OUTPUT ||
  path.join(homedir(), ".cache/logo-yoink/background-removal/experiments");
await mkdir(root, { recursive: true });
await mkdir(out, { recursive: true });
const templates = [
  [
    "thin",
    420,
    100,
    '<text x="15" y="70" font-family="Arial" font-size="58" font-weight="200" fill="#153967">minimum</text>',
  ],
  [
    "dots",
    270,
    100,
    '<text x="12" y="75" font-family="Arial" font-size="72" fill="#702dd2">jiji.io</text>',
  ],
  [
    "white-detail",
    160,
    160,
    '<circle cx="80" cy="80" r="62" fill="#e32d53"/><path d="M45 65h70v15H85v40H70V80H45z" fill="white"/>',
  ],
  [
    "gradient",
    190,
    140,
    '<defs><linearGradient id="g"><stop stop-color="#11b5dd"/><stop offset="1" stop-color="#8d25d4"/></linearGradient></defs><path d="M20 120L95 15l75 105-75-35z" fill="url(#g)"/>',
  ],
  [
    "tiny",
    32,
    32,
    '<circle cx="16" cy="16" r="12" fill="#063b24"/><path d="M9 16l5 5 9-11" fill="none" stroke="white" stroke-width="2"/>',
  ],
  [
    "wide",
    700,
    80,
    '<text x="12" y="57" font-family="Arial" font-size="45" letter-spacing="8" fill="#152944">NORTH STAR LABS</text>',
  ],
  [
    "outline",
    200,
    160,
    '<circle cx="100" cy="80" r="56" fill="none" stroke="#167ca1" stroke-width="2"/><path d="M55 100l45-65 45 65z" fill="none" stroke="#167ca1" stroke-width="2"/>',
  ],
  [
    "disconnected",
    220,
    140,
    '<circle cx="45" cy="70" r="25" fill="#f58c16"/><circle cx="105" cy="70" r="15" fill="#2260aa"/><circle cx="150" cy="70" r="8" fill="#812eb0"/><circle cx="180" cy="70" r="3" fill="#279950"/>',
  ],
];
let corpus = [];
if (process.argv.includes("--generate-only")) {
  for (let k = 0; k < templates.length; k++)
    for (let j = 0; j < 3; j++) {
      const [tag, w, h, body] = templates[k],
        id = `s${k}-${j}-${tag}`,
        bg = ["#ffffff", "#e7ebf3", "#fff0cc"][j];
      const rgba = await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`,
        ),
      )
        .ensureAlpha()
        .png()
        .toBuffer();
      await writeFile(path.join(root, `${id}-truth.png`), rgba);
      let input = sharp(rgba).flatten({ background: bg });
      const jpeg = j === 2;
      await input[jpeg ? "jpeg" : "png"](jpeg ? { quality: 75 } : {}).toFile(
        path.join(root, `${id}.${jpeg ? "jpg" : "png"}`),
      );
      corpus.push({
        id,
        file: `${id}.${jpeg ? "jpg" : "png"}`,
        truth: `${id}-truth.png`,
        split: k % 2 ? "heldout" : "tuning",
        kind: tag,
        bg,
      });
    }
  const assetDir = "runs/precision-async-original100-v2/assets";
  let added = 0;
  for (const name of (await readdir(assetDir)).sort()) {
    if (!/\.png$/.test(name)) continue;
    const bytes = await readFile(path.join(assetDir, name));
    let m;
    try {
      m = await sharp(bytes).metadata();
    } catch {
      continue;
    }
    if (m.width < 20 || m.width > 2000 || m.height > 1000) continue;
    const id = `real-${added}`,
      transparent =
        m.hasAlpha && (await sharp(bytes).stats()).isOpaque === false;
    const normalized = await sharp(bytes)
      .resize({
        width: 500,
        height: 180,
        fit: "inside",
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .png()
      .toBuffer();
    await writeFile(
      path.join(root, `${id}.png`),
      await sharp(normalized).flatten({ background: "#fff" }).png().toBuffer(),
    );
    if (transparent)
      await writeFile(path.join(root, `${id}-truth.png`), normalized);
    corpus.push({
      id,
      file: `${id}.png`,
      truth: transparent ? `${id}-truth.png` : null,
      split: added % 2 ? "heldout" : "tuning",
      kind: "cached",
      source: path.join(assetDir, name),
    });
    if (++added === 8) break;
  }
  for (const [id, bg, body] of [
    [
      "dark-white",
      "#10151e",
      '<text x="20" y="68" font-size="55" font-family="Arial" fill="white">white.io</text>',
    ],
    [
      "low-contrast",
      "#f3f3f3",
      '<text x="20" y="68" font-size="55" font-family="Arial" fill="#d5d5d5">soft.io</text>',
    ],
    [
      "shadow",
      "#fff",
      '<defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter></defs><rect x="29" y="26" width="100" height="55" rx="10" fill="#333" opacity=".3" filter="url(#s)"/><rect x="25" y="20" width="100" height="55" rx="10" fill="#125abb"/>',
    ],
    [
      "full-bleed",
      "#fff",
      '<rect width="300" height="100" fill="#194ea2"/><text x="20" y="68" font-size="55" font-family="Arial" fill="white">BADGE</text>',
    ],
  ]) {
    const truth = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100">${body}</svg>`,
      ),
    )
      .ensureAlpha()
      .png()
      .toBuffer();
    await writeFile(`${root}/${id}-truth.png`, truth);
    await sharp(truth)
      .flatten({ background: bg })
      .png()
      .toFile(`${root}/${id}.png`);
    corpus.push({
      id,
      file: id + ".png",
      truth: id + "-truth.png",
      split: "heldout",
      kind: id,
      bg,
    });
  }

  await writeFile(
    path.join(root, "manifest.json"),
    JSON.stringify(corpus, null, 2) + "\n",
  );
  process.exit(0);
}
corpus = JSON.parse(await readFile(path.join(root, "manifest.json")));
if (process.env.QA_ONLY)
  corpus = corpus.filter((x) => process.env.QA_ONLY.split(",").includes(x.id));
const require = createRequire(path.join(out, "../runtime/package.json"));
const ort = require("onnxruntime-node");
const modelFilter = process.env.QA_MODEL;
const results = [];
for (const model of ["isnet", "birefnet"]) {
  if (modelFilter && model !== modelFilter) continue;
  const start = performance.now();
  const session = await ort.InferenceSession.create(
    path.join(out, `${model}.onnx`),
    { executionProviders: ["cpu"], intraOpNumThreads: 4, interOpNumThreads: 1 },
  );
  console.log(
    model,
    session.inputNames,
    session.outputNames,
    "load ms",
    performance.now() - start,
  );
  for (const mode of ["native", "pad"])
    for (const item of corpus) {
      const input = await readFile(path.join(root, item.file));
      const { width: w, height: h } = await sharp(input).metadata();
      const S = 1024;
      const rw =
          mode === "pad"
            ? Math.max(1, Math.round((w * S) / Math.max(w, h)))
            : S,
        rh =
          mode === "pad"
            ? Math.max(1, Math.round((h * S) / Math.max(w, h)))
            : S;
      const left = Math.floor((S - rw) / 2),
        top = Math.floor((S - rh) / 2);
      let prep = sharp(input)
        .removeAlpha()
        .resize(rw, rh, { fit: "fill", kernel: "linear" });
      if (mode === "pad")
        prep = prep.extend({
          left,
          right: S - rw - left,
          top,
          bottom: S - rh - top,
          background: "#fff",
        });
      const rgb = await prep.raw().toBuffer();
      const tensor = new Float32Array(3 * S * S);
      for (let i = 0; i < S * S; i++)
        for (let c = 0; c < 3; c++)
          tensor[c * S * S + i] =
            (rgb[i * 3 + c] / (model === "isnet" ? 256 : 255) -
              (model === "isnet" ? 0.5 : [0.485, 0.456, 0.406][c])) /
            (model === "isnet" ? 1 : [0.229, 0.224, 0.225][c]);
      const t = performance.now();
      const output = await session.run({
        [session.inputNames[0]]: new ort.Tensor("float32", tensor, [
          1,
          3,
          S,
          S,
        ]),
      });
      const ms = performance.now() - t;
      const values = output[session.outputNames[0]].data;
      let lo = Infinity,
        hi = -Infinity;
      if (model === "isnet")
        for (const v of values) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      const mask = Buffer.alloc(S * S);
      for (let i = 0; i < mask.length; i++)
        mask[i] = Math.round(
          255 *
            (model === "birefnet"
              ? 1 / (1 + Math.exp(-values[i]))
              : (values[i] - lo) / (hi - lo || 1)),
        );
      let restore = sharp(mask, { raw: { width: S, height: S, channels: 1 } });
      if (mode === "pad")
        restore = restore.extract({ left, top, width: rw, height: rh });
      const alpha = await restore
        .resize(w, h, { kernel: "linear" })
        .greyscale()
        .raw()
        .toBuffer();
      const rgba = await sharp(input).ensureAlpha().raw().toBuffer();
      let truth = null;
      if (item.truth)
        truth = await sharp(path.join(root, item.truth))
          .ensureAlpha()
          .raw()
          .toBuffer();
      for (const preset of ["soft", "refine"]) {
        let loss = 0,
          remaining = 0,
          edge = 0,
          nfg = 0,
          nbg = 0,
          ne = 0;
        const outputRGBA = Buffer.from(rgba);
        for (let i = 0; i < w * h; i++) {
          const a =
            preset === "soft"
              ? alpha[i]
              : Math.round(
                  255 *
                    Math.max(0, Math.min(1, (alpha[i] / 255 - 0.02) / 0.96)),
                );
          outputRGBA[4 * i + 3] = a;
          if (truth) {
            const expected = truth[i * 4 + 3];
            if (expected >= 250) {
              loss += 1 - a / 255;
              nfg++;
            }
            if (expected === 0) {
              remaining += a / 255;
              nbg++;
            }
            if (expected > 0 && expected < 250) {
              edge += Math.abs(a - expected) / 255;
              ne++;
            }
          }
        }
        const file = `${model}-${mode}-${preset}-${item.id}.png`;
        await sharp(outputRGBA, { raw: { width: w, height: h, channels: 4 } })
          .png()
          .toFile(path.join(out, file));
        results.push({
          model,
          mode,
          preset,
          id: item.id,
          split: item.split,
          truth: !!truth,
          foregroundLoss: nfg ? loss / nfg : null,
          remainingBackground: nbg ? remaining / nbg : null,
          edgeError: ne ? edge / ne : null,
          ms,
          rssMB: process.memoryUsage().rss / 1024 ** 2,
          file,
        });
      }
      console.log(model, mode, item.id, Math.round(ms) + "ms");
      await writeFile(
        path.join(
          out,
          `results-${model}${process.env.QA_ONLY ? "-stress" : ""}.json`,
        ),
        JSON.stringify(
          results.filter((x) => x.model === model),
          null,
          2,
        ),
      );
    }
  await session.release();
}
