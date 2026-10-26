import { h, clear } from '../lib/dom.js';
import { db, rpc } from '../lib/supabase.js';
import { state, can } from '../lib/state.js';
import { pageHeader, card, formFields, readForm, toast, showError, withBusy } from '../lib/ui.js';
import { receiptHtml } from '../lib/receipt.js';
import { CURRENCIES, timezones, localeFor } from './setup.js';
import { applyBranding } from '../main.js';
import { uploadLogo } from '../lib/branding.js';

export async function render(root) {
  const parts = [pageHeader('Settings', can.settings() ? 'Shop details, receipts and your account.' : 'Your account.')];
  if (can.settings()) parts.push(shopSettings());
  parts.push(myAccount());
  clear(root, ...parts);
}

function shopSettings() {
  const s = state.settings || {};
  const preview = h('iframe', { class: 'receipt-preview', title: 'Receipt preview' });
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
