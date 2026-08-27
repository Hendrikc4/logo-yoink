import { adaptBrandResults, additionalAssetFamilies, brandRoleLabel, describeVariant } from './result-adapter.js';

const form = document.querySelector('#extract-form');
const input = document.querySelector('#website');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const domain = document.querySelector('#result-domain');
const diagnostics = document.querySelector('#diagnostics');
const roleGrid = document.querySelector('#role-grid');
const familyGrid = document.querySelector('#family-grid');
const completeResults = document.querySelector('#complete-results');
const resultCount = document.querySelector('#result-count');
const button = form.querySelector('button');
const buttonLabel = button.querySelector('.button-label');
const trainLoader = status.querySelector('.train-loader');
const statusMessage = status.querySelector('.status-message');

let activeRequest = null;
let requestSequence = 0;
const renderedAssets = new Map();

form.addEventListener('submit', async event => {
  event.preventDefault();
  const website = input.value.trim();
  if (!website) {
    input.setAttribute('aria-invalid', 'true');
    setStatus('Enter a website URL to start a lookup.', 'error');
    input.focus();
    return;
  }

  input.removeAttribute('aria-invalid');
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const sequence = ++requestSequence;

  clearResults();
  setLoading(true);
  setStatus(`Inspecting ${displayWebsite(website)} and validating its logo files…`, 'loading');

  try {
    const response = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ website }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'We could not inspect that website.');
    if (sequence !== requestSequence) return;

    if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) {
      setStatus(`No usable logo files were found for ${payload.domain || displayWebsite(website)}. Try the site’s canonical homepage URL.`, 'error');
      return;
    }

    render(payload);
    setStatus(`Found logo candidates for ${payload.domain}. Recommended assets are ready below.`, 'success');
  } catch (error) {
    if (error.name === 'AbortError' || sequence !== requestSequence) return;
    setStatus(normalizeError(error), 'error');
  } finally {
    if (sequence === requestSequence) {
      activeRequest = null;
      setLoading(false);
    }
  }
});

function setLoading(isLoading) {
  button.disabled = isLoading;
  buttonLabel.textContent = isLoading ? 'Yoinking…' : 'Yoink it';
  form.setAttribute('aria-busy', String(isLoading));
}

function setStatus(message, state = '') {
  const trainWasRunning = trainLoader.classList.contains('train-loader--running');
  const shouldParkTrain = state === 'success' || (state === 'error' && trainWasRunning);

  statusMessage.textContent = message;
  trainLoader.classList.toggle('train-loader--running', state === 'loading' || shouldParkTrain);
  trainLoader.classList.toggle('train-loader--complete', shouldParkTrain);

  if (state) status.dataset.state = state;
  else delete status.dataset.state;
}

function clearResults() {
  results.hidden = true;
  roleGrid.replaceChildren();
  familyGrid.replaceChildren();
  diagnostics.replaceChildren();
  completeResults.open = false;
  completeResults.hidden = true;
  resultCount.textContent = '';
  renderedAssets.clear();
}

function render(payload) {
  domain.textContent = payload.domain;
  diagnostics.innerHTML = [
    ['validated', payload.diagnostics?.validated ?? payload.candidates.length],
    ['families', payload.diagnostics?.families ?? payload.assetFamilies?.length ?? payload.candidates.length],
    ['duration', formatDuration(payload.diagnostics?.durationMs)],
  ].map(([label, value]) => `<span>${escapeHtml(label)}: ${escapeHtml(value)}</span>`).join('');

  roleGrid.innerHTML = adaptBrandResults(payload)
    .map((asset, index) => roleCard(asset, payload.domain, index + 1))
    .join('');

  const families = additionalAssetFamilies(payload);
  familyGrid.innerHTML = families.map(family => familyCard(family, payload.candidates, payload.domain)).join('');
  const additionalCount = families.reduce((sum, family) => sum + (family.candidateIndexes?.length ?? 0), 0);
  resultCount.textContent = `(${additionalCount})`;
  completeResults.open = false;
  completeResults.hidden = families.length === 0;
  results.hidden = false;
}

