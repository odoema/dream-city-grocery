(() => {
  'use strict';

  const config = window.DREAM_CITY_SUPABASE_CONFIG || {};
  const configured = typeof config.url === 'string'
    && config.url.includes('nohdgmylncjtdymfshfy.supabase.co')
    && typeof config.anonKey === 'string'
    && config.anonKey.length > 20
    && !config.anonKey.startsWith('REPLACE_');
  const client = configured && window.supabase
    ? window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;

  // Reuse the core application client in optional modules. This avoids creating
  // multiple GoTrueClient instances for the same Supabase project in one page.
  window.DREAM_CITY_SUPABASE_CLIENT = client;

  const $ = id => document.getElementById(id);
  const fmt = value => 'UGX ' + Math.round(Number(value || 0)).toLocaleString('en-UG');
  let profile = null;
  let products = [];
  let categories = [];
  let customers = [];
  let sales = [];
  let suppliers = [];
  let purchaseOrders = [];
  let supplierInvoices = [];
  let stocktakeSession = null;
  let stocktakeItems = [];
  let stocktakeHistory = [];
  let cart = [];
  let lastReceipt = null;
  let pendingIdempotencyKey = null;
  let busy = false;
  // Prevent overlapping auth callbacks from racing and resetting a valid session.
  let sessionCheckId = 0;

  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  function setMessage(message, isError = false) {
    const el = $('auth-message');
    if (el) {
      el.textContent = message || '';
      el.style.color = isError ? '#b42318' : '';
    }
  }

  function setConnectionStatus(label, detail, state = 'pending') {
    const labelEl = $('connection-label');
    const detailEl = $('connection-detail');
    const dot = $('connection-dot');
    if (labelEl) labelEl.textContent = label;
    if (detailEl) detailEl.textContent = detail;
    if (dot) {
      dot.classList.toggle('connection-ok', state === 'ok');
      dot.classList.toggle('connection-error', state === 'error');
      dot.classList.toggle('connection-pending', state === 'pending');
      dot.setAttribute('aria-label', state === 'ok' ? 'Connected' : state === 'error' ? 'Connection issue' : 'Connection not yet verified');
    }
  }

  function setSignedIn(signedIn) {
    $('auth-panel').classList.toggle('hidden', signedIn);
    $('sign-out').classList.toggle('hidden', !signedIn);
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('hidden', !signedIn));
    $('staff-status').textContent = signedIn && profile
      ? profile.full_name + ' · ' + profile.role
      : 'Not signed in';
    $('checkout').disabled = !signedIn || busy;
    if (!signedIn) {
      $('page-title').textContent = 'Staff sign in';
      $('checkout-note').textContent = 'Sign in to load live products and complete a sale.';
    } else {
      $('page-title').textContent = 'Owner dashboard';
      $('checkout-note').textContent = 'Checkout is posted atomically to the dedicated database.';
    }
  }

  function showView(view) {
    if (!profile) return;
    document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
    const target = $(view + '-view');
    if (target) target.classList.remove('hidden');
    document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    const titles = { dashboard: 'Owner dashboard', pos: 'Point of Sale', inventory: 'Inventory management', customers: 'Customer management', stocktake: 'Stock Taking & Reconciliation', purchases: 'Purchases', accounting: 'Accounting', reports: 'Reports & analytics' };
    $('page-title').textContent = titles[view] || 'Dream City Grocery';
    if (view === 'pos') renderProducts();
    if (view === 'inventory') renderInventory();
    if (view === 'customers') renderCustomers();
    if (view === 'stocktake') loadStocktakeData().catch(error => toast('Stock-taking could not load: ' + error.message));
    if (view === 'purchases') loadPurchaseData().catch(error => toast('Purchases could not load: ' + error.message));
    if (view === 'accounting') loadAccountingData().catch(error => toast('Accounting could not load: ' + error.message));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function stockOf(p) { return Number(p.quantity_on_hand || 0); }
  function priceOf(p) { return Number(p.selling_price || 0); }
  function productCategory(p) { return p.categories?.name || 'Uncategorised'; }

  function renderProducts() {
    const q = ($('product-search').value || '').trim().toLowerCase();
    const filtered = products.filter(p => p.active && (p.name + ' ' + p.sku + ' ' + (p.barcode || '') + ' ' + productCategory(p)).toLowerCase().includes(q));
    $('product-grid').innerHTML = filtered.map(p => {
      const low = stockOf(p) <= Number(p.reorder_level || 0);
      return '<button class="product-card" data-product="' + p.id + '" ' + (stockOf(p) <= 0 ? 'disabled' : '') + '>' +
        '<div class="product-emoji">🛒</div><b>' + escapeHtml(p.name) + '</b>' +
        '<small>' + escapeHtml(p.sku) + ' · ' + stockOf(p) + ' in stock</small>' +
        '<strong>' + fmt(priceOf(p)) + '</strong><span class="stock">' + (low ? 'Low stock' : '') + '</span></button>';
    }).join('') || '<p class="muted">No active products found. Add products in Inventory if your role permits it.</p>';
    document.querySelectorAll('[data-product]').forEach(button => button.addEventListener('click', () => addToCart(button.dataset.product)));
  }

  function addToCart(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;
