const form = document.querySelector('#extract-form');
const input = document.querySelector('#website');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const domain = document.querySelector('#result-domain');
const diagnostics = document.querySelector('#diagnostics');
const roleGrid = document.querySelector('#role-grid');
const familyGrid = document.querySelector('#family-grid');
const button = form.querySelector('button');

form.addEventListener('submit', async event => {
  event.preventDefault();
  results.hidden = true;
  setStatus('Searching the website and validating image files…', 'loading');
  button.disabled = true;
  try {
    const response = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ website: input.value }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Extraction failed.');
    render(payload);
    setStatus(payload.candidates.length ? `Found ${payload.candidates.length} validated candidate${payload.candidates.length === 1 ? '' : 's'}.` : 'The website responded, but no usable logo image was found.', payload.candidates.length ? 'success' : 'error');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

function setStatus(message, state) {
  status.textContent = message;
  status.dataset.state = state;
}

function render(payload) {
  domain.textContent = payload.domain;
  diagnostics.innerHTML = [
    ['validated', payload.diagnostics.validated],
    ['families', payload.diagnostics.families ?? payload.assetFamilies?.length ?? payload.candidates.length],
    ['duration', `${(payload.diagnostics.durationMs / 1000).toFixed(1)}s`],
  ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
  roleGrid.innerHTML = [
    ['icon', 'Icon', 'For profiles, cards, and app tiles'],
    ['wide', 'Wordmark', 'For headers, decks, and brand rows'],
    ['favicon', 'Favicon', 'For browser tabs and compact UI'],
  ].map(([role, label, description]) => roleCard(payload.selectedByRole?.[role], role, label, description, payload.domain)).join('');

  const families = payload.assetFamilies?.length ? payload.assetFamilies : fallbackFamilies(payload.candidates);
  familyGrid.innerHTML = families.map(family => familyCard(family, payload.candidates, payload.domain)).join('');
  results.hidden = false;
}

function roleCard(item, role, label, description, resultDomain) {
  if (!item) return `<article class="role-card empty">
    <div class="role-heading"><span>${escapeHtml(label)}</span><em>Not found</em></div>
    <div class="empty-body"><strong>No reliable ${escapeHtml(label.toLowerCase())}</strong><p>${escapeHtml(description)}.</p></div>
  </article>`;
  const dimensions = item.width && item.height ? `${formatNumber(item.width)} × ${formatNumber(item.height)}` : item.format.toUpperCase();
  return `<article class="role-card selected">
    <div class="role-heading"><span>${escapeHtml(label)}</span><em>Best for this use</em></div>
    <div class="preview"><img src="${escapeHtml(item.dataUrl)}" alt="Recommended ${escapeHtml(label.toLowerCase())} for ${escapeHtml(resultDomain)}"></div>
    <div class="candidate-body">
      <div class="rank"><span>${escapeHtml(item.source)}</span><span>${escapeHtml(item.confidence_band)} confidence</span></div>
      <h3>${escapeHtml(dimensions)}</h3>
      <p>${escapeHtml(description)} · role score ${escapeHtml(item.role_scores?.[role] ?? item.score)}</p>
      <div class="actions">
        <a href="${escapeHtml(item.dataUrl)}" download="${safeFilename(item, resultDomain, role)}">Download ${escapeHtml(item.format.toUpperCase())}</a>
        ${sourceLink(item)}
      </div>
    </div>
  </article>`;
}

function familyCard(family, candidates, resultDomain) {
  const members = family.candidateIndexes.map(index => candidates[index]).filter(Boolean);
  const item = candidates[family.representativeIndex] ?? members[0];
  if (!item) return '';
  const roles = family.roles?.length ? family.roles : [...new Set(members.flatMap(member => member.predicted_roles ?? []))];
  const roleLabels = roles.map(role => role === 'wide' ? 'wordmark' : role);
  return `<article class="family-card">
    <div class="preview family-preview"><img src="${escapeHtml(item.dataUrl)}" alt="Logo asset family for ${escapeHtml(resultDomain)}"></div>
    <div class="candidate-body">
      <div class="rank"><span>${escapeHtml(roleLabels.join(' · ') || 'candidate')}</span><span>${members.length} file${members.length === 1 ? '' : 's'}</span></div>
      <h3>${familyTitle(item, roles)}</h3>
      <p>${escapeHtml(item.source)} · ${escapeHtml(item.confidence_band)} confidence</p>
      <div class="variant-list" aria-label="Available files">
        ${members.map(member => variantLink(member, resultDomain, roles[0] ?? 'logo')).join('')}
      </div>
      <div class="actions">${sourceLink(item)}</div>
    </div>
  </article>`;
}

function familyTitle(item, roles) {
  if (roles.includes('wide')) return 'Wordmark family';
  if (roles.includes('icon')) return 'Icon family';
  if (roles.includes('favicon')) return 'Favicon family';
  return item.squareish ? 'Square asset' : 'Logo candidate';
}

function variantLink(item, resultDomain, role) {
  const dimensions = item.width && item.height ? `${formatNumber(item.width)}×${formatNumber(item.height)}` : 'scalable';
  return `<a href="${escapeHtml(item.dataUrl)}" download="${safeFilename(item, resultDomain, role)}"><strong>${escapeHtml(item.format.toUpperCase())}</strong><span>${escapeHtml(dimensions)}</span><span>↓</span></a>`;
}

function sourceLink(item) {
  const source = String(item.resolvedUrl ?? item.resolved_url ?? '');
  const href = source.startsWith('http:') || source.startsWith('https:') ? source : item.source_page;
  return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">Source ↗</a>` : '';
}

function fallbackFamilies(candidates) {
  return candidates.map((item, index) => ({
    id: item.family_id ?? `family-${index + 1}`,
    candidateIndexes: [index], representativeIndex: index, variantCount: 1,
    roles: item.predicted_roles ?? [],
  }));
}

function safeFilename(item, resultDomain, role) {
  const dimensions = item.width && item.height ? `-${formatNumber(item.width)}x${formatNumber(item.height)}` : '';
  return `${resultDomain}-${role}${dimensions}.${item.format}`.replace(/[^a-z0-9._-]/gi, '-');
}

function formatNumber(value) {
  return Number.isInteger(value) ? value : Math.round(value * 10) / 10;
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
