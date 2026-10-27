import { h, clear } from '../lib/dom.js';
import { db, rpc, run } from '../lib/supabase.js';
import { state, can } from '../lib/state.js';
import { pageHeader, card, formFields, readForm, toast, showError, withBusy } from '../lib/ui.js';
import { receiptHtml } from '../lib/receipt.js';
import { CURRENCIES, timezones, localeFor } from './setup.js';
import { applyBranding } from '../main.js';
import { uploadLogo } from '../lib/branding.js';
import { isLayoutLocked, setLayoutLocked, resetLayout } from '../lib/resize.js';
import { downloadBackup, lastBackupAt } from '../lib/backup.js';
import { dateTime } from '../lib/format.js';

export async function render(root) {
  const parts = [pageHeader('Settings', can.settings() ? 'Shop details, receipts and your account.' : 'Your account.')];
  if (can.settings()) parts.push(shopSettings(), h('div', { class: 'grid-2' }, dataSettings(), layoutSettings()), h('div', { class: 'grid-2' }, loyverseSettings(), reportSettings()));
  parts.push(myAccount());
  clear(root, ...parts);
}

function shopSettings() {
  const s = state.settings || {};
  const preview = h('iframe', { class: 'receipt-preview', title: 'Receipt preview' });
  // Shrink the whole receipt (A4 is ~690px wide) to fit the preview box, and show it full length.
  const fitPreview = () => {
    if (!preview.isConnected) return window.removeEventListener('resize', fitPreview);
    const doc = preview.contentDocument;
    const body = doc?.body;
    if (!body || !preview.clientWidth) return;
    body.style.transform = ''; body.style.width = '';
    const natural = Math.max(doc.documentElement.scrollWidth, body.scrollWidth);
    const scale = Math.min(1, (preview.clientWidth - 2) / natural);
    doc.documentElement.style.overflow = 'hidden';
    if (scale < 1) {
      body.style.width = natural + 'px';
      body.style.transformOrigin = '0 0';
      body.style.transform = 'scale(' + scale + ')';
    }
    preview.style.height = Math.ceil(doc.documentElement.scrollHeight * scale + 8) + 'px';
  };
  preview.addEventListener('load', () => { fitPreview(); setTimeout(fitPreview, 300); });
  window.addEventListener('resize', fitPreview);
  const form = h('form', null,
    formFields([
      { type: 'section', label: 'Shop' },
      { name: 'business_name', label: 'Shop name', value: s.business_name, required: true },
      { name: 'tagline', label: 'Tagline', value: s.tagline },
      { name: 'phone', label: 'Phone', value: s.phone },
      { name: 'email', label: 'Email', type: 'email', value: s.email },
      { name: 'address', label: 'Address', value: s.address, full: true },
      { name: 'tax_id', label: 'Tax ID (TIN)', value: s.tax_id },
      { name: 'primary_color', label: 'Brand colour', type: 'color', value: s.primary_color || '#16376A' },
      { type: 'section', label: 'Money & time' },
      { name: 'currency_code', label: 'Currency', type: 'select', value: s.currency_code, options: CURRENCIES },
      { name: 'currency_decimals', label: 'Decimals', type: 'select', value: s.currency_decimals, options: [0, 2].map(v => ({ value: v, label: String(v) })) },
      { name: 'timezone', label: 'Time zone', type: 'select', value: s.timezone, options: timezones() },
      { type: 'section', label: 'Receipts' },
      { name: 'receipt_prefix', label: 'Receipt number prefix', value: s.receipt_prefix, pattern: '[A-Za-z0-9]{1,8}', maxlength: 8, hint: 'Only affects new receipts.' },
      { name: 'receipt_width', label: 'Printer paper', type: 'select', value: s.receipt_width, options: [{ value: '58mm', label: '58 mm thermal' }, { value: '80mm', label: '80 mm thermal' }, { value: 'a4', label: 'A4 / normal printer' }] },
      { name: 'receipt_header', label: 'Extra line at the top', value: s.receipt_header, full: true },
      { name: 'receipt_footer', label: 'Message at the bottom', value: s.receipt_footer, full: true },
      { type: 'section', label: 'Rules' },
      { name: 'stock_cover_days', label: 'Shopping list covers (days)', type: 'number', min: '1', max: '90', step: '1', value: s.stock_cover_days, hint: 'How many days of sales each shopping list should cover.' },
      { name: 'allow_cashier_discounts', label: 'Cashiers may give discounts', type: 'checkbox', value: s.allow_cashier_discounts, hint: 'Otherwise only owners and managers can.' }
    ]),
    h('div', { class: 'field' }, h('label', null, 'Logo'), h('div', { class: 'row' },
      s.logo_url ? h('img', { src: s.logo_url, alt: 'Current logo', class: 'logo-preview' }) : null,
      h('input', { type: 'file', name: 'logo_file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml' }),
      s.logo_url ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'remove_logo' }), h('span', null, 'Remove logo')) : null)),
    h('div', { class: 'row end' }, h('button', { class: 'primary', type: 'submit' }, 'Save settings')));

  const drawPreview = () => {
    preview.srcdoc = receiptHtml({ receipt_number: (state.settings.receipt_prefix || 'RCP') + '-000123', created_at: new Date().toISOString(), cashier: state.profile.full_name, payment_method: 'cash',
      subtotal: 15000, discount: 0, total: 15000, tendered: 20000, change: 5000,
      items: [{ name: 'Sugar 1kg', qty: 2, price: 5000, line_total: 10000 }, { name: 'Bar soap', qty: 1, price: 5000, line_total: 5000 }] });
  };

  form.addEventListener('submit', e => {
    e.preventDefault();
    withBusy(form.querySelector('button[type=submit]'), async () => {
      try {
        const v = readForm(form);
        const file = form.querySelector('input[name=logo_file]').files[0];
        const payload = { ...v, currency_decimals: Number(v.currency_decimals), receipt_prefix: (v.receipt_prefix || '').toUpperCase(), locale: localeFor(v.currency_code) };
        delete payload.logo_file; delete payload.remove_logo;
        if (file) payload.logo_url = await uploadLogo(file);
        else if (v.remove_logo) payload.logo_url = '';
        state.settings = await rpc('update_store_settings', { p_settings: payload });
        applyBranding(state.settings);
        drawPreview();
        toast('Settings saved. Reload the page to see the new name and logo everywhere.');
      } catch (err) { showError(err); }
    });
  });
  drawPreview();
  return h('div', { class: 'grid-2 settings' }, card('Shop settings', form), card('Receipt preview', preview));
}

