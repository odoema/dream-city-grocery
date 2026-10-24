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

  const $ = id => document.getElementById(id);
  const fmt = value => 'UGX ' + Math.round(Number(value || 0)).toLocaleString('en-UG');
  let profile = null;
  let products = [];
  let categories = [];
  let customers = [];
  let sales = [];
  let cart = [];
  let lastReceipt = null;
  let pendingIdempotencyKey = null;
  let busy = false;

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
    const titles = { dashboard: 'Owner dashboard', pos: 'Point of Sale', inventory: 'Inventory management', purchases: 'Purchases', accounting: 'Accounting', reports: 'Reports & analytics' };
    $('page-title').textContent = titles[view] || 'Dream City Grocery';
    if (view === 'pos') renderProducts();
    if (view === 'inventory') renderInventory();
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
    const item = cart.find(row => row.id === id);
    if ((item ? item.qty : 0) + 1 > stockOf(product)) return toast('Quantity exceeds current stock.');
    if (item) item.qty += 1;
    else cart.push({ id: product.id, sku: product.sku, name: product.name, price: priceOf(product), qty: 1, stock: stockOf(product) });
    pendingIdempotencyKey = null;
    renderCart();
  }

  function renderCart() {
    const count = cart.reduce((sum, item) => sum + item.qty, 0);
    const subtotal = cart.reduce((sum, item) => sum + item.qty * item.price, 0);
    $('cart-count').textContent = count + ' item' + (count === 1 ? '' : 's');
    $('subtotal').textContent = fmt(subtotal);
    $('total').textContent = fmt(subtotal);
    $('cart-items').innerHTML = cart.length ? cart.map(item =>
      '<div class="cart-item"><div class="ci-main"><b>' + escapeHtml(item.name) + '</b><small>' + fmt(item.price) + ' each</small></div>' +
      '<div class="qty-controls"><button type="button" data-dec="' + item.id + '" aria-label="Decrease quantity">−</button><span>' + item.qty + '</span>' +
      '<button type="button" data-inc="' + item.id + '" aria-label="Increase quantity">＋</button></div></div>'
    ).join('') : '<div class="empty-cart">Your cart is empty.<br/>Choose a product to begin.</div>';
    document.querySelectorAll('[data-dec]').forEach(button => button.addEventListener('click', () => changeQty(button.dataset.dec, -1)));
    document.querySelectorAll('[data-inc]').forEach(button => button.addEventListener('click', () => changeQty(button.dataset.inc, 1)));
    $('checkout').disabled = !profile || busy || !cart.length;
  }

  function changeQty(id, delta) {
    const item = cart.find(row => row.id === id);
    if (!item) return;
    const product = products.find(row => row.id === id);
    if (item.qty + delta > stockOf(product)) return toast('Quantity exceeds current stock.');
    item.qty += delta;
    if (item.qty <= 0) cart = cart.filter(row => row.id !== id);
    pendingIdempotencyKey = null;
    renderCart();
  }

  function renderInventory() {
    const q = ($('inventory-search').value || '').trim().toLowerCase();
    $('inventory-table').innerHTML = products.filter(p => (p.name + ' ' + p.sku + ' ' + productCategory(p)).toLowerCase().includes(q)).map(p =>
      '<tr><td>' + escapeHtml(p.sku) + '</td><td><b>' + escapeHtml(p.name) + '</b></td><td>' + escapeHtml(productCategory(p)) + '</td>' +
      '<td>' + fmt(p.buying_price) + '</td><td><b>' + fmt(p.selling_price) + '</b></td><td>' + stockOf(p) + '</td><td>' + Number(p.reorder_level || 0) + '</td>' +
      '<td><span class="' + (stockOf(p) <= Number(p.reorder_level || 0) ? 'low-stock' : 'in-stock') + '">' + (p.active ? (stockOf(p) <= Number(p.reorder_level || 0) ? 'Low stock' : 'In stock') : 'Inactive') + '</span></td></tr>'
    ).join('') || '<tr><td colspan="8">No products found.</td></tr>';
  }

  function renderAlerts() {
    const low = products.filter(p => p.active && stockOf(p) <= Number(p.reorder_level || 0)).slice(0, 6);
    $('stock-alerts').innerHTML = low.map(p => '<div class="stock-row"><div class="stock-icon">!</div><div class="stock-info"><b>' + escapeHtml(p.name) +
      '</b><small>Reorder level: ' + Number(p.reorder_level || 0) + '</small></div><div class="stock-count">' + stockOf(p) + ' left</div></div>'
    ).join('') || '<p class="muted">No low-stock products, or the catalogue is empty.</p>';
  }

  function renderSales(target) {
    const rows = sales.map(s => {
      const date = new Date(s.created_at);
      const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-GB');
      const payment = String(s.payment_method || '').replaceAll('_', ' ');
      return '<tr><td class="receipt-id">' + escapeHtml(s.receipt_number) + '</td><td>' + escapeHtml(time) + '</td><td>' +
        escapeHtml(s.profiles?.full_name || (s.cashier_id === profile?.id ? profile.full_name : 'Staff')) + '</td><td>' + escapeHtml(payment) +
        '</td><td><b>' + fmt(s.total) + '</b></td><td><span class="status">' + escapeHtml(s.status) + '</span></td></tr>';
    }).join('');
    $(target).innerHTML = rows || '<tr><td colspan="6">No completed sales found for your account.</td></tr>';
  }

  async function loadData() {
    if (!client || !profile) return;
    const [productResult, categoryResult, customerResult, saleResult] = await Promise.all([
      client.from('products').select('*, categories(name)').order('name'),
      client.from('categories').select('id,name').eq('active', true).order('name'),
      client.from('customers').select('id,name,phone,credit_limit').eq('active', true).order('name'),
      client.from('sales').select('id,receipt_number,cashier_id,payment_method,total,status,created_at,profiles(full_name)').order('created_at', { ascending: false }).limit(30)
    ]);
    if (productResult.error) throw productResult.error;
    if (categoryResult.error && categoryResult.error.code !== '42501') throw categoryResult.error;
    if (customerResult.error && customerResult.error.code !== '42501') throw customerResult.error;
    if (saleResult.error && saleResult.error.code !== '42501') throw saleResult.error;
    products = productResult.data || [];
    categories = categoryResult.data || [];
    customers = customerResult.data || [];
    sales = saleResult.data || [];
    renderProducts();
    renderInventory();
    renderAlerts();
    renderSales('recent-sales');
    renderSales('report-sales');
    renderCustomerSelect();
    const dashboardMetrics = document.querySelectorAll('#dashboard-view .metric strong');
    if (dashboardMetrics.length >= 4) {
      const todays = sales.filter(s => new Date(s.created_at).toDateString() === new Date().toDateString());
      dashboardMetrics[0].textContent = fmt(todays.reduce((sum, s) => sum + Number(s.total), 0));
      dashboardMetrics[1].textContent = '—';
      dashboardMetrics[2].textContent = String(todays.length);
      dashboardMetrics[3].textContent = products.filter(p => p.active && stockOf(p) <= Number(p.reorder_level || 0)).length + ' products';
      const descriptions = document.querySelectorAll('#dashboard-view .metric small');
      if (descriptions.length >= 4) {
        descriptions[0].textContent = 'Recorded sales today (latest 30 loaded)';
        descriptions[1].textContent = 'Accounting report not yet implemented';
        descriptions[2].textContent = 'Latest 30 sales loaded';
        descriptions[3].textContent = 'Based on live stock';
      }
    }
    const dashboardNotice = document.querySelector('#dashboard-view .notice');
    if (dashboardNotice) {
      dashboardNotice.innerHTML = '<b>Live data</b><span>Products and recent sales are loaded from Dream City Supabase. Financial statements and purchases are not yet implemented.</span>';
    }
    const reportNotice = document.querySelector('#reports-view .notice');
    if (reportNotice) reportNotice.innerHTML = '<b>Live sales</b><span>Showing the latest 30 database sales available to your staff role.</span>';
    const footer = document.querySelector('footer .footer-demo');
    if (footer) footer.textContent = 'Connected · Live database';
  }

  function renderCustomerSelect() {
    const select = $('customer-select');
    const label = $('customer-label');
    const isCredit = $('payment-method').value === 'Credit';
    select.classList.toggle('hidden', !isCredit);
    label.classList.toggle('hidden', !isCredit);
    select.innerHTML = '<option value="">Select customer…</option>' + customers.map(c =>
      '<option value="' + c.id + '">' + escapeHtml(c.name) + (c.phone ? ' · ' + escapeHtml(c.phone) : '') + '</option>'
    ).join('');
  }

  async function addCustomer() {
    if (!profile || !['owner', 'manager'].includes(profile.role)) return toast('Only an owner or manager can add customers.');
    const name = prompt('Customer name:');
    if (!name || !name.trim()) return;
    const phone = prompt('Customer phone (optional):', '') || null;
    const limitRaw = prompt('Credit limit in UGX (enter 0 for no credit):', '0');
    if (limitRaw === null) return;
    const creditLimit = Number(limitRaw);
    if (!Number.isFinite(creditLimit) || creditLimit < 0) return toast('Enter a valid non-negative credit limit.');
    const result = await client.from('customers').insert({
      name: name.trim(), phone: phone && phone.trim() ? phone.trim() : null,
      credit_limit: creditLimit, active: true
    }).select('id,name,phone,credit_limit').single();
    if (result.error) return toast('Could not save customer: ' + result.error.message);
    customers.push(result.data);
    renderCustomerSelect();
    $('payment-method').value = 'Credit';
    renderCustomerSelect();
    $('customer-select').value = result.data.id;
    toast('Customer saved. Credit sales are subject to the configured limit.');
  }

  async function addProduct() {
    if (!profile || !['owner', 'manager'].includes(profile.role)) return toast('Only an owner or manager can add products.');
    const name = prompt('Product name:');
    if (!name || !name.trim()) return;
    const sku = prompt('Unique SKU / product code:');
    if (!sku || !sku.trim()) return;
    const buying = Number(prompt('Buying cost in UGX:', '0'));
    const selling = Number(prompt('Selling price in UGX:', '0'));
    const quantity = Number(prompt('Opening stock quantity:', '0'));
    const reorder = Number(prompt('Reorder level:', '0'));
    if (![buying, selling, quantity, reorder].every(Number.isFinite) || buying < 0 || selling < 0 || quantity < 0 || reorder < 0) return toast('Enter valid non-negative numeric values.');
    let categoryId = null;
    const categoryName = prompt('Category name (optional):', '');
    if (categoryName && categoryName.trim()) {
      let category = categories.find(c => c.name.toLowerCase() === categoryName.trim().toLowerCase());
      if (!category) {
        const result = await client.from('categories').insert({ name: categoryName.trim() }).select('id,name').single();
        if (result.error) return toast('Could not create category: ' + result.error.message);
        category = result.data;
        categories.push(category);
      }
      categoryId = category.id;
    }
    const result = await client.from('products').insert({
      name: name.trim(), sku: sku.trim(), buying_price: buying, selling_price: selling,
      quantity_on_hand: quantity, reorder_level: reorder, category_id: categoryId, active: true
    }).select('id').single();
    if (result.error) return toast('Could not save product: ' + result.error.message);
    toast('Product saved.');
    await loadData();
  }

  async function checkout() {
    if (!profile || busy || !cart.length) return;
    const methodMap = { 'Cash': 'cash', 'Mobile Money': 'mobile_money', 'Card': 'card', 'Bank': 'bank', 'Credit': 'credit' };
    const payment = methodMap[$('payment-method').value] || 'cash';
    const customerId = payment === 'credit' ? $('customer-select').value || null : null;
    if (payment === 'credit' && !customerId) return toast('Choose a customer for a credit sale.');
    const subtotal = cart.reduce((sum, item) => sum + item.qty * item.price, 0);
    let discount = 0;
    if (['owner', 'manager'].includes(profile.role)) {
      const entered = prompt('Authorized discount in UGX (enter 0 for no discount):', '0');
      if (entered === null) return;
      discount = Number(entered);
      if (!Number.isFinite(discount) || discount < 0 || discount > subtotal) return toast('Discount must be between UGX 0 and the subtotal.');
    }
    if (!pendingIdempotencyKey) pendingIdempotencyKey = crypto.randomUUID();
    busy = true;
    $('checkout').disabled = true;
    $('checkout').textContent = 'Processing…';
    try {
      const result = await client.rpc('complete_sale', {
        p_items: cart.map(item => ({ product_id: item.id, quantity: item.qty })),
        p_payment_method: payment,
        p_idempotency_key: pendingIdempotencyKey,
        p_customer_id: customerId,
        p_discount: discount,
        p_tax: 0
      });
      if (result.error) throw result.error;
      const sale = result.data;
      lastReceipt = {
        receipt_number: sale.receipt_number,
        created_at: new Date().toISOString(),
        cashier: profile.full_name || profile.id,
        payment_method: payment,
        subtotal: Number(sale.subtotal),
        discount: Number(sale.discount),
        total: Number(sale.total),
        items: cart.map(item => ({ name: item.name, sku: item.sku, qty: item.qty, price: item.price, line_total: item.qty * item.price }))
      };
      cart = [];
      pendingIdempotencyKey = null;
      renderCart();
      $('print-last-receipt').classList.remove('hidden');
      toast('Sale saved: ' + sale.receipt_number + ' · ' + fmt(sale.total));
      try {
        await loadData();
      } catch (refreshError) {
        toast('Sale was saved, but the screen could not refresh: ' + (refreshError.message || 'refresh error'));
      }
      printReceipt(lastReceipt);
    } catch (error) {
      toast('Sale was not confirmed: ' + (error.message || 'Please retry. Keep the cart and try again.'));
    } finally {
      busy = false;
      $('checkout').textContent = 'Complete sale';
      $('checkout').disabled = !profile || !cart.length;
    }
  }

  function printReceipt(receipt) {
    if (!receipt) return;
    const popup = window.open('', '_blank', 'width=420,height=700');
    if (!popup) return toast('Allow pop-ups to print the receipt, then use Print last receipt.');
    const rows = receipt.items.map(item => '<tr><td>' + escapeHtml(item.name) + '<br><small>' + escapeHtml(item.sku) + '</small></td><td>' + item.qty + '</td><td>' + fmt(item.price) + '</td><td>' + fmt(item.line_total) + '</td></tr>').join('');
    popup.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(receipt.receipt_number) + '</title><style>body{font:13px Arial,sans-serif;color:#111;padding:18px;max-width:360px;margin:auto}h2,p{text-align:center;margin:5px}hr{border:0;border-top:1px dashed #777;margin:14px 0}table{width:100%;border-collapse:collapse;font-size:12px}td,th{text-align:left;padding:6px 2px;border-bottom:1px solid #ddd}.num{text-align:right}.total{font-size:17px;font-weight:bold;text-align:right}small{color:#555}@media print{button{display:none}}</style></head><body><h2>Dream City Grocery</h2><p>Empowering Communities</p><hr><p><b>Receipt:</b> ' + escapeHtml(receipt.receipt_number) + '</p><p>' + escapeHtml(new Date(receipt.created_at).toLocaleString('en-GB')) + '</p><p>Cashier: ' + escapeHtml(receipt.cashier) + '</p><p>Payment: ' + escapeHtml(receipt.payment_method.replaceAll('_', ' ')) + '</p><hr><table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>' + rows + '</tbody></table><hr><p>Subtotal: ' + fmt(receipt.subtotal) + '</p><p>Discount: ' + fmt(receipt.discount) + '</p><p class="total">TOTAL: ' + fmt(receipt.total) + '</p><hr><p>Thank you for shopping with us!</p><script>window.onload=()=>window.print()<\/script></body></html>');
    popup.document.close();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  async function onSession(session) {
    profile = null;
    cart = [];
    products = [];
    sales = [];
    setSignedIn(false);
    renderCart();
    if (!session || !client) return;
    const result = await client.from('profiles').select('id,full_name,role,active').eq('id', session.user.id).maybeSingle();
    if (result.error) {
      setMessage('Could not load staff profile: ' + result.error.message, true);
      await client.auth.signOut();
      return;
    }
    if (!result.data || !result.data.active) {
      setMessage('This login has no active Dream City staff profile. Ask the owner to configure it.', true);
      await client.auth.signOut();
      return;
    }
    profile = result.data;
    setSignedIn(true);
    $('staff-status').textContent = (profile.full_name || session.user.email) + ' · ' + profile.role;
    try {
      await loadData();
      showView('dashboard');
      setMessage('');
    } catch (error) {
      setMessage('Connected, but data could not load: ' + (error.message || 'Check the database migration and permissions.'), true);
    }
  }

  $('today').textContent = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());
  document.querySelectorAll('.nav').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  document.querySelectorAll('[data-goto]').forEach(button => button.addEventListener('click', () => showView(button.dataset.goto)));
  $('product-search').addEventListener('input', renderProducts);
  $('inventory-search').addEventListener('input', renderInventory);
  $('payment-method').addEventListener('change', renderCustomerSelect);
  $('clear-cart').addEventListener('click', () => { cart = []; pendingIdempotencyKey = null; renderCart(); });
  $('checkout').addEventListener('click', checkout);
  $('add-product').addEventListener('click', addProduct);
  $('add-customer').addEventListener('click', addCustomer);
  $('print-last-receipt').addEventListener('click', () => printReceipt(lastReceipt));
  $('sign-in-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!client) return setMessage('Supabase is not configured. Edit supabase-config.js with the dedicated project publishable/anon key.', true);
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    $('sign-in-button').disabled = true;
    setMessage('Signing in…');
    const result = await client.auth.signInWithPassword({ email, password });
    $('sign-in-button').disabled = false;
    if (result.error) setMessage(result.error.message, true);
    else await onSession(result.data.session);
  });
  $('sign-out').addEventListener('click', async () => {
    if (client) await client.auth.signOut();
    profile = null;
    cart = [];
    setSignedIn(false);
    setMessage('You have signed out.');
  });

  // Demo figures must never be mistaken for real transactions.
  document.querySelectorAll('#dashboard-view .metric strong').forEach(el => el.textContent = '—');
  document.querySelectorAll('#dashboard-view .metric small').forEach(el => el.textContent = 'Awaiting live data');
  $('recent-sales').innerHTML = '<tr><td colspan="6">Sign in to load live sales.</td></tr>';
  $('report-sales').innerHTML = '<tr><td colspan="6">Sign in to load live sales.</td></tr>';
  $('stock-alerts').innerHTML = '<p class="muted">Sign in to load live stock alerts.</p>';
  $('inventory-table').innerHTML = '<tr><td colspan="8">Sign in to load live products.</td></tr>';

  if (!client) {
    $('config-warning').classList.remove('hidden');
    setMessage('Setup required: configure supabase-config.js and apply the database migration.', true);
    setSignedIn(false);
  } else {
    client.auth.getSession().then(({ data, error }) => {
      if (error) setMessage(error.message, true);
      return onSession(data?.session || null);
    });
    client.auth.onAuthStateChange((_event, session) => {
      // Avoid awaiting network work inside Supabase's auth event callback.
      setTimeout(() => onSession(session), 0);
    });
  }
})();