function roleCard(asset, resultDomain, index) {
  const { selected: item, key: role, label, description, variants } = asset;
  if (!item) return `<article class="role-card empty">
    <div class="role-heading"><span class="role-number">${index}</span><h3>${escapeHtml(label)}</h3></div>
    <div class="preview"><span class="empty-mark" aria-hidden="true">—</span></div>
    <div class="candidate-body"><p>No reliable ${escapeHtml(label.toLowerCase())} was found for this website.</p><div class="candidate-meta"><span>Not found</span></div></div>
  </article>`;

  const dimensions = dimensionsFor(item);
  const format = String(item.format || 'file').toUpperCase();
  const assetId = `asset-${index}`;
  renderedAssets.set(assetId, { role, resultDomain, variants });
  return `<article class="role-card selected">
    <div class="role-heading"><span class="role-number">${index}</span><h3>${escapeHtml(label)}</h3></div>
    ${previewControls(assetId, label)}
    <div class="preview" data-preview-background="transparent">
      <img data-asset-image src="${escapeHtml(item.dataUrl)}" alt="Recommended ${escapeHtml(label.toLowerCase())} for ${escapeHtml(resultDomain)}">
      <a class="download-overlay" data-asset-download href="${escapeHtml(item.dataUrl)}" download="${safeFilename(item, resultDomain, role)}">Download <span aria-hidden="true">↓</span></a>
    </div>
    <div class="candidate-body"><p>${escapeHtml(description)}</p>${variantPicker(assetId, variants)}<div class="candidate-meta"><span data-asset-format>${escapeHtml(format)}</span><span data-asset-dimensions>${escapeHtml(dimensions)}</span></div></div>
  </article>`;
}

function previewControls(assetId, label) {
  return `<div class="preview-toolbar">
    <span>Preview background</span>
    <div class="preview-options" role="group" aria-label="Preview ${escapeHtml(label.toLowerCase())} background" data-preview-for="${assetId}">
      ${previewButton('white', 'White', false)}
      ${previewButton('transparent', 'Transparent', true)}
      ${previewButton('black', 'Black', false)}
    </div>
  </div>`;
}

function previewButton(value, label, pressed) {
  return `<button type="button" data-preview-background="${value}" aria-pressed="${pressed}" title="Preview on ${label.toLowerCase()}"><span class="preview-swatch" aria-hidden="true"></span><span>${label}</span></button>`;
}

function variantPicker(assetId, variants) {
  if (variants.length < 2) return '';
  return `<label class="variant-picker"><span>Asset version</span><select data-asset-variant="${assetId}">${variants.map((item, index) => {
    const descriptors = describeVariant(item);
    const fallback = `${String(item.format || 'file').toUpperCase()} · ${dimensionsFor(item)}`;
    return `<option value="${index}">${escapeHtml(descriptors.length ? descriptors.join(' · ') : fallback)}</option>`;
  }).join('')}</select></label>`;
}

function familyCard(family, candidates, resultDomain) {
  const indexes = Array.isArray(family.candidateIndexes) ? family.candidateIndexes : [];
  const members = indexes.map(index => candidates[index]).filter(Boolean);
  const item = candidates[family.representativeIndex] ?? members[0];
  if (!item) return '';
  const roles = family.roles?.length ? family.roles : [...new Set(members.flatMap(member => member.predicted_roles ?? []))];
  const roleLabels = [...new Set(roles.map(brandRoleLabel))];
  return `<article class="family-card">
    <div class="preview"><img src="${escapeHtml(item.dataUrl)}" alt="Logo asset family for ${escapeHtml(resultDomain)}"></div>
    <div class="candidate-body">
      <div class="rank"><span>${escapeHtml(roleLabels.join(' · ') || 'candidate')}</span><span>${members.length} file${members.length === 1 ? '' : 's'}</span></div>
      <h3>${familyTitle(item, roles)}</h3>
      <p>${escapeHtml(item.source)} · ${escapeHtml(item.confidence_band || 'ranked')} confidence</p>
      <div class="variant-list" aria-label="Available files">${members.map(member => variantLink(member, resultDomain, roles[0] ?? 'logo')).join('')}</div>
      <div class="actions">${sourceLink(item)}</div>
    </div>
  </article>`;
}

