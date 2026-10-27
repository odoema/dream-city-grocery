// Executive dashboard — a live, bird's-eye view of the business for the
// Executive Director, the board and donors. Read-only; refreshes itself.
import { h, clear } from '../lib/dom.js';
import { db, rpc, run } from '../lib/supabase.js';
import { state, is } from '../lib/state.js';
import { money, num, date, dateTime, time, paymentLabel, todayISO, addDaysISO, rangeFor, currencyCode } from '../lib/format.js';
import { loading, showError, toast } from '../lib/ui.js';
import { backupDue } from '../lib/backup.js';
import { lineChart, barChart, rankBars, donut, sparkline, ring, C } from '../lib/charts.js';

const PERIODS = [
  ['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['year', 'This year']
];
const REFRESH_MS = 30000;

function periodRange(key) {
  const t = todayISO();
  const from = key === 'today' ? t : key === '7d' ? addDaysISO(t, -6) : key === '30d' ? addDaysISO(t, -29)
    : key === 'month' ? t.slice(0, 8) + '01' : t.slice(0, 4) + '-01-01';
  const days = Math.round((Date.parse(t) - Date.parse(from)) / 864e5) + 1;
  const prevTo = addDaysISO(from, -1), prevFrom = addDaysISO(prevTo, -(days - 1));
  return { fromISO: from, toISO: t, days, cur: rangeFor(from, t), prev: rangeFor(prevFrom, prevTo), prevFrom, prevTo };
}

// Compact money for axes and tiles: UGX 1.2M
function short(v) {
  const n = Number(v) || 0, a = Math.abs(n);
  const f = a >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e3 ? (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K' : String(Math.round(n));
  return f.replace('.0', '');
}
const shortMoney = v => currencyCode() + ' ' + short(v);

function delta(cur, prev) {
  cur = Number(cur) || 0; prev = Number(prev) || 0;
  if (!prev) return cur ? { text: 'new', up: true } : { text: '—', up: null };
  const p = (cur - prev) / Math.abs(prev) * 100;
  return { text: (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p).toFixed(Math.abs(p) < 10 ? 1 : 0) + '%', up: p >= 0 };
}

export async function render(root) {
  let period = (() => { try { return localStorage.getItem('exec.period') || '30d'; } catch { return '30d'; } })();
  let timer = null, channel = null, busy = false, lastData = null;
  const s = state.settings || {};

  const live = h('span', { class: 'live' }, h('i'), 'Live');
  const updated = h('span', { class: 'muted small' });
  const periodSel = h('div', { class: 'seg-pills', role: 'tablist', 'aria-label': 'Period' });
  const body = h('div', { class: 'exec-body' });
  const presentBtn = h('button', { class: 'secondary small', type: 'button', onclick: togglePresent }, 'Present');
  const printBtn = h('button', { class: 'primary small', type: 'button', onclick: () => window.print() }, 'Print donor report');

  clear(root, h('div', { class: 'exec' },
    h('header', { class: 'exec-hero' },
      h('div', { class: 'exec-hero-text' },
        h('p', { class: 'eyebrow' }, 'Executive dashboard'),
        h('h1', null, s.business_name || 'Our shop'),
        h('p', { class: 'exec-tag' }, s.tagline || 'Performance at a glance'),
        h('div', { class: 'exec-live' }, live, updated)),
      h('div', { class: 'exec-actions' }, periodSel, h('div', { class: 'row' }, presentBtn, printBtn))),
    is('owner') && backupDue() ? h('div', { class: 'notice-bar no-print' }, h('span', null, 'No backup downloaded on this computer in the last day.'), h('a', { class: 'secondary small', href: '#/settings' }, 'Back up now')) : null,
    body));

  function drawPeriods() {
    clear(periodSel, PERIODS.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === period), class: k === period ? 'on' : '', onclick: () => { period = k; try { localStorage.setItem('exec.period', k); } catch { /* ignore */ } drawPeriods(); load(true); } }, l)));
  }

  function togglePresent() {
    const on = !document.body.classList.contains('present');
    document.body.classList.toggle('present', on);
    presentBtn.textContent = on ? 'Exit presentation' : 'Present';
    if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  const onFs = () => { if (!document.fullscreenElement && document.body.classList.contains('present')) togglePresent(); };
  document.addEventListener('fullscreenchange', onFs);

  async function load(showSpinner) {
    if (busy) return;
    busy = true;
    const r = periodRange(period);
    if (showSpinner || !lastData) loading(body, 'Gathering the latest numbers…');
    try {
      const yearStart = todayISO().slice(0, 4) + '-01-01';
      const [cur, prev, items, fin, intel, recent, customers, staff, purchases, year] = await Promise.all([
        rpc('get_sales_summary', { p_from: r.cur.from, p_to: r.cur.to }),
        rpc('get_sales_summary', { p_from: r.prev.from, p_to: r.prev.to }),
        rpc('get_sales_by_item', { p_from: r.cur.from, p_to: r.cur.to }).catch(() => null),
        rpc('get_financial_statements', { p_from: r.cur.from, p_to: r.cur.to }).catch(() => null),
        rpc('get_inventory_intelligence', { p_days: 30 }).catch(() => null),
        run(db().from('sales').select('receipt_number,created_at,total,payment_method,status,customers(name)').order('created_at', { ascending: false }).limit(8)).catch(() => []),
        rpc('list_customers_with_balance').catch(() => []),
        is('owner', 'manager') ? rpc('list_staff').catch(() => []) : Promise.resolve([]),
        run(db().from('supplier_invoices').select('supplier_id,total,invoice_date').gte('invoice_date', r.fromISO).lte('invoice_date', r.toISO).limit(5000)).catch(() => []),
        period === 'year' ? Promise.resolve(null) : rpc('get_sales_summary', { p_from: rangeFor(yearStart, todayISO()).from, p_to: rangeFor(yearStart, todayISO()).to }).catch(() => null)
      ]);
      lastData = { r, cur, prev, items, fin, intel, recent, customers, staff, purchases, year: year || cur };
      draw(lastData);
      updated.textContent = 'Updated ' + time(new Date().toISOString());
      live.classList.remove('off');
    } catch (e) {
      live.classList.add('off');
      if (!lastData) { showError(e); clear(body, h('p', { class: 'muted' }, e.message)); }
    } finally { busy = false; }
  }

  function draw({ r, cur, prev, items, fin, intel, recent, customers, staff, purchases, year }) {
    // ----- daily (or hourly for today) series, gaps filled with zero
    let labels, values, prevValues, tickFmt;
    if (period === 'today') {
      const byH = Object.fromEntries((cur.by_hour || []).map(x => [x.hour, Number(x.total)]));
      const pH = Object.fromEntries((prev.by_hour || []).map(x => [x.hour, Number(x.total)]));
      const nowH = new Date().getHours();
      labels = Array.from({ length: Math.max(nowH + 1, 1) }, (_, i) => String(i).padStart(2, '0') + ':00');
      values = labels.map((_, i) => byH[i] || 0); prevValues = labels.map((_, i) => pH[i] || 0);
      tickFmt = l => l.slice(0, 2) + 'h';
    } else {
      const byD = Object.fromEntries((cur.by_day || []).map(x => [x.day, Number(x.total)]));
      const pD = Object.fromEntries((prev.by_day || []).map(x => [x.day, Number(x.total)]));
      labels = Array.from({ length: r.days }, (_, i) => addDaysISO(r.fromISO, i));
      values = labels.map(d => byD[d] || 0);
      prevValues = labels.map((_, i) => pD[addDaysISO(r.prevFrom, i)] || 0);
      tickFmt = l => date(l).replace(/ \d{4}$/, '');
    }
    const profitDaily = period === 'today' ? null : labels.map(d => Number((cur.by_day || []).find(x => x.day === d)?.profit || 0));

    const units = (items?.items || []).reduce((t, i) => t + Number(i.quantity || 0), 0);
    const margin = Number(cur.net_sales) > 0 ? Number(cur.gross_profit) / Number(cur.net_sales) * 100 : 0;
    const pMargin = Number(prev.net_sales) > 0 ? Number(prev.gross_profit) / Number(prev.net_sales) * 100 : 0;

    const kpi = (label, value, d, spark, note) => h('div', { class: 'kpi' },
      h('span', { class: 'kpi-label' }, label),
      h('strong', { class: 'kpi-value' }, value),
      h('div', { class: 'kpi-foot' },
        d ? h('span', { class: 'delta ' + (d.up === null ? '' : d.up ? 'up' : 'down') }, d.text) : null,
        h('small', { class: 'muted' }, note || 'vs previous period')),
      spark ? h('div', { class: 'kpi-spark' }, spark) : null);

    // ----- financial position
    const acct = code => Number((fin?.balance_sheet?.assets || []).find(a => a.code === code)?.amount || 0);
    const liab = code => Number((fin?.balance_sheet?.liabilities || []).find(a => a.code === code)?.amount || 0);
    const cash = acct('1000'), mobile = acct('1010'), bank = acct('1020'), stock = acct('1200'), owedToUs = acct('1100'), owedBy = liab('2000');
    const netWorth = Number(fin?.balance_sheet?.total_assets || 0) - (fin?.balance_sheet?.liabilities || []).reduce((t, a) => t + Number(a.amount), 0);

    // ----- payment mix
    const payColors = { cash: C.navy, mobile_money: C.orange, card: C.bronze, bank: C.black, credit: 'rgba(22, 55, 106, .45)' };
    const pay = (cur.by_payment || []).map(p => ({ label: paymentLabel(p.method), value: Number(p.total), color: payColors[p.method] || C.navy }))
      .sort((a, b) => b.value - a.value);

    // ----- impact
    const supplierCount = new Set((purchases || []).map(p => p.supplier_id)).size;
    const purchased = (purchases || []).reduce((t, p) => t + Number(p.total), 0);
    const creditCustomers = (customers || []).filter(c => Number(c.balance) > 0);
    const creditOut = creditCustomers.reduce((t, c) => t + Number(c.balance), 0);
    const activeStaff = (staff || []).filter(x => x.active).length;
    const sm = intel?.summary || {};
    const inStockPct = sm.products ? (1 - Number(sm.out || 0) / Number(sm.products)) * 100 : 0;
    const healthyPct = sm.products ? (1 - (Number(sm.out || 0) + Number(sm.low || 0) + Number(sm.dead || 0)) / Number(sm.products)) * 100 : 0;

    // ----- best hour
    const hours = Array.from({ length: 24 }, (_, i) => ({ hour: i, total: Number((cur.by_hour || []).find(x => x.hour === i)?.total || 0) }));
    const open = hours.filter((x, i) => i >= 6 && i <= 22);
    const peak = open.reduce((a, b) => b.total > a.total ? b : a, open[0]);
    const peakIdx = open.indexOf(peak);

    // ----- year by month (from the year summary)
    const months = Array.from({ length: 12 }, (_, m) => ({ m, total: 0 }));
    for (const d of (year?.by_day || [])) { const m = Number(d.day.slice(5, 7)) - 1; months[m].total += Number(d.total); }
    const thisMonth = new Date().getMonth();
    const monthName = m => new Date(2026, m, 1).toLocaleString('en', { month: 'short' });

    const best = (cur.by_day || []).reduce((a, b) => Number(b.total) > Number(a?.total || 0) ? b : a, null);

    clear(body,
      // KPI band
      h('section', { class: 'kpis' },
        kpi('Sales', money(cur.net_sales), delta(cur.net_sales, prev.net_sales), sparkline(values, C.orange)),
        kpi('Gross profit', money(cur.gross_profit), delta(cur.gross_profit, prev.gross_profit), profitDaily ? sparkline(profitDaily, C.orange) : null, num(margin, 1) + '% margin (was ' + num(pMargin, 1) + '%)'),
        kpi('Customer visits', num(cur.transactions), delta(cur.transactions, prev.transactions), null, 'receipts issued'),
        kpi('Average basket', money(cur.average_sale), delta(cur.average_sale, prev.average_sale)),
        kpi('Items sold', num(units, 0), null, null, num((items?.items || []).length) + ' different products'),
        kpi('Stock on the shelves', money(sm.stock_cost || stock), null, null, 'worth ' + shortMoney(sm.stock_retail || 0) + ' at selling price')),

      // Trend + payment
      h('section', { class: 'exec-grid g-2-1' },
        panel(period === 'today' ? 'Sales by hour today' : 'Sales trend', period === 'today' ? 'Compared with yesterday' : `Daily sales, ${PERIODS.find(p => p[0] === period)[1].toLowerCase()} vs the period before`,
          lineChart({ labels, series: [
            { name: 'This period', color: C.navy, values, area: true },
            { name: 'Previous period', color: C.bronze, values: prevValues, dashed: true }
          ], fmt: (v, axis) => axis ? short(v) : money(v), short: tickFmt, ariaLabel: 'Sales trend' }),
          h('div', { class: 'chart-legend' }, h('span', null, h('i', { style: { background: C.navy } }), 'This period'), h('span', null, h('i', { class: 'dash', style: { borderColor: C.bronze } }), 'Previous period'),
            best && period !== 'today' ? h('span', { class: 'muted' }, 'Best day: ' + date(best.day) + ' · ' + money(best.total)) : null)),
        panel('How customers pay', 'Share of sales value',
          pay.length ? donut({ parts: pay, fmt: money, center: shortMoney(cur.net_sales), sub: 'total sales' }) : empty('No sales in this period yet.'))),

      // Financial position
      h('section', { class: 'exec-grid g-1' },
        panel('Financial position', 'What the business owns and owes right now',
          h('div', { class: 'position' },
            pos('Cash in hand', cash), pos('Mobile money', mobile), pos('Bank', bank), pos('Stock (at cost)', stock),
            pos('Customers owe us', owedToUs), pos('We owe suppliers', -owedBy, true),
            h('div', { class: 'fin-pos fin-pos-total' }, h('span', null, 'Net worth of the shop'), h('strong', null, money(netWorth))),
            h('div', { class: 'fin-pos-bar' }, posBar([['Cash & money', cash + mobile + bank, C.navy], ['Stock', stock, C.orange], ['Owed to us', owedToUs, C.bronze]])))),
      ),

      // Products / categories / hours
      h('section', { class: 'exec-grid g-3' },
        panel('Top products', 'By sales value',
          (cur.top_products || []).length ? rankBars({ items: cur.top_products.slice(0, 8).map(p => ({ label: p.name, value: Number(p.revenue), sub: num(p.quantity) + ' sold · profit ' + money(p.profit) })), fmt: shortMoney }) : empty('No sales yet.')),
        panel('Top categories', 'By sales value',
          (items?.categories || []).length ? rankBars({ items: items.categories.slice(0, 8).map(c => ({ label: c.category, value: Number(c.revenue), sub: 'margin ' + (Number(c.revenue) ? num(Number(c.profit) / Number(c.revenue) * 100, 0) : 0) + '%' })), fmt: shortMoney, color: C.bronze }) : empty('No sales yet.')),
        panel('Busiest hours', peak && peak.total ? `Peak: ${String(peak.hour).padStart(2, '0')}:00 – ${String(peak.hour + 1).padStart(2, '0')}:00` : 'Sales by time of day',
          barChart({ items: open.map(x => ({ label: String(x.hour).padStart(2, '0') + ':00', short: String(x.hour), value: x.total })), fmt: (v, axis) => axis ? short(v) : money(v), highlight: peakIdx, height: 300, width: 400, ariaLabel: 'Sales by hour' }))),

      // Year + stock health
      h('section', { class: 'exec-grid g-2-1' },
        panel('This year, month by month', 'Sales value — current month highlighted',
          barChart({ items: months.map(x => ({ label: monthName(x.m) + ' ' + todayISO().slice(0, 4), short: monthName(x.m), value: x.total })), fmt: (v, axis) => axis ? short(v) : money(v), highlight: thisMonth, height: 240, ariaLabel: 'Sales by month' })),
        panel('Stock health', 'Products available to customers',
          h('div', { class: 'rings' }, ring(inStockPct, 'In stock', C.navy), ring(healthyPct, 'Healthy stock', C.orange)),
          h('ul', { class: 'facts' },
            fact('Out of stock', num(sm.out || 0)), fact('Running low', num(sm.low || 0)), fact('Not selling (30 days)', num(sm.dead || 0)),
            fact('Top sellers (class A)', num(sm.abc?.A || 0))))),

      // Impact (donors)
      h('section', { class: 'impact' },
        h('div', { class: 'impact-head' }, h('p', { class: 'eyebrow' }, 'Community impact'), h('h2', null, 'Who this shop serves'),
          h('p', { class: 'muted' }, `${PERIODS.find(p => p[0] === period)[1]} · figures come straight from the till and the accounts.`)),
        h('div', { class: 'impact-grid' },
          impact(num(cur.transactions), 'customer visits served'),
          impact(num(units, 0), 'items put in people\'s hands'),
          impact(num(creditCustomers.length), 'families buying on trusted credit', money(creditOut) + ' extended'),
          impact(num(supplierCount), 'local suppliers paid', money(purchased) + ' of goods bought'),
          activeStaff ? impact(num(activeStaff), 'people employed') : null,
          impact(num(inStockPct, 0) + '%', 'of products on the shelf'))),

      // Live feed
      h('section', { class: 'exec-grid g-1' },
        panel('Latest sales', 'Updates by itself every 30 seconds',
          h('ul', { class: 'feed' }, (recent || []).map(x => h('li', { class: x.status === 'refunded' ? 'refunded' : '' },
            h('span', { class: 'feed-time' }, dateTime(x.created_at)),
            h('span', { class: 'feed-what' }, x.receipt_number + ' · ' + paymentLabel(x.payment_method) + (x.customers?.name ? ' · ' + x.customers.name : '')),
            h('b', null, (x.status === 'refunded' ? 'Refunded ' : '') + money(x.total)))),
            (recent || []).length ? null : h('li', { class: 'muted' }, 'No sales yet.')))),

      h('p', { class: 'exec-foot muted small' }, `${s.business_name || ''} · Executive dashboard · ${date(r.fromISO)} – ${date(r.toISO)} · printed ${dateTime(new Date().toISOString())}`));
  }

  // ----- small building blocks
  function panel(title, sub, ...content) { return h('div', { class: 'panel2' }, h('div', { class: 'panel2-head' }, h('h2', null, title), sub ? h('p', { class: 'muted small' }, sub) : null), ...content); }
  function empty(t) { return h('p', { class: 'muted pad' }, t); }
  function pos(label, value, owe) { return h('div', { class: 'fin-pos' }, h('span', null, label), h('strong', { class: owe && value ? 'neg' : '' }, money(value))); }
  function posBar(parts) {
    const t = parts.reduce((a, p) => a + Math.max(0, p[1]), 0) || 1;
    return h('div', null, h('div', { class: 'stackbar' }, parts.map(([l, v, c]) => h('span', { title: l + ': ' + money(v), style: { width: (Math.max(0, v) / t * 100) + '%', background: c } }))),
      h('div', { class: 'chart-legend' }, parts.map(([l, v, c]) => h('span', null, h('i', { style: { background: c } }), l + ' ' + Math.round(Math.max(0, v) / t * 100) + '%'))));
  }
  function fact(k, v) { return h('li', null, h('span', null, k), h('b', null, v)); }
  function impact(big, text, sub) { return h('div', { class: 'impact-card' }, h('strong', null, big), h('span', null, text), sub ? h('small', null, sub) : null); }

  // ----- live updates: Supabase Realtime when available, plus a 30 s refresh
  try {
    channel = db().channel('exec-sales').on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => {
      load(false); toast('New sale recorded — dashboard updated.');
    }).subscribe();
  } catch { channel = null; }
  timer = setInterval(() => { if (!document.hidden) load(false); }, REFRESH_MS);
  const onVis = () => { if (!document.hidden) load(false); };
  document.addEventListener('visibilitychange', onVis);

  drawPeriods();
  await load(true);

  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('fullscreenchange', onFs);
    document.body.classList.remove('present');
    if (channel) db().removeChannel(channel);
  };
}
