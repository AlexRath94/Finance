import type { Cents, DateStr } from '../types';

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const num = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

export const fmtEur = (c: Cents) => eur.format(c / 100);
export const fmtEurSigned = (c: Cents) => (c > 0 ? '+' : '') + eur.format(c / 100);
export const fmtNum = (n: number, digits = 2) =>
  new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(n);
export const fmtPlain = (n: number) => num.format(n);

export function fmtDate(d: DateStr): string {
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

export function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

export function today(): DateStr {
  const d = new Date();
  return toDateStr(d);
}

export function toDateStr(d: Date): DateStr {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const monthOf = (d: DateStr) => d.slice(0, 7);
export const currentMonth = () => monthOf(today());

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Parses money input in German or English notation into cents.
 * "1.234,56" / "1234,56" / "1,234.56" / "12.5" / "-3" / "12,30 €" / "12,30 S" (Soll = negative).
 */
export function parseMoney(input: string | number | undefined | null): Cents | null {
  if (input === undefined || input === null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  if (/\s[sS]$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  } else if (/\s[hH]$/.test(s)) {
    s = s.slice(0, -1);
  }
  s = s.replace(/[€\s]|EUR/gi, '');
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // "1,234" with exactly three digits after a single comma is ambiguous; German usage wins.
    s = s.replace(/,/g, (_m, i: number) => (i === lastComma ? '.' : ''));
  } else if (lastDot > -1) {
    const dots = s.split('.').length - 1;
    const decimals = s.length - lastDot - 1;
    // "1.234.567" or "1.234" (thousands) vs "12.5"
    if (dots > 1 || (decimals === 3 && /^\d{1,3}(\.\d{3})+$/.test(s))) s = s.replace(/\./g, '');
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const value = Math.round(parseFloat(s) * 100);
  return negative ? -value : value;
}

/** Formats cents for an editable input field ("1234,56"). */
export function centsToInput(c: Cents | undefined): string {
  if (c === undefined || c === null) return '';
  return (c / 100).toFixed(2).replace('.', ',');
}

/** Parses dd.mm.yyyy, dd.mm.yy, yyyy-mm-dd, dd/mm/yyyy into ISO. */
export function parseDate(input: string, fallbackYear?: number): DateStr | null {
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += y > 70 ? 1900 : 2000;
    return iso(y, +m[2], +m[1]);
  }
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (m && fallbackYear) return iso(fallbackYear, +m[2], +m[1]);
  return null;
}

function iso(y: number, m: number, d: number): DateStr | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function maskIban(iban?: string): string {
  if (!iban) return '';
  const clean = iban.replace(/\s/g, '');
  if (clean.length < 8) return clean;
  return `${clean.slice(0, 4)} •••• ${clean.slice(-4)}`;
}

export const normalizeIban = (iban?: string) => (iban || '').replace(/\s/g, '').toUpperCase();

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  return `vor ${d} Tag${d === 1 ? '' : 'en'}`;
}
