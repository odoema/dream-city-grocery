import { state } from './state.js';

function settings() {
  return state.settings || {};
}

export function currencyCode() {
  return settings().currency_code || 'UGX';
}

export function locale() {
  return settings().locale || 'en-UG';
}

export function timezone() {
  return settings().timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

const moneyCache = new Map();
export function money(value) {
  const dec = Number.isInteger(settings().currency_decimals) ? settings().currency_decimals : 0;
  const key = locale() + currencyCode() + dec;
  let f = moneyCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale(), { style: 'currency', currency: currencyCode(), currencyDisplay: 'code', minimumFractionDigits: dec, maximumFractionDigits: dec });
    } catch {
      f = new Intl.NumberFormat('en', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    }
    moneyCache.set(key, f);
  }
  const n = Number(value || 0);
  return f.format(Number.isFinite(n) ? n : 0);
}

export function num(value, maxDecimals = 3) {
  const n = Number(value || 0);
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: maxDecimals }).format(Number.isFinite(n) ? n : 0);
}

export function dateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale(), { timeZone: timezone(), dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function date(value) {
  if (!value) return '—';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T12:00:00Z') : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale(), { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? 'UTC' : timezone(), dateStyle: 'medium' }).format(d);
}

export function time(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale(), { timeZone: timezone(), timeStyle: 'short' }).format(d);
}

// Today's YYYY-MM-DD in the shop's time zone.
export function todayISO() {
  return localDateISO(new Date());
}

export function localDateISO(d) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Convert a wall-clock time in a time zone to a UTC Date.
export function zonedToUtc(year, month, day, hour = 0, minute = 0, second = 0, tz = timezone()) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = tzOffsetMs(new Date(guess), tz);
  let result = guess - offset;
  // Second pass handles DST boundaries.
  const offset2 = tzOffsetMs(new Date(result), tz);
  if (offset2 !== offset) result = guess - offset2;
  return new Date(result);
}

function tzOffsetMs(d, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(d);
  const get = t => Number(parts.find(p => p.type === t).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

// Start (inclusive) and end (exclusive) UTC instants for a local date range.
export function rangeFor(fromISO, toISO) {
  const [fy, fm, fd] = fromISO.split('-').map(Number);
  const [ty, tm, td] = toISO.split('-').map(Number);
  const from = zonedToUtc(fy, fm, fd);
  const end = zonedToUtc(ty, tm, td);
  end.setTime(end.getTime() + 24 * 3600 * 1000);
  return { from: from.toISOString(), to: end.toISOString() };
}

export function addDaysISO(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function paymentLabel(method) {
  return { cash: 'Cash', mobile_money: 'Mobile money', card: 'Card', bank: 'Bank', credit: 'Credit (pay later)' }[method] || String(method || '');
}

export function parseAmount(value) {
  if (value === null || value === undefined) return NaN;
  const s = String(value).replace(/[\s,]/g, '');
  if (s === '') return NaN;
  return Number(s);
}