// Backup (daily) and one-time data import.
function dataSettings() {
  const status = h('p', { class: 'muted small' });
  const say = () => { const at = lastBackupAt(); status.textContent = at ? 'Last backup on this computer: ' + dateTime(at) + '.' : 'No backup downloaded on this computer yet.'; };
  say();
  const btn = h('button', { class: 'primary', type: 'button', onclick: () => withBusy(btn, async () => {
    try {
      const r = await downloadBackup(t => { status.textContent = 'Saving ' + t + '…'; });
      toast(`Backup saved: ${r.rows.toLocaleString()} records.` + (r.skipped.length ? ' Skipped: ' + r.skipped.join(', ') : ''));
    } catch (e) { showError(e); }
    say();
  }) }, 'Download backup');
  return card('Backup & data',
    h('p', null, 'Download a copy of all products, customers, sales and the accounts as one file. Do it at the end of each day and keep the file somewhere safe (a flash disk or Google Drive).'),
    h('div', { class: 'row' }, btn, h('a', { class: 'secondary', href: '#/import' }, 'Import from Loyverse')), status);
}

// Loyverse live sync: Loyverse stays the till, this app mirrors its sales, prices, costs and stock.
function loyverseSettings() {
  const body = h('div');
  const draw = async () => {
    try {
      const st = await run(db().from('loyverse_sync_state').select('*').maybeSingle());
      if (!st) return clear(body, h('p', { class: 'muted' }, 'Loyverse sync is not set up on this database yet.'));
      const r = st.last_result || {};
      const warn = (r.warnings || []).length;
      clear(body,
        h('p', null, st.last_finished_at ? 'Last sync: ' + dateTime(st.last_finished_at) : 'Not synced yet.',
          st.last_error ? h('span', { class: 'bad' }, ' · Problem: ' + st.last_error) : null),
        st.last_finished_at && !st.last_error ? h('p', { class: 'muted small' },
          `Products ${r.items ?? 0} · new sales ${r.sales ?? 0} · refunds ${r.refunds ?? 0} · stock corrected on ${r.stock_aligned ?? 0} products` +
          (warn ? ` · ${warn} receipt(s) could not be recorded` : '')) : null,
        h('p', { class: 'muted small' }, 'Sales from Loyverse appear with receipt numbers starting LV-. Record stock deliveries and counts in Loyverse; this app copies the result.'));
    } catch (e) { clear(body, h('p', { class: 'muted' }, e.message)); }
  };
  const btn = h('button', { class: 'primary', type: 'button', onclick: () => withBusy(btn, async () => {
    try {
      const { data, error } = await db().functions.invoke('loyverse-sync', { body: {} });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.error);
      toast(data?.skipped ? 'Synced less than a minute ago — try again shortly.' : `Synced: ${data?.result?.sales ?? 0} new sales.`);
    } catch (e) { showError(e); }
    await draw();
  }) }, 'Sync now');
  const instant = h('button', { class: 'secondary', type: 'button', onclick: () => withBusy(instant, async () => {
    try {
      const { data, error } = await db().functions.invoke('loyverse-sync', { body: { action: 'register-webhook' } });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.error);
      toast(data?.webhook === 'already on' ? 'Instant sync was already on.' : 'Instant sync is on: Loyverse now tells this app about every receipt.');
    } catch (e) { showError(e); }
  }) }, 'Turn on instant sync');
  draw();
  return card('Loyverse live sync', h('p', null, 'Every few minutes this app reads Loyverse: new sales and refunds, prices, costs and stock.'), body, h('div', { class: 'row' }, btn, instant));
}

