import { state } from './state.js';
import { money, date, dateTime } from './format.js';

// Shared branded A4 document engine. Keep in sync with docs/BRAND.md.
const BRAND = Object.freeze({ navy: '#16376A', orange: '#FB8F11', bronze: '#A16A1A', black: '#010101', white: '#FFFFFF' });

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const abs = u => { try { return new URL(u, location.href).href; } catch { return u; } };

export const DOC_CSS = `
  @page { size: A4; margin: 12mm 14mm 15mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font: 10.5pt/1.45 Arial, Helvetica, sans-serif; color: ${BRAND.black}; background: ${BRAND.white}; }
  .doc { width: 100%; max-width: 182mm; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm; min-height: 32mm; }
  .identity { display: flex; align-items: flex-start; gap: 5mm; min-width: 0; }
  .head .logo { height: 32mm; max-width: 60mm; object-fit: contain; object-position: left top; }
  .shop { font-size: 9pt; line-height: 1.45; }
  .shop b { display: block; font-size: 12.5pt; line-height: 1.2; color: ${BRAND.navy}; margin-bottom: 1.5mm; }
  .title { text-align: right; min-width: 52mm; }
  .title h1 { margin: 0; font-size: 20pt; line-height: 1.05; letter-spacing: .065em; color: ${BRAND.navy}; text-transform: uppercase; }
  .title .no { margin-top: 2mm; font-size: 11pt; font-weight: 800; }
  .title .date { margin-top: .8mm; font-size: 9pt; }
  .rule { height: 3px; background: ${BRAND.orange}; margin: 5mm 0 5.5mm; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin-bottom: 5mm; break-inside: avoid; }
  .box { border: 1px solid ${BRAND.navy}; border-radius: 2mm; padding: 3.2mm 4mm; min-height: 16mm; }
  .box h3 { margin: 0 0 1.7mm; font-size: 8pt; line-height: 1.1; letter-spacing: .1em; text-transform: uppercase; color: ${BRAND.bronze}; }
  .kv { display: grid; grid-template-columns: auto 1fr; gap: .7mm 4mm; }
  .kv span:nth-child(odd) { color: ${BRAND.navy}; font-weight: 700; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 2mm; break-inside: auto; }
  table.lines thead { display: table-header-group; }
  table.lines tr { break-inside: avoid; page-break-inside: avoid; }
  table.lines th { background: ${BRAND.navy}; color: ${BRAND.white}; text-align: left; font-size: 8.5pt; line-height: 1.2; text-transform: uppercase; letter-spacing: .05em; padding: 2.2mm 2.5mm; }
  table.lines td { padding: 1.9mm 2.5mm; border-bottom: 1px solid rgba(22,55,106,.18); vertical-align: top; }
  table.lines tr:nth-child(even) td { background: rgba(22,55,106,.035); }
  table.lines th:first-child, table.lines td:first-child { border-left: 1px solid rgba(22,55,106,.12); }
  table.lines th:last-child, table.lines td:last-child { border-right: 1px solid rgba(22,55,106,.12); }
  .r, table.lines th.r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .totals { margin-left: auto; width: 82mm; margin-top: 5mm; border-collapse: collapse; break-inside: avoid; }
  .totals td { padding: 1.5mm 2.8mm; font-variant-numeric: tabular-nums; }
  .totals tr.sub td { font-weight: 700; border-top: 1px solid ${BRAND.navy}; }
  .totals tr.grand td { background: ${BRAND.navy}; color: ${BRAND.white}; font-weight: 800; font-size: 12.5pt; padding-top: 2.5mm; padding-bottom: 2.5mm; }
  .totals tr.grand td:first-child { letter-spacing: .04em; }
  .stamp { display: inline-block; border: 2px solid ${BRAND.bronze}; color: ${BRAND.bronze}; font-weight: 800; padding: 1.2mm 4mm; letter-spacing: .1em; text-transform: uppercase; }
  .notes { margin-top: 6mm; font-size: 9pt; break-inside: avoid; }
  .notes h3 { margin: 0 0 1.5mm; color: ${BRAND.navy}; font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid ${BRAND.orange}; padding-bottom: 1mm; }
  .sign { display: grid; grid-template-columns: repeat(var(--n, 2), 1fr); gap: 12mm; margin-top: 16mm; break-inside: avoid; }
  .sign div { border-top: 1px solid ${BRAND.black}; padding-top: 1.5mm; font-size: 8.5pt; color: ${BRAND.navy}; }
  .foot { margin-top: 8mm; padding-top: 2.5mm; border-top: 1px solid ${BRAND.orange}; font-size: 8pt; color: ${BRAND.navy}; display: flex; justify-content: space-between; gap: 6mm; break-inside: avoid; }
  .section { margin-top: 6mm; break-inside: avoid; }
  .section h2 { font-size: 11pt; color: ${BRAND.navy}; margin: 0 0 2mm; border-bottom: 2px solid ${BRAND.orange}; padding-bottom: 1mm; }
  .neg { color: ${BRAND.bronze}; }
  .muted-print { color: rgba(22,55,106,.72); }
  @media print { a { color: inherit; text-decoration: none; } }
`;

