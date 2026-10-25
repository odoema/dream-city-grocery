(() => {
  'use strict';

  const config = window.DREAM_CITY_SUPABASE_CONFIG || {};
  if (!window.supabase || !config.url || !config.anonKey) return;

  const db = window.supabase.createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const state = { profile: null, categories: [], product: null, imageFile: null, imageUrl: null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  const money = value => 'UGX ' + Math.round(Number(value || 0)).toLocaleString('en-UG');
  const $ = id => document.getElementById(id);
  const canManage = () => ['owner', 'manager'].includes(state.profile?.role);

  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 4200);
  }

  async function loadProfile() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return null;
    const { data, error } = await db.from('profiles').select('id,full_name,role,active').eq('id', session.user.id).maybeSingle();
    if (error) throw error;
    state.profile = data;
    return data;
  }

  async function loadCategories(selected) {
    const [live, dictionary] = await Promise.all([
      db.from('categories').select('id,name,active').order('name'),
      db.from('dream_city_category_dictionary').select('display_name,source_name,department,active,sort_order').eq('active', true).order('sort_order').order('display_name')
    ]);
    if (live.error) throw live.error;
    const names = new Map((live.data || []).map(c => [c.name.toLowerCase(), c]));
    for (const row of (dictionary.data || [])) {
      const name = row.display_name || row.source_name;
      if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), { id: '', name, active: true, dictionaryOnly: true });
    }
    state.categories = [...names.values()].sort((a,b) => a.name.localeCompare(b.name));
    const select = $('pm-category');
    if (!select) return;
    select.innerHTML = '<option value="">Select category…</option>' + state.categories.map(c => '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>').join('');
    if (selected) select.value = selected;
  }

  function injectStyles() {
    if ($('product-manager-styles')) return;
    const style = document.createElement('style');
    style.id = 'product-manager-styles';
    style.textContent = `
      #product-manager-modal{position:fixed;inset:0;background:rgba(15,23,42,.58);z-index:9999;display:none;align-items:center;justify-content:center;padding:20px}
      #product-manager-modal.show{display:flex}
      .pm-dialog{width:min(980px,100%);max-height:94vh;overflow:auto;background:#fff;border-radius:22px;box-shadow:0 28px 80px rgba(15,23,42,.28)}
      .pm-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:24px 26px 16px;border-bottom:1px solid #e5e7eb}.pm-head h2{margin:2px 0 4px}.pm-head p{margin:0;color:#667085}
      .pm-close{border:0;background:#f2f4f7;border-radius:10px;width:38px;height:38px;font-size:22px;cursor:pointer}
      .pm-body{padding:22px 26px}.pm-grid{display:grid;grid-template-columns:1.3fr .7fr;gap:22px}.pm-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}.pm-field{display:flex;flex-direction:column;gap:6px}.pm-field.full{grid-column:1/-1}.pm-field label{font-size:13px;font-weight:700;color:#344054}.pm-field input,.pm-field select,.pm-field textarea{width:100%;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:10px;padding:11px 12px;font:inherit;background:#fff}.pm-field textarea{min-height:82px;resize:vertical}
      .pm-checks{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px}.pm-check{display:flex;gap:7px;align-items:center;font-size:13px}.pm-check input{width:auto}
      .pm-photo{border:1px dashed #b8c0cc;border-radius:16px;min-height:250px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px;background:#f8fafc;text-align:center}.pm-photo img{max-width:100%;max-height:230px;border-radius:12px;object-fit:contain}.pm-photo .pm-placeholder{font-size:54px}.pm-photo input{margin-top:14px;max-width:100%}.pm-hint{font-size:12px;color:#667085;margin-top:8px}.pm-section{margin-top:22px;padding-top:18px;border-top:1px solid #eaecf0}.pm-section h3{margin:0 0 12px}.pm-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 26px;border-top:1px solid #e5e7eb}.pm-actions{display:flex;gap:10px}.pm-danger{color:#b42318}.pm-source{font-size:12px;color:#667085}.pm-thumb{width:40px;height:40px;border-radius:8px;object-fit:cover;vertical-align:middle;margin-right:8px;background:#f2f4f7}.pm-manager-banner{margin:0 0 16px;padding:12px 14px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;font-size:13px}
      @media(max-width:760px){.pm-grid{grid-template-columns:1fr}.pm-fields{grid-template-columns:1fr}.pm-field.full{grid-column:auto}.pm-head,.pm-body,.pm-footer{padding-left:16px;padding-right:16px}}
    `;
    document.head.appendChild(style);
  }

  function injectModal() {
    if ($('product-manager-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'product-manager-modal';
    modal.innerHTML = `
      <div class="pm-dialog" role="dialog" aria-modal="true" aria-labelledby="pm-title">
        <div class="pm-head"><div><p class="eyebrow">PRODUCT MANAGER</p><h2 id="pm-title">Add product</h2><p id="pm-subtitle">Create a clean live product record for Dream City Grocery.</p></div><button class="pm-close" id="pm-close" type="button" aria-label="Close">×</button></div>
        <form id="pm-form">
          <div class="pm-body">
            <div class="pm-manager-banner">The live database remains authoritative. Legacy Loyverse stock is never copied into current stock automatically.</div>
            <div class="pm-grid">
              <div class="pm-fields">
                <div class="pm-field"><label for="pm-name">Product name *</label><input id="pm-name" required></div>
                <div class="pm-field"><label for="pm-category">Category</label><select id="pm-category"><option value="">Select category…</option></select></div>
                <div class="pm-field"><label for="pm-sku">SKU *</label><input id="pm-sku" required></div>
                <div class="pm-field"><label for="pm-barcode">Barcode</label><input id="pm-barcode" inputmode="numeric"></div>
                <div class="pm-field"><label for="pm-buying">Cost / buying price (UGX) *</label><input id="pm-buying" type="number" min="0" step="0.01" required></div>
                <div class="pm-field"><label for="pm-selling">Selling price (UGX) *</label><input id="pm-selling" type="number" min="0" step="0.01" required></div>
                <div class="pm-field"><label for="pm-stock">Opening / current stock</label><input id="pm-stock" type="number" min="0" step="0.001" value="0"></div>
                <div class="pm-field"><label for="pm-reorder">Low-stock / reorder level</label><input id="pm-reorder" type="number" min="0" step="0.001" value="0"></div>
                <div class="pm-field"><label for="pm-unit">Unit</label><select id="pm-unit"><option value="piece">Each / piece</option><option value="kg">Kilogram</option><option value="g">Gram</option><option value="litre">Litre</option><option value="ml">Millilitre</option></select></div>
                <div class="pm-field"><label for="pm-description">Description</label><textarea id="pm-description" placeholder="e.g. Hair Comb"></textarea></div>
                <div class="pm-field full"><label>Product behaviour</label><div class="pm-checks"><label class="pm-check"><input id="pm-available" type="checkbox" checked> Available for sale</label><label class="pm-check"><input id="pm-weight" type="checkbox"> Sold by weight / volume</label><label class="pm-check"><input id="pm-track" type="checkbox" checked> Track stock</label><label class="pm-check"><input id="pm-composite" type="checkbox"> Composite item</label></div></div>
                <div class="pm-field full"><label for="pm-variants">Variants (JSON, optional)</label><textarea id="pm-variants" placeholder='[{"name":"Colour","options":["Black","Blue"]}]'></textarea></div>
              </div>
              <div>
                <div class="pm-photo" id="pm-photo"><div class="pm-placeholder">🛒</div><b>Product image</b><div class="pm-hint">Square images work best, like the Loyverse POS representation.</div><input id="pm-image" type="file" accept="image/jpeg,image/png,image/webp"></div>
                <div class="pm-section"><h3>POS representation</h3><div class="pm-hint">Choose an image instead of an emoji/card placeholder. Image is stored in the private product-images bucket when available.</div></div>
                <div class="pm-section"><h3>Audit</h3><div class="pm-source" id="pm-audit-note">New live product</div></div>
              </div>
            </div>
          </div>
          <div class="pm-footer"><button class="secondary" id="pm-cancel" type="button">Cancel</button><div class="pm-actions"><button class="primary" id="pm-save" type="submit">Save product</button></div></div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    $('pm-close').onclick = closeModal;
    $('pm-cancel').onclick = closeModal;
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    $('pm-image').addEventListener('change', previewImage);
    $('pm-form').addEventListener('submit', saveProduct);
  }

  function previewImage() {
    const file = $('pm-image').files?.[0];
    state.imageFile = file || null;
    const photo = $('pm-photo');
    if (!file) return;
    const url = URL.createObjectURL(file);
    photo.innerHTML = '<img src="' + url + '" alt="Product preview"><b>New image selected</b><input id="pm-image" type="file" accept="image/jpeg,image/png,image/webp">';
    $('pm-image').addEventListener('change', previewImage);
  }

  async function imageUrl(path) {
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path;
    const { data, error } = await db.storage.from('product-images').createSignedUrl(path, 3600);
    return error ? null : data?.signedUrl || null;
  }

  async function uploadImage(productId, file) {
    if (!file) return null;
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = productId + '/main.' + (ext || 'jpg');
    const { error } = await db.storage.from('product-images').upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (error) throw error;
    return path;
  }

  async function ensureCategory(name) {
    const clean = String(name || '').trim();
    if (!clean) return null;
    const existing = state.categories.find(c => c.name.toLowerCase() === clean.toLowerCase() && c.id);
    if (existing) return existing.id;
    const { data, error } = await db.from('categories').insert({ name: clean, active: true }).select('id').single();
    if (error) {
      if (error.code === '23505') {
        const retry = await db.from('categories').select('id').ilike('name', clean).limit(1).maybeSingle();
        if (retry.error) throw retry.error;
        return retry.data?.id || null;
      }
      throw error;
    }
    return data.id;
  }

  function resetForm() {
    $('pm-form').reset();
    $('pm-available').checked = true;
    $('pm-track').checked = true;
    $('pm-stock').value = '0';
    $('pm-reorder').value = '0';
    $('pm-photo').innerHTML = '<div class="pm-placeholder">🛒</div><b>Product image</b><div class="pm-hint">Square images work best, like the Loyverse POS representation.</div><input id="pm-image" type="file" accept="image/jpeg,image/png,image/webp">';
    $('pm-image').addEventListener('change', previewImage);
    state.product = null;
    state.imageFile = null;
    state.imageUrl = null;
  }

  async function openModal(productId = null) {
    if (!canManage()) return toast('Only an owner or manager can manage products.');
    injectStyles();
    injectModal();
    resetForm();
    await loadCategories();
    if (productId) {
      const { data, error } = await db.from('products').select('*').eq('id', productId).single();
      if (error) return toast('Could not load product: ' + error.message);
      state.product = data;
      $('pm-title').textContent = 'Edit product';
      $('pm-subtitle').textContent = 'Update the live product record without touching historical sales.';
      $('pm-name').value = data.name || '';
      $('pm-category').value = data.category_id ? (state.categories.find(c => c.id === data.category_id)?.name || '') : '';
      $('pm-sku').value = data.sku || '';
      $('pm-barcode').value = data.barcode || '';
      $('pm-buying').value = data.buying_price ?? 0;
      $('pm-selling').value = data.selling_price ?? 0;
      $('pm-stock').value = data.quantity_on_hand ?? 0;
      $('pm-reorder').value = data.reorder_level ?? 0;
      $('pm-unit').value = data.unit || 'piece';
      $('pm-description').value = data.description || '';
      $('pm-available').checked = data.available_for_sale !== false;
      $('pm-weight').checked = !!data.sold_by_weight;
      $('pm-track').checked = data.track_stock !== false;
      $('pm-composite').checked = !!data.composite_item;
      $('pm-variants').value = data.variant_options ? JSON.stringify(data.variant_options, null, 2) : '';
      $('pm-audit-note').textContent = 'Existing product · SKU ' + (data.sku || '—') + (data.source_system ? ' · Source: ' + data.source_system : '');
      const signed = await imageUrl(data.image_path);
      if (signed) $('pm-photo').innerHTML = '<img src="' + esc(signed) + '" alt="' + esc(data.name) + '"><b>Current image</b><div class="pm-hint">Choose another image to replace it.</div><input id="pm-image" type="file" accept="image/jpeg,image/png,image/webp">';
      $('pm-image').addEventListener('change', previewImage);
    } else {
      $('pm-title').textContent = 'Add product';
      $('pm-subtitle').textContent = 'Create a clean live product record for Dream City Grocery.';
      $('pm-audit-note').textContent = 'New live product';
    }
    $('product-manager-modal').classList.add('show');
    $('pm-name').focus();
  }

  function closeModal() { $('product-manager-modal')?.classList.remove('show'); }

  async function saveProduct(event) {
    event.preventDefault();
    if (!canManage()) return toast('You do not have permission to manage products.');
    const save = $('pm-save');
    save.disabled = true;
    save.textContent = 'Saving…';
    try {
      const categoryId = await ensureCategory($('pm-category').value);
      let variants = [];
      const rawVariants = $('pm-variants').value.trim();
      if (rawVariants) {
        variants = JSON.parse(rawVariants);
        if (!Array.isArray(variants)) throw new Error('Variants must be a JSON array.');
      }
      const base = {
        sku: $('pm-sku').value.trim(),
        barcode: $('pm-barcode').value.trim() || null,
        name: $('pm-name').value.trim(),
        category_id: categoryId,
        unit: $('pm-unit').value,
        buying_price: Number($('pm-buying').value || 0),
        selling_price: Number($('pm-selling').value || 0),
        quantity_on_hand: Number($('pm-stock').value || 0),
        reorder_level: Number($('pm-reorder').value || 0),
        active: $('pm-available').checked
      };
      const advanced = {
        ...base,
        description: $('pm-description').value.trim(),
        available_for_sale: $('pm-available').checked,
        sold_by_weight: $('pm-weight').checked,
        track_stock: $('pm-track').checked,
        composite_item: $('pm-composite').checked,
        variant_options: variants,
        pos_representation: { mode: state.imageFile || state.product?.image_path ? 'image' : 'default' }
      };
      let result;
      if (state.product) result = await db.from('products').update(advanced).eq('id', state.product.id).select('id').single();
      else result = await db.from('products').insert(advanced).select('id').single();
      let advancedSaved = true;
      if (result.error && /column|schema cache|does not exist/i.test(result.error.message || '')) {
        advancedSaved = false;
        if (state.product) result = await db.from('products').update(base).eq('id', state.product.id).select('id').single();
        else result = await db.from('products').insert(base).select('id').single();
      }
      if (result.error) throw result.error;
      const productId = result.data.id;
      if (state.imageFile) {
        const path = await uploadImage(productId, state.imageFile);
        const { error } = await db.from('products').update({ image_path: path }).eq('id', productId);
        if (error) throw error;
      }
      closeModal();
      toast((state.product ? 'Product updated' : 'Product created') + (advancedSaved ? ' successfully.' : '. Core fields saved; run the product-manager migration to enable the advanced Loyverse fields.'));
      window.dispatchEvent(new CustomEvent('dream-city-products-changed'));
      if (typeof window.loadDreamCityData === 'function') window.loadDreamCityData();
      else if (typeof window.location.reload === 'function') setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      toast('Could not save product: ' + (error.message || error));
    } finally {
      save.disabled = false;
      save.textContent = 'Save product';
    }
  }

  async function setActive(productId, active) {
    if (!canManage()) return toast('Only an owner or manager can change product status.');
    const word = active ? 'reactivate' : 'deactivate';
    if (!confirm('Are you sure you want to ' + word + ' this product?')) return;
    const { error } = await db.from('products').update({ active }).eq('id', productId);
    if (error) return toast('Could not ' + word + ' product: ' + error.message);
    toast('Product ' + (active ? 'reactivated.' : 'deactivated.'));
    window.dispatchEvent(new CustomEvent('dream-city-products-changed'));
    setTimeout(() => window.location.reload(), 350);
  }

  function interceptProductButtons(event) {
    const edit = event.target.closest?.('[data-edit-product]');
    const add = event.target.closest?.('#add-product');
    const off = event.target.closest?.('[data-deactivate-product]');
    const on = event.target.closest?.('[data-reactivate-product]');
    if (edit) { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); openModal(edit.dataset.editProduct); }
    else if (add) { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); openModal(); }
    else if (off) { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); setActive(off.dataset.deactivateProduct, false); }
    else if (on) { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); setActive(on.dataset.reactivateProduct, true); }
  }

  async function init() {
    try {
      const profile = await loadProfile();
      if (!profile || !profile.active) return;
      document.addEventListener('click', interceptProductButtons, true);
      window.addEventListener('dream-city-products-changed', () => { if (window.location.hash === '#inventory' || document.querySelector('#inventory-view:not(.hidden)')) setTimeout(() => location.reload(), 250); });
    } catch (error) {
      console.warn('[Dream City Product Manager]', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
