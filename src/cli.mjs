#!/usr/bin/env node
import './load-env.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { yoink } from './index.mjs';

const args = process.argv.slice(2);
const valueOptions = new Set(['--download', '--theme', '--background', '--role', '--upscale', '--width', '--height', '--linkedin-company-url']);
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
const strict = args.includes('--strict');
const requestedRole = option('--role');
const preferenceRole = requestedRole === 'icon' || requestedRole === 'favicon' ? 'icon' : 'logo';
const deepWide = args.includes('--deep-wide');
const spaBundles = args.includes('--spa-bundles');
const wikimediaFallback = !args.includes('--no-wikimedia-fallback');
const bimi = args.includes('--bimi');
const allFallbacks = args.includes('--all-fallbacks');
const browser = allFallbacks || !args.includes('--no-browser');
const jina = allFallbacks || args.includes('--jina');
const removeBackground = args.includes('--remove-background');
const linkedinFallback = args.includes('--linkedin-fallback') || Boolean(option('--linkedin-company-url'));
const upscaleFactor = option('--upscale') == null ? null : Number(option('--upscale'));
const upscaleWidth = option('--width') == null ? null : Number(option('--width'));
const upscaleHeight = option('--height') == null ? null : Number(option('--height'));
const upscale = upscaleWidth != null || upscaleHeight != null
  ? { width: upscaleWidth, height: upscaleHeight, ...(upscaleFactor == null ? {} : { factor: upscaleFactor }) }
  : upscaleFactor;

if (!website || downloadIndex >= 0 && !downloadDirectory ||
    [...valueOptions].some(name => args.includes(name) && (!option(name) || option(name).startsWith('--'))) ||
    !['any', 'light', 'dark'].includes(theme) ||
    !['any', 'transparent', 'opaque'].includes(background) ||
    requestedRole && !['icon', 'logo', 'wide', 'favicon'].includes(requestedRole) ||
    upscaleFactor != null && (!Number.isFinite(upscaleFactor) || upscaleFactor <= 1 || upscaleFactor > 8) ||
    [upscaleWidth, upscaleHeight].some(value => value != null && (!Number.isInteger(value) || value < 1 || value > 8192))) {
  console.error('Usage: logo-yoink <website> [--no-browser] [--jina] [--all-fallbacks] [--theme any|light|dark] [--background any|transparent|opaque] [--strict] [--role icon|logo] [--download <directory>] [--remove-background] [--upscale 2] [--width 1024] [--height 1024] [--linkedin-fallback] [--linkedin-company-url <url>] [--no-wikimedia-fallback] [--bimi]');
  process.exit(1);
}

try {
  const result = await yoink(website, {
    besticonUrl: process.env.BESTICON_URL || null,
    scrapers: [...(browser ? ['browser'] : []), ...(jina ? ['jina'] : [])],
    jinaApiKey: process.env.JINA_API_KEY || null,
    deep: deepWide || allFallbacks,
    spaBundles,
    wikimedia: wikimediaFallback,
    bimi,
    removeBackground,
    ...(upscale == null ? {} : { upscale }),
    linkedinFallback,
    linkedinCompanyUrl: option('--linkedin-company-url') ?? undefined,
    preferences: { [preferenceRole]: { theme, background, strict } },
  });
  const downloadSelection = requestedRole === 'logo' || requestedRole === 'wide'
    ? result.assets.logo
    : requestedRole === 'icon' || requestedRole === 'favicon'
      ? result.assets.icon
      : result.selected;
  if (downloadDirectory && downloadSelection) {
    const processedRole = result.processedAssets?.logo?.original === downloadSelection ? 'logo' : 'icon';
    const downloadable = result.processedAssets?.[processedRole]?.enhanced ?? downloadSelection;
    const targetDirectory = resolve(downloadDirectory);
    await mkdir(targetDirectory, { recursive: true });
    const pathExtension = extname(new URL(downloadable.resolvedUrl).pathname);
    const extension = downloadable.transformation || downloadable.source === 'official-archive' || !pathExtension ? `.${downloadable.format}` : pathExtension;
    const path = resolve(targetDirectory, `logo${extension}`);
    const bytes = Buffer.from(downloadable.dataUrl.split(',')[1], 'base64');
    await writeFile(path, bytes);
    result.downloadedTo = path;
  }
  const printable = structuredClone(result);
  for (const item of printable.candidates) delete item.dataUrl;
  for (const variants of Object.values(printable.assetVariants ?? {})) {
    for (const item of variants) delete item.dataUrl;
  }
  for (const processed of Object.values(printable.processedAssets ?? {})) {
    if (processed.original) delete processed.original.dataUrl;
    if (processed.enhanced) delete processed.enhanced.dataUrl;
  }
  for (const item of [printable.icon, printable.logo, printable.selected, ...Object.values(printable.assets), ...Object.values(printable.selectedByRole)]) {
    if (item) delete item.dataUrl;
  }
  console.log(JSON.stringify(printable, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
