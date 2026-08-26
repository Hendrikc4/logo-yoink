const sidebar = document.querySelector('.docs-sidebar');
const menuButton = document.querySelector('.menu-button');
const menuScrim = document.querySelector('.menu-scrim');
const filter = document.querySelector('#docs-filter');
const sectionLinks = [...document.querySelectorAll('.section-nav a')];
const pageLinks = [...document.querySelectorAll('.on-this-page nav a')];

function setMenu(open) {
  sidebar?.classList.toggle('is-open', open);
  menuButton?.setAttribute('aria-expanded', String(open));
  if (menuScrim) menuScrim.hidden = !open;
  document.body.style.overflow = open ? 'hidden' : '';
}

menuButton?.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
menuScrim?.addEventListener('click', () => setMenu(false));
sectionLinks.forEach(link => link.addEventListener('click', () => setMenu(false)));

document.addEventListener('keydown', event => {
  const element = event.target;
  const isTyping = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element?.isContentEditable;
  if (event.key === '/' && !isTyping) {
    event.preventDefault();
    if (window.innerWidth <= 800) setMenu(true);
    filter?.focus();
  }
  if (event.key === 'Escape') {
    setMenu(false);
    filter?.blur();
  }
});

filter?.addEventListener('input', () => {
  const query = filter.value.trim().toLowerCase();
  sectionLinks.forEach(link => {
    const section = document.querySelector(link.hash);
    const haystack = `${link.textContent} ${section?.dataset.docTitle ?? ''}`.toLowerCase();
    link.hidden = Boolean(query) && !haystack.includes(query);
  });
  document.querySelectorAll('.section-nav > div').forEach(group => {
    group.hidden = [...group.querySelectorAll('a')].every(link => link.hidden);
  });
});

document.querySelectorAll('.code-tabs').forEach(tabs => {
  const windowElement = tabs.closest('.code-window');
  tabs.addEventListener('click', event => {
    const button = event.target.closest('.code-tab');
    if (!button) return;
    tabs.querySelectorAll('.code-tab').forEach(tab => tab.classList.toggle('is-active', tab === button));
    windowElement.querySelectorAll('[data-code-panel]').forEach(panel => {
      panel.hidden = panel.dataset.codePanel !== button.dataset.language;
    });
  });
});

document.querySelectorAll('.copy-button').forEach(button => {
  button.addEventListener('click', async () => {
    const target = button.dataset.copyTarget
      ? document.getElementById(button.dataset.copyTarget)
      : button.closest('.code-window')?.querySelector('[data-code-panel]:not([hidden])');
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.innerText);
      button.textContent = 'Copied';
      button.classList.add('is-copied');
      window.setTimeout(() => { button.textContent = 'Copy'; button.classList.remove('is-copied'); }, 1600);
    } catch {
      button.textContent = 'Select text';
    }
  });
});

const observedSections = [...document.querySelectorAll('.docs-main section[id]')];
const activeObserver = new IntersectionObserver(entries => {
  const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  const hash = `#${visible.target.id}`;
  [...sectionLinks, ...pageLinks].forEach(link => link.classList.toggle('is-active', link.hash === hash));
}, { rootMargin: '-15% 0px -70%', threshold: [0, .1, .5] });
observedSections.forEach(section => activeObserver.observe(section));