// Automatic emails: evening report (21:15) and morning shopping list (06:45), sent by the Google mailer.
function reportSettings() {
  const send = (kind, label) => {
    const b = h('button', { class: kind === 'evening' ? 'primary' : 'secondary', type: 'button', onclick: () => withBusy(b, async () => {
      try { const r = await rpc('send_shop_report', { p_kind: kind }); toast('Sent: ' + r.subject); }
      catch (e) { showError(e); }
    }) }, label);
    return b;
  };
  return card('Automatic reports',
    h('p', null, 'Every evening at 21:15 the Executive Director gets the day\'s sales, profit, cash and best sellers. Every morning at 06:45 the buyer gets today\'s shopping list. Both by email, sent automatically.'),
    h('div', { class: 'row' }, send('evening', 'Send today\'s report now'), send('morning', 'Send shopping list now')));
}

// Per-till layout lock (owner only). Saved on this computer, like the sizes themselves.
function layoutSettings() {
  const box = h('input', { type: 'checkbox', checked: isLayoutLocked() });
  const status = h('p', { class: 'muted small' });
  const say = () => { status.textContent = box.checked
    ? 'Locked: cashiers cannot move the borders on the Sell page. Untick to adjust, then lock again.'
    : 'Unlocked: drag the borders on the Sell page (between products and the sale, and under the sale items). Double-click a border to reset it.'; };
  box.addEventListener('change', () => { setLayoutLocked(box.checked); say(); toast(box.checked ? 'Layout locked on this till.' : 'Layout unlocked on this till.'); });
  say();
  return card("This till's layout",
    h('label', { class: 'check' }, box, h('span', null, h('b', null, 'Lock layout'), h('small', null, 'Applies to this computer only. Each till keeps its own layout.'))),
    status,
    h('div', { class: 'row' }, h('button', { class: 'secondary small', type: 'button', onclick: () => { resetLayout(); toast('Layout reset to default on this till.'); } }, 'Reset to default layout')));
}

function myAccount() {
  const nameForm = h('form', { class: 'stack' }, formFields([{ name: 'full_name', label: 'Your name', value: state.profile.full_name, required: true, full: true }]),
    h('button', { class: 'secondary', type: 'submit' }, 'Save name'));
  nameForm.addEventListener('submit', e => {
    e.preventDefault();
    withBusy(nameForm.querySelector('button'), async () => {
      try { const v = readForm(nameForm); await rpc('update_my_name', { p_full_name: v.full_name }); state.profile.full_name = v.full_name; toast('Name saved.'); }
      catch (err) { showError(err); }
    });
  });
  const passForm = h('form', { class: 'stack' }, formFields([
    { name: 'password', label: 'New password', type: 'password', required: true, autocomplete: 'new-password', hint: 'At least 8 characters.' },
    { name: 'password2', label: 'Repeat new password', type: 'password', required: true, autocomplete: 'new-password' }
  ]), h('button', { class: 'secondary', type: 'submit' }, 'Change password'));
  passForm.addEventListener('submit', e => {
    e.preventDefault();
    withBusy(passForm.querySelector('button'), async () => {
      const v = readForm(passForm);
      if (v.password.length < 8) return toast('Use at least 8 characters.', 'error');
      if (v.password !== v.password2) return toast('The passwords do not match.', 'error');
      const { error } = await db().auth.updateUser({ password: v.password });
      if (error) return showError(error);
      passForm.reset();
      toast('Password changed.');
    });
  });
  return h('div', { class: 'grid-2' }, card('My account · ' + (state.session?.user?.email || ''), nameForm), card('Password', passForm));
}
