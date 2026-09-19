#!/usr/bin/env node

import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceManifestPath = resolve(repositoryRoot, 'brand-library/v2/manifest.json');
const runtimeRoot = resolve(repositoryRoot, 'brand-library/runtime');
const temporaryRoot = resolve(repositoryRoot, `brand-library/.runtime-${process.pid}`);
const manifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
let copied = 0;

async function copyApprovedAsset(asset, brandId, role) {
  const source = resolve(dirname(sourceManifestPath), asset.path);
  const sourceBoundary = relative(resolve(repositoryRoot, 'brand-library'), source);
  if (sourceBoundary.startsWith('..')) throw new Error(`Approved path escapes the brand library: ${asset.path}`);
  const path = `assets/${brandId}/${role}/${basename(source)}`;
  const destination = resolve(temporaryRoot, path);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  copied++;
  return { ...asset, path };
}

try {
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(temporaryRoot, { recursive: true });
  for (const brand of manifest.brands ?? []) {
    for (const [role, asset] of Object.entries(brand.assets ?? {})) {
      brand.assets[role] = await copyApprovedAsset(asset, brand.id, role);
    }
    for (const [role, variants] of Object.entries(brand.variants ?? {})) {
      brand.variants[role] = [];
      for (const asset of variants) brand.variants[role].push(await copyApprovedAsset(asset, brand.id, role));
    }
  }
  manifest.runtime = { approvedAssetsOnly: true, assetCount: copied };
  await writeFile(resolve(temporaryRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await rm(runtimeRoot, { recursive: true, force: true });
  await rename(temporaryRoot, runtimeRoot);
  process.stdout.write(`Prepared ${copied} approved brand-library assets for runtime packaging.\n`);
} catch (error) {
  await rm(temporaryRoot, { recursive: true, force: true });
  throw error;
}
