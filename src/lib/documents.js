import { state } from './state.js';
import { money, date, dateTime } from './format.js';

// Branded printable documents (A4). Follows docs/BRAND.md — logo colours only:
// navy #16376A, orange #FB8F11, bronze #A16A1A, black #010101, white #FFFFFF.

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const abs = u => { try { return new URL(u, location.href).href; } catch { return u; } };

export const DOC_CSS = `
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.5pt/1.45 Arial, Helvetica, sans-serif; color: #010101; background: #FFFFFF; }
  .doc { width: 100%; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm; }
  .head .logo { height: 32mm; max-width: 60mm; object-fit: contain; }
  .head .shop { font-size: 9pt; line-height: 1.4; }
  .head .shop b { display: block; font-size: 12pt; color: #16376A; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 20pt; letter-spacing: .06em; color: #16376A; text-transform: uppercase; }
  .title .no { font-size: 11pt; font-weight: bold; }
  .rule { height: 3px; background: #FB8F11; margin: 5mm 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-bottom: 5mm; }
  .box { border: 1px solid #16376A; border-radius: 2mm; padding: 3mm 4mm; }
  .box h3 { margin: 0 0 1.5mm; font-size: 8pt; letter-spacing: .1em; text-transform: uppercase; color: #A16A1A; }
  .kv { display: grid; grid-template-columns: auto 1fr; gap: .6mm 4mm; }
  .kv span:nth-child(odd) { color: #16376A; font-weight: bold; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 2mm; }
  table.lines th { background: #16376A; color: #FFFFFF; text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .05em; padding: 2mm 2.5mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table.lines td { padding: 1.8mm 2.5mm; border-bottom: 1px solid #16376A33; vertical-align: top; }
  table.lines tr:nth-child(even) td { background: #16376A0A; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .r, table.lines th.r { text-align: right; white-space: nowrap; }
  .totals { margin-left: auto; width: 85mm; margin-top: 4mm; border-collapse: collapse; }
  .totals td { padding: 1.5mm 2.5mm; }
  .totals tr.grand td { background: #16376A; color: #FFFFFF; font-weight: bold; font-size: 12pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .totals tr.sub td { font-weight: bold; border-top: 1px solid #16376A; }
  .stamp { display: inline-block; border: 2px solid #A16A1A; color: #A16A1A; font-weight: bold; padding: 1mm 4mm; letter-spacing: .1em; text-transform: uppercase; }
  .notes { margin-top: 6mm; font-size: 9pt; }
  .notes h3 { margin: 0 0 1mm; color: #16376A; font-size: 9pt; text-transform: uppercase; }
  .sign { display: grid; grid-template-columns: repeat(var(--n, 2), 1fr); gap: 12mm; margin-top: 16mm; }
  .sign div { border-top: 1px solid #010101; padding-top: 1.5mm; font-size: 8.5pt; color: #16376A; }
  .foot { margin-top: 8mm; padding-top: 2.5mm; border-top: 1px solid #FB8F11; font-size: 8pt; color: #16376A; display: flex; justify-content: space-between; gap: 6mm; }
  .section { margin-top: 6mm; }
  .section h2 { font-size: 11pt; color: #16376A; margin: 0 0 2mm; border-bottom: 2px solid #FB8F11; padding-bottom: 1mm; }
  .neg { color: #A16A1A; }
`;

function shopBlock() {
  const s = state.settings || {};
  return [
    s.logo_url ? `<img class="logo" src="${esc(abs(s.logo_url))}" alt="${esc(s.business_name)}">` : `<div class="shop"><b>${esc(s.business_name || 'Shop')}</b></div>`,
    `<div class="shop">${s.logo_url ? `<b>${esc(s.business_name || '')}</b>` : ''}${[s.address, s.phone && 'Tel: ' + s.phone, s.email, s.tax_id && 'TIN: ' + s.tax_id].filter(Boolean).map(esc).join('<br>')}</div>`
  ].join('');
}

/**
 * Branded A4 document.
 * opts: { title, number, date, stamp, boxes: [{ heading, rows: [[label, value]] } | { heading, html }],
 *         columns: [{ label, right }], rows: [[cells]], totals: [[label, value, 'grand'|'sub'|'']],
 *         sections: [{ heading, html }], notes, signatures: ['Prepared by', …] }
 */
export function documentHtml(o) {
  const s = state.settings || {};
  const boxes = (o.boxes || []).map(b => `<div class="box"><h3>${esc(b.heading)}</h3>${b.html ?? `<div class="kv">${b.rows.filter(r => r[1] !== undefined && r[1] !== null && r[1] !== '').map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>`}</div>`).join('');
  const table = o.columns ? `<table class="lines"><thead><tr>${o.columns.map(c => `<th${c.right ? ' class="r"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${
    (o.rows || []).length ? o.rows.map(r => `<tr>${r.map((v, i) => `<td${o.columns[i]?.right ? ' class="r"' : ''}>${v && v.__html ? v.__html : esc(v)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${o.columns.length}">Nothing to show.</td></tr>`}</tbody></table>` : '';
  const totals = (o.totals || []).length ? `<table class="totals">${o.totals.map(([k, v, cls]) => `<tr class="${cls || ''}"><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('')}</table>` : '';
  const sections = (o.sections || []).map(x => `<div class="section"><h2>${esc(x.heading)}</h2>${x.html}</div>`).join('');
  const sigs = (o.signatures || []).length ? `<div class="sign" style="--n:${o.signatures.length}">${o.signatures.map(t => `<div>${esc(t)}<br><br>Name &amp; date</div>`).join('')}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.title)} ${esc(o.number || '')}</title><style>${DOC_CSS}</style></head><body><div class="doc">
<div class="head"><div>${shopBlock()}</div><div class="title"><h1>${esc(o.title)}</h1>${o.number ? `<div class="no">${esc(o.number)}</div>` : ''}<div>${esc(o.date || date(new Date().toISOString()))}</div>${o.stamp ? `<div style="margin-top:2mm"><span class="stamp">${esc(o.stamp)}</span></div>` : ''}</div></div>
<div class="rule"></div>
${boxes ? `<div class="meta">${boxes}</div>` : ''}
${table}${totals}${sections}
${o.notes ? `<div class="notes"><h3>Notes</h3>${esc(o.notes)}</div>` : ''}
${sigs}
<div class="foot"><span>${esc(s.business_name || '')}${s.tagline ? ' · ' + esc(s.tagline) : ''}</span><span>Printed ${esc(dateTime(new Date().toISOString()))}${state.profile?.full_name ? ' by ' + esc(state.profile.full_name) : ''}</span></div>
</div></body></html>`;
}

export const raw = html => ({ __html: html });
export const m = v => money(v);

// Print any HTML through a hidden iframe (no pop-up blocker problems); waits for images.
export function printHtml(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open(); doc.write(html); doc.close();
  const go = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } finally { setTimeout(() => frame.remove(), 60000); } };
  const imgs = [...doc.images].filter(i => !i.complete);
  if (!imgs.length) return setTimeout(go, 80);
  let left = imgs.length;
  const done = () => { if (--left === 0) setTimeout(go, 50); };
  imgs.forEach(i => { i.onload = done; i.onerror = done; });
  setTimeout(() => { if (left > 0) { left = 0; go(); } }, 4000);
}

export function printDocument(opts) { printHtml(documentHtml(opts)); }
