// Tiny DOM helpers. Text is always set with textContent, so data from the
// database can never inject HTML.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'value') el.value = value;
      else if (key === 'checked') el.checked = Boolean(value);
      else if (key === 'html') el.innerHTML = value; // only for trusted, static markup
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// A simple <table> from column definitions: { label, value(row) -> node|text, class }
export function table(columns, rows, { empty = 'Nothing to show yet.', onRow } = {}) {
  const thead = h('thead', null, h('tr', null, columns.map(c => h('th', { class: c.class }, c.label))));
  const tbody = h('tbody');
  if (!rows.length) {
    tbody.append(h('tr', null, h('td', { colspan: columns.length, class: 'empty' }, empty)));
  } else {
    for (const row of rows) {
      const tr = h('tr', onRow ? { class: 'clickable', onclick: () => onRow(row) } : null,
        columns.map(c => h('td', { class: c.class, 'data-label': c.label }, c.value(row))));
      tbody.append(tr);
    }
  }
  return h('div', { class: 'table-wrap' }, h('table', null, thead, tbody));
}

export function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(cell => {
    const s = cell === null || cell === undefined ? '' : String(cell);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// RFC 4122 v4 id; works on older phones and non-HTTPS previews too.
export function uuid() {
  if (globalThis.crypto?.randomUUID) {
    try { return globalThis.crypto.randomUUID(); } catch { /* insecure context */ }
  }
  const b = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
