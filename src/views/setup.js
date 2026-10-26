import { h, clear } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { state } from '../lib/state.js';
import { formFields, readForm, withBusy, showError, toast } from '../lib/ui.js';
import { signOut } from '../main.js';
import { uploadLogo } from '../lib/branding.js';

// A brand-new shop: the first signed-in person becomes the owner.
export function renderClaimOwner(app, { session, onDone }) {
  const nameInput = h('input', { required: true, placeholder: 'Your full name', 'aria-label': 'Your full name', value: session.user.user_metadata?.full_name || '' });
  const btn = h('button', { class: 'primary block', type: 'submit' }, 'Make me the owner');
  clear(app, h('div', { class: 'center-screen' }, h('form', { class: 'panel narrow', onsubmit: async e => {
    e.preventDefault();
    await withBusy(btn, async () => {
      try { await rpc('claim_first_owner', { p_full_name: nameInput.value.trim() }); await onDone(); }
      catch (err) { showError(err); }
    });
  } },
  h('p', { class: 'eyebrow' }, 'NEW SHOP'),
  h('h1', null, 'Set up this shop'),
  h('p', null, 'This shop has no owner yet. You are signed in as ', h('b', null, session.user.email), '. The owner can add staff, change settings and see all money records.'),
  h('label', null, 'Your name'), nameInput, btn,
  h('button', { type: 'button', class: 'link', onclick: signOut }, 'This is not me — sign out'))));
  nameInput.focus();
}

// First-run settings for the owner.
export function renderSetupWizard(app, { onDone }) {
  const s = state.settings || {};
  const form = h('form', { class: 'panel wide' },
    h('p', { class: 'eyebrow' }, 'STEP 1 OF 1 · SHOP DETAILS'),
    h('h1', null, 'Tell us about your shop'),
    h('p', { class: 'muted' }, 'This appears on the sign-in page and on receipts. You can change it later in Settings.'),
    formFields([
      { name: 'business_name', label: 'Shop name', value: s.business_name === 'My Grocery' ? '' : s.business_name, required: true, full: true },
      { name: 'tagline', label: 'Tagline (optional)', value: s.tagline, full: true },
      { name: 'phone', label: 'Phone', value: s.phone },
      { name: 'address', label: 'Address / town', value: s.address },
      { name: 'currency_code', label: 'Currency', type: 'select', value: s.currency_code || 'UGX', options: CURRENCIES },
      { name: 'currency_decimals', label: 'Decimals in prices', type: 'select', value: s.currency_decimals ?? 0, options: [{ value: 0, label: '0 (e.g. 5,000)' }, { value: 2, label: '2 (e.g. 5.00)' }] },
      { name: 'timezone', label: 'Time zone', type: 'select', value: s.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, options: timezones() },
      { name: 'receipt_prefix', label: 'Receipt number prefix', value: s.receipt_prefix || 'RCP', hint: 'Capital letters/numbers, up to 8. Example: RCP-000123', pattern: '[A-Za-z0-9]{1,8}', maxlength: 8 }
    ]),
    h('div', { class: 'field' }, h('label', null, 'Logo (optional)'), h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', name: 'logo_file' })),
    h('div', { class: 'row end' }, h('button', { class: 'primary', type: 'submit' }, 'Finish setup')));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    await withBusy(btn, async () => {
      try {
        const v = readForm(form);
        const file = form.querySelector('input[name=logo_file]').files[0];
        const payload = { ...v, currency_decimals: Number(v.currency_decimals), receipt_prefix: v.receipt_prefix.toUpperCase(), locale: localeFor(v.currency_code), setup_completed: true };
        delete payload.logo_file;
        if (file) payload.logo_url = await uploadLogo(file);
        state.settings = await rpc('update_store_settings', { p_settings: payload });
        toast('Shop set up. Next: add your products or import them from Loyverse.');
        location.hash = '#/import';
        await onDone();
      } catch (err) { showError(err); }
    });
  });
  clear(app, h('div', { class: 'center-screen' }, form));
}

export const CURRENCIES = [
  ['UGX', 'Ugandan shilling (UGX)'], ['KES', 'Kenyan shilling (KES)'], ['TZS', 'Tanzanian shilling (TZS)'], ['RWF', 'Rwandan franc (RWF)'],
  ['SSP', 'South Sudanese pound (SSP)'], ['CDF', 'Congolese franc (CDF)'], ['BIF', 'Burundian franc (BIF)'], ['ETB', 'Ethiopian birr (ETB)'],
  ['NGN', 'Nigerian naira (NGN)'], ['GHS', 'Ghanaian cedi (GHS)'], ['ZAR', 'South African rand (ZAR)'], ['ZMW', 'Zambian kwacha (ZMW)'],
  ['MWK', 'Malawian kwacha (MWK)'], ['USD', 'US dollar (USD)'], ['EUR', 'Euro (EUR)'], ['GBP', 'British pound (GBP)']
].map(([value, label]) => ({ value, label }));

export function localeFor(code) {
  return { UGX: 'en-UG', KES: 'en-KE', TZS: 'en-TZ', RWF: 'en-RW', NGN: 'en-NG', GHS: 'en-GH', ZAR: 'en-ZA', ZMW: 'en-ZM', MWK: 'en-MW', USD: 'en-US', EUR: 'en-IE', GBP: 'en-GB' }[code] || 'en';
}

export function timezones() {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = ['Africa/Kampala', 'Africa/Nairobi', 'Africa/Dar_es_Salaam', 'Africa/Kigali', 'Africa/Lagos', 'Africa/Johannesburg', 'UTC']; }
  return zones.map(z => ({ value: z, label: z.replace(/_/g, ' ') }));
}
