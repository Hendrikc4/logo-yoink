#!/usr/bin/env node

/**
 * Attach exhaustive safety classes to candidate-sheet labels.
 *
 * Candidate-sheet review answers whether an asset is a usable logo for the
 * requested company. This second, independently versioned pass partitions
 * every reviewed negative into a concrete safety class without rewriting the
 * frozen packet or weakening its fingerprint checks.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCanonicalLabel } from '../../benchmark/lib/labels.mjs';
import { validatePacket } from './visual-label-sheets.mjs';

export const NEGATIVE_SAFETY_CLASSES = ['wrong_brand', 'related_brand', 'not_logo', 'unjudgeable'];
export const SAFETY_REVIEW_VERSION = 'visual-label-safety-v1-exhaustive-negatives';

async function readJsonl(path) {
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`${path}:${index + 1}: ${error.message}`); }
  });
}

function candidateKey(entityId, candidateId) {
  return `${entityId}\0${candidateId}`;
}

function labelValues(label) {
  return label?.values && typeof label.values === 'object' && !Array.isArray(label.values) ? label.values : {};
}

function validateSafetyResponse(response, sheet, labelsByCandidate) {
  const context = response?.sheet_id ?? 'unknown sheet';
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error(`${context}: response must be an object`);
  const allowed = new Set(['sheet_id', 'packet_fingerprint', ...NEGATIVE_SAFETY_CLASSES]);
  if (Object.keys(response).some(key => !allowed.has(key))) throw new Error(`${context}: unexpected response field`);
  if (response.sheet_id !== sheet.sheet_id) throw new Error(`${context}: sheet_id does not match packet`);
  if (response.packet_fingerprint !== sheet.packet_fingerprint) throw new Error(`${context}: packet_fingerprint does not match packet`);

  const candidatesByNumber = new Map(sheet.entities.flatMap(entity => entity.candidates.map(candidate => [candidate.n, { ...candidate, entity_id: entity.entity_id }])));
  const assigned = new Map();
  for (const safetyClass of NEGATIVE_SAFETY_CLASSES) {
    const numbers = response[safetyClass];
    if (!Array.isArray(numbers) || numbers.some(number => !Number.isInteger(number))) throw new Error(`${context}.${safetyClass} must be an integer array`);
    if (new Set(numbers).size !== numbers.length) throw new Error(`${context}.${safetyClass} contains duplicates`);
    for (const number of numbers) {
      const candidate = candidatesByNumber.get(number);
      if (!candidate) throw new Error(`${context}: unknown candidate number ${number}`);
      if (assigned.has(number)) throw new Error(`${context}: candidate ${number} has multiple safety classes`);
      const labels = candidate.candidate_ids.map(candidateId => labelsByCandidate.get(candidateKey(candidate.entity_id, candidateId)));
      if (labels.some(label => !label)) throw new Error(`${context}: candidate ${number} is missing an imported label`);
      if (labels.some(label => labelValues(label).identity !== 'wrong')) throw new Error(`${context}: candidate ${number} is not a reviewed negative`);
      assigned.set(number, safetyClass);
    }
  }

  for (const [number, candidate] of candidatesByNumber) {
    const labels = candidate.candidate_ids.map(candidateId => labelsByCandidate.get(candidateKey(candidate.entity_id, candidateId)));
    if (labels.some(label => !label)) throw new Error(`${context}: candidate ${number} is missing an imported label`);
    const identities = new Set(labels.map(label => labelValues(label).identity));
    if (identities.size !== 1) throw new Error(`${context}: aliases for candidate ${number} disagree on identity`);
    if (identities.has('wrong') && !assigned.has(number)) throw new Error(`${context}: reviewed negative ${number} has no safety class`);
    if (!identities.has('wrong') && assigned.has(number)) throw new Error(`${context}: positive or ambiguous candidate ${number} cannot have a negative safety class`);
  }
  return assigned;
}

export async function applyVisualLabelSafety({ packetDirectory, labelsPath, safetyPath, outputPath, reviewerId, reviewPass, overwrite = false }) {
  if (typeof reviewerId !== 'string' || !reviewerId.trim()) throw new Error('A non-empty --reviewer identity is required');
  if (typeof reviewPass !== 'string' || !reviewPass.trim()) throw new Error('A non-empty --review-pass is required');
  const packet = resolve(packetDirectory);
  const index = await validatePacket(packet);
  const labels = await readJsonl(resolve(labelsPath));
  const labelsByCandidate = new Map();
  for (const label of labels) {
    const key = candidateKey(label.entity_id, label.candidate_id);
    if (labelsByCandidate.has(key)) throw new Error(`Duplicate candidate label ${key}`);
    labelsByCandidate.set(key, label);
  }

  const responses = await readJsonl(resolve(safetyPath));
  const responsesBySheet = new Map();
  for (const response of responses) {
    if (responsesBySheet.has(response.sheet_id)) throw new Error(`Duplicate safety response for ${response.sheet_id}`);
    responsesBySheet.set(response.sheet_id, response);
  }
  const expectedSheets = new Set(index.sheets.map(sheet => sheet.sheet_id));
  const extras = [...responsesBySheet.keys()].filter(sheetId => !expectedSheets.has(sheetId));
  const missing = [...expectedSheets].filter(sheetId => !responsesBySheet.has(sheetId));
  if (extras.length) throw new Error(`Safety responses include unknown sheets: ${extras.join(', ')}`);
  if (missing.length) throw new Error(`Missing safety responses: ${missing.join(', ')}`);

  const safetyByCandidate = new Map();
  for (const sheet of index.sheets) {
    const assigned = validateSafetyResponse(responsesBySheet.get(sheet.sheet_id), sheet, labelsByCandidate);
    for (const entity of sheet.entities) for (const candidate of entity.candidates) {
      const safetyClass = assigned.get(candidate.n);
      if (!safetyClass) continue;
      for (const candidateId of candidate.candidate_ids) safetyByCandidate.set(candidateKey(entity.entity_id, candidateId), {
        safetyClass, sheetId: sheet.sheet_id, sheetNumber: candidate.n, packetFingerprint: sheet.packet_fingerprint,
      });
    }
  }

  let classifiedNegativeCount = 0;
  const output = labels.map(label => {
    const values = labelValues(label);
    const safety = safetyByCandidate.get(candidateKey(label.entity_id, label.candidate_id));
    const expectedClass = values.identity === 'correct' ? 'correct_brand' : values.identity === 'ambiguous' ? 'unjudgeable' : safety?.safetyClass;
    if (!expectedClass) throw new Error(`${candidateKey(label.entity_id, label.candidate_id)}: negative label is not safety-complete`);
    if (values.identity === 'wrong') classifiedNegativeCount += 1;
    const upgraded = {
      ...label,
      values: { ...values, safety_class: expectedClass },
      provenance: {
        ...label.provenance,
        safety_adjudication: {
          prompt_version: SAFETY_REVIEW_VERSION,
          reviewer_id: reviewerId.trim(),
          review_pass: reviewPass.trim(),
          sheet_id: safety?.sheetId ?? label.provenance?.task_id?.split(':')[0] ?? null,
          sheet_number: safety?.sheetNumber ?? null,
          packet_fingerprint: safety?.packetFingerprint ?? label.provenance?.packet_fingerprint ?? null,
        },
      },
    };
    validateCanonicalLabel(upgraded, `candidate ${label.candidate_id}`);
    return upgraded;
  });

  const destination = resolve(outputPath);
  await mkdir(dirname(destination), { recursive: true });
  if (!overwrite) {
    try { await readFile(destination); throw new Error(`Refusing to overwrite existing output: ${destination}`); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const temporary = join(dirname(destination), `.${basename(destination)}.tmp-${process.pid}-${Date.now()}`);
  try {
    await writeFile(temporary, `${output.map(row => JSON.stringify(row)).join('\n')}\n`, { flag: 'wx' });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { output: destination, candidate_count: output.length, classified_negative_count: classifiedNegativeCount };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--overwrite') options.overwrite = true;
    else if (token === '--help') options.help = true;
    else if (token.startsWith('--')) options[token.slice(2)] = argv[++index];
    else throw new Error(`Unexpected argument: ${token}`);
  }
  return options;
}

function help() {
  return 'Usage: node scripts/review/apply-visual-label-safety.mjs --packet PACKET --labels LABELS --safety SAFETY.jsonl --output OUTPUT --reviewer ID --review-pass ID [--overwrite]';
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { process.stdout.write(`${help()}\n`); return; }
  for (const required of ['packet', 'labels', 'safety', 'output', 'reviewer', 'review-pass']) if (!options[required]) throw new Error(help());
  const result = await applyVisualLabelSafety({
    packetDirectory: options.packet,
    labelsPath: options.labels,
    safetyPath: options.safety,
    outputPath: options.output,
    reviewerId: options.reviewer,
    reviewPass: options['review-pass'],
    overwrite: options.overwrite,
  });
  process.stdout.write(`${result.output}\n${result.candidate_count} labels; ${result.classified_negative_count} negatives safety-classified\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  process.stderr.write(`apply-visual-label-safety: ${error.message}\n`);
  process.exitCode = 1;
});
