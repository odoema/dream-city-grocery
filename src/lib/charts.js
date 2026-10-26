// Small, dependency-free SVG charts in the brand palette (docs/BRAND.md).
// Every chart has a hover tooltip, direct labels where useful and a text alternative.
import { h } from './dom.js';

export const C = { navy: '#16376A', orange: '#FB8F11', bronze: '#A16A1A', black: '#010101', white: '#FFFFFF' };
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
};

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function tooltipHost() {
  const tip = h('div', { class: 'chart-tip', role: 'status' });
  tip.hidden = true;
  return tip;
}
function showTip(tip, wrap, x, y, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const w = wrap.clientWidth;
  tip.style.left = Math.min(Math.max(x, 70), w - 70) + 'px';
  tip.style.top = y + 'px';
}
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Line/area chart. series: [{ name, color, values: [number], dashed, area }]; labels: [string] (x axis).
 * fmt formats values; short(labels[i]) gives the tick text.
 */
export function lineChart({ labels, series, fmt = v => v, short = v => v, height = 260, ariaLabel = 'Trend' }) {
  const W = 760, H = height, L = 64, R = 16, T = 18, B = 34;
  const max = niceMax(Math.max(1, ...series.flatMap(x => x.values)));
  const n = Math.max(labels.length, 2);
  const X = i => L + (W - L - R) * (labels.length === 1 ? 0.5 : i / (n - 1));
  const Y = v => T + (H - T - B) * (1 - v / max);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': ariaLabel });
  for (let k = 0; k <= 4; k++) {
    const v = max * k / 4;
    svg.append(s('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'grid' }),
      s('text', { x: L - 8, y: Y(v) + 4, class: 'tick', 'text-anchor': 'end' }, fmt(v, true)));
  }
  const every = Math.ceil(labels.length / 8);
  labels.forEach((lb, i) => { if (i % every === 0 || (i === labels.length - 1 && i % every >= every / 2)) svg.append(s('text', { x: X(i), y: H - 10, class: 'tick', 'text-anchor': 'middle' }, short(lb))); });
  for (const se of series) {
    const pts = se.values.map((v, i) => [X(i), Y(v)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    if (se.area && pts.length) {
      const id = 'g' + Math.random().toString(36).slice(2, 8);
      svg.append(s('defs', {}, s('linearGradient', { id, x1: 0, x2: 0, y1: 0, y2: 1 },
        s('stop', { offset: '0%', 'stop-color': se.color, 'stop-opacity': '.28' }), s('stop', { offset: '100%', 'stop-color': se.color, 'stop-opacity': '0' }))));
      svg.append(s('path', { d: d + ` L ${pts.at(-1)[0]} ${Y(0)} L ${pts[0][0]} ${Y(0)} Z`, fill: `url(#${id})` }));
    }
    svg.append(s('path', { d, fill: 'none', stroke: se.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': se.dashed ? '6 5' : null, opacity: se.dashed ? .8 : 1 }));
  }
  // Highlight the latest point of the first series.
  const main = series[0];
  if (main && main.values.length) {
    const i = main.values.length - 1;
    svg.append(s('circle', { cx: X(i), cy: Y(main.values[i]), r: 5, fill: main.color, stroke: C.white, 'stroke-width': 2 }));
  }
  const cross = s('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' });
  const dots = series.map(se => s('circle', { r: 5, fill: se.color, stroke: C.white, 'stroke-width': 2, visibility: 'hidden' }));
  svg.append(cross, ...dots);
  const wrap = h('div', { class: 'chart-wrap2' }, svg);
  const tip = tooltipHost(); wrap.append(tip);
  const hit = s('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
  svg.append(hit);
  const move = e => {
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(labels.length - 1, Math.round((px - L) / ((W - L - R) / (n - 1)))));
    const x = X(i);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    series.forEach((se, k) => { dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', Y(se.values[i] || 0)); dots[k].setAttribute('visibility', 'visible'); });
    showTip(tip, wrap, x / W * r.width, Math.min(...series.map(se => Y(se.values[i] || 0))) / H * r.height - 10,
      `<b>${esc(labels[i])}</b>` + series.map(se => `<div><i style="background:${se.color}"></i>${esc(se.name)}: <b>${esc(fmt(se.values[i] || 0))}</b></div>`).join(''));
  };
  const leave = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); tip.hidden = true; };
  hit.addEventListener('pointermove', move); hit.addEventListener('pointerleave', leave);
  return wrap;
}

/** Vertical bars. items: [{ label, value, note }]. highlight: index to colour orange. */
export function barChart({ items, fmt = v => v, height = 220, width = 760, color = C.navy, highlight = -1, ariaLabel = 'Bars' }) {
  const W = width, H = height, L = 56, R = 8, T = 16, B = 30;
  const max = niceMax(Math.max(1, ...items.map(i => i.value)));
  const bw = (W - L - R) / Math.max(items.length, 1);
  const Y = v => T + (H - T - B) * (1 - v / max);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': ariaLabel });
  for (let k = 0; k <= 4; k++) { const v = max * k / 4; svg.append(s('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'grid' }), s('text', { x: L - 8, y: Y(v) + 4, class: 'tick', 'text-anchor': 'end' }, fmt(v, true))); }
  const wrap = h('div', { class: 'chart-wrap2' }, svg);
  const tip = tooltipHost(); wrap.append(tip);
  const every = Math.ceil(items.length / 12);
  items.forEach((it, i) => {
    const x = L + i * bw + bw * 0.16, w = Math.max(2, bw * 0.68), y = Y(it.value), hgt = Math.max(0, Y(0) - y);
    const r = Math.min(4, w / 2, hgt);
    const d = hgt <= 0 ? '' : `M${x} ${Y(0)} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${Y(0)} Z`;
    const bar = s('path', { d, fill: i === highlight ? C.orange : color, class: 'bar2' });
    const hit = s('rect', { x: L + i * bw, y: T, width: bw, height: H - T - B, fill: 'transparent' });
    hit.addEventListener('pointerenter', () => { bar.classList.add('on'); const rr = svg.getBoundingClientRect(); showTip(tip, wrap, (x + w / 2) / W * rr.width, y / H * rr.height - 10, `<b>${esc(it.label)}</b><div>${esc(fmt(it.value))}${it.note ? ' · ' + esc(it.note) : ''}</div>`); });
    hit.addEventListener('pointerleave', () => { bar.classList.remove('on'); tip.hidden = true; });
    svg.append(bar, hit);
    if (i % every === 0) svg.append(s('text', { x: x + w / 2, y: H - 10, class: 'tick', 'text-anchor': 'middle' }, it.short ?? it.label));
  });
  return wrap;
}

/** Horizontal ranked bars with direct labels. items: [{ label, value, sub }] */
export function rankBars({ items, fmt = v => v, color = C.navy }) {
  const max = Math.max(1, ...items.map(i => i.value));
  return h('div', { class: 'rank' }, items.map((it, i) => h('div', { class: 'rank-row' },
    h('span', { class: 'rank-n' }, String(i + 1)),
    h('div', { class: 'rank-body' },
      h('div', { class: 'rank-top' }, h('span', { class: 'rank-label', title: it.label }, it.label), h('b', null, fmt(it.value))),
      h('div', { class: 'rank-track' }, h('div', { class: 'rank-fill', style: { width: (it.value / max * 100).toFixed(1) + '%', background: i === 0 ? C.orange : color } })),
      it.sub ? h('small', { class: 'muted' }, it.sub) : null))));
}

/** Donut with legend. parts: [{ label, value, color }] */
export function donut({ parts, fmt = v => v, center = '', sub = '' }) {
  const total = parts.reduce((t, p) => t + p.value, 0) || 1;
  const R = 70, r = 46, cx = 90, cy = 90;
  const svg = s('svg', { viewBox: '0 0 180 180', class: 'donut-svg', role: 'img', 'aria-label': parts.map(p => `${p.label} ${Math.round(p.value / total * 100)}%`).join(', ') });
  let a = -Math.PI / 2;
  const wrap = h('div', { class: 'donut' });
  const tip = tooltipHost();
  for (const p of parts.filter(p => p.value > 0)) {
    const frac = p.value / total, b = a + frac * Math.PI * 2 - (parts.length > 1 ? 0.02 : 0);
    const large = b - a > Math.PI ? 1 : 0;
    const P = (rad, ang) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
    const [x1, y1] = P(R, a), [x2, y2] = P(R, b), [x3, y3] = P(r, b), [x4, y4] = P(r, a);
    const path = frac >= 0.999
      ? s('circle', { cx, cy, r: (R + r) / 2, fill: 'none', stroke: p.color, 'stroke-width': R - r })
      : s('path', { d: `M${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${r} ${r} 0 ${large} 0 ${x4} ${y4} Z`, fill: p.color, class: 'slice' });
    path.addEventListener('pointerenter', () => { tip.innerHTML = `<b>${esc(p.label)}</b><div>${esc(fmt(p.value))} · ${Math.round(frac * 100)}%</div>`; tip.hidden = false; tip.style.left = '50%'; tip.style.top = '0px'; });
    path.addEventListener('pointerleave', () => { tip.hidden = true; });
    svg.append(path);
    a += frac * Math.PI * 2;
  }
  svg.append(s('text', { x: cx, y: cy + 2, 'text-anchor': 'middle', class: 'donut-c' }, center), s('text', { x: cx, y: cy + 20, 'text-anchor': 'middle', class: 'donut-s' }, sub));
  wrap.append(h('div', { class: 'donut-fig' }, svg, tip),
    h('ul', { class: 'legend' }, parts.map(p => h('li', null, h('i', { style: { background: p.color } }), h('span', null, p.label), h('b', null, Math.round(p.value / total * 100) + '%'), h('small', { class: 'muted' }, fmt(p.value))))));
  return wrap;
}

/** Tiny inline trend line for KPI tiles. */
export function sparkline(values, color = C.orange) {
  const W = 120, H = 34, max = Math.max(1, ...values), min = Math.min(0, ...values);
  const X = i => values.length < 2 ? W / 2 : i / (values.length - 1) * W;
  const Y = v => H - 3 - (H - 6) * (v - min) / (max - min || 1);
  const d = values.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
  return s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spark', 'aria-hidden': 'true', preserveAspectRatio: 'none' },
    s('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    values.length ? s('circle', { cx: X(values.length - 1), cy: Y(values.at(-1)), r: 2.6, fill: color }) : null);
}

/** Gauge-like progress ring for a single percentage (0–100). */
export function ring(pct, label, color = C.navy) {
  const v = Math.max(0, Math.min(100, pct || 0)), R = 34, L = 2 * Math.PI * R;
  return h('div', { class: 'ring' },
    s('svg', { viewBox: '0 0 84 84', role: 'img', 'aria-label': `${label} ${Math.round(v)}%` },
      s('circle', { cx: 42, cy: 42, r: R, fill: 'none', stroke: 'rgba(22, 55, 106, .12)', 'stroke-width': 9 }),
      s('circle', { cx: 42, cy: 42, r: R, fill: 'none', stroke: color, 'stroke-width': 9, 'stroke-linecap': 'round', 'stroke-dasharray': `${L * v / 100} ${L}`, transform: 'rotate(-90 42 42)' }),
      s('text', { x: 42, y: 47, 'text-anchor': 'middle', class: 'ring-t' }, Math.round(v) + '%')),
    h('span', null, label));
}
