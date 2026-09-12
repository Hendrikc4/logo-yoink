window.va = window.va || function analyticsQueue() {
  (window.vaq = window.vaq || []).push(arguments);
};

// Only fixed event names and categorical values may leave the page.
// Never send submitted websites, asset URLs, filenames, or error text.
window.yoinkTrack = function track(name, data = {}) {
  const allowed = {
    extraction_started: {},
    extraction_finished: { outcome: ['success', 'empty', 'error'] },
    asset_download: { placement: ['recommended', 'more_assets'] },
    github_clicked: { placement: ['result', 'page'] },
  };
  if (!Object.hasOwn(allowed, name)) return;
  const safe = {};
  for (const [key, values] of Object.entries(allowed[name])) {
    if (values.includes(data[key])) safe[key] = data[key];
  }
  try { window.va('event', { name, data: safe }); } catch { /* Analytics must never block a yoink. */ }
};

window.va('beforeSend', event => {
  const url = new URL(event.url);
  url.search = '';
  url.hash = '';
  return { ...event, url: url.toString() };
});

document.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link) return;
  if (link.hasAttribute('download') && link.closest('#results')) {
    window.yoinkTrack('asset_download', { placement: link.hasAttribute('data-asset-download') ? 'recommended' : 'more_assets' });
  }
  if (link.getAttribute('href') === 'https://github.com/Hendrikc4/logo-yoink') {
    window.yoinkTrack('github_clicked', { placement: link.dataset.githubPlacement === 'result' ? 'result' : 'page' });
  }
});
