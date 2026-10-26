import { h, clear } from '../lib/dom.js';
import { db } from '../lib/supabase.js';
import { state } from '../lib/state.js';
import { withBusy } from '../lib/ui.js';

export function renderLogin(app, { recovery = false, onSignedIn }) {
  const p = state.publicProfile || {};
  const name = p.business_name || 'Grocery POS';
  const message = h('p', { class: 'form-message', role: 'status', 'aria-live': 'polite' });
  const say = (text, error = false) => { message.textContent = text || ''; message.classList.toggle('error', error); };

  const email = h('input', { id: 'login-email', type: 'email', autocomplete: 'username', required: true, placeholder: 'you@example.com' });
  const password = h('input', { id: 'login-password', type: 'password', autocomplete: 'current-password', required: true, placeholder: 'Your password' });
  const toggle = h('button', { type: 'button', class: 'link', 'aria-pressed': 'false', onclick: () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
    toggle.setAttribute('aria-pressed', String(show));
  } }, 'Show');
  const submit = h('button', { class: 'primary block', type: 'submit' }, 'Sign in');

  const signIn = h('form', { class: 'auth-form', onsubmit: async e => {
    e.preventDefault();
    await withBusy(submit, async () => {
      say('Signing in…');
      try {
        const { data, error } = await db().auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        if (error) return say(error.message === 'Invalid login credentials' ? 'Email or password is not correct.' : error.message, true);
        say('');
        await onSignedIn(data.session);
      } catch {
        say('Cannot reach the server. Check the internet connection and try again.', true);
      }
    });
  } },
  h('label', { for: 'login-email' }, 'Email'), email,
  h('div', { class: 'label-row' }, h('label', { for: 'login-password' }, 'Password'), h('button', { type: 'button', class: 'link', onclick: () => show(resetForm) }, 'Forgot password?')),
  h('div', { class: 'with-action' }, password, toggle),
  submit);

  const resetEmail = h('input', { type: 'email', required: true, autocomplete: 'email', placeholder: 'you@example.com', 'aria-label': 'Email' });
  const resetBtn = h('button', { class: 'primary block', type: 'submit' }, 'Email me a reset link');
  const resetForm = h('form', { class: 'auth-form', onsubmit: async e => {
    e.preventDefault();
    await withBusy(resetBtn, async () => {
      const redirectTo = location.origin + location.pathname;
      const { error } = await db().auth.resetPasswordForEmail(resetEmail.value.trim(), { redirectTo });
      if (error) return say(error.message, true);
      say('If that email has an account, a reset link is on its way. Check spam too.');
    });
  } },
  h('button', { type: 'button', class: 'link', onclick: () => show(signIn) }, '← Back to sign in'),
  h('h2', null, 'Reset your password'), resetEmail, resetBtn);

  const newPass = h('input', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password', placeholder: 'New password (8+ characters)', 'aria-label': 'New password' });
  const newPass2 = h('input', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password', placeholder: 'Repeat new password', 'aria-label': 'Repeat new password' });
  const saveBtn = h('button', { class: 'primary block', type: 'submit' }, 'Save new password');
  const newForm = h('form', { class: 'auth-form', onsubmit: async e => {
    e.preventDefault();
    if (newPass.value !== newPass2.value) return say('The passwords do not match.', true);
    await withBusy(saveBtn, async () => {
      const { data, error } = await db().auth.updateUser({ password: newPass.value });
      if (error) return say(error.message, true);
      history.replaceState(null, '', location.pathname);
      say('Password saved.');
      const { data: s } = await db().auth.getSession();
      await onSignedIn(s.session || data?.session || null);
    });
  } }, h('h2', null, 'Choose a new password'), newPass, newPass2, saveBtn);

  const formHost = h('div');
  function show(form) { say(''); clear(formHost, form); form.querySelector('input')?.focus(); }

  clear(app, h('div', { class: 'auth' },
    h('section', { class: 'auth-story' },
      h('div', { class: 'auth-brand' }, p.logo_url ? h('img', { src: p.logo_url, alt: '' }) : h('div', { class: 'brand-mark big' }, name.slice(0, 1)), h('span', null, name)),
      h('h1', null, 'Run your shop with ', h('em', null, 'confidence.')),
      h('p', null, p.tagline || 'Sales, stock, purchasing and money — in one place.'),
      h('ul', { class: 'auth-points' },
        h('li', null, 'Fast checkout with barcode scanning'),
        h('li', null, 'Stock that updates itself from sales and purchases'),
        h('li', null, 'Daily numbers you can trust'))),
    h('section', { class: 'auth-card' },
      h('div', { class: 'auth-card-inner' },
        h('p', { class: 'eyebrow' }, 'STAFF SIGN-IN'),
        h('h2', null, recovery ? 'Set a new password' : 'Welcome back'),
        formHost, message,
        h('p', { class: 'muted small' }, 'Need an account? Ask the shop owner.')))));
  show(recovery ? newForm : signIn);
}
