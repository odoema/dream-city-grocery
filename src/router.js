import { h, clear, $$ } from './lib/dom.js';
import { loading } from './lib/ui.js';

const views = {
  home: () => import('./views/home.js'),
  sell: () => import('./views/sell.js'),
  products: () => import('./views/products.js'),
  customers: () => import('./views/customers.js'),
  buy: () => import('./views/buy.js'),
  count: () => import('./views/count.js'),
  inventory: () => import('./views/inventory.js'),
  reports: () => import('./views/reports.js'),
  accounts: () => import('./views/accounts.js'),
  import: () => import('./views/import.js'),
  staff: () => import('./views/staff.js'),
  settings: () => import('./views/settings.js')
};

let mainEl = null;
let allowed = [];
let renderToken = 0;
let cleanup = null;

function onHash() { render(); }

export function startRouter(main, navItems) {
  mainEl = main;
  allowed = navItems.map(n => n.path);
  window.addEventListener('hashchange', onHash);
  render();
}

export function stopRouter() {
  window.removeEventListener('hashchange', onHash);
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  mainEl = null;
}

export function navigate(path) {
  if (location.hash === '#/' + path) render(); else location.hash = '#/' + path;
}

async function render() {
  if (!mainEl) return;
  const [path, query] = (location.hash.replace(/^#\/?/, '') || 'home').split('?');
  const name = allowed.includes(path) && views[path] ? path : 'home';
  const token = ++renderToken;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  document.body.classList.remove('drawer-open');
  $$('.nav-link[data-path]').forEach(a => a.classList.toggle('active', a.dataset.path === name));
  loading(mainEl);
  try {
    const mod = await views[name]();
    if (token !== renderToken) return;
    const params = new URLSearchParams(query || '');
    const result = await mod.render(mainEl, { params });
    if (typeof result === 'function') cleanup = result;
    mainEl.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    if (token !== renderToken) return;
    clear(mainEl, h('div', { class: 'panel' }, h('h1', null, 'Something went wrong'), h('p', { class: 'muted' }, e.message),
      h('button', { class: 'primary', onclick: () => render() }, 'Try again')));
  }
}
