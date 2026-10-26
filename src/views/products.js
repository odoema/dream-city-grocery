import { h, clear, table, debounce, downloadCsv } from '../lib/dom.js';
import { db, rpc, run } from '../lib/supabase.js';
import { can } from '../lib/state.js';
import { money, num, dateTime } from '../lib/format.js';
import { pageHeader, card, formModal, modal, toast, showError, badge, stat, confirmDialog, loading } from '../lib/ui.js';
import { imageUrls, uploadProductImage, removeProductImage } from '../lib/images.js';

export async function render(root) {
  let products = [];
  let categories = [];
  let filter = 'all';
  let photos = new Map();
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Search name, SKU or barcode…', 'aria-label': 'Search products' });
  const filterSel = h('select', { 'aria-label': 'Filter' },
    [['all', 'All active'], ['low', 'Low stock'], ['out', 'Out of stock'], ['inactive', 'Inactive'], ['noprice', 'No selling price']].map(([v, l]) => h('option', { value: v }, l)));
  const stats = h('div', { class: 'stats' });
  const listHost = h('div');

  clear(root,
    pageHeader('Products', 'Your catalogue, prices and live stock.',
      can.manageCatalogue() ? h('button', { class: 'primary', onclick: () => editProduct() }, '+ Add product') : null,
      h('button', { class: 'secondary', onclick: exportCsv }, 'Export CSV')),
    stats,
    card(h('div', { class: 'toolbar' }, search, filterSel), listHost));

  async function load() {
    loading(listHost);
    const [p, c] = await Promise.all([
      run(db().from('products').select('id,sku,barcode,name,category_id,unit,buying_price,selling_price,quantity_on_hand,reorder_level,active,available_for_sale,sold_by_weight,track_stock,description,source_system,image_path,categories(name)').order('name').limit(10000)),
      run(db().from('categories').select('id,name,active').order('name'))
    ]);
    products = p; categories = c;
    draw();
    photos = await imageUrls(products.map(x => x.image_path));
    draw();
  }

  function visible() {
    const q = search.value.trim().toLowerCase();
    return products.filter(p => {
      if (filter === 'inactive' ? p.active : !p.active) return false;
      if (filter === 'low' && !(p.track_stock && Number(p.quantity_on_hand) > 0 && Number(p.quantity_on_hand) <= Number(p.reorder_level))) return false;
      if (filter === 'out' && !(p.track_stock && Number(p.quantity_on_hand) <= 0)) return false;
      if (filter === 'noprice' && Number(p.selling_price) > 0) return false;
      if (!q) return true;
      return (p.name + ' ' + p.sku + ' ' + (p.barcode || '') + ' ' + (p.categories?.name || '')).toLowerCase().includes(q);
    });
  }

  function draw() {
    const active = products.filter(p => p.active);
    const value = active.reduce((s, p) => s + (p.track_stock ? Number(p.quantity_on_hand) * Number(p.buying_price) : 0), 0);
    const low = active.filter(p => p.track_stock && Number(p.quantity_on_hand) <= Number(p.reorder_level)).length;
    clear(stats,
      stat('Active products', num(active.length)),
      stat('Stock value (at cost)', money(value)),
      stat('Low or out of stock', num(low), null, low ? 'warn' : ''),
      stat('Missing a price', num(active.filter(p => Number(p.selling_price) <= 0).length)));
    const rows = visible();
    clear(listHost, table([
      { label: 'Product', value: p => h('div', { class: 'with-thumb' }, thumb(p), h('div', null, h('b', null, p.name), h('small', { class: 'block muted' }, p.sku + (p.barcode ? ' · ' + p.barcode : '')))) },
      { label: 'Category', value: p => p.categories?.name || '—' },
      { label: 'Cost', class: 'num', value: p => money(p.buying_price) },
      { label: 'Price', class: 'num', value: p => h('b', null, money(p.selling_price)) },
      { label: 'Margin', class: 'num', value: p => Number(p.selling_price) > 0 ? Math.round((1 - Number(p.buying_price) / Number(p.selling_price)) * 100) + '%' : '—' },
      { label: 'In stock', class: 'num', value: p => !p.track_stock ? badge('not tracked') : h('span', { class: Number(p.quantity_on_hand) <= 0 ? 'bad' : Number(p.quantity_on_hand) <= Number(p.reorder_level) ? 'warn' : '' }, num(p.quantity_on_hand) + ' ' + (p.unit || '')) },
      { label: '', class: 'actions', value: p => h('div', { class: 'row' },
        can.manageCatalogue() ? h('button', { class: 'link', onclick: e => { e.stopPropagation(); editProduct(p); } }, 'Edit') : null,
        h('button', { class: 'link', onclick: e => { e.stopPropagation(); history(p); } }, 'History')) }
    ], rows.slice(0, 500), { empty: products.length ? 'No products match.' : 'No products yet. Add one or import from Loyverse.' }),
    rows.length > 500 ? h('p', { class: 'muted pad' }, `Showing 500 of ${rows.length}. Search to narrow down.`) : null);
  }

  function thumb(p) {
    const url = p.image_path && photos.get(p.image_path);
    return url ? h('img', { class: 'thumb', src: url, alt: '', loading: 'lazy' }) : h('div', { class: 'thumb empty', 'aria-hidden': 'true' }, (p.name || '?').slice(0, 1).toUpperCase());
  }

  search.addEventListener('input', debounce(draw, 150));
  filterSel.addEventListener('change', () => { filter = filterSel.value; draw(); });

  function editProduct(p) {
    const isNew = !p;
    p = p || { unit: 'piece', active: true, available_for_sale: true, track_stock: true, buying_price: 0, selling_price: 0, reorder_level: 0 };
    const listId = 'cat-list-' + Math.random().toString(36).slice(2, 6);
    let photoFile = null;
    let removePhoto = false;
    const currentUrl = p.image_path && photos.get(p.image_path);
    const preview = h('div', { class: 'photo-preview' }, currentUrl ? h('img', { src: currentUrl, alt: 'Product photo' }) : h('span', { class: 'muted' }, 'No photo yet'));
    const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const cameraInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
    const removeBtn = h('button', { type: 'button', class: 'link danger', hidden: !p.image_path }, 'Remove photo');
    const onPick = input => () => {
      const f = input.files[0];
      if (!f) return;
      photoFile = f; removePhoto = false;
      clear(preview, h('img', { src: URL.createObjectURL(f), alt: 'New product photo' }));
      removeBtn.hidden = false;
    };
    fileInput.addEventListener('change', onPick(fileInput));
    cameraInput.addEventListener('change', onPick(cameraInput));
    removeBtn.addEventListener('click', () => { photoFile = null; removePhoto = true; clear(preview, h('span', { class: 'muted' }, 'Photo will be removed')); removeBtn.hidden = true; });
    const photoField = h('div', { class: 'field full photo-field' },
      h('label', null, 'Photo'),
      h('div', { class: 'photo-row' }, preview,
        h('div', { class: 'stack' },
          h('button', { type: 'button', class: 'secondary small', onclick: () => fileInput.click() }, 'Choose photo'),
          h('button', { type: 'button', class: 'secondary small', onclick: () => cameraInput.click() }, 'Take photo'),
          removeBtn,
          h('small', { class: 'hint' }, 'Shown on the till. Shrunk automatically.'))),
      fileInput, cameraInput);
    const extra = h('div', null, h('datalist', { id: listId }, categories.filter(c => c.active).map(c => h('option', { value: c.name }))), photoField);
    formModal({
      title: isNew ? 'Add product' : 'Edit product', wide: true,
      subtitle: isNew ? 'Stock starts at zero. Add opening stock after saving, or receive it through Buy.' : 'Stock quantity changes only through sales, purchases and stock counts.',
      extra,
      fields: [
        { name: 'name', label: 'Product name', value: p.name, required: true, full: true },
        { name: 'sku', label: 'SKU / code', value: p.sku, hint: isNew ? 'Leave empty to generate one.' : null },
        { name: 'barcode', label: 'Barcode', value: p.barcode, hint: 'Scan it into this box.' },
        { name: 'category', label: 'Category', value: p.categories?.name || '', list: listId, hint: 'Pick or type a new one.' },
        { name: 'unit', label: 'Unit', value: p.unit || 'piece', hint: 'piece, kg, litre, packet…' },
        { name: 'buying_price', label: 'Cost price', type: 'number', min: '0', step: 'any', value: p.buying_price },
        { name: 'selling_price', label: 'Selling price', type: 'number', min: '0', step: 'any', value: p.selling_price, required: true },
        { name: 'reorder_level', label: 'Low-stock alert at', type: 'number', min: '0', step: 'any', value: p.reorder_level },
        { name: 'description', label: 'Notes', type: 'textarea', value: p.description, full: true, rows: 2 },
        { name: 'sold_by_weight', label: 'Sold by weight / measure', type: 'checkbox', value: p.sold_by_weight, hint: 'Allows quantities like 1.5' },
        { name: 'track_stock', label: 'Track stock', type: 'checkbox', value: p.track_stock !== false, hint: 'Turn off for services' },
        { name: 'available_for_sale', label: 'Show at the till', type: 'checkbox', value: p.available_for_sale !== false },
        { name: 'active', label: 'Active', type: 'checkbox', value: p.active !== false, hint: 'Inactive products keep their history' }
      ],
      onSubmit: async v => {
        if (!(v.selling_price >= 0) || !(v.buying_price >= 0)) throw new Error('Prices cannot be negative.');
        const categoryId = await ensureCategory(v.category);
        const row = {
          name: v.name, barcode: v.barcode || null, category_id: categoryId, unit: v.unit || 'piece',
          buying_price: v.buying_price || 0, selling_price: v.selling_price || 0, reorder_level: v.reorder_level || 0,
          description: v.description || '', sold_by_weight: v.sold_by_weight, track_stock: v.track_stock,
          available_for_sale: v.available_for_sale, active: v.active
        };
        let productId = p.id;
        if (isNew) {
          let sku = v.sku;
          for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = sku || 'P-' + Math.random().toString(36).slice(2, 8).toUpperCase();
            const { data: created, error } = await db().from('products').insert({ ...row, sku: candidate }).select('id').single();
            if (!error) { productId = created.id; toast('Product added.'); break; }
            if (error.code === '23505' && !sku) continue;
            throw new Error(error.code === '23505' ? 'That SKU or barcode is already used by another product.' : error.message);
          }
        } else {
          const { error } = await db().from('products').update({ ...row, sku: v.sku || p.sku, updated_at: new Date().toISOString() }).eq('id', p.id);
          if (error) throw new Error(error.code === '23505' ? 'That SKU or barcode is already used by another product.' : error.message);
          toast('Product saved.');
        }
        if (photoFile && productId) {
          try {
            const path = await uploadProductImage(productId, photoFile);
            await run(db().from('products').update({ image_path: path }).eq('id', productId));
            if (p.image_path) await removeProductImage(p.image_path);
          } catch (err) { showError(new Error('Product saved, but the photo was not: ' + err.message)); }
        } else if (removePhoto && p.image_path) {
          await run(db().from('products').update({ image_path: null }).eq('id', productId));
          await removeProductImage(p.image_path);
        }
        await load();
      }
    });
  }

  async function ensureCategory(name) {
    if (!name) return null;
    const found = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const row = await run(db().from('categories').insert({ name }).select('id,name,active').single());
    categories.push(row);
    return row.id;
  }

  async function history(p) {
    const body = h('div', null, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Loading…'));
    const m = modal({ title: p.name, subtitle: 'Stock movements · ' + num(p.quantity_on_hand) + ' ' + (p.unit || '') + ' now', wide: true, content: body });
    try {
      const rows = await run(db().from('inventory_movements').select('created_at,movement_type,quantity_delta,unit_cost,note').eq('product_id', p.id).order('created_at', { ascending: false }).limit(200));
      const opening = can.manageCatalogue() && p.track_stock && !rows.length;
      clear(body,
        opening ? h('div', { class: 'notice' }, h('div', null, h('b', null, 'No stock recorded yet. '), 'If this product is already on your shelf, record the opening stock once.'),
          h('button', { class: 'primary', onclick: () => { m.close(); openingStock(p); } }, 'Set opening stock')) : null,
        table([
          { label: 'When', value: r => dateTime(r.created_at) },
          { label: 'What', value: r => ({ opening: 'Opening stock', purchase: 'Received', sale: 'Sold', sale_return: 'Refund', purchase_return: 'Returned to supplier', adjustment: 'Stock count' }[r.movement_type] || r.movement_type) },
          { label: 'Qty', class: 'num', value: r => h('span', { class: Number(r.quantity_delta) < 0 ? 'bad' : 'ok' }, (Number(r.quantity_delta) > 0 ? '+' : '') + num(r.quantity_delta)) },
          { label: 'Unit cost', class: 'num', value: r => money(r.unit_cost) },
          { label: 'Note', value: r => r.note || '' }
        ], rows, { empty: 'No movements yet.' }));
    } catch (e) { clear(body, h('p', { class: 'muted' }, e.message)); }
  }

  function openingStock(p) {
    formModal({
      title: 'Opening stock', subtitle: p.name + ' — use this once, when you start using the system.',
      fields: [
        { name: 'qty', label: 'Quantity on the shelf now', type: 'number', min: '0', step: 'any', required: true },
        { name: 'cost', label: 'Cost per unit', type: 'number', min: '0', step: 'any', value: p.buying_price, required: true },
        { name: 'note', label: 'Note', value: 'Opening stock count', full: true }
      ],
      submitLabel: 'Record opening stock',
      onSubmit: async v => {
        if (!(v.qty > 0)) throw new Error('Enter a quantity above zero.');
        const ok = await confirmDialog({ title: 'Record opening stock?', message: `${num(v.qty)} × ${p.name} at ${money(v.cost)} = ${money(v.qty * v.cost)}. This is posted to stock and to the books and can only be corrected later with a stock count.` });
        if (!ok) throw new Error('Cancelled.');
        await rpc('post_opening_stock', { p_product_id: p.id, p_quantity: v.qty, p_unit_cost: v.cost, p_note: v.note });
        toast('Opening stock recorded.');
        await load();
      }
    });
  }

  function exportCsv() {
    downloadCsv('products.csv', [
      ['SKU', 'Barcode', 'Name', 'Category', 'Unit', 'Cost', 'Price', 'In stock', 'Low stock at', 'Active'],
      ...visible().map(p => [p.sku, p.barcode || '', p.name, p.categories?.name || '', p.unit, p.buying_price, p.selling_price, p.quantity_on_hand, p.reorder_level, p.active ? 'yes' : 'no'])
    ]);
  }

  await load().catch(showError);
}
