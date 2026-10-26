import { h, clear, debounce, uuid } from '../lib/dom.js';
import { db, rpc, run } from '../lib/supabase.js';
import { state, can } from '../lib/state.js';
import { money, num, parseAmount, paymentLabel } from '../lib/format.js';
import { toast, showError, modal, withBusy, formModal, confirmDialog } from '../lib/ui.js';
import { printReceipt } from '../lib/receipt.js';

const CART_KEY = 'pos.cart.v2';

export async function render(root) {
  let products = [];
  let customers = [];
  let categories = [];
  let activeCategory = '';
  let cart = loadCart();           // [{ id, name, sku, price, listed, qty, weight, track, stock }]
  let payment = 'cash';
  let customerId = '';
  let discount = 0;
  let idempotencyKey = null;

  const search = h('input', { class: 'search', type: 'search', placeholder: 'Search or scan barcode…', 'aria-label': 'Search products or scan a barcode', autocomplete: 'off' });
  const chips = h('div', { class: 'chips', role: 'toolbar', 'aria-label': 'Categories' });
  const grid = h('div', { class: 'product-grid' });
  const cartList = h('div', { class: 'cart-lines' });
  const totals = h('div', { class: 'cart-totals' });
  const payButtons = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Payment method' });
  const customerSelect = h('select', { 'aria-label': 'Customer' });
  const discountInput = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Discount' });
  const tendered = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Cash given (optional)', 'aria-label': 'Cash given' });
  const changeLine = h('div', { class: 'change-line' });
  const checkoutBtn = h('button', { class: 'primary block big', type: 'button' }, 'Complete sale');
  const countLabel = h('span', { class: 'muted' });
  const mobileBar = h('button', { type: 'button', class: 'mobile-cart-bar', hidden: true, onclick: () => cartEl.scrollIntoView({ behavior: 'smooth' }) });

  clear(root,
    h('div', { class: 'pos' },
      h('section', { class: 'pos-products card' },
        h('div', { class: 'pos-search' }, search),
        chips, grid),
      mobileBar,
      h('aside', { class: 'pos-cart card', 'aria-label': 'Current sale', id: 'pos-cart' },
        h('div', { class: 'card-head' }, h('h2', null, 'Current sale'), countLabel,
          h('button', { class: 'link', type: 'button', onclick: clearCartAsk }, 'Clear')),
        cartList,
        h('div', { class: 'cart-form' },
          h('label', null, 'Payment'), payButtons,
          h('div', { class: 'customer-row' }, h('label', null, 'Customer'), h('div', { class: 'with-action' }, customerSelect,
            can.manageCustomers() ? h('button', { class: 'secondary small', type: 'button', onclick: quickCustomer }, '+ New') : null)),
          can.discount() ? h('div', { class: 'discount-row' }, h('label', null, 'Discount'), discountInput) : null,
          h('div', { class: 'tender-row' }, tendered, changeLine)),
        totals, checkoutBtn)));
  const cartEl = root.querySelector('#pos-cart');

  // ------------------------------------------------------------ data
  async function load() {
    const [p, c, cats] = await Promise.all([
      run(db().from('products').select('id,name,sku,barcode,selling_price,quantity_on_hand,reorder_level,unit,sold_by_weight,track_stock,available_for_sale,category_id,categories(name)').eq('active', true).order('name').limit(5000)),
      run(db().from('customers').select('id,name,phone,credit_limit,active').eq('active', true).order('name').limit(2000)),
      run(db().from('categories').select('id,name').eq('active', true).order('name'))
    ]);
    products = p.filter(x => x.available_for_sale !== false);
    customers = c;
    categories = cats.filter(cat => products.some(x => x.category_id === cat.id));
    // Refresh cart lines with current price/stock.
    cart = cart.filter(line => products.some(x => x.id === line.id)).map(line => {
      const prod = products.find(x => x.id === line.id);
      return { ...line, listed: Number(prod.selling_price), price: line.price === line.listed ? Number(prod.selling_price) : line.price, stock: Number(prod.quantity_on_hand), track: prod.track_stock };
    });
    renderChips(); renderGrid(); renderCustomers(); renderCart();
  }

  // ------------------------------------------------------------ products
  function renderChips() {
    clear(chips, [['', 'All'], ...categories.map(c => [c.id, c.name])].map(([id, label]) =>
      h('button', { type: 'button', class: 'chip' + (id === activeCategory ? ' active' : ''), onclick: () => { activeCategory = id; renderChips(); renderGrid(); } }, label)));
  }

  function matches(p, q) {
    if (!q) return true;
    const hay = (p.name + ' ' + p.sku + ' ' + (p.barcode || '') + ' ' + (p.categories?.name || '')).toLowerCase();
    return q.split(/\s+/).every(t => hay.includes(t));
  }

  function renderGrid() {
    const q = search.value.trim().toLowerCase();
    const list = products.filter(p => (!activeCategory || p.category_id === activeCategory) && matches(p, q)).slice(0, 200);
    if (!products.length) {
      clear(grid, h('div', { class: 'empty-state' }, h('h3', null, 'No products yet'),
        h('p', { class: 'muted' }, 'Add products, or import your catalogue from Loyverse.'),
        can.manageCatalogue() ? h('a', { class: 'primary', href: '#/import' }, 'Import from Loyverse') : null));
      return;
    }
    clear(grid, list.length ? list.map(productCard) : h('p', { class: 'muted pad' }, 'No product matches “' + search.value + '”.'));
  }

  function productCard(p) {
    const stock = Number(p.quantity_on_hand);
    const out = p.track_stock && stock <= 0;
    const low = p.track_stock && !out && stock <= Number(p.reorder_level || 0);
    return h('button', { type: 'button', class: 'product-card' + (out ? ' out' : ''), disabled: out, onclick: () => add(p) },
      h('span', { class: 'p-name' }, p.name),
      h('span', { class: 'p-meta' }, p.sku),
      h('span', { class: 'p-price' }, money(p.selling_price), p.sold_by_weight ? h('small', null, ' / ' + (p.unit || 'kg')) : null),
      h('span', { class: 'p-stock ' + (out ? 'bad' : low ? 'warn' : 'ok') }, !p.track_stock ? 'Not stock-tracked' : out ? 'Out of stock' : num(stock) + ' ' + (p.unit || '') + ' left'));
  }

  function add(p, qty) {
    const line = cart.find(l => l.id === p.id);
    const step = qty ?? (p.sold_by_weight ? null : 1);
    if (step === null) return askWeight(p);
    const next = (line ? line.qty : 0) + step;
    if (p.track_stock && next > Number(p.quantity_on_hand)) return toast(`Only ${num(p.quantity_on_hand)} of ${p.name} in stock.`, 'error');
    if (line) line.qty = round3(next);
    else cart.push({ id: p.id, name: p.name, sku: p.sku, price: Number(p.selling_price), listed: Number(p.selling_price), qty: round3(step), weight: p.sold_by_weight, track: p.track_stock, stock: Number(p.quantity_on_hand), unit: p.unit });
    idempotencyKey = null;
    renderCart();
  }

  function askWeight(p) {
    formModal({
      title: p.name, subtitle: money(p.selling_price) + ' per ' + (p.unit || 'kg'),
      fields: [{ name: 'qty', label: 'Quantity (' + (p.unit || 'kg') + ')', type: 'number', step: '0.001', min: '0.001', required: true }],
      submitLabel: 'Add', onSubmit: v => { if (!(v.qty > 0)) throw new Error('Enter a quantity above zero.'); add(p, v.qty); }
    });
  }

  // Barcode scanners type the code and press Enter.
  search.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = search.value.trim().toLowerCase();
    if (!code) return;
    const exact = products.find(p => (p.barcode && p.barcode.toLowerCase() === code) || p.sku.toLowerCase() === code);
    const filtered = products.filter(p => matches(p, code));
    const pick = exact || (filtered.length === 1 ? filtered[0] : null);
    if (pick) { add(pick); search.value = ''; renderGrid(); }
    else if (!filtered.length) toast('No product with code ' + search.value, 'error');
  });
  search.addEventListener('input', debounce(renderGrid, 120));

  // ------------------------------------------------------------ cart
  function renderCart() {
    saveCart(cart);
    const count = cart.reduce((s, l) => s + (l.weight ? 1 : l.qty), 0);
    countLabel.textContent = count ? num(count) + (count === 1 ? ' item' : ' items') : '';
    if (!cart.length) {
      clear(cartList, h('div', { class: 'empty-cart' }, 'Tap a product or scan a barcode to start.'));
    } else {
      clear(cartList, cart.map(line => h('div', { class: 'cart-line' },
        h('div', { class: 'cl-main' },
          h('b', null, line.name),
          h('small', { class: 'muted' }, money(line.price) + (line.weight ? ' / ' + (line.unit || 'kg') : ' each') + (line.price !== line.listed ? ' · price changed' : ''))),
        h('div', { class: 'qty' },
          h('button', { type: 'button', 'aria-label': 'Less ' + line.name, onclick: () => bump(line, -1) }, '−'),
          h('input', { value: num(line.qty), inputmode: 'decimal', 'aria-label': 'Quantity of ' + line.name, onchange: e => setQty(line, parseAmount(e.target.value)) }),
          h('button', { type: 'button', 'aria-label': 'More ' + line.name, onclick: () => bump(line, 1) }, '+')),
        h('div', { class: 'cl-total' }, money(line.qty * line.price),
          can.overridePrice() ? h('button', { class: 'link small', type: 'button', onclick: () => changePrice(line) }, 'Price') : null,
          h('button', { class: 'link small danger', type: 'button', 'aria-label': 'Remove ' + line.name, onclick: () => { cart = cart.filter(l => l !== line); idempotencyKey = null; renderCart(); } }, 'Remove')))));
    }
    const subtotal = cart.reduce((s, l) => s + round2(l.qty * l.price), 0);
    const disc = Math.min(Math.max(discount, 0), subtotal);
    const total = subtotal - disc;
    clear(totals,
      h('div', null, h('span', null, 'Subtotal'), h('span', null, money(subtotal))),
      disc ? h('div', null, h('span', null, 'Discount'), h('span', null, '−' + money(disc))) : null,
      h('div', { class: 'grand' }, h('span', null, 'Total'), h('strong', null, money(total))));
    const given = parseAmount(tendered.value);
    changeLine.textContent = payment === 'cash' && given > 0 ? (given >= total ? 'Change: ' + money(given - total) : 'Short by ' + money(total - given)) : '';
    changeLine.className = 'change-line' + (given > 0 && given < total ? ' bad' : '');
    tendered.parentElement.hidden = payment !== 'cash';
    checkoutBtn.disabled = !cart.length;
    mobileBar.hidden = !cart.length;
    mobileBar.textContent = `${countLabel.textContent} · ${money(total)} — View sale ↓`;
    checkoutBtn.textContent = cart.length ? 'Complete sale · ' + money(total) : 'Complete sale';
  }

  function bump(line, dir) {
    const step = line.weight ? 0.25 : 1;
    setQty(line, round3(line.qty + dir * step));
  }

  function setQty(line, qty) {
    if (!Number.isFinite(qty)) return renderCart();
    if (qty <= 0) cart = cart.filter(l => l !== line);
    else {
      if (!line.weight && qty !== Math.trunc(qty)) { toast(line.name + ' is sold in whole units.', 'error'); return renderCart(); }
      if (line.track && qty > line.stock) { toast(`Only ${num(line.stock)} in stock.`, 'error'); qty = line.stock; }
      line.qty = qty;
    }
    idempotencyKey = null;
    renderCart();
  }

  function changePrice(line) {
    formModal({
      title: 'Change price', subtitle: line.name + ' · listed at ' + money(line.listed),
      fields: [{ name: 'price', label: 'Selling price for this sale', type: 'number', min: '0', step: 'any', value: line.price, required: true }],
      submitLabel: 'Use this price',
      onSubmit: v => { if (!(v.price >= 0)) throw new Error('Enter a valid price.'); line.price = round2(v.price); idempotencyKey = null; renderCart(); }
    });
  }

  async function clearCartAsk() {
    if (!cart.length) return;
    if (await confirmDialog({ title: 'Clear this sale?', message: 'All items will be removed from the cart.', confirmLabel: 'Clear', danger: true })) {
      cart = []; discount = 0; discountInput.value = ''; tendered.value = ''; idempotencyKey = null; renderCart();
    }
  }

  // ------------------------------------------------------------ payment
  function renderPayments() {
    const methods = ['cash', 'mobile_money', 'card', 'bank', 'credit'];
    clear(payButtons, methods.map(m => h('button', { type: 'button', role: 'radio', 'aria-checked': String(m === payment), class: m === payment ? 'active' : '', onclick: () => { payment = m; idempotencyKey = null; renderPayments(); renderCustomers(); renderCart(); } }, paymentLabel(m).replace(' (pay later)', ''))));
    customerSelect.required = payment === 'credit';
    customerSelect.closest('.customer-row')?.classList.toggle('needed', payment === 'credit');
  }

  function renderCustomers() {
    clear(customerSelect, h('option', { value: '' }, payment === 'credit' ? 'Choose customer (required)' : 'Walk-in customer'),
      customers.map(c => h('option', { value: c.id, selected: c.id === customerId }, c.name + (c.phone ? ' · ' + c.phone : ''))));
  }
  customerSelect.addEventListener('change', () => { customerId = customerSelect.value; idempotencyKey = null; });
  discountInput.addEventListener('input', () => { const v = parseAmount(discountInput.value); discount = Number.isFinite(v) ? v : 0; idempotencyKey = null; renderCart(); });
  tendered.addEventListener('input', () => renderCart());

  function quickCustomer() {
    formModal({
      title: 'New customer',
      fields: [
        { name: 'name', label: 'Name', required: true, full: true },
        { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'credit_limit', label: 'Credit limit', type: 'number', min: '0', step: 'any', value: 0, hint: 'Maximum they may owe. 0 = no credit.' }
      ],
      onSubmit: async v => {
        const row = await run(db().from('customers').insert({ name: v.name, phone: v.phone || null, credit_limit: v.credit_limit || 0 }).select('id,name,phone,credit_limit,active').single());
        customers.push(row); customers.sort((a, b) => a.name.localeCompare(b.name));
        customerId = row.id; renderCustomers();
        toast('Customer added.');
      }
    });
  }

  // ------------------------------------------------------------ checkout
  checkoutBtn.addEventListener('click', () => withBusy(checkoutBtn, checkout));

  async function checkout() {
    if (!cart.length) return;
    if (payment === 'credit' && !customerId) return toast('Choose the customer for a credit sale.', 'error');
    const subtotal = cart.reduce((s, l) => s + round2(l.qty * l.price), 0);
    if (discount < 0 || discount > subtotal) return toast('Discount must be between 0 and the subtotal.', 'error');
    if (!navigator.onLine) return toast('You are offline. Reconnect to save the sale — the cart is kept.', 'error');
    idempotencyKey = idempotencyKey || uuid();
    checkoutBtn.textContent = 'Saving…';
    try {
      const items = cart.map(l => l.price !== l.listed ? { product_id: l.id, quantity: l.qty, unit_price: l.price } : { product_id: l.id, quantity: l.qty });
      const sale = await rpc('complete_sale', {
        p_items: items, p_payment_method: payment, p_idempotency_key: idempotencyKey,
        p_customer_id: customerId || null, p_discount: round2(discount), p_tax: 0
      });
      const given = parseAmount(tendered.value);
      const receipt = {
        receipt_number: sale.receipt_number, created_at: sale.created_at || new Date().toISOString(),
        cashier: state.profile.full_name, customer: customers.find(c => c.id === customerId)?.name || '',
        payment_method: payment, subtotal: sale.subtotal, discount: sale.discount, total: sale.total,
        tendered: payment === 'cash' && given > 0 ? given : null, change: payment === 'cash' && given > 0 ? given - Number(sale.total) : null,
        items: cart.map(l => ({ name: l.name, sku: l.sku, qty: l.qty, price: l.price, line_total: round2(l.qty * l.price) }))
      };
      cart = []; discount = 0; discountInput.value = ''; tendered.value = ''; customerId = ''; payment = 'cash'; idempotencyKey = null;
      renderPayments(); renderCustomers(); renderCart();
      showDone(receipt, sale.replayed);
      load().catch(showError);
    } catch (e) {
      showError(new Error('Sale NOT saved: ' + e.message));
    }
  }

  function showDone(receipt, replayed) {
    modal({
      title: replayed ? 'Sale was already saved' : 'Sale complete',
      subtitle: receipt.receipt_number,
      content: h('div', { class: 'done' },
        h('div', { class: 'done-total' }, money(receipt.total)),
        receipt.change !== null && receipt.change !== undefined ? h('div', { class: 'done-change' }, 'Change: ', h('b', null, money(receipt.change))) : null,
        h('p', { class: 'muted' }, paymentLabel(receipt.payment_method) + (receipt.customer ? ' · ' + receipt.customer : ''))),
      actions: [
        { label: 'Print receipt', onClick: () => printReceipt(receipt) },
        { label: 'New sale', kind: 'primary', onClick: ({ close }) => { close(); search.focus(); } }
      ]
    });
  }

  // Keyboard: F2 = search, F9 = checkout
  const onKey = e => {
    if (e.key === 'F2') { e.preventDefault(); search.focus(); }
    if (e.key === 'F9') { e.preventDefault(); checkoutBtn.click(); }
  };
  document.addEventListener('keydown', onKey);

  renderPayments();
  renderCart();
  grid.append(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Loading products…'));
  await load();
  search.focus();
  return () => document.removeEventListener('keydown', onKey);
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }
function loadCart() { try { return JSON.parse(sessionStorage.getItem(CART_KEY) || '[]'); } catch { return []; } }
function saveCart(cart) { try { sessionStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* private mode */ } }