function familyTitle(item, roles) {
  if (roles.includes('wide')) return 'Wordmark family';
  if (roles.includes('icon')) return 'Icon family';
  if (roles.includes('favicon')) return 'Icon family';
  return item.squareish ? 'Square asset' : 'Logo candidate';
}

function variantLink(item, resultDomain, role) {
  return `<a href="${escapeHtml(item.dataUrl)}" download="${safeFilename(item, resultDomain, role)}"><strong>${escapeHtml(String(item.format || 'file').toUpperCase())}</strong><span>${escapeHtml(dimensionsFor(item))}</span><span aria-hidden="true">↓</span></a>`;
}

function sourceLink(item) {
  const source = String(item.resolvedUrl ?? item.resolved_url ?? '');
  const href = /^https?:/.test(source) ? source : item.source_page;
  return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">View source ↗</a>` : '';
}

function dimensionsFor(item) {
  return item.width && item.height ? `${formatNumber(item.width)}×${formatNumber(item.height)}` : 'Scalable';
}

function safeFilename(item, resultDomain, role) {
  const dimensions = item.width && item.height ? `-${formatNumber(item.width)}x${formatNumber(item.height)}` : '';
  return `${resultDomain}-${role}${dimensions}.${item.format || 'img'}`.replace(/[^a-z0-9._-]/gi, '-');
}

function displayWebsite(value) {
  return value.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function formatDuration(value) {
  return Number.isFinite(value) ? `${(value / 1000).toFixed(1)}s` : '—';
}

function normalizeError(error) {
  const message = String(error?.message || 'Logo lookup failed. Please try again.');
  return message === 'Failed to fetch' ? 'The lookup service could not be reached. Please try again.' : message;
}

function formatNumber(value) {
  return Number.isInteger(value) ? value : Math.round(value * 10) / 10;
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

roleGrid.addEventListener('pointerover', event => {
  if (event.pointerType && event.pointerType !== 'mouse') return;
  const control = event.target.closest('[data-preview-for] button');
  if (control) setPreviewBackground(control);
});

roleGrid.addEventListener('focusin', event => {
  const control = event.target.closest('[data-preview-for] button');
  if (control) setPreviewBackground(control);
});

roleGrid.addEventListener('click', event => {
  const control = event.target.closest('[data-preview-for] button');
  if (control) setPreviewBackground(control);
});

roleGrid.addEventListener('change', event => {
  const select = event.target.closest('[data-asset-variant]');
  if (!select) return;
  const asset = renderedAssets.get(select.dataset.assetVariant);
  const item = asset?.variants[Number(select.value)];
  const card = select.closest('.role-card');
  if (!item || !card) return;
  card.querySelector('[data-asset-image]').src = item.dataUrl;
  const download = card.querySelector('[data-asset-download]');
  download.href = item.dataUrl;
  download.download = safeFilename(item, asset.resultDomain, asset.role);
  card.querySelector('[data-asset-format]').textContent = String(item.format || 'file').toUpperCase();
  card.querySelector('[data-asset-dimensions]').textContent = dimensionsFor(item);
});

function setPreviewBackground(control) {
  const controls = control.closest('[data-preview-for]');
  const card = control.closest('.role-card');
  const preview = card?.querySelector('.preview');
  if (!controls || !preview) return;
  preview.dataset.previewBackground = control.dataset.previewBackground;
  for (const button of controls.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button === control));
}
