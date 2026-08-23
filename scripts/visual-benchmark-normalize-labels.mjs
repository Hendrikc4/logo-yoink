#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeLabelRecord, validateCanonicalLabel } from './visual-benchmark-labels.mjs';

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument ${token}`);
    const [key, inline] = token.slice(2).split('=', 2);
    if (key === 'help') return { help: true };
    const value = inline ?? argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    out[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return out;
}

async function readRows(path) {
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try { return [{ row: JSON.parse(line), line: index + 1 }]; }
    catch (error) { throw new Error(`${path}:${index + 1}: invalid JSON (${error.message})`); }
  });
}

export async function normalizeLabels(inputPath, outputPath, options = {}) {
  const rows = await readRows(resolve(inputPath));
  const output = [];
  for (const { row, line } of rows) {
    try {
      const normalized = normalizeLabelRecord(row, options);
      validateCanonicalLabel(normalized, `${inputPath}:${line}`);
      output.push(normalized);
    } catch (error) {
      throw new Error(`${inputPath}:${line}: ${error.message}`);
    }
  }
  await writeFile(resolve(outputPath), output.length ? `${output.map(row => JSON.stringify(row)).join('\n')}\n` : '', 'utf8');
  return { input: rows.length, output: output.length, outputPath: resolve(outputPath) };
}

export async function main(argv = process.argv.slice(2)) {
  const args = argsOf(argv);
  if (args.help) { process.stdout.write('Usage: visual-benchmark-normalize-labels.mjs --input <pilot-labels.jsonl> --output <canonical-labels.jsonl> [--run-key ID] [--capture-key ID] [--pass-id ID] [--reviewer-id ID] [--reviewer-kind KIND]\n'); return; }
  if (!args.input || !args.output) throw new Error('Usage: visual-benchmark-normalize-labels.mjs --input <pilot-labels.jsonl> --output <canonical-labels.jsonl> [--run-key ID] [--capture-key ID] [--pass-id ID] [--reviewer-id ID] [--reviewer-kind KIND]');
  const result = await normalizeLabels(args.input, args.output, args);
  process.stdout.write(`Normalized ${result.output}/${result.input} labels to ${result.outputPath}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main().catch(error => { console.error(`visual-benchmark-normalize-labels: ${error.message}`); process.exitCode = 1; });
