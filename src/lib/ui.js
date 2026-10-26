import { h, clear } from './dom.js';

// ---------------------------------------------------------------- toasts
export function toast(message, kind = 'info') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const el = h('div', { class: 'toast ' + kind, role: kind === 'error' ? 'alert' : 'status' }, message);
  host.append(el);
  setTimeout(() => el.classList.add('leaving'), kind === 'error' ? 6500 : 3500);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 4000);
}

export function showError(error) {
  console.error(error);
  toast(error?.message || String(error), 'error');
}

// ---------------------------------------------------------------- modals
// Returns { el, close, body } — body is where content goes.
export function modal({ title, subtitle, content, actions = [], wide = false, onClose }) {
  const previous = document.activeElement;
  const body = h('div', { class: 'modal-body' }, content);
  const foot = h('div', { class: 'modal-foot' });
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (previous && previous.focus) previous.focus();
    onClose && onClose();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const dialog = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' },
      h('div', null, h('h2', null, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, '×')),
    body, foot);
  const overlay = h('div', { class: 'overlay', onmousedown: e => { if (e.target === overlay) close(); } }, dialog);
  for (const a of actions) {
    foot.append(h('button', { type: a.submit ? 'submit' : 'button', class: a.kind || 'secondary', form: a.form, onclick: a.onClick ? () => a.onClick({ close, body }) : null }, a.label));
  }
  if (!actions.length) foot.remove();
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  setTimeout(() => {
    const first = dialog.querySelector('input:not([type=hidden]):not([disabled]), select, textarea, button.primary');
    first && first.focus();
  }, 30);
  return { el: dialog, close, body };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const m = modal({
      title,
      content: typeof message === 'string' ? h('p', null, message) : message,
      onClose: () => { if (!done) resolve(false); },
      actions: [
        { label: 'Cancel', onClick: ({ close }) => close() },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: ({ close }) => { done = true; close(); resolve(true); } }
      ]
    });
    return m;
  });
}

// ---------------------------------------------------------------- forms
// fields: [{ name, label, type, value, required, options:[{value,label}], hint, step, min, placeholder, full, list }]
export function formFields(fields) {
  const grid = h('div', { class: 'form-grid' });
  for (const f of fields) {
    if (f.type === 'section') { grid.append(h('h3', { class: 'form-section full' }, f.label)); continue; }
    if (f.type === 'note') { grid.append(h('p', { class: 'muted full' }, f.label)); continue; }
    const id = 'f-' + f.name + '-' + Math.random().toString(36).slice(2, 7);
    let input;
    if (f.type === 'select') {
      input = h('select', { id, name: f.name, required: f.required },
        (f.options || []).map(o => h('option', { value: o.value, selected: String(o.value) === String(f.value ?? '') }, o.label)));
    } else if (f.type === 'textarea') {
      input = h('textarea', { id, name: f.name, rows: f.rows || 3, placeholder: f.placeholder, required: f.required }, f.value ?? '');
    } else if (f.type === 'checkbox') {
      input = h('input', { id, name: f.name, type: 'checkbox', checked: Boolean(f.value) });
      grid.append(h('label', { class: 'check' + (f.full ? ' full' : ''), for: id }, input, h('span', null, f.label, f.hint ? h('small', null, f.hint) : null)));
      continue;
    } else {
      input = h('input', {
        id, name: f.name, type: f.type || 'text', value: f.value ?? '', required: f.required, step: f.step, min: f.min, max: f.max,
        placeholder: f.placeholder, inputmode: f.inputmode || (f.type === 'number' ? 'decimal' : null), list: f.list, autocomplete: f.autocomplete || 'off',
        readonly: f.readonly, maxlength: f.maxlength, pattern: f.pattern
      });
    }
    grid.append(h('div', { class: 'field' + (f.full ? ' full' : '') }, h('label', { for: id }, f.label, f.required ? h('span', { class: 'req' }, ' *') : null), input, f.hint ? h('small', { class: 'hint' }, f.hint) : null));
  }
  return grid;
}

export function readForm(form) {
  const out = {};
  for (const el of form.querySelectorAll('input[name], select[name], textarea[name]')) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value.trim();
  }
  return out;
}

// Modal with a form; onSubmit(values) may throw to keep the dialog open.
export function formModal({ title, subtitle, fields, submitLabel = 'Save', onSubmit, wide, extra }) {
  const formId = 'form-' + Math.random().toString(36).slice(2, 8);
  const form = h('form', { id: formId, novalidate: false }, formFields(fields), extra || null);
  const m = modal({
    title, subtitle, wide, content: form,
    actions: [
      { label: 'Cancel', onClick: ({ close }) => close() },
      { label: submitLabel, kind: 'primary', submit: true, form: formId }
    ]
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = m.el.querySelector('.modal-foot .primary');
    await withBusy(btn, async () => {
      try {
        await onSubmit(readForm(form), form);
        m.close();
      } catch (err) { showError(err); }
    });
  });
  return m;
}

export async function withBusy(button, fn) {
  if (!button) return fn();
  if (button.dataset.busy) return;
  button.dataset.busy = '1';
  const label = button.textContent;
  button.disabled = true;
  button.classList.add('busy');
  try { return await fn(); }
  finally {
    delete button.dataset.busy;
    button.disabled = false;
    button.classList.remove('busy');
    if (button.textContent !== label && !button.dataset.keepLabel) button.textContent = label;
  }
}

// ---------------------------------------------------------------- bits
export function pageHeader(title, subtitle, ...actions) {
  return h('div', { class: 'page-head' },
    h('div', null, h('h1', null, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null),
    actions.length ? h('div', { class: 'page-actions' }, actions) : null);
}

export function card(title, ...content) {
  return h('section', { class: 'card' }, title ? h('div', { class: 'card-head' }, typeof title === 'string' ? h('h2', null, title) : title) : null, content);
}

export function stat(label, value, note, tone) {
  return h('div', { class: 'stat' + (tone ? ' ' + tone : '') }, h('span', { class: 'stat-label' }, label), h('strong', null, value), note ? h('small', null, note) : null);
}

export function badge(text, tone = '') {
  return h('span', { class: 'badge ' + tone }, text);
}

export function loading(el, text = 'Loading…') {
  return clear(el, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), text));
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty-state' }, h('h3', null, title), text ? h('p', { class: 'muted' }, text) : null, action || null);
}

export function tabs(items, active, onChange) {
  return h('div', { class: 'tabs', role: 'tablist' }, items.map(([key, label]) =>
    h('button', { type: 'button', role: 'tab', class: key === active ? 'active' : '', 'aria-selected': String(key === active), onclick: () => onChange(key) }, label)));
}