function shopBlock() {
  const s = state.settings || {};
  const details = [s.address, s.phone && 'Tel: ' + s.phone, s.email, s.tax_id && 'TIN: ' + s.tax_id].filter(Boolean).map(esc).join('<br>');
  return `<div class="identity">${s.logo_url ? `<img class="logo" src="${esc(abs(s.logo_url))}" alt="${esc(s.business_name || 'Shop logo')}">` : ''}<div class="shop"><b>${esc(s.business_name || 'Shop')}</b>${details}</div></div>`;
}

/**
 * Branded A4 document.
 * opts: { title, number, date, stamp, boxes: [{ heading, rows: [[label, value]] } | { heading, html }],
 * columns: [{ label, right }], rows: [[cells]], totals: [[label, value, 'grand'|'sub'|'']],
 * sections: [{ heading, html }], notes, signatures: ['Prepared by', …] }
 */
export function documentHtml(o) {
  const s = state.settings || {};
  const boxes = (o.boxes || []).map(b => `<div class="box"><h3>${esc(b.heading)}</h3>${b.html ?? `<div class="kv">${(b.rows || []).filter(r => r[1] !== undefined && r[1] !== null && r[1] !== '').map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>`}</div>`).join('');
  const table = o.columns ? `<table class="lines"><thead><tr>${o.columns.map(c => `<th${c.right ? ' class="r"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${
    (o.rows || []).length ? o.rows.map(r => `<tr>${r.map((v, i) => `<td${o.columns[i]?.right ? ' class="r"' : ''}>${v && v.__html ? v.__html : esc(v)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${o.columns.length}" class="muted-print">Nothing to show.</td></tr>`}</tbody></table>` : '';
  const totals = (o.totals || []).length ? `<table class="totals">${o.totals.map(([k, v, cls]) => `<tr class="${cls || ''}"><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('')}</table>` : '';
  const sections = (o.sections || []).map(x => `<div class="section"><h2>${esc(x.heading)}</h2>${x.html}</div>`).join('');
  const sigs = (o.signatures || []).length ? `<div class="sign" style="--n:${o.signatures.length}">${o.signatures.map(t => `<div>${esc(t)}<br><br>Name &amp; date</div>`).join('')}</div>` : '';
  const stamp = o.stamp ? `<div style="margin-top:2.5mm"><span class="stamp">${esc(o.stamp)}</span></div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.title)} ${esc(o.number || '')}</title><style>${DOC_CSS}</style></head><body><div class="doc">
<div class="head"><div>${shopBlock()}</div><div class="title"><h1>${esc(o.title)}</h1>${o.number ? `<div class="no">${esc(o.number)}</div>` : ''}<div class="date">${esc(o.date || date(new Date().toISOString()))}</div>${stamp}</div></div>
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
