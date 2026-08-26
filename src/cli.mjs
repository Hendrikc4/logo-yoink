import './load-env.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { extractLogos } from './extractor.mjs';

const args = process.argv.slice(2);
const valueOptions = new Set(['--download', '--theme', '--background', '--role']);
let website = null;
for (let index = 0; index < args.length; index++) {
  if (valueOptions.has(args[index])) { index += 1; continue; }
  if (!args[index].startsWith('--') && !website) website = args[index];
}
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const downloadIndex = args.indexOf('--download');
const downloadDirectory = downloadIndex >= 0 ? args[downloadIndex + 1] : null;
const theme = option('--theme') ?? 'any';
const background = option('--background') ?? 'any';
const requestedRole = option('--role');
const deepWide = args.includes('--deep-wide');
const spaBundles = args.includes('--spa-bundles');
const wikimediaFallback = !args.includes('--no-wikimedia-fallback');
const bimi = args.includes('--bimi');

if (!website || downloadIndex >= 0 && !downloadDirectory ||
    ['--theme', '--background', '--role'].some(name => args.includes(name) && (!option(name) || option(name).startsWith('--'))) ||
    !['any', 'light', 'dark'].includes(theme) ||
    !['any', 'transparent', 'opaque'].includes(background) ||
    requestedRole && !['icon', 'logo', 'wide', 'favicon'].includes(requestedRole)) {
  console.error('Usage: npm run cli -- <website> [--theme any|light|dark] [--background any|transparent|opaque] [--role icon|logo] [--download <directory>] [--deep-wide] [--spa-bundles] [--no-wikimedia-fallback] [--bimi]');
  process.exit(1);
}

try {
  const result = await extractLogos(website, {
    besticonUrl: process.env.BESTICON_URL || null,
    jinaApiKey: process.env.JINA_API_KEY || null,
    roleAwareBudget: true,
    contentBoundingWide: true,
    deepWide,
    spaBundles,
    wikimediaFallback,
    bimi,
    preferences: { logo: { theme, background } },
  });
  const downloadSelection = requestedRole === 'logo' || requestedRole === 'wide'
    ? result.assets.logo
    : requestedRole === 'icon' || requestedRole === 'favicon'
      ? result.assets.icon
      : result.selected;
  if (downloadDirectory && downloadSelection) {
    const targetDirectory = resolve(downloadDirectory);
    await mkdir(targetDirectory, { recursive: true });
    const pathExtension = extname(new URL(downloadSelection.resolvedUrl).pathname);
    const extension = downloadSelection.source === 'official-archive' || !pathExtension ? `.${downloadSelection.format}` : pathExtension;
    const path = resolve(targetDirectory, `logo${extension}`);
    const bytes = Buffer.from(downloadSelection.dataUrl.split(',')[1], 'base64');
    await writeFile(path, bytes);
    result.downloadedTo = path;
  }
  const printable = structuredClone(result);
  for (const item of printable.candidates) delete item.dataUrl;
  for (const variants of Object.values(printable.assetVariants ?? {})) {
    for (const item of variants) delete item.dataUrl;
  }
  for (const item of [printable.selected, ...Object.values(printable.assets), ...Object.values(printable.selectedByRole)]) {
    if (item) delete item.dataUrl;
  }
  console.log(JSON.stringify(printable, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
