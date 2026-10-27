import './styles.css';
import { loadConfig } from './lib/config.js';
import { initClient, db, rpc, run } from './lib/supabase.js';
import { state, roleLabel } from './lib/state.js';
import { h, clear } from './lib/dom.js';
import { showError, toast } from './lib/ui.js';
import { renderLogin } from './views/login.js';
import { renderClaimOwner, renderSetupWizard } from './views/setup.js';
import { startRouter, stopRouter } from './router.js';
import { applySavedSizes } from './lib/resize.js';
import { icon, trimLogo } from './lib/icons.js';

applySavedSizes();

const app = document.getElementById('app');
let sessionToken = 0;

async function boot() {
  const config = await loadConfig();
  state.config = config;
  if (config.problems.length) return renderConfigError(config.problems);

  initClient(config);
  await loadPublicProfile();

  // Never await network work inside the auth callback (supabase-js deadlock).
  db().auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return;
    if (event === 'PASSWORD_RECOVERY') { setTimeout(() => renderLogin(app, { recovery: true, onSignedIn }), 0); return; }
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') { state.session = session; return; }
    setTimeout(() => onSession(session), 0);
  });

  const recovery = /type=recovery/.test(location.hash) || new URLSearchParams(location.search).get('type') === 'recovery';
  const { data } = await db().auth.getSession();
  if (recovery && data.session) return renderLogin(app, { recovery: true, onSignedIn });
  await onSession(data.session);
}

async function loadPublicProfile() {
  try {
    state.publicProfile = await rpc('get_public_store_profile');
  } catch (e) {
    console.warn('Store profile unavailable:', e.message);
    state.publicProfile = null;
  }
  applyBranding(state.publicProfile);
}

export function applyBranding(p) {
  const name = p?.business_name || 'Grocery POS';
  document.title = name;
  const color = /^#[0-9a-f]{6}$/i.test(p?.primary_color || '') ? p.primary_color : '#16376A';
  document.documentElement.style.setProperty('--brand', color);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', color);
}

function onSignedIn(session) { return onSession(session); }

async function onSession(session) {
  const token = ++sessionToken;
  state.session = session;
  state.profile = null;
  state.settings = null;
  stopRouter();
  if (!session) return renderLogin(app, { onSignedIn });

  clear(app, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Checking your staff access…'));
  try {
    const profile = await run(db().from('profiles').select('id,full_name,role,active').eq('id', session.user.id).maybeSingle());
    if (token !== sessionToken) return;
    if (!profile || !profile.active || (state.publicProfile && !state.publicProfile.has_owner && profile.role !== 'owner')) {
      if (state.publicProfile && !state.publicProfile.has_owner) {
        return renderClaimOwner(app, { session, onDone: async () => { await loadPublicProfile(); await onSession(session); } });
      }
      return renderNoAccess(session, profile);
    }
    state.profile = profile;
    const settings = await run(db().from('store_settings').select('*').maybeSingle()).catch(() => null);
    if (token !== sessionToken) return;
    state.settings = settings || { ...(state.publicProfile || {}), currency_code: 'UGX', currency_decimals: 0, locale: 'en-UG', timezone: 'Africa/Kampala', receipt_prefix: 'RCP' };
    applyBranding(state.settings);

    if (profile.role === 'owner' && settings && !settings.setup_completed) {
      return renderSetupWizard(app, { onDone: async () => { await loadPublicProfile(); await onSession(state.session); } });
    }
    renderShell();
  } catch (e) {
    if (token !== sessionToken) return;
    clear(app, h('div', { class: 'center-screen' }, h('div', { class: 'panel narrow' },
      h('h1', null, 'Could not load your account'),
      h('p', { class: 'muted' }, e.message),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => onSession(session) }, 'Try again'),
        h('button', { class: 'secondary', onclick: signOut }, 'Sign out')))));
  }
}

function renderNoAccess(session, profile) {
  clear(app, h('div', { class: 'center-screen' }, h('div', { class: 'panel narrow' },
    h('h1', null, profile && !profile.active ? 'Your account is switched off' : 'No staff access yet'),
    h('p', null, 'You are signed in as ', h('b', null, session.user.email), '.'),
    h('p', { class: 'muted' }, 'Ask the shop owner to activate your account in Staff, then sign in again.'),
    h('button', { class: 'primary', onclick: signOut }, 'Sign out'))));
}

export async function signOut() {
  try { await db().auth.signOut(); } catch (e) { showError(e); }
  state.session = null;
  state.profile = null;
  renderLogin(app, { onSignedIn });
}

// ------------------------------------------------------------------ shell
// Hidden items still work as links (e.g. Settings → Import, Inventory → Count stock) but stay out of the menu.
export const NAV = [
  { path: 'executive', label: 'Dashboard', icon: 'dashboard', roles: ['owner', 'manager', 'accountant'] },
  { path: 'sell', label: 'Sell', icon: 'sell', roles: null },
  { path: 'close', label: 'Close day', icon: 'close', roles: null },
  { path: 'products', label: 'Products', icon: 'products', roles: null },
  { path: 'customers', label: 'Customers', icon: 'customers', roles: null },
  { path: 'buy', label: 'Buy', icon: 'buy', roles: null },
  { path: 'inventory', label: 'Inventory', icon: 'inventory', roles: ['owner', 'manager', 'accountant'] },
  { path: 'reports', label: 'Reports', icon: 'reports', roles: null },
  { path: 'accounts', label: 'Accounts', icon: 'accounts', roles: ['owner', 'manager', 'accountant'] },
  { path: 'staff', label: 'Staff', icon: 'staff', roles: ['owner', 'manager'] },
  { path: 'settings', label: 'Settings', icon: 'settings', roles: null },
  { path: 'home', label: 'Home', icon: 'home', roles: null, hidden: true },
  { path: 'count', label: 'Count stock', icon: 'count', roles: ['owner', 'manager', 'accountant'], hidden: true },
  { path: 'import', label: 'Import data', icon: 'import', roles: ['owner', 'manager'], hidden: true }
];

