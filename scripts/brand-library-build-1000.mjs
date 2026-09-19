#!/usr/bin/env node
// Curate a reproducible usage-oriented 1,000-identity cohort from the reviewed
// pilot, the repository's major-brand fixture, and independently researched sets.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('brand-library/v2');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const slug = value => String(value).normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const v1 = await read('brand-library/v1/sources.json');
const fixture = await read('fixtures/companies-800.json');
const extraFiles = process.argv.includes('--fixture-only') ? [] : process.argv.includes('--public-only') ? ['cohort-public.json'] : ['cohort-public.json', 'cohort-consumer.json', 'cohort-tech.json'];
const extra = [];
for (const file of extraFiles) {
  try {
    const payload = await read(resolve(root, file));
    const cohort = file.replace(/^cohort-|\.json$/g,'');
    extra.push(...(Array.isArray(payload) ? payload : payload.records ?? payload.brands ?? []).map(item => ({ ...item, cohort })));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const exclusions = new Set([
  // Non-companies or universities in the old mixed benchmark.
  'wikipedia.org','sourceforge.net','stackoverflow.com','mayoclinic.org','clevelandclinic.org',
  'who.int','unicef.org','un.org','mit.edu','stanford.edu','harvard.edu','ox.ac.uk',
  'cam.ac.uk','khanacademy.org','unesco.org','weforum.org','amnesty.org',
]);
// Current first-party corporate sites. Keep the original fixture/cohort domains
// as aliases so a domain change does not discard a stable library identity.
const canonicalOverrides = {
  'match-group': {
    domain:'mtch.com',
    evidence:'Match Group identifies mtch.com as its corporate website in its 2026 statement: https://s203.q4cdn.com/993464185/files/doc_downloads/2026/Match-Group-Modern-Slavery-Act-Statement-2025-vF.pdf',
  },
  'charter-communications': {
    domain:'corporate.charter.com',
    evidence:'Charter points to corporate.charter.com in its 2026 results: https://corporate.charter.com/newsroom/charter-announces-second-quarter-2026-results',
  },
  'marsh-mclennan': {
    name:'Marsh', domain:'marsh.com',
    evidence:'Marsh McLennan changed its brand to Marsh in January 2026: https://www.marsh.com/en/about/legal-entity-us-ca.html',
  },
  citigroup: {
    domain:'citigroup.com', aliases:['citi.com'],
    evidence:'Citigroup corporate About Us is on citigroup.com: https://www.citigroup.com/citi/about/',
  },
  comcast: {
    domain:'corporate.comcast.com',
    evidence:'Comcast Corporation maintains its official media library at corporate.comcast.com: https://corporate.comcast.com/press/photos',
  },
  'bharti-airtel': {
    domain:'airtel.in',
    evidence:'Bharti Airtel identifies airtel.in as its company website: https://www.airtel.in/about-bharti/about-bharti-airtel/',
  },
};
function withCanonicalOverride(brand) {
  const override = canonicalOverrides[brand.id];
  if (!override) return brand;
  return {
    ...brand,
    name:override.name ?? brand.name,
    domain:override.domain,
    aliases:[...new Set([...brand.aliases,brand.domain,...(override.aliases ?? [])])].filter(domain => domain !== override.domain),
    selectionEvidence:`${brand.selectionEvidence}; ${override.evidence}`,
  };
}
const legacy = v1.brands.map(([id,name,domain,aliases,identityType,parentBrandId]) => ({
  id,name,domain,
  // Alibaba.com is the B2B marketplace, not the Alibaba Group holding company.
  aliases:aliases.filter(alias => !(
    (id === 'alibaba' && alias === 'alibabagroup.com') ||
    (id === 'coca-cola' && alias === 'coca-colacompany.com') ||
    (id === 'pepsi' && alias === 'pepsico.com') ||
    (id === 'snapchat' && alias === 'snap.com')
  )),
  identityType:id === 'alibaba' ? 'product' : identityType,
  parentBrandId:id === 'alibaba' ? 'alibaba-group' :
    id === 'coca-cola' ? 'coca-cola-company' : id === 'ge' ? null : parentBrandId,
  brandStatus:id === 'ge' ? 'shared-post-split-mark' : undefined,
  sector:null,country:null,
  selectionEvidence:id === 'ge' ? 'reviewed-major-brands-100-v1; GE mark shared after the 2024 split into GE Aerospace, GE Vernova, and GE HealthCare' : 'reviewed-major-brands-100-v1',
  cohort:'original-100',
}));
const fixtureBrands = fixture.companies.filter(item => item.cohort === 'major-brands-300' && !exclusions.has(item.website))
  .map(item => withCanonicalOverride({
    id:item.website === 'alibabagroup.com' ? 'alibaba-group' : slug(item.name),
    name:item.website === 'alibabagroup.com' ? 'Alibaba Group' : item.name,
    domain:item.website,aliases:[],
    identityType:'company',parentBrandId:null,sector:null,country:null,
    selectionEvidence:'repository major-brands-300 fixture, 2026-08-24',
    cohort:'major-brands-fixture',
  }));
const preparedExtra = extra.filter(item => !exclusions.has(item.domain)).map((item, index) => withCanonicalOverride({
  ...item,
  // Bolt mobility and StackBlitz's Bolt.new are unrelated brands.
  id:item.cohort === 'tech' && item.id === 'bolt' && item.domain === 'bolt.new'
    ? 'bolt-new' : item.id ?? slug(item.name),
  name:item.id === 'max-streaming' ? 'HBO Max' : item.name,
  // Separate corporate sites from consumer brands that happen to share a root.
  domain:item.id === 'trip-com-group' ? 'group.trip.com' :
    item.id === 'ross-stores' ? 'corp.rossstores.com' : item.domain,
  aliases:item.id === 'max-streaming' ? ['Max'] : item.aliases ?? [],
  identityType:item.identityType ?? 'company',
  parentBrandId:item.id === 'free-now' ? 'lyft' :
    item.id === 'airasia' ? 'airasia-x' :
    item.id === 'mitsubishi-fuso' ? 'archion' : item.parentBrandId ?? null,
  sector:item.id === 'capital-a' ? 'diversified travel services' : item.sector ?? null,
  country:item.country ?? null,
  selectionEvidence:item.id === 'max-streaming'
    ? `${item.selectionEvidence}; WBD restored HBO Max name in summer 2025: https://press.wbd.com/us/media-release/hbo-max/warner-bros-discovery-announces-max-become-hbo-max-summer`
    : item.id === 'free-now'
      ? `${item.selectionEvidence}; Lyft acquisition completed 2025-07-31: https://investor.lyft.com/news-events-presentations/press-releases/detail/96/lyft-goes-global-freenow-acquisition-complete`
      : item.id === 'airasia'
        ? `${item.selectionEvidence}; Capital A disposed airline businesses to AirAsia X in January 2026: https://newsroom.airasia.com/news/2026/1/18/capital-a-completes-aviation-business-disposal-to-airasia-x`
        : item.id === 'mitsubishi-fuso'
          ? `${item.selectionEvidence}; part of ARCHION since April 2026: https://archion.co.jp/en/company/message/`
          : item.id === 'capital-a'
            ? `${item.selectionEvidence}; no longer owns the airline businesses after January 2026 disposal: https://newsroom.airasia.com/news/2026/1/18/capital-a-completes-aviation-business-disposal-to-airasia-x`
        : item.selectionEvidence ?? 'curated-cohort-research',
  cohort:item.cohort ?? 'researched-expansion',
  _index:index,
}));
const ordered = [...legacy,...fixtureBrands,...preparedExtra];
const selected = [], duplicateDomains = [], duplicateIds = [], aliasConflicts = [];
const byDomain = new Map(), byId = new Map(), byAlias = new Map();
for (const candidate of ordered) {
  const domain = String(candidate.domain ?? '').toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/$/,'');
  const id = String(candidate.id ?? '');
  if (!id || !domain || !/^[a-z0-9.-]+$/.test(domain)) throw new Error(`Invalid identity: ${JSON.stringify(candidate)}`);
  const brand = { ...candidate, id, domain };
  delete brand._index;
  const domainMatch = byDomain.get(domain) ?? byAlias.get(domain);
  const idMatch = byId.get(id);
  if (domainMatch || idMatch) {
    const kept = domainMatch ?? idMatch;
    // A shared website is not proof of a shared visual identity: eXtra/UEC,
    // Amul/GCMMF, and Ola/ANI Technologies are distinct brand/company pairs.
    // Only augment a record when its stable ID matches exactly.
    if (idMatch && ['public','consumer','tech'].includes(candidate.cohort) && kept.cohort !== 'original-100') {
      if (brand.name && brand.name !== kept.name && brand.name.length > kept.name.length) kept.name = brand.name;
      if (brand.sector) kept.sector = brand.sector;
      if (brand.country) kept.country = brand.country;
      if (brand.identityType && brand.identityType !== 'company') kept.identityType = brand.identityType;
      if (brand.parentBrandId) kept.parentBrandId = brand.parentBrandId;
      kept.selectionEvidence = `${kept.selectionEvidence}; ${brand.selectionEvidence}`;
      if (idMatch && domain !== kept.domain && !kept.aliases.includes(domain)) kept.aliases.push(domain);
    }
    (domainMatch ? duplicateDomains : duplicateIds).push({ rejected:brand, kept });
    continue;
  }
  selected.push(brand);byDomain.set(domain,brand);byId.set(id,brand);
  for (const alias of brand.aliases) {
    const value = String(alias).toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/$/,'');
    if (value && !byAlias.has(value)) byAlias.set(value,brand);
  }
}
for (const brand of selected) {
  for (const alias of brand.aliases) {
    const domain = String(alias).toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/$/,'');
    const owner = byDomain.get(domain);
    if (owner && owner.id !== brand.id) aliasConflicts.push({ alias:domain, owner:brand.id, canonical:owner.id });
  }
}
const partial = process.argv.includes('--partial');
const target = partial ? selected.length : 1000;
if (!partial && selected.length < target) throw new Error(`Only ${selected.length} unique candidates for a ${target}-brand target; add researched candidates.`);
function stratified(pool, count) {
  const groups = new Map();
  for (const item of pool) {
    const key = item.sector ?? 'unspecified';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const chosen = [];
  while (chosen.length < count && [...groups.values()].some(group => group.length)) {
    for (const group of groups.values()) {
      if (chosen.length >= count) break;
      if (group.length) chosen.push(group.shift());
    }
  }
  return chosen;
}
let finalBrands;
if (partial) finalBrands = selected.slice();
else {
  const protectedBrands = selected.filter(item => ['original-100','major-brands-fixture'].includes(item.cohort));
  const pools = Object.fromEntries(['public','consumer','tech'].map(cohort => [cohort, selected.filter(item => item.cohort === cohort)]));
  const desired = { public:230, consumer:240, tech:230 };
  finalBrands = [...protectedBrands, ...Object.entries(desired).flatMap(([cohort,count]) => stratified(pools[cohort],count))];
  const chosen = new Set(finalBrands.map(item => item.id));
  for (const item of selected) {
    if (finalBrands.length >= target) break;
    if (!chosen.has(item.id)) { finalBrands.push(item); chosen.add(item.id); }
  }
  finalBrands = finalBrands.slice(0,target);
}
const selectedIds = new Set(finalBrands.map(brand => brand.id));
const promotedParents = [];
for (let index = 0; index < finalBrands.length; index++) {
  const parentId = finalBrands[index].parentBrandId;
  if (!parentId || selectedIds.has(parentId) || !byId.has(parentId)) continue;
  const parent = byId.get(parentId);
  let removeIndex = finalBrands.length - 1;
  while (removeIndex >= legacy.length && (
    finalBrands[removeIndex].id === parentId ||
    finalBrands.some(brand => brand.parentBrandId === finalBrands[removeIndex].id)
  )) removeIndex--;
  if (removeIndex < legacy.length) throw new Error(`Cannot include required parent ${parentId} without dropping a protected identity.`);
  const removed = finalBrands.splice(removeIndex,1)[0];
  selectedIds.delete(removed.id);
  finalBrands.push(parent);
  selectedIds.add(parent.id);
  promotedParents.push({ parentId, forBrand:finalBrands[index].id, displaced:removed.id });
}
for (const brand of finalBrands) {
  if (brand.parentBrandId && byId.has(brand.parentBrandId) && !selectedIds.has(brand.parentBrandId)) {
    throw new Error(`Selected ${brand.id} has an available but unselected parent ${brand.parentBrandId}.`);
  }
}
const parentIdAliases = new Map([
  ['mondelez','mondelez-international'],
  ['estee-lauder-companies','este-e-lauder'],
]);
const externalParents = [];
for (const brand of finalBrands) {
  if (!brand.parentBrandId) continue;
  brand.parentBrandId = parentIdAliases.get(brand.parentBrandId) ?? brand.parentBrandId;
  if (selectedIds.has(brand.parentBrandId)) continue;
  // Preserve known ownership without inventing a library entry or a logo for it.
  brand.externalParentBrandId = brand.parentBrandId;
  externalParents.push({ id:brand.id, externalParentBrandId:brand.parentBrandId });
  brand.parentBrandId = null;
}
const source = {
  schemaVersion:2,libraryId:'major-brands-1000-v1',expectedCount:target,
  selectionMethod:'Usage-oriented global importance and display frequency; preserves the reviewed first 100, then adds the existing major-brands fixture and researched cross-sector cohorts. Not a ranked market-cap index.',
  brands:finalBrands,
};
if (process.argv.includes('--check')) {
  const ids = new Set(source.brands.map(brand => brand.id));
  if (ids.size !== target) throw new Error(`Expected ${target} unique IDs, got ${ids.size}.`);
  for (const brand of source.brands) {
    if (brand.parentBrandId && !ids.has(brand.parentBrandId)) throw new Error(`Missing parent for ${brand.id}.`);
  }
  for (const [id, name, parentBrandId] of [
    ['bolt', 'Bolt', null], ['extra', 'eXtra', null], ['amul', 'Amul', null],
    ['ola', 'Ola', null], ['max-streaming', 'HBO Max', 'warner-bros-discovery'],
  ]) {
    const brand = source.brands.find(item => item.id === id);
    if (!brand || brand.name !== name || brand.parentBrandId !== parentBrandId) {
      throw new Error(`Incorrect identity mapping for ${id}: ${JSON.stringify(brand)}`);
    }
  }
  console.log(JSON.stringify({ checked:true, selected:target, uniqueCandidates:selected.length },null,2));
  process.exit(0);
}
const audit = {
  generatedAt:new Date().toISOString(),totalCandidates:ordered.length,uniqueCandidates:selected.length,
  selected:target,promotedParents,externalParents,unselected:selected.filter(brand => !selectedIds.has(brand.id)).map(({id,name,domain,cohort}) => ({id,name,domain,cohort})),
  duplicateDomains,duplicateIds,aliasConflicts,
  cohortCounts:Object.fromEntries([...new Set(source.brands.map(x=>x.cohort))].map(cohort=>[cohort,source.brands.filter(x=>x.cohort===cohort).length])),
};
await mkdir(root,{recursive:true});
await writeFile(resolve(root,'sources.json'),JSON.stringify(source,null,2)+'\n');
await writeFile(resolve(root,'selection-audit.json'),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify({selected:target,uniqueCandidates:selected.length,duplicateDomains:duplicateDomains.length,duplicateIds:duplicateIds.length,aliasConflicts:aliasConflicts.length,cohortCounts:audit.cohortCounts},null,2));
