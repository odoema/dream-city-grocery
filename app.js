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

  // Reuse the core application client in optional modules to avoid multiple
  // GoTrueClient instances for the same Supabase project in one page.
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
    const item = cart.find(row => row.id === id);
    if ((item ? item.qty : 0) + 1 > stockOf(product)) return toast('Quantity exceeds current stock.');
    if (item) item.qty += 1;
    else cart.push({ id: product.id, sku: product.sku, name: product.name, price: priceOf(product), listedPrice: priceOf(product), qty: 1, stock: stockOf(product) });
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
      '<div class="cart-item"><div class="ci-main"><b>' + escapeHtml(item.name) + '</b><small>' + fmt(item.price) + ' each' + (item.price !== item.listedPrice ? ' · manager price override' : '') + '</small></div>' +
      '<div class="qty-controls">' + (['owner','manager'].includes(profile?.role) ? '<button type="button" data-price="' + item.id + '" aria-label="Change selling price">₮</button>' : '') +
      '<button type="button" data-dec="' + item.id + '" aria-label="Decrease quantity">−</button><span>' + item.qty + '</span>' +
      '<button type="button" data-inc="' + item.id + '" aria-label="Increase quantity">＋</button></div></div>'
    ).join('') : '<div class="empty-cart">Your cart is empty.<br/>Choose a product to begin.</div>';
    document.querySelectorAll('[data-dec]').forEach(button => button.addEventListener('click', () => changeQty(button.dataset.dec, -1)));
    document.querySelectorAll('[data-inc]').forEach(button => button.addEventListener('click', () => changeQty(button.dataset.inc, 1)));
    document.querySelectorAll('[data-price]').forEach(button => button.addEventListener('click', () => changePrice(button.dataset.price)));
    $('checkout').disabled = !profile || busy || !cart.length;
  }

  function changePrice(id) {
    if (!profile || !['owner','manager'].includes(profile.role)) return toast('Only an owner or manager can override a selling price.');
    const item = cart.find(row => row.id === id);
    if (!item) return;
    const entered = prompt('Authorized selling price for ' + item.name + ' (listed price ' + fmt(item.listedPrice) + '):', String(item.price));
    if (entered === null) return;
    const price = Number(entered);
    if (!Number.isFinite(price) || price < 0) return toast('Enter a valid non-negative selling price.');
    item.price = Math.round(price * 100) / 100;
    pendingIdempotencyKey = null;
    renderCart();
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
      '<td><span class="' + (stockOf(p) <= Number(p.reorder_level || 0) ? 'low-stock' : 'in-stock') + '">' + (p.active ? (stockOf(p) <= Number(p.reorder_level || 0) ? 'Low stock' : 'In stock') : 'Inactive') + '</span></td><td>' + (['owner','manager'].includes(profile?.role) ? '<button class="text-button" type="button" data-edit-product="' + p.id + '">Edit</button> ' + (p.active ? '<button class="text-button" type="button" data-deactivate-product="' + p.id + '">Deactivate</button>' : '<button class="text-button" type="button" data-reactivate-product="' + p.id + '">Reactivate</button>') : 'View only') + '</td></tr>'
    ).join('') || '<tr><td colspan="9">No products found.</td></tr>';
    document.querySelectorAll('[data-edit-product]').forEach(b => b.addEventListener('click', () => editProduct(b.dataset.editProduct)));
    document.querySelectorAll('[data-deactivate-product]').forEach(b => b.addEventListener('click', () => setProductActive(b.dataset.deactivateProduct, false)));
    document.querySelectorAll('[data-reactivate-product]').forEach(b => b.addEventListener('click', () => setProductActive(b.dataset.reactivateProduct, true)));
  }

  function renderCustomers() {
    if (!profile || !$('customers-table')) return;
    const canEdit = ['owner','manager'].includes(profile.role);
    $('customers-table').innerHTML = customers.map(c => '<tr><td><b>' + escapeHtml(c.name) + '</b></td><td>' + escapeHtml(c.phone || '—') + '</td><td>' + fmt(c.credit_limit) + '</td><td>' + (c.active ? 'Active' : 'Inactive') + '</td><td>' + (canEdit ? '<button class="text-button" type="button" data-edit-customer="' + c.id + '">Edit</button> ' + (c.active ? '<button class="text-button" type="button" data-deactivate-customer="' + c.id + '">Deactivate</button>' : '<button class="text-button" type="button" data-reactivate-customer="' + c.id + '">Reactivate</button>') : 'View only') + '</td></tr>').join('') || '<tr><td colspan="5">No customers found.</td></tr>';
    document.querySelectorAll('[data-edit-customer]').forEach(b => b.addEventListener('click', () => editCustomer(b.dataset.editCustomer)));
    document.querySelectorAll('[data-deactivate-customer]').forEach(b => b.addEventListener('click', () => setCustomerActive(b.dataset.deactivateCustomer, false)));
    document.querySelectorAll('[data-reactivate-customer]').forEach(b => b.addEventListener('click', () => setCustomerActive(b.dataset.reactivateCustomer, true)));
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
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const [productResult, categoryResult, customerResult, saleResult, todaySalesResult] = await Promise.all([
      client.from('products').select('*, categories(name)').order('name'),
      client.from('categories').select('id,name').eq('active', true).order('name'),
      client.from('customers').select('id,name,phone,credit_limit,active').order('name'),
      client.from('sales').select('id,receipt_number,cashier_id,payment_method,total,status,created_at,profiles(full_name)').order('created_at', { ascending: false }).limit(30),
      client.from('sales').select('total,created_at').eq('status', 'completed').gte('created_at', dayStart.toISOString()).lt('created_at', dayEnd.toISOString())
    ]);
    if (productResult.error) throw productResult.error;
    if (categoryResult.error && categoryResult.error.code !== '42501') throw categoryResult.error;
    if (customerResult.error && customerResult.error.code !== '42501') throw customerResult.error;
    if (saleResult.error && saleResult.error.code !== '42501') throw saleResult.error;
    if (todaySalesResult.error) throw todaySalesResult.error;
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
    renderCustomers();
    const dashboardMetrics = document.querySelectorAll('#dashboard-view .metric strong');
    if (dashboardMetrics.length >= 4) {
      const todays = todaySalesResult.data || [];
      dashboardMetrics[0].textContent = fmt(todays.reduce((sum, s) => sum + Number(s.total), 0));
      dashboardMetrics[1].textContent = '—';
      dashboardMetrics[2].textContent = String(todays.length);
      dashboardMetrics[3].textContent = products.filter(p => p.active && stockOf(p) <= Number(p.reorder_level || 0)).length + ' products';
      const descriptions = document.querySelectorAll('#dashboard-view .metric small');
      if (descriptions.length >= 4) {
        descriptions[0].textContent = 'Recorded completed sales today (all rows returned)';
        descriptions[1].textContent = 'See Accounting for posted journal totals';
        descriptions[2].textContent = 'Latest 30 sales loaded';
        descriptions[3].textContent = 'Based on live stock';
      }
    }
    const chart = document.querySelector('#dashboard-view .chart');
    if (chart) {
      chart.innerHTML = '<p class="muted">Historical sales chart is not implemented yet. The transaction table below shows recent recorded sales.</p>';
      chart.style.height = 'auto';
      chart.style.padding = '14px 0';
    }
    const salesSubtitle = document.querySelector('#dashboard-view .sales-panel .panel-heading p');
    if (salesSubtitle) salesSubtitle.textContent = 'Historical trend pending — not demo figures';
    const recentSubtitle = document.querySelector('#dashboard-view .recent-panel .panel-heading p');
    if (recentSubtitle) recentSubtitle.textContent = 'Latest recorded transactions from the database';
    const dashboardNotice = document.querySelector('#dashboard-view .notice');
    if (dashboardNotice) {
      dashboardNotice.innerHTML = '<b>Live data</b><span>Products and recent sales are live. Purchasing and accounts payable are available after applying the purchasing migration; Balance Sheet and Cash Flow reports remain pending.</span>';
    }
    const reportNotice = document.querySelector('#reports-view .notice');
    if (reportNotice) reportNotice.innerHTML = '<b>Live sales</b><span>Showing the latest 30 database sales available to your staff role. CSV export and historical analytics are not yet implemented.</span>';
    const footer = document.querySelector('footer .footer-demo');
    if (footer) footer.textContent = 'Connected · Live database';
  }



  function canManageStocktake() { return profile && ['owner','manager','accountant'].includes(profile.role); }

  async function loadStocktakeData() {
    if (!client || !profile) return;
    if (!canManageStocktake()) {
      $('stocktake-view').innerHTML = '<div class="notice"><b>Access restricted</b><span>Stock-taking is available to owners, managers and accountants.</span></div>';
      return;
    }
    const [sessionResult, historyResult] = await Promise.all([
      client.from('stocktake_sessions').select('id,session_number,status,notes,started_at,completed_at').eq('status','draft').order('started_at',{ascending:false}).limit(1),
      client.from('stocktake_sessions').select('id,session_number,status,started_at,completed_at').order('started_at',{ascending:false}).limit(10)
    ]);
    if (sessionResult.error) throw sessionResult.error;
    if (historyResult.error) throw historyResult.error;
    stocktakeSession = sessionResult.data?.[0] || null;
    stocktakeHistory = historyResult.data || [];
    stocktakeItems = [];
    if (stocktakeSession) {
      const itemsResult = await client.from('stocktake_items')
        .select('id,session_id,product_id,system_quantity,counted_quantity,unit_cost,counted_at,products(name,sku,unit,active)')
        .eq('session_id',stocktakeSession.id).order('product_id');
      if (itemsResult.error) throw itemsResult.error;
      stocktakeItems = itemsResult.data || [];
    }
    renderStocktake(stocktakeHistory);
  }

  function renderStocktake(history) {
    const session = stocktakeSession;
    const counted = stocktakeItems.filter(item => item.counted_quantity !== null).length;
    const varianceItems = stocktakeItems.filter(item => item.counted_quantity !== null && Number(item.counted_quantity) !== Number(item.system_quantity)).length;
    const summary = $('stocktake-summary');
    summary.innerHTML = session ? [
      ['Current session', session.session_number],
      ['Products counted', counted + ' / ' + stocktakeItems.length],
      ['Count variances', String(varianceItems)],
      ['Status', 'Draft — not posted']
    ].map(([label,value]) => '<article class="metric"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value)+'</strong></article>').join('') :
      '<article class="metric"><span>Current session</span><strong>None</strong><small>Start a session after recording new purchases.</small></article>';
    $('start-stocktake').disabled = !!session;
    $('finalize-stocktake').disabled = !session || !stocktakeItems.length || counted !== stocktakeItems.length;
    $('cancel-stocktake').disabled = !session;
    $('finalize-stocktake').textContent = session ? (counted === stocktakeItems.length ? 'Approve & post adjustments' : 'Count all products first') : 'Approve & post adjustments';
    const q = ($('stocktake-search').value || '').trim().toLowerCase();
    $('stocktake-items').innerHTML = session ? (stocktakeItems.filter(item => {
      const p = item.products || {};
      return (String(p.name||'')+' '+String(p.sku||'')).toLowerCase().includes(q);
    }).map(item => {
      const p = item.products || {};
      const hasCount = item.counted_quantity !== null;
      const variance = hasCount ? Number(item.counted_quantity)-Number(item.system_quantity) : null;
      return '<tr><td>'+escapeHtml(p.sku||'')+'</td><td><b>'+escapeHtml(p.name||'Unknown product')+'</b></td><td>'+escapeHtml(p.unit||'piece')+'</td>'+
        '<td>'+Number(item.system_quantity)+'</td><td><input class="search compact stocktake-count-input" inputmode="decimal" type="number" min="0" step="0.001" aria-label="Count for '+escapeHtml(p.name||p.sku||'product')+'" data-product-id="'+item.product_id+'" value="'+(hasCount?Number(item.counted_quantity):'')+'" placeholder="Enter count" style="max-width:130px" /></td>'+
        '<td>'+(hasCount?(variance>0?'+':'')+variance:'—')+'</td><td>'+(hasCount?'Counted':'Not counted')+'</td>'+
        '<td><button class="secondary stocktake-save" data-product-id="'+item.product_id+'" type="button">Save count</button></td></tr>';
    }).join('') || '<tr><td colspan="8">No matching products.</td></tr>') : '<tr><td colspan="8">No open session. Click “Start stocktake” to capture the current system quantities.</td></tr>';
    $('stocktake-history').innerHTML = history.length ? history.map(row =>
      '<tr><td><b>'+escapeHtml(row.session_number)+'</b></td><td>'+escapeHtml(new Date(row.started_at).toLocaleString('en-GB'))+'</td><td>'+escapeHtml(row.status)+'</td><td>'+(row.id===session?.id?stocktakeItems.length:'—')+'</td><td>'+(row.completed_at?escapeHtml(new Date(row.completed_at).toLocaleString('en-GB')):'—')+'</td></tr>'
    ).join('') : '<tr><td colspan="5">No stock-taking sessions yet.</td></tr>';
    document.querySelectorAll('.stocktake-save').forEach(button => button.addEventListener('click', async () => {
      const input = document.querySelector('.stocktake-count-input[data-product-id="'+button.dataset.productId+'"]');
      if (!session || !input || input.value.trim()==='') return toast('Enter a physical count first.');
      const quantity = Number(input.value);
      if (!Number.isFinite(quantity) || quantity<0) return toast('Enter a valid count of zero or more.');
      button.disabled = true;
      const result = await client.rpc('record_stocktake_count',{p_session_id:session.id,p_product_id:button.dataset.productId,p_counted_quantity:quantity});
      button.disabled = false;
      if (result.error) return toast('Count was not saved: '+result.error.message);
      toast('Count saved.');
      await loadStocktakeData();
    }));
  }

  async function startStocktake() {
    if (!canManageStocktake()) return toast('Stock-taking access required.');
    if (!confirm('Have Dorcas’s new goods been recorded in Purchases, and can sales/receiving pause during the count? Start a stock snapshot now?')) return;
    const notes = prompt('Stocktake notes (optional):', 'Physical stocktake');
    if (notes === null) return;
    const result = await client.rpc('start_stocktake',{p_notes:notes});
    if (result.error) return toast('Could not start stocktake: '+result.error.message);
    toast('Stocktake started: '+result.data.session_number+' ('+result.data.product_count+' products).');
    await loadStocktakeData();
  }

  async function cancelStocktake() {
    if (!stocktakeSession || !canManageStocktake()) return;
    if (!confirm('Cancel '+stocktakeSession.session_number+'? No stock or accounting balances will be changed. You can then start a fresh session.')) return;
    const result = await client.rpc('cancel_stocktake',{p_session_id:stocktakeSession.id});
    if (result.error) return toast('Could not cancel session: '+result.error.message);
    toast('Draft stocktake cancelled. No balances were changed.');
    await loadStocktakeData();
  }

  async function finalizeStocktake() {
    if (!stocktakeSession || !canManageStocktake()) return;
    if (stocktakeItems.some(item => item.counted_quantity === null)) return toast('Count every product, including zero-stock products, first.');
    const varianceCount = stocktakeItems.filter(item => Number(item.counted_quantity)!==Number(item.system_quantity)).length;
    if (!confirm('Approve stocktake '+stocktakeSession.session_number+'? This will update product stock, add inventory movements and post accounting entries for '+varianceCount+' product variance(s). This cannot be undone through the POS.')) return;
    const result = await client.rpc('finalize_stocktake',{p_session_id:stocktakeSession.id});
    if (result.error) return toast('Stocktake not posted: '+result.error.message);
    toast('Stocktake posted. Surplus: '+fmt(result.data.surplus_value)+'; shortage: '+fmt(result.data.shortage_value)+'.');
    await Promise.all([loadStocktakeData(),loadData(),loadAccountingData().catch(()=>{})]);
  }

  function canManagePurchases() { return profile && ['owner','manager','accountant'].includes(profile.role); }

  async function loadPurchaseData() {
    if (!client || !profile) return;
    if (!canManagePurchases()) {
      $('purchases-view').innerHTML = '<div class="notice"><b>Access restricted</b><span>Purchases are available to owners, managers and accountants.</span></div>';
      return;
    }
    const [supplierRes, orderRes, invoiceRes] = await Promise.all([
      client.from('suppliers').select('id,name,phone,email,address,active').order('name'),
      client.from('purchase_orders').select('id,order_number,supplier_id,status,order_date,expected_date,notes,suppliers(name),purchase_order_items(quantity_ordered,unit_cost,quantity_received,products(name,sku))').order('created_at',{ascending:false}).limit(50),
      client.from('supplier_invoices').select('id,supplier_id,purchase_order_id,invoice_number,invoice_date,due_date,total,amount_paid,status,created_at,suppliers(name),goods_receipts(receipt_number)').order('created_at',{ascending:false}).limit(50)
    ]);
    for (const res of [supplierRes,orderRes,invoiceRes]) if (res.error) throw res.error;
    suppliers = supplierRes.data || [];
    purchaseOrders = orderRes.data || [];
    supplierInvoices = invoiceRes.data || [];
    renderPurchases();
  }

  function renderPurchases() {
    const activeSuppliers = suppliers.filter(s => s.active);
    $('purchase-suppliers').innerHTML = suppliers.map(s => '<tr><td><b>'+escapeHtml(s.name)+'</b></td><td>'+escapeHtml(s.phone||'—')+'</td><td>'+escapeHtml(s.email||'—')+'</td><td><span class="status">'+(s.active?'Active':'Inactive')+'</span></td><td>' + (['owner','manager'].includes(profile?.role) ? '<button class="text-button" type="button" data-edit-supplier="'+s.id+'">Edit</button> ' + (s.active ? '<button class="text-button" type="button" data-deactivate-supplier="'+s.id+'">Deactivate</button>' : '<button class="text-button" type="button" data-reactivate-supplier="'+s.id+'">Reactivate</button>') : 'View only') + '</td></tr>').join('') || '<tr><td colspan="5">No suppliers yet. Add your first supplier.</td></tr>';
    document.querySelectorAll('[data-edit-supplier]').forEach(b=>b.addEventListener('click',()=>editSupplier(b.dataset.editSupplier)));
    document.querySelectorAll('[data-deactivate-supplier]').forEach(b=>b.addEventListener('click',()=>setSupplierActive(b.dataset.deactivateSupplier,false)));
    document.querySelectorAll('[data-reactivate-supplier]').forEach(b=>b.addEventListener('click',()=>setSupplierActive(b.dataset.reactivateSupplier,true)));
    $('purchase-orders').innerHTML = purchaseOrders.map(o => '<tr><td class="receipt-id">'+escapeHtml(o.order_number)+'</td><td>'+escapeHtml(o.suppliers?.name||'')+'</td><td>'+escapeHtml(o.order_date||'')+'</td><td>'+escapeHtml(o.expected_date||'—')+'</td><td>'+escapeHtml(o.status)+'</td><td>'+o.purchase_order_items.map(i=>escapeHtml(i.products?.name||i.products?.sku||'')+' × '+Number(i.quantity_ordered)).join('<br>')+'</td></tr>').join('') || '<tr><td colspan="6">No purchase orders recorded.</td></tr>';
    $('supplier-invoices').innerHTML = supplierInvoices.map(i => '<tr><td class="receipt-id">'+escapeHtml(i.invoice_number)+'</td><td>'+escapeHtml(i.suppliers?.name||'')+'</td><td>'+escapeHtml(i.invoice_date||'')+'</td><td>'+escapeHtml(i.due_date||'—')+'</td><td><b>'+fmt(i.total)+'</b></td><td>'+fmt(i.amount_paid)+'</td><td><b>'+fmt(Number(i.total)-Number(i.amount_paid))+'</b></td><td>'+escapeHtml(i.status)+'</td><td>'+(!['paid'].includes(i.status)?'<button class="text-button" type="button" data-pay-invoice="'+i.id+'">Record payment</button>':'Paid')+'</td></tr>').join('') || '<tr><td colspan="9">No supplier invoices recorded.</td></tr>';
    document.querySelectorAll('[data-pay-invoice]').forEach(b=>b.addEventListener('click',()=>paySupplierInvoice(b.dataset.payInvoice)));
    const payable = supplierInvoices.reduce((sum,i)=>sum+Number(i.total)-Number(i.amount_paid),0);
    $('ap-total').textContent = fmt(payable);
    $('po-count').textContent = String(purchaseOrders.filter(o=>['ordered','part_received'].includes(o.status)).length);
    $('invoice-count').textContent = String(supplierInvoices.length);
    $('receipt-count').textContent = String(supplierInvoices.filter(i=>i.goods_receipts).length);
    $('purchases-notice').innerHTML = '<b>Live purchasing</b><span>Purchase orders, goods receipts, supplier invoices, inventory and accounts payable post to the dedicated Supabase database. Invoice receiving updates stock and journals atomically.</span>';
  }

  function chooseSupplier() {
    const active = suppliers.filter(s=>s.active);
    if (!active.length) { toast('Add a supplier first.'); return null; }
    const answer = prompt('Choose supplier by number:\n' + active.map((s,i)=>(i+1)+'. '+s.name+(s.phone?' · '+s.phone:'')).join('\n'));
    if (answer===null) return null;
    const n=Number(answer);
    if (!Number.isInteger(n)||n<1||n>active.length) { toast('Invalid supplier selection.'); return null; }
    return active[n-1];
  }

  function promptPurchaseItems(title) {
    const activeProducts = products.filter(p=>p.active);
    if (!activeProducts.length) { toast('Add products to inventory first.'); return null; }
    const raw = prompt(title + '\nEnter each line as SKU:quantity:unit_cost, separated by semicolons.\nAvailable SKUs:\n' + activeProducts.map(p=>p.sku+' — '+p.name).join('\n'));
    if (raw===null) return null;
    const items=[];
    for (const part of raw.split(';')) {
      const bits=part.trim().split(':');
      if (bits.length!==3) { toast('Use SKU:quantity:unit_cost for each line.'); return null; }
      const product=activeProducts.find(p=>p.sku.toLowerCase()===bits[0].trim().toLowerCase());
      const quantity=Number(bits[1]), unit_cost=Number(bits[2]);
      if (!product||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unit_cost)||unit_cost<0) { toast('Check SKU, positive quantity and non-negative cost.'); return null; }
      if(items.some(i=>i.product_id===product.id)){toast('Each SKU should appear only once.');return null;}
      items.push({product_id:product.id,quantity,unit_cost});
    }
    return items.length?items:null;
  }

  async function addSupplier() {
    if (!profile || !['owner','manager'].includes(profile.role)) return toast('Only an owner or manager can add suppliers.');
    const name=prompt('Supplier / company name:');
    if(!name||!name.trim())return;
    const phone=prompt('Phone (optional):','');
    const email=prompt('Email (optional):','');
    const address=prompt('Address (optional):','');
    const result=await client.from('suppliers').insert({name:name.trim(),phone:phone?.trim()||null,email:email?.trim()||null,address:address?.trim()||null,active:true}).select('id').single();
    if(result.error)return toast('Supplier not saved: '+result.error.message);
    toast('Supplier saved.');
    await loadPurchaseData();
  }

  async function editSupplier(id) {
    if (!profile || !['owner','manager'].includes(profile.role)) return toast('Only an owner or manager can edit suppliers.');
    const s = suppliers.find(x => x.id === id); if (!s) return;
    const name = prompt('Supplier / company name:', s.name); if (name === null) return;
    if (!name.trim()) return toast('Supplier name is required.');
    const phone = prompt('Phone (optional):', s.phone || ''); if (phone === null) return;
    const email = prompt('Email (optional):', s.email || ''); if (email === null) return;
    const address = prompt('Address (optional):', s.address || ''); if (address === null) return;
    const r = await client.from('suppliers').update({name:name.trim(),phone:phone.trim()||null,email:email.trim()||null,address:address.trim()||null}).eq('id',id);
    if (r.error) return toast('Supplier update failed: ' + r.error.message);
    toast('Supplier updated.'); await loadPurchaseData();
  }

  async function setSupplierActive(id, active) {
    if (!profile || !['owner','manager'].includes(profile.role)) return toast('Only an owner or manager can change supplier status.');
    const s = suppliers.find(x=>x.id===id); if(!s)return;
    if (!confirm((active?'Reactivate':'Deactivate')+' supplier "'+s.name+'"? Existing invoices and purchase history will be preserved.')) return;
    const r=await client.from('suppliers').update({active}).eq('id',id);
    if(r.error)return toast('Supplier status not changed: '+r.error.message);
    toast(active?'Supplier reactivated.':'Supplier deactivated.'); await loadPurchaseData();
  }

  async function createPurchaseOrder() {
    if(!canManagePurchases())return toast('Purchases access required.');
    const supplier=chooseSupplier(); if(!supplier)return;
    const items=promptPurchaseItems('Create purchase order'); if(!items)return;
    const expected=prompt('Expected delivery date (YYYY-MM-DD, optional):','');
    if(expected===null)return;
    const notes=prompt('Notes (optional):','')||'';
    const result=await client.rpc('create_purchase_order',{p_supplier_id:supplier.id,p_items:items,p_expected_date:expected.trim()||null,p_notes:notes});
    if(result.error)return toast('Purchase order failed: '+result.error.message);
    toast('Purchase order created: '+result.data.order_number);
    await loadPurchaseData();
  }

  async function receiveSupplierInvoice() {
    if(!canManagePurchases())return toast('Purchases access required.');
    const supplier=chooseSupplier(); if(!supplier)return;
    const invoice=prompt('Supplier invoice number:'); if(!invoice||!invoice.trim())return;
    const invoiceDate=prompt('Invoice date (YYYY-MM-DD):',new Date().toISOString().slice(0,10)); if(invoiceDate===null)return;
    const dueDate=prompt('Payment due date (YYYY-MM-DD, optional):',''); if(dueDate===null)return;
    const items=promptPurchaseItems('Receive goods / record supplier invoice'); if(!items)return;
    const orderCandidates=purchaseOrders.filter(o=>o.supplier_id===supplier.id&&['ordered','part_received'].includes(o.status));
    let orderId=null;
    if(orderCandidates.length){
      const use=prompt('Optional purchase order number to match (leave blank if not linked):\n' + orderCandidates.map(o=>o.order_number).join('\n'),'');
      if(use===null)return;
      if(use.trim()){
        const order=orderCandidates.find(o=>o.order_number.toLowerCase()===use.trim().toLowerCase());
        if(!order)return toast('Purchase order not found for this supplier.');
        orderId=order.id;
      }
    }
    const notes=prompt('Goods receipt notes (optional):','')||'';
    const result=await client.rpc('receive_supplier_invoice',{p_supplier_id:supplier.id,p_invoice_number:invoice.trim(),p_invoice_date:invoiceDate.trim()||null,p_due_date:dueDate.trim()||null,p_items:items,p_purchase_order_id:orderId,p_notes:notes});
    if(result.error)return toast('Goods receiving failed: '+result.error.message);
    toast('Goods received '+result.data.receipt_number+' · invoice '+fmt(result.data.total));
    await Promise.all([loadPurchaseData(),loadData()]);
  }

  async function paySupplierInvoice(id) {
    const invoice=supplierInvoices.find(i=>i.id===id); if(!invoice)return;
    const outstanding=Number(invoice.total)-Number(invoice.amount_paid);
    const ref=prompt('Payment reference (bank/mobile-money transaction or cash voucher):'); if(!ref||!ref.trim())return;
    const methodRaw=prompt('Payment method: cash, mobile_money, card or bank','bank'); if(methodRaw===null)return;
    const method=methodRaw.trim().toLowerCase();
    if(!['cash','mobile_money','card','bank'].includes(method))return toast('Choose cash, mobile_money, card or bank.');
    const amountRaw=prompt('Amount to pay (outstanding '+fmt(outstanding)+'):',String(outstanding)); if(amountRaw===null)return;
    const amount=Number(amountRaw);
    if(!Number.isFinite(amount)||amount<=0||amount>outstanding)return toast('Payment must be positive and no greater than outstanding balance.');
    const result=await client.rpc('pay_supplier_invoice',{p_invoice_id:id,p_payment_reference:ref.trim(),p_payment_method:method,p_amount:amount});
    if(result.error)return toast('Payment not saved: '+result.error.message);
    toast('Supplier payment saved. Balance: '+fmt(result.data.remaining_balance));
    await loadPurchaseData();
  }

  async function loadAccountingData() {
    if(!client||!profile||!['owner','manager','accountant'].includes(profile.role))return;
    const [journalRes, invoiceRes, paymentRes] = await Promise.all([
      client.from('journals').select('id,journal_date,source_type,source_id,memo').order('journal_date',{ascending:false}).limit(500),
      client.from('supplier_invoices').select('total,amount_paid,status'),
      client.from('sales').select('total,cost_of_goods,discount,status,created_at').eq('status','completed')
    ]);
    for(const r of [journalRes,invoiceRes,paymentRes])if(r.error)throw r.error;
    const saleRevenue=paymentRes.data.reduce((sum,s)=>sum+Number(s.total),0);
    const cogs=paymentRes.data.reduce((sum,s)=>sum+Number(s.cost_of_goods),0);
    const ap=invoiceRes.data.reduce((sum,i)=>sum+Number(i.total)-Number(i.amount_paid),0);
    const revenue=paymentRes.data.reduce((sum,s)=>sum+Number(s.total),0);
    const [lineRes,accountsRes] = await Promise.all([
      client.from('journal_lines').select('journal_id,account_id,debit,credit'),
      client.from('accounts').select('id,code,name,type').eq('active',true).order('code')
    ]);
    if(lineRes.error)throw lineRes.error;if(accountsRes.error)throw accountsRes.error;
    const accountById=Object.fromEntries(accountsRes.data.map(a=>[a.id,a]));
    const totals={};
    for(const line of lineRes.data){const a=accountById[line.account_id];if(!a)continue;totals[a.code]=(totals[a.code]||0)+Number(line.debit)-Number(line.credit);}
    const grossRevenue=Object.entries(totals).filter(([code])=>code==='4000').reduce((s,[,v])=>s-v,0);
    const discounts=Object.entries(totals).filter(([code])=>code==='4900').reduce((s,[,v])=>s+v,0);
    const expense=Object.entries(totals).filter(([code])=>code.startsWith('6')).reduce((s,[,v])=>s+v,0);
    const net=grossRevenue-discounts-cogs-expense;
    const metrics=document.querySelectorAll('#accounting-view .metric strong');
    if(metrics.length>=4){metrics[0].textContent=fmt(grossRevenue);metrics[1].textContent=fmt(cogs);metrics[2].textContent=fmt(expense);metrics[3].textContent=fmt(net);}
    const subs=document.querySelectorAll('#accounting-view .metric small');
    if(subs.length>=4){subs[0].textContent='Posted journals · UGX';subs[1].textContent='From completed POS sales';subs[2].textContent='Posted expense journals';subs[3].textContent='Revenue less COGS and expenses';}
    $('ap-total-accounting').textContent=fmt(ap);
    const normalDebit = a => ['asset','expense','contra_revenue'].includes(a.type);
    let totalDebit=0,totalCredit=0;
    $('trial-balance').innerHTML=accountsRes.data.map(a=>{
      const netBalance=totals[a.code]||0;
      const debit=normalDebit(a)?Math.max(netBalance,0):Math.max(-netBalance,0);
      const credit=normalDebit(a)?Math.max(-netBalance,0):Math.max(netBalance,0);
      totalDebit+=debit;totalCredit+=credit;
      return '<tr><td>'+escapeHtml(a.code)+'</td><td>'+escapeHtml(a.name)+'</td><td>'+escapeHtml(a.type.replaceAll('_',' '))+'</td><td>'+fmt(debit)+'</td><td>'+fmt(credit)+'</td></tr>';
    }).join('')||'<tr><td colspan="5">No active accounts.</td></tr>';
    $('trial-debit').textContent=fmt(totalDebit);$('trial-credit').textContent=fmt(totalCredit);
    const assetAccounts=accountsRes.data.filter(a=>a.type==='asset');
    const liabilityAccounts=accountsRes.data.filter(a=>a.type==='liability');
    const equityAccounts=accountsRes.data.filter(a=>a.type==='equity');
    const assetTotal=assetAccounts.reduce((sum,a)=>sum+(totals[a.code]||0),0);
    const liabilityTotal=liabilityAccounts.reduce((sum,a)=>sum-(totals[a.code]||0),0);
    const equityTotal=equityAccounts.reduce((sum,a)=>sum-(totals[a.code]||0),0)+net;
    const bsRows=[
      ...assetAccounts.map(a=>({section:'Assets',name:a.code+' · '+a.name,value:totals[a.code]||0})),
      ...liabilityAccounts.map(a=>({section:'Liabilities',name:a.code+' · '+a.name,value:-(totals[a.code]||0)})),
      ...equityAccounts.map(a=>({section:'Equity',name:a.code+' · '+a.name,value:-(totals[a.code]||0)})),
      {section:'Equity',name:'Current-period net profit (estimated)',value:net},
      {section:'Total',name:'Total assets',value:assetTotal},
      {section:'Total',name:'Liabilities + equity',value:liabilityTotal+equityTotal}
    ];
    $('balance-sheet').innerHTML=bsRows.map(r=>'<tr><td>'+escapeHtml(r.section)+'</td><td>'+escapeHtml(r.name)+'</td><td><b>'+fmt(r.value)+'</b></td></tr>').join('');
    const cashMovement=accountsRes.data.filter(a=>['1000','1010','1020'].includes(a.code)).reduce((sum,a)=>sum+(totals[a.code]||0),0);
    $('cash-movement').textContent=fmt(cashMovement);
    $('journal-register').innerHTML=journalRes.data.map(j=>'<tr><td>'+escapeHtml(new Date(j.journal_date).toLocaleString('en-GB'))+'</td><td>'+escapeHtml(j.source_type)+'</td><td>'+escapeHtml(j.memo)+'</td></tr>').join('')||'<tr><td colspan="3">No posted journals.</td></tr>';
    $('accounting-notice').innerHTML='<b>Live accounting</b><span>Trial balance and balance sheet snapshot are derived from posted journal lines. Profit and cash movement are cumulative since opening; import opening balances before relying on these as formal statements.</span>';
  }

  function renderCustomerSelect() {
    const select = $('customer-select');
    const label = $('customer-label');
    const isCredit = $('payment-method').value === 'Credit';
    select.classList.toggle('hidden', !isCredit);
    label.classList.toggle('hidden', !isCredit);
    select.innerHTML = '<option value="">Select customer…</option>' + customers.filter(c => c.active).map(c =>
      '<option value="' + c.id + '">' + escapeHtml(c.name) + (c.phone ? ' · ' + escapeHtml(c.phone) : '') + '</option>'
    ).join('');
  }

  async function editCustomer(id) {
    if (!profile || !['owner','manager'].includes(profile.role)) return toast('Only an owner or manager can edit customers.');
    const c=customers.find(x=>x.id===id); if(!c)return;
    const name=prompt('Customer name:',c.name); if(name===null)return; if(!name.trim())return toast('Customer name is required.');
    const phone=prompt('Customer phone (optional):',c.phone||''); if(phone===null)return;
    const limitRaw=prompt('Credit limit in UGX:',String(c.credit_limit||0)); if(limitRaw===null)return;
    const credit_limit=Number(limitRaw); if(!Number.isFinite(credit_limit)||credit_limit<0)return toast('Enter a valid non-negative credit limit.');
    const r=await client.from('customers').update({name:name.trim(),phone:phone.trim()||null,credit_limit}).eq('id',id);
    if(r.error)return toast('Customer update failed: '+r.error.message);
    toast('Customer updated.'); await loadData();
  }

  async function setCustomerActive(id, active) {
    if (!profile || !['owner','manager'].includes(profile.role)) return toast('Only an owner or manager can change customer status.');
    const c=customers.find(x=>x.id===id); if(!c)return;
    if(!confirm((active?'Reactivate':'Deactivate')+' customer "'+c.name+'"? Past sales will be preserved.'))return;
    const r=await client.from('customers').update({active}).eq('id',id);
    if(r.error)return toast('Customer status not changed: '+r.error.message);
    toast(active?'Customer reactivated.':'Customer deactivated.'); await loadData();
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

  async function generateUniqueSku(productName, excludeId) {
    const prefix = String(productName || 'ITEM')
      .normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 5) || 'ITEM';
    for (let attempt = 0; attempt < 8; attempt++) {
      const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 7).toUpperCase();
      const candidate = 'DCG-' + prefix + '-' + suffix;
      let query = client.from('products').select('id').eq('sku', candidate).limit(1);
      const result = await query;
      if (result.error) throw new Error(result.error.message);
      if (!result.data.length || (excludeId && result.data.every(row => row.id === excludeId))) return candidate;
    }
    throw new Error('Could not generate a unique SKU. Please try again.');
  }

  async function editProduct(id) {
    if (!profile || !['owner','manager'].includes(profile.role)) return toast('Only an owner or manager can edit products.');
    const p=products.find(x=>x.id===id); if(!p)return;
    const name=prompt('Product name:',p.name); if(name===null)return; if(!name.trim())return toast('Product name is required.');
    let sku=prompt('Unique SKU / product code (leave blank to generate a new unique SKU):',p.sku); if(sku===null)return;
    if(!sku.trim()) { try { sku=await generateUniqueSku(name.trim(), id); } catch(e) { return toast('Could not generate SKU: '+e.message); } }
    const buyingRaw=prompt('Buying cost in UGX:',String(p.buying_price||0)); if(buyingRaw===null)return;
    const sellingRaw=prompt('Selling price in UGX:',String(p.selling_price||0)); if(sellingRaw===null)return;
    const reorderRaw=prompt('Reorder level:',String(p.reorder_level||0)); if(reorderRaw===null)return;
    const buying=Number(buyingRaw), selling=Number(sellingRaw), reorder=Number(reorderRaw);
    if (![buying,selling,reorder].every(Number.isFinite)||buying<0||selling<0||reorder<0)return toast('Enter valid non-negative numeric values.');
    const categoryName=prompt('Category name (leave blank for uncategorised):',p.categories?.name||''); if(categoryName===null)return;
    let category_id=null;
    if(categoryName.trim()){
      let category=categories.find(c=>c.name.toLowerCase()===categoryName.trim().toLowerCase());
      if(!category){const cr=await client.from('categories').insert({name:categoryName.trim()}).select('id,name').single();if(cr.error)return toast('Category could not be created: '+cr.error.message);category=cr.data;categories.push(category);}
      category_id=category.id;
    }
    const r=await client.from('products').update({name:name.trim(),sku:sku.trim(),buying_price:buying,selling_price:selling,reorder_level:reorder,category_id}).eq('id',id);
    if(r.error)return toast('Product update failed: '+r.error.message);
    toast('Product updated. Stock quantity was not changed; use Purchases or Stock Taking to adjust stock.'); await loadData();
  }

  async function setProductActive(id, active) {
    if (!profile || !['owner','manager'].includes(profile.role)) return toast('Only an owner or manager can change product status.');
    const p=products.find(x=>x.id===id); if(!p)return;
    if(!confirm((active?'Reactivate':'Deactivate')+' product "'+p.name+'"? Transaction history will be preserved.'))return;
    const r=await client.from('products').update({active}).eq('id',id);
    if(r.error)return toast('Product status not changed: '+r.error.message);
    toast(active?'Product reactivated.':'Product deactivated.'); await loadData();
  }

  async function addProduct() {
    if (!profile || !['owner', 'manager'].includes(profile.role)) return toast('Only an owner or manager can add products.');
    const name = prompt('Product name:');
    if (!name || !name.trim()) return;
    let sku;
    try { sku = await generateUniqueSku(name.trim()); }
    catch (e) { return toast('Could not generate SKU: ' + e.message); }
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
      name: name.trim(), sku, buying_price: buying, selling_price: selling,
      quantity_on_hand: quantity, reorder_level: reorder, category_id: categoryId, active: true
    }).select('id').single();
    if (result.error) return toast('Could not save product: ' + result.error.message);
    toast('Product saved with SKU ' + sku + '.');
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
        p_items: cart.map(item => item.price !== item.listedPrice
          ? ({ product_id: item.id, quantity: item.qty, unit_price: item.price })
          : ({ product_id: item.id, quantity: item.qty })),
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
    const checkId = ++sessionCheckId;
    profile = null;
    cart = [];
    products = [];
    sales = [];
    setSignedIn(false);
    renderCart();
    if (!client) { setConnectionStatus('Setup required', 'Supabase configuration missing', 'error'); return; }
    if (!session) { setConnectionStatus('Live system configured', 'Sign in to verify live data access', 'pending'); return; }
    setConnectionStatus('Checking connection', 'Verifying staff access and live data', 'pending');
    let result;
    try {
      result = await client.from('profiles').select('id,full_name,role,active').eq('id', session.user.id).maybeSingle();
    } catch (error) {
      if (checkId !== sessionCheckId) return;
      setConnectionStatus('Connection issue', 'Could not verify staff profile', 'error');
      setMessage('Could not verify your staff profile because the database request failed. Check your connection and try again.', true);
      return;
    }
    if (checkId !== sessionCheckId) return;
    if (result.error) {
      setConnectionStatus('Connection issue', 'Could not verify staff profile', 'error');
      setMessage('Could not load staff profile: ' + result.error.message, true);
      await client.auth.signOut();
      return;
    }
    if (!result.data || !result.data.active) {
      setConnectionStatus('Sign-in not authorised', 'Ask the owner to activate your staff profile', 'error');
      setMessage('This login has no active Dream City staff profile. Ask the owner to configure it.', true);
      await client.auth.signOut();
      return;
    }
    profile = result.data;
    setSignedIn(true);
    $('staff-status').textContent = (profile.full_name || session.user.email) + ' · ' + profile.role;
    try {
      await loadData();
      if (checkId !== sessionCheckId) return;
      showView('dashboard');
      setMessage('');
    } catch (error) {
      if (checkId !== sessionCheckId) return;
      setConnectionStatus('Connection issue', 'Live data could not be loaded', 'error');
      setMessage('You signed in, but live data could not load: ' + (error.message || 'Check the database migration and permissions.'), true);
    }
  }

  $('today').textContent = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());
  // Delegate navigation so desktop sidebar and mobile bottom-nav clicks share one reliable handler.
  // Give an explicit response when authentication/profile setup prevents opening a module.
  document.addEventListener('click', event => {
    const navButton = event.target.closest('button.nav[data-view]');
    const gotoButton = event.target.closest('button[data-goto]');
    const button = navButton || gotoButton;
    if (!button) return;
    event.preventDefault();
    const destination = navButton ? navButton.dataset.view : gotoButton.dataset.goto;
    if (!destination) return;
    if (!profile) {
      toast('Please sign in with an active staff account to open ' + (destination === 'pos' ? 'Point of Sale' : destination.charAt(0).toUpperCase() + destination.slice(1)) + '.');
      $('login-email')?.focus({ preventScroll: true });
      return;
    }
    showView(destination);
  }, { passive: false });
  $('product-search').addEventListener('input', renderProducts);
  $('inventory-search').addEventListener('input', renderInventory);
  $('start-stocktake').addEventListener('click', startStocktake);
  $('refresh-stocktake').addEventListener('click', () => loadStocktakeData().catch(error => toast('Refresh failed: '+error.message)));
  $('finalize-stocktake').addEventListener('click', finalizeStocktake);
  $('cancel-stocktake').addEventListener('click', cancelStocktake);
  $('stocktake-search').addEventListener('input', () => renderStocktake(stocktakeHistory));
  $('add-supplier').addEventListener('click', addSupplier);
  $('create-purchase-order').addEventListener('click', createPurchaseOrder);
  $('receive-supplier-invoice').addEventListener('click', receiveSupplierInvoice);
  $('payment-method').addEventListener('change', renderCustomerSelect);
  $('clear-cart').addEventListener('click', () => { cart = []; pendingIdempotencyKey = null; renderCart(); });
  $('checkout').addEventListener('click', checkout);
  $('add-product').addEventListener('click', addProduct);
  $('add-customer').addEventListener('click', addCustomer);
  $('manage-add-customer').addEventListener('click', addCustomer);
  $('print-last-receipt').addEventListener('click', () => printReceipt(lastReceipt));
  $('toggle-password').addEventListener('click', () => {
    const field = $('login-password'), show = field.type === 'password';
    field.type = show ? 'text' : 'password';
    $('toggle-password').textContent = show ? 'Hide' : 'Show';
    $('toggle-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    $('toggle-password').setAttribute('aria-pressed', String(show));
  });
  $('forgot-password').addEventListener('click', () => {
    $('sign-in-form').classList.add('hidden'); $('reset-request-form').classList.remove('hidden');
    $('reset-email').value = $('login-email').value.trim(); setMessage(''); $('reset-email').focus();
  });
  $('back-to-sign-in').addEventListener('click', () => {
    $('reset-request-form').classList.add('hidden'); $('new-password-form').classList.add('hidden');
    $('sign-in-form').classList.remove('hidden'); setMessage(''); $('login-email').focus();
  });
  $('reset-request-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!client) return setMessage('Password recovery is not configured. Contact your administrator.', true);
    const button=$('send-reset-link'); button.disabled=true; button.textContent='Sending secure link…';
    const redirectTo=new URL(window.location.href); redirectTo.hash='';
    try {
      const result=await client.auth.resetPasswordForEmail($('reset-email').value.trim(),{redirectTo:redirectTo.toString()});
      if(result.error) throw result.error;
      setMessage('If an account exists for that email, a reset link has been sent. Check your inbox and spam folder. If it does not arrive, check Spam and ask the administrator to verify the Supabase email settings.');
    } catch(error) {
      setMessage('Could not send the reset email: '+(error.message||'Check your internet connection and Supabase email settings.'),true);
    } finally {
      button.disabled=false; button.textContent='Send reset link →';
    }
  });
  $('new-password-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!client) return setMessage('Password recovery is not configured. Contact your administrator.',true);
    const password=$('new-password').value;
    if(password!==$('confirm-password').value)return setMessage('The passwords do not match.',true);
    if(password.length<8)return setMessage('Use at least 8 characters for your new password.',true);
    const button=$('save-new-password');button.disabled=true;button.textContent='Saving password…';
    try {
      const result=await client.auth.updateUser({password});
      if(result.error) throw result.error;
      $('new-password-form').classList.add('hidden');$('sign-in-form').classList.remove('hidden');
      $('login-password').value='';$('new-password').value='';$('confirm-password').value='';
      setMessage('Password updated. You can now sign in with your new password.');
    } catch(error) {
      setMessage('Could not update the password: '+(error.message||'Open the password-reset link again and retry.'),true);
    } finally {
      button.disabled=false;button.textContent='Save new password →';
    }
  });
  const recoveryMode=window.location.hash.includes('type=recovery')||new URLSearchParams(window.location.search).get('type')==='recovery';
  if(recoveryMode){$('sign-in-form').classList.add('hidden');$('reset-request-form').classList.add('hidden');$('new-password-form').classList.remove('hidden');$('auth-title').textContent='Set a new password';}
  $('sign-in-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!client) return setMessage('Supabase is not configured. Edit supabase-config.js with the dedicated project publishable/anon key.', true);
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    $('sign-in-button').disabled = true;
    setMessage('Signing in…');
    try {
      const result = await client.auth.signInWithPassword({ email, password });
      if (result.error) {
        setMessage(result.error.message, true);
        return;
      }
      // Handle this sign-in result directly. The listener skips SIGNED_IN to
      // avoid processing the same session twice.
      await onSession(result.data.session);
    } catch (error) {
      setMessage('Unable to reach the sign-in service. Check your internet connection and try again.', true);
    } finally {
      $('sign-in-button').disabled = false;
    }
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
    // Subscribe before reading the stored session so sign-in events cannot be
    // missed during initialization. Ignore duplicate initial-session callbacks;
    // the explicit getSession result is authoritative for initial page load.
    // If a real auth event arrives while getSession() is pending, never let
    // the older initial-session response overwrite that newer sign-in.
    let authEventSeen = false;
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') return;
      authEventSeen = true;
      // Avoid awaiting network work inside Supabase's auth event callback.
      setTimeout(() => onSession(session), 0);
    });
    client.auth.getSession().then(({ data, error }) => {
      if (error) {
        if (!authEventSeen) {
          setConnectionStatus('Connection issue', 'Could not restore sign-in session', 'error');
          setMessage('Could not restore your sign-in session. Refresh the page and try again.', true);
        }
        return;
      }
      if (!authEventSeen) onSession(data?.session || null);
    }).catch(() => {
      if (!authEventSeen) {
        setConnectionStatus('Connection issue', 'Could not restore sign-in session', 'error');
        setMessage('Could not contact the sign-in service. Check your connection and refresh the page.', true);
      }
    });
  }
})();