function renderShell() {
  const s = state.settings || {};
  const items = NAV.filter(n => !n.roles || n.roles.includes(state.profile.role));
  const navLink = n => h('a', { href: '#/' + n.path, class: 'nav-link', dataset: { path: n.path } }, h('span', { class: 'nav-icon', 'aria-hidden': 'true', html: icon(n.icon) }), h('span', null, n.label));
  const brand = h('div', { class: 'brand' },
    s.logo_url ? h('img', { src: s.logo_url, alt: s.business_name || 'Logo', class: 'brand-logo' }) : h('div', { class: 'brand-mark' }, (s.business_name || 'G').slice(0, 1)),
    s.logo_url ? null : h('div', null, h('b', null, s.business_name || 'Grocery'), s.tagline ? h('small', null, s.tagline) : null));
  const user = h('div', { class: 'user-chip' },
    h('div', { class: 'avatar' }, initials(state.profile.full_name || state.session.user.email)),
    h('div', null, h('b', null, state.profile.full_name || state.session.user.email), h('small', null, roleLabel(state.profile.role))),
    h('button', { class: 'link', onclick: signOut }, 'Sign out'));
  const drawer = h('aside', { class: 'sidebar', id: 'sidebar' }, brand, h('nav', { 'aria-label': 'Main' }, items.filter(n => !n.hidden).map(navLink)), user);
  const main = h('main', { id: 'view', tabindex: '-1' });
  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn menu-btn', 'aria-label': 'Open menu', onclick: () => document.body.classList.toggle('drawer-open') }, '☰'),
    s.logo_url ? h('img', { src: s.logo_url, alt: '', class: 'brand-logo-top' }) : null,
    h('b', null, s.business_name || 'Grocery'),
    h('a', { class: 'primary small', href: '#/sell' }, 'Sell'));
  const bottom = h('nav', { class: 'bottom-nav', 'aria-label': 'Quick' },
    items.filter(n => ['executive', 'sell', 'close', 'products'].includes(n.path)).slice(0, 4).map(navLink),
    h('button', { class: 'nav-link', onclick: () => document.body.classList.toggle('drawer-open') }, h('span', { class: 'nav-icon', html: icon('menu') }), h('span', null, 'More')));
  const scrim = h('div', { class: 'scrim', onclick: () => document.body.classList.remove('drawer-open') });
  clear(app, h('div', { class: 'shell' }, drawer, scrim, h('div', { class: 'content' }, topbar, main), bottom));
  // Sharper, larger logo: trim its white margin so the artwork fills the frame.
  for (const img of app.querySelectorAll('.brand-logo, .brand-logo-top')) trimLogo(img.src).then(src => { if (src) img.src = src; });
  startRouter(main, items);
}

function initials(name) {
  return String(name || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
}

function renderConfigError(problems) {
  clear(app, h('div', { class: 'center-screen' }, h('div', { class: 'panel narrow' },
    h('h1', null, 'Setup needed'),
    h('p', null, 'This app is not connected to a database yet. Edit ', h('code', null, 'config.json'), ' next to index.html:'),
    h('ul', null, problems.map(p => h('li', null, p))),
    h('pre', null, '{\n  "supabaseUrl": "https://YOUR-PROJECT.supabase.co",\n  "supabaseKey": "sb_publishable_..."\n}'),
    h('p', { class: 'muted' }, 'Use the publishable (or anon) key from Supabase → Project Settings → API. Never use a secret/service-role key.'))));
}

window.addEventListener('unhandledrejection', e => { if (e.reason) showError(e.reason); });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {}));
}

// ------------------------------------------------------------------ stay up to date
// Installed apps can keep an old version open for days. Every few minutes (and when the
// window comes back into view) check whether a newer version has been published; if so,
// switch to it at the next screen change, or straight away with the Update button.
const myBuild = [...document.scripts].map(x => x.src).find(src => /assets\/index-[^/]+\.js$/.test(src)) || '';
let updateReady = false;
async function checkForUpdate() {
  if (!myBuild || updateReady || !navigator.onLine) return;
  try {
    const html = await fetch('./?build-check=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.text() : '');
    const latest = (html.match(/assets\/index-[^"']+\.js/) || [])[0];
    if (!latest || myBuild.endsWith(latest)) return;
    updateReady = true;
    const bar = h('div', { class: 'update-bar', role: 'status' },
      h('span', null, 'A new version of the app is ready.'),
      h('button', { class: 'primary small', type: 'button', onclick: () => location.reload() }, 'Update now'));
    document.body.append(bar);
    window.addEventListener('hashchange', () => location.reload(), { once: true });
  } catch { /* offline or blocked: try again later */ }
}
setInterval(checkForUpdate, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
setTimeout(checkForUpdate, 15000);

// A clear, persistent banner while the connection is down (sales cannot be saved offline).
const offlineBar = h('div', { class: 'offline-bar', role: 'alert' }, 'Offline — sales are NOT being saved. Keep the cart; finish the sale when the connection returns.');
function syncOnline() {
  if (navigator.onLine) offlineBar.remove(); else document.body.append(offlineBar);
}
window.addEventListener('online', () => { syncOnline(); toast('Back online.'); });
window.addEventListener('offline', syncOnline);
syncOnline();

boot().catch(showError);
