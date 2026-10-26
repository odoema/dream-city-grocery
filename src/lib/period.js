import { h } from './dom.js';
import { todayISO, addDaysISO, rangeFor } from './format.js';

// Period picker: returns { el, get() -> { fromISO, toISO, from, to, label } }
export function periodPicker(onChange, initial = 'today') {
  const today = todayISO();
  const monthStart = today.slice(0, 8) + '01';
  const presets = {
    today: ['Today', today, today],
    yesterday: ['Yesterday', addDaysISO(today, -1), addDaysISO(today, -1)],
    week: ['Last 7 days', addDaysISO(today, -6), today],
    month: ['This month', monthStart, today],
    d30: ['Last 30 days', addDaysISO(today, -29), today],
    year: ['This year', today.slice(0, 4) + '-01-01', today]
  };
  let current = initial;
  const select = h('select', { 'aria-label': 'Period' }, [...Object.entries(presets).map(([k, [l]]) => h('option', { value: k, selected: k === initial }, l)), h('option', { value: 'custom' }, 'Custom dates…')]);
  const from = h('input', { type: 'date', value: presets[initial]?.[1] || today, 'aria-label': 'From', hidden: true });
  const to = h('input', { type: 'date', value: today, 'aria-label': 'To', hidden: true });
  select.addEventListener('change', () => {
    current = select.value;
    const custom = current === 'custom';
    from.hidden = to.hidden = !custom;
    if (!custom) { from.value = presets[current][1]; to.value = presets[current][2]; }
    onChange(get());
  });
  [from, to].forEach(i => i.addEventListener('change', () => { if (from.value && to.value) onChange(get()); }));
  function get() {
    const fromISO = current === 'custom' ? from.value : presets[current][1];
    const toISO = current === 'custom' ? to.value : presets[current][2];
    const label = current === 'custom' ? `${fromISO} to ${toISO}` : presets[current][0];
    return { fromISO, toISO, label, ...rangeFor(fromISO, toISO) };
  }
  return { el: h('div', { class: 'period' }, select, from, to), get };
}

// Simple accessible bar chart (SVG) — values: [{ label, value }]
export function barChart(values, { format = v => v, height = 180 } = {}) {
  const max = Math.max(1, ...values.map(v => Number(v.value) || 0));
  const w = Math.max(values.length * 36, 280);
  const bw = Math.max(8, Math.min(28, (w / Math.max(values.length, 1)) - 8));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${height + 24}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Chart: ' + values.map(v => `${v.label} ${format(v.value)}`).join(', '));
  values.forEach((v, i) => {
    const x = i * (w / values.length) + ((w / values.length) - bw) / 2;
    const bh = Math.round((Number(v.value) || 0) / max * height);
    const rect = document.createElementNS(ns, 'rect');
    Object.entries({ x, y: height - bh, width: bw, height: Math.max(bh, 1), rx: 3, class: 'bar' }).forEach(([k, val]) => rect.setAttribute(k, val));
    const title = document.createElementNS(ns, 'title');
    title.textContent = `${v.label}: ${format(v.value)}`;
    rect.append(title);
    const text = document.createElementNS(ns, 'text');
    Object.entries({ x: x + bw / 2, y: height + 16, 'text-anchor': 'middle', class: 'axis' }).forEach(([k, val]) => text.setAttribute(k, val));
    text.textContent = v.short || v.label;
    svg.append(rect, text);
  });
  return h('div', { class: 'chart-wrap' }, svg);
}
