const form = document.querySelector('#extract-form');
const input = document.querySelector('#website');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const domain = document.querySelector('#result-domain');
const diagnostics = document.querySelector('#diagnostics');
const grid = document.querySelector('#candidate-grid');
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
    ['discovered', payload.diagnostics.discovered],
    ['duration', `${(payload.diagnostics.durationMs / 1000).toFixed(1)}s`],
  ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
  grid.innerHTML = payload.candidates.map((item, index) => candidateCard(item, index)).join('');
  results.hidden = false;
}

function candidateCard(item, index) {
  const dimensions = item.width && item.height ? `${formatNumber(item.width)} × ${formatNumber(item.height)}` : item.format.toUpperCase();
  const quality = item.squareish && item.highResolution ? 'High-quality square' : item.squareish ? 'Small square' : 'Rectangular';
  return `<article class="candidate ${index === 0 ? 'selected' : ''}">
    <div class="preview"><img src="${item.dataUrl}" alt="Logo candidate ${index + 1}"></div>
    <div class="candidate-body">
      <div class="rank">${index === 0 ? 'Best match' : `Candidate ${index + 1}`}<span>${escapeHtml(item.source)}</span></div>
      <h3>${escapeHtml(dimensions)}</h3>
      <p>${escapeHtml(quality)} · score ${item.score}</p>
      <div class="actions">
        <a href="${item.dataUrl}" download="${safeFilename(item)}">Download</a>
        <a href="${escapeHtml(item.resolvedUrl)}" target="_blank" rel="noreferrer">Source ↗</a>
      </div>
    </div>
  </article>`;
}

function safeFilename(item) {
  return `logo-${item.source}.${item.format}`.replace(/[^a-z0-9._-]/gi, '-');
}

function formatNumber(value) {
  return Number.isInteger(value) ? value : Math.round(value * 10) / 10;
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
