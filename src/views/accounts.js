import { h, clear, table, downloadCsv } from '../lib/dom.js';
import { printDocument, esc } from '../lib/documents.js';
import { db, rpc, run } from '../lib/supabase.js';
import { money, date, dateTime, paymentLabel, todayISO } from '../lib/format.js';
import { pageHeader, card, toast, showError, stat, loading, formModal, tabs } from '../lib/ui.js';
import { periodPicker } from '../lib/period.js';

export async function render(root) {
  let tab = 'summary';
  const tabHost = h('div');
  const host = h('div');
  const picker = periodPicker(() => show(tab), 'month');
  clear(root, pageHeader('Accounts', 'Profit, what the shop owns and owes, and expenses. Built automatically from every sale, purchase and count.',
    picker.el, h('button', { class: 'primary', onclick: recordExpense }, '+ Record expense')), tabHost, host);

  async function show(next) {
    tab = next;
    clear(tabHost, tabs([['summary', 'Profit & balance sheet'], ['expenses', 'Expenses'], ['owner', 'Owner money'], ['ledger', 'Journal']], tab, show));
    loading(host);
    const p = picker.get();
    try {
      if (tab === 'summary') await summary(p);
      else if (tab === 'expenses') await expenses(p);
      else if (tab === 'owner') await ownerMoney(p);
      else await ledger(p);
    } catch (e) { showError(e); clear(host, h('p', { class: 'muted' }, e.message)); }
  }

  async function summary(p) {
    const fs = await rpc('get_financial_statements', { p_from: p.from, p_to: p.to });
    const pl = fs.profit_and_loss;
    const bs = fs.balance_sheet;
    const tb = fs.trial_balance || [];
    const tbD = tb.reduce((s, r) => s + Number(r.debit), 0);
    const tbC = tb.reduce((s, r) => s + Number(r.credit), 0);
    const balanced = Math.abs(Number(bs.total_assets) - Number(bs.total_liabilities_equity)) < 0.01;
    clear(host,
      h('div', { class: 'stats' },
        stat('Net sales', money(pl.net_revenue), p.label),
        stat('Gross profit', money(pl.gross_profit)),
        stat('Expenses', money(pl.operating_expenses)),
        stat('Net profit', money(pl.net_profit), null, Number(pl.net_profit) < 0 ? 'bad' : 'ok')),
      h('div', { class: 'grid-2' },
        card('Profit & loss · ' + p.label, statement([
          ['Sales', pl.revenue], ['Less discounts & returns', -pl.discounts_returns], ['Net sales', pl.net_revenue, true],
          ['Cost of goods sold', -pl.cost_of_goods], ['Gross profit', pl.gross_profit, true],
          ['Operating expenses (incl. stock losses)', -pl.operating_expenses], ['Net profit', pl.net_profit, true]
        ]), table([
          { label: 'Account', value: r => r.code + ' · ' + r.name },
          { label: 'Amount', class: 'num', value: r => money(r.amount) }
        ], pl.lines || [], { empty: 'No income or expenses in this period.' })),
        card('Balance sheet · at ' + date(p.toISO), statement([
          ...bs.assets.map(a => [a.name, a.amount]), ['Total assets', bs.total_assets, true],
          ...bs.liabilities.map(a => [a.name, a.amount]),
          ...bs.equity.map(a => [a.name, a.amount]),
          ['Profit kept in the business (to date)', bs.retained_earnings],
          ['Total liabilities & equity', bs.total_liabilities_equity, true]
        ]), h('p', { class: balanced ? 'ok small' : 'bad small' }, balanced ? '✓ Balances' : '⚠ Does not balance — contact support'))),
      card(h('div', { class: 'row between' }, h('h2', null, 'Trial balance · at ' + date(p.toISO)),
        h('button', { class: 'secondary small', onclick: () => downloadCsv('trial-balance-' + p.toISO + '.csv', [['Code', 'Account', 'Debit', 'Credit'], ...tb.map(r => [r.code, r.name, r.debit, r.credit])]) }, 'Export CSV')),
      table([
        { label: 'Code', value: r => r.code },
        { label: 'Account', value: r => r.name },
        { label: 'Debit', class: 'num', value: r => Number(r.debit) ? money(r.debit) : '' },
        { label: 'Credit', class: 'num', value: r => Number(r.credit) ? money(r.credit) : '' }
      ], tb, { empty: 'Nothing posted yet.' }),
      h('div', { class: 'row end strong' }, 'Totals: ', money(tbD), ' / ', money(tbC))),
      h('div', { class: 'row end' }, h('button', { class: 'primary', onclick: () => printStatements(p, pl, bs, tb, tbD, tbC) }, 'Print financial statements')));
  }

  function printStatements(p, pl, bs, tb, tbD, tbC) {
    const rows = lines => '<table class="lines"><tbody>' + lines.map(([k, v, strong]) => `<tr${strong ? ' style="font-weight:bold"' : ''}><td>${esc(k)}</td><td class="r${Number(v) < 0 ? ' neg' : ''}">${esc(money(v))}</td></tr>`).join('') + '</tbody></table>';
    printDocument({
      title: 'Financial statements', number: p.label, date: 'Period ' + date(p.fromISO) + ' – ' + date(p.toISO),
      sections: [
        { heading: 'Profit & loss', html: rows([
          ['Sales', pl.revenue], ['Less discounts & returns', -pl.discounts_returns], ['Net sales', pl.net_revenue, true],
          ['Cost of goods sold', -pl.cost_of_goods], ['Gross profit', pl.gross_profit, true],
          ['Operating expenses (incl. stock losses)', -pl.operating_expenses], ['Net profit', pl.net_profit, true]]) },
        { heading: 'Balance sheet at ' + date(p.toISO), html: rows([
          ...bs.assets.map(a => [a.name, a.amount]), ['Total assets', bs.total_assets, true],
          ...bs.liabilities.map(a => [a.name, a.amount]), ...bs.equity.map(a => [a.name, a.amount]),
          ['Profit kept in the business (to date)', bs.retained_earnings], ['Total liabilities & equity', bs.total_liabilities_equity, true]]) },
        { heading: 'Trial balance at ' + date(p.toISO), html: '<table class="lines"><thead><tr><th>Code</th><th>Account</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead><tbody>' +
          tb.map(r => `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td class="r">${Number(r.debit) ? esc(money(r.debit)) : ''}</td><td class="r">${Number(r.credit) ? esc(money(r.credit)) : ''}</td></tr>`).join('') +
          `<tr style="font-weight:bold"><td></td><td>Totals</td><td class="r">${esc(money(tbD))}</td><td class="r">${esc(money(tbC))}</td></tr></tbody></table>` }
      ],
      signatures: ['Prepared by (accountant)', 'Approved by (owner)']
    });
  }

  function statement(lines) {
    return h('dl', { class: 'statement' }, lines.map(([label, value, strong]) => [
      h('dt', { class: strong ? 'strong' : '' }, label), h('dd', { class: (strong ? 'strong ' : '') + (Number(value) < 0 ? 'neg' : '') }, money(value))]));
  }

  async function expenses(p) {
    const rows = await run(db().from('expenses').select('expense_number,expense_date,category,description,amount,payment_method,reference').gte('expense_date', p.fromISO).lte('expense_date', p.toISO).order('expense_date', { ascending: false }).limit(1000));
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    clear(host, card(h('div', { class: 'row between' }, h('h2', null, 'Expenses · ' + money(total)),
      h('button', { class: 'secondary small', onclick: () => downloadCsv('expenses.csv', [['Number', 'Date', 'Category', 'Description', 'Amount', 'Paid by', 'Reference'], ...rows.map(r => [r.expense_number, r.expense_date, r.category, r.description, r.amount, r.payment_method, r.reference])]) }, 'Export CSV')),
    table([
      { label: 'Date', value: r => date(r.expense_date) },
      { label: 'Number', value: r => r.expense_number },
      { label: 'Category', value: r => r.category },
      { label: 'What for', value: r => r.description },
      { label: 'Paid by', value: r => paymentLabel(r.payment_method) },
      { label: 'Amount', class: 'num', value: r => money(r.amount) },
      { label: '', class: 'actions', value: r => h('button', { class: 'link', onclick: () => printVoucher(r) }, 'Print') }
    ], rows, { empty: 'No expenses recorded in this period.' })));
  }

  async function ledger(p) {
    const rows = await run(db().from('journals').select('id,journal_date,source_type,memo,journal_lines(debit,credit,description,accounts(code,name))').gte('journal_date', p.from).lt('journal_date', p.to).order('journal_date', { ascending: false }).limit(300));
    clear(host, card('Journal entries · ' + p.label, h('p', { class: 'muted' }, 'Every entry is created by the system from a real transaction. Entries are never edited — mistakes are corrected with a reversal.'),
      rows.length ? rows.map(j => h('details', { class: 'journal' },
        h('summary', null, h('span', null, dateTime(j.journal_date)), h('b', null, j.memo), h('span', { class: 'muted' }, j.source_type.replace(/_/g, ' '))),
        table([
          { label: 'Account', value: l => l.accounts ? l.accounts.code + ' · ' + l.accounts.name : '' },
          { label: 'Detail', value: l => l.description },
          { label: 'Debit', class: 'num', value: l => Number(l.debit) ? money(l.debit) : '' },
          { label: 'Credit', class: 'num', value: l => Number(l.credit) ? money(l.credit) : '' }
        ], j.journal_lines || []))) : h('p', { class: 'muted' }, 'No entries in this period.')));
  }

  async function ownerMoney(p) {
    const rows = await run(db().from('money_movements').select('*').gte('created_at', p.from).lt('created_at', p.to).order('created_at', { ascending: false }));
    const KIND = { capital: 'Capital put in', drawing: 'Taken out by owner', transfer: 'Transfer' };
    const sum = k => rows.filter(r => r.kind === k).reduce((a, r) => a + Number(r.amount), 0);
    clear(host,
      h('div', { class: 'stats' }, stat('Capital put in', money(sum('capital')), p.label), stat('Taken out by owner', money(sum('drawing'))), stat('Transfers', money(sum('transfer')))),
      card(h('div', { class: 'row between' }, h('h2', null, 'Owner money · ' + p.label),
        h('div', { class: 'row' },
          h('button', { class: 'secondary small', onclick: () => moneyForm('capital') }, '+ Capital in'),
          h('button', { class: 'secondary small', onclick: () => moneyForm('drawing') }, '− Owner takes out'),
          h('button', { class: 'primary small', onclick: () => moneyForm('transfer') }, '⇄ Transfer (e.g. cash to bank)'))),
        h('p', { class: 'muted small' }, 'Money that is not a sale or an expense: the owner putting money in or taking it out, and moving money between the drawer, mobile money and the bank.'),
        table([
          { label: 'When', value: r => dateTime(r.created_at) },
          { label: 'Number', value: r => r.movement_number },
          { label: 'What', value: r => KIND[r.kind] },
          { label: 'From', value: r => r.from_method ? paymentLabel(r.from_method) : 'Owner' },
          { label: 'To', value: r => r.to_method ? paymentLabel(r.to_method) : 'Owner' },
          { label: 'Note', value: r => r.note },
          { label: 'Amount', class: 'num', value: r => money(r.amount) }
        ], rows, { empty: 'Nothing in this period.' })));
  }

  function moneyForm(kind) {
    const methods = ['cash', 'mobile_money', 'bank', 'card'].map(m => ({ value: m, label: paymentLabel(m) }));
    const title = { capital: 'Owner puts money in', drawing: 'Owner takes money out', transfer: 'Move money' }[kind];
    formModal({
      title, subtitle: kind === 'transfer' ? 'For example: cash from the drawer banked, or mobile money withdrawn to cash.' : 'Recorded against the owner, not as a sale or an expense.',
      fields: [
        { name: 'amount', label: 'Amount', type: 'number', min: '0', step: 'any', required: true },
        kind !== 'capital' ? { name: 'from', label: 'From', type: 'select', value: 'cash', options: methods } : null,
        kind !== 'drawing' ? { name: 'to', label: kind === 'capital' ? 'Into' : 'To', type: 'select', value: kind === 'transfer' ? 'bank' : 'cash', options: methods } : null,
        { name: 'note', label: 'Note', full: true }
      ].filter(Boolean),
      onSubmit: async v => {
        const r = await rpc('record_money_movement', { p_kind: kind, p_amount: v.amount, p_from: v.from || null, p_to: v.to || null, p_note: v.note || '' });
        toast(r.movement_number + ' recorded.');
        show(tab);
      }
    });
  }

  function printVoucher(r) {
    printDocument({
      title: 'Payment voucher', number: r.expense_number, date: date(r.expense_date), stamp: 'Paid',
      boxes: [{ heading: 'Expense', rows: [['Category', r.category], ['Paid by', paymentLabel(r.payment_method)], ['Reference', r.reference || '']] },
              { heading: 'Accounting', rows: [['Debit', '6000 Operating expenses'], ['Credit', paymentLabel(r.payment_method) + ' account']] }],
      columns: [{ label: 'Description' }, { label: 'Amount', right: true }],
      rows: [[r.description, money(r.amount)]],
      totals: [['Total paid', money(r.amount), 'grand']],
      signatures: ['Paid by', 'Received by', 'Approved by']
    });
  }

  function recordExpense() {
    formModal({
      title: 'Record an expense', subtitle: 'Money paid out for running the shop (transport, rent, electricity, wages…). Not for stock — use Buy for goods.',
      fields: [
        { name: 'description', label: 'What was it for?', required: true, full: true },
        { name: 'category', label: 'Category', type: 'select', value: 'Transport', options: ['Transport', 'Rent', 'Electricity & water', 'Wages', 'Airtime & internet', 'Repairs', 'Packaging', 'Cleaning', 'Taxes & licences', 'Other'].map(v => ({ value: v, label: v })) },
        { name: 'amount', label: 'Amount', type: 'number', min: '0', step: 'any', required: true },
        { name: 'method', label: 'Paid with', type: 'select', value: 'cash', options: ['cash', 'mobile_money', 'bank', 'card'].map(m => ({ value: m, label: paymentLabel(m) })) },
        { name: 'date', label: 'Date', type: 'date', value: todayISO() },
        { name: 'reference', label: 'Receipt / reference', full: true }
      ],
      onSubmit: async v => {
        const r = await rpc('record_expense', { p_description: v.description, p_amount: v.amount, p_payment_method: v.method, p_category: v.category, p_expense_date: v.date || null, p_reference: v.reference || '' });
        toast('Expense ' + r.expense_number + ' recorded.');
        show(tab);
      }
    });
  }

  await show('summary');
}
