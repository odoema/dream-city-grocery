import { h, clear, table, debounce } from '../lib/dom.js';
import { db, rpc, run } from '../lib/supabase.js';
import { money, num, dateTime } from '../lib/format.js';
import { pageHeader, card, toast, showError, badge, stat, withBusy, confirmDialog, formModal, loading } from '../lib/ui.js';

export async function render(root) {
  const host = h('div');
  clear(root, pageHeader('Count stock', 'Count what is physically on the shelf. The system works out the differences and posts them.'), host);
  await load();

  async function load() {
    loading(host);
    try {
      const [open, history] = await Promise.all([
        run(db().from('stocktake_sessions').select('id,session_number,notes,started_at').eq('status', 'draft').order('started_at', { ascending: false }).limit(1)),
        run(db().from('stocktake_sessions').select('id,session_number,status,started_at,completed_at').order('started_at', { ascending: false }).limit(15))
      ]);
      if (open[0]) await renderSession(open[0]); else renderStart(history);
    } catch (e) { showError(e); clear(host, h('p', { class: 'muted' }, e.message)); }
  }

  function renderStart(history) {
    clear(host,
      card('Start a stock count',
        h('ol', { class: 'steps' },
          h('li', null, h('b', null, 'Receive new goods first'), ' (Buy → Record a purchase), so the system knows about them.'),
          h('li', null, h('b', null, 'Pause selling'), ' while you count. If stock changes during the count you will need to restart.'),
          h('li', null, h('b', null, 'Count every product'), ' — enter 0 when none are on the shelf.'),
          h('li', null, h('b', null, 'Finish & post'), ' to update stock and the books.')),
        h('button', { class: 'primary', onclick: () => formModal({
          title: 'Start counting', fields: [{ name: 'notes', label: 'Note (optional)', value: 'Monthly stock count', full: true }], submitLabel: 'Start',
          onSubmit: async v => { const r = await rpc('start_stocktake', { p_notes: v.notes || '' }); toast(`Count ${r.session_number} started with ${r.product_count} products.`); await load(); }
        }) }, 'Start counting')),
      card('Previous counts', table([
        { label: 'Count', value: s => s.session_number },
        { label: 'Started', value: s => dateTime(s.started_at) },
        { label: 'Finished', value: s => dateTime(s.completed_at) },
        { label: 'Status', value: s => badge(s.status, s.status === 'completed' ? 'ok' : 'muted') }
      ], history, { empty: 'No counts yet.' })));
  }

  async function renderSession(session) {
    const items = await run(db().from('stocktake_items').select('product_id,system_quantity,counted_quantity,unit_cost,products(name,sku,unit,barcode)').eq('session_id', session.id).limit(10000));
    items.sort((a, b) => (a.products?.name || '').localeCompare(b.products?.name || ''));
    let show = 'todo';
    const search = h('input', { class: 'search', type: 'search', placeholder: 'Search or scan…', 'aria-label': 'Search products in this count' });
    const filter = h('select', { 'aria-label': 'Show' }, [['todo', 'Not counted yet'], ['all', 'All products'], ['diff', 'With a difference']].map(([v, l]) => h('option', { value: v }, l)));
    const stats = h('div', { class: 'stats' });
    const listHost = h('div');
    const finishBtn = h('button', { class: 'primary' }, 'Finish & post');

    function summary() {
      const counted = items.filter(i => i.counted_quantity !== null);
      const diffs = counted.filter(i => Number(i.counted_quantity) !== Number(i.system_quantity));
      const value = diffs.reduce((s, i) => s + (Number(i.counted_quantity) - Number(i.system_quantity)) * Number(i.unit_cost), 0);
      clear(stats,
        stat('Counted', counted.length + ' / ' + items.length, null, counted.length === items.length ? 'ok' : ''),
        stat('Differences', String(diffs.length), null, diffs.length ? 'warn' : ''),
        stat('Net value of differences', money(value), value < 0 ? 'Shortage' : value > 0 ? 'Surplus' : 'No change', value < 0 ? 'bad' : ''));
      finishBtn.disabled = counted.length !== items.length;
      finishBtn.textContent = counted.length === items.length ? 'Finish & post' : `Count ${items.length - counted.length} more to finish`;
    }

    function draw() {
      const q = search.value.trim().toLowerCase();
      const rows = items.filter(i => {
        if (show === 'todo' && i.counted_quantity !== null) return false;
        if (show === 'diff' && (i.counted_quantity === null || Number(i.counted_quantity) === Number(i.system_quantity))) return false;
        const p = i.products || {};
        return !q || (p.name + ' ' + p.sku + ' ' + (p.barcode || '')).toLowerCase().includes(q);
      }).slice(0, 300);
      clear(listHost, table([
        { label: 'Product', value: i => h('div', null, h('b', null, i.products?.name), h('small', { class: 'block muted' }, i.products?.sku)) },
        { label: 'System says', class: 'num', value: i => num(i.system_quantity) + ' ' + (i.products?.unit || '') },
        { label: 'Counted', value: i => countInput(i) },
        { label: 'Difference', class: 'num', value: i => i.counted_quantity === null ? '—' : diffText(i) }
      ], rows, { empty: show === 'todo' ? 'Everything is counted. Review the differences, then Finish & post.' : 'No products match.' }));
    }

    function diffText(i) {
      const d = Number(i.counted_quantity) - Number(i.system_quantity);
      return h('span', { class: d < 0 ? 'bad' : d > 0 ? 'ok' : 'muted' }, (d > 0 ? '+' : '') + num(d));
    }

    function countInput(i) {
      const input = h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', class: 'narrow', value: i.counted_quantity ?? '', placeholder: 'Count', 'aria-label': 'Count for ' + (i.products?.name || '') });
      const save = async () => {
        if (input.value === '') return;
        const qty = Number(input.value);
        if (!(qty >= 0)) return toast('Enter 0 or more.', 'error');
        if (Number(i.counted_quantity) === qty && i.counted_quantity !== null) return;
        input.disabled = true;
        try {
          await rpc('record_stocktake_count', { p_session_id: session.id, p_product_id: i.product_id, p_counted_quantity: qty });
          i.counted_quantity = qty;
          input.classList.add('saved');
          summary();
        } catch (e) { showError(e); } finally { input.disabled = false; }
      };
      input.addEventListener('change', save);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); save().then(() => { const all = [...listHost.querySelectorAll('input')]; const next = all[all.indexOf(input) + 1]; next ? next.focus() : draw(); }); }
      });
      return input;
    }

    finishBtn.addEventListener('click', () => withBusy(finishBtn, async () => {
      const diffs = items.filter(i => Number(i.counted_quantity) !== Number(i.system_quantity)).length;
      const ok = await confirmDialog({ title: 'Finish and post this count?', message: `${diffs} product(s) have a difference. Stock will be set to what you counted and the differences posted to the books. This cannot be undone.`, confirmLabel: 'Post count' });
      if (!ok) return;
      try {
        const r = await rpc('finalize_stocktake', { p_session_id: session.id });
        toast(`Posted. Surplus ${money(r.surplus_value)}, shortage ${money(r.shortage_value)}.`);
        await load();
      } catch (e) { showError(e); }
    }));

    search.addEventListener('input', debounce(draw, 150));
    filter.addEventListener('change', () => { show = filter.value; draw(); });

    clear(host,
      h('div', { class: 'notice' }, h('div', null, h('b', null, session.session_number), ' started ', dateTime(session.started_at), '. Type each count and press Enter — it saves straight away.')),
      stats,
      card(h('div', { class: 'toolbar' }, search, filter), listHost),
      h('div', { class: 'row end sticky-actions' },
        h('button', { class: 'secondary', onclick: e => withBusy(e.currentTarget, async () => {
          if (!(await confirmDialog({ title: 'Cancel this count?', message: 'Nothing will change in stock or the books. You can start a fresh count afterwards.', confirmLabel: 'Cancel count', danger: true }))) return;
          try { await rpc('cancel_stocktake', { p_session_id: session.id }); toast('Count cancelled.'); await load(); } catch (err) { showError(err); }
        }) }, 'Cancel count'),
        finishBtn));
    summary();
    draw();
  }
}
