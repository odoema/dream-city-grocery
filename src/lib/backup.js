// One-file backup of the shop's records, downloaded to this computer.
// The free database plan has no point-in-time restore, so keep a copy off-site.
import { db } from './supabase.js';
import { state } from './state.js';

const TABLES = ['store_settings', 'accounts', 'categories', 'suppliers', 'customers', 'products', 'sales', 'sale_items', 'sale_returns',
  'customer_payments', 'expenses', 'money_movements', 'cash_ups', 'supplier_invoices', 'supplier_invoice_items', 'supplier_payments',
  'inventory_movements', 'journals', 'journal_lines'];
const KEY = 'backup.lastAt';

export function lastBackupAt() { try { return localStorage.getItem(KEY); } catch { return null; } }
export function backupDue() {
  const at = lastBackupAt();
  return !at || Date.now() - Date.parse(at) > 24 * 3600 * 1000;
}

export async function downloadBackup(onProgress = () => {}) {
  const out = { app: 'grocery-pos', created_at: new Date().toISOString(), shop: state.settings?.business_name || '', tables: {}, skipped: {} };
  for (const [i, t] of TABLES.entries()) {
    onProgress(`${i + 1}/${TABLES.length} ${t.replace(/_/g, ' ')}`);
    const rows = [];
    try {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db().from(t).select('*').order('id').range(from, from + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      out.tables[t] = rows;
    } catch (e) { out.skipped[t] = e.message || String(e); }
  }
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `backup-${(state.settings?.receipt_prefix || 'shop').toLowerCase()}-${out.created_at.slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  try { localStorage.setItem(KEY, out.created_at); } catch { /* ignore */ }
  return { tables: Object.keys(out.tables).length, rows: Object.values(out.tables).reduce((n, r) => n + r.length, 0), skipped: Object.keys(out.skipped) };
}
