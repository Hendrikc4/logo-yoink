import { mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { extractLogos } from './extractor.mjs';

const args = process.argv.slice(2);
const website = args.find(value => !value.startsWith('--'));
const downloadIndex = args.indexOf('--download');
const downloadDirectory = downloadIndex >= 0 ? args[downloadIndex + 1] : null;

if (!website || downloadIndex >= 0 && !downloadDirectory) {
  console.error('Usage: npm run cli -- <website> [--download <directory>]');
  process.exit(1);
}

try {
  const result = await extractLogos(website, {
    besticonUrl: process.env.BESTICON_URL || null,
    roleAwareBudget: true,
    contentBoundingWide: true,
  });
  if (downloadDirectory && result.selected) {
    const targetDirectory = resolve(downloadDirectory);
    await mkdir(targetDirectory, { recursive: true });
    const extension = extname(new URL(result.selected.resolvedUrl).pathname) || `.${result.selected.format}`;
    const path = resolve(targetDirectory, `logo${extension}`);
    const bytes = Buffer.from(result.selected.dataUrl.split(',')[1], 'base64');
    await writeFile(path, bytes);
    result.downloadedTo = path;
  }
  const printable = structuredClone(result);
  for (const item of printable.candidates) delete item.dataUrl;
  if (printable.selected) delete printable.selected.dataUrl;
  console.log(JSON.stringify(printable, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
