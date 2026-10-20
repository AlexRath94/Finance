import type { CsvMapping, DateStr } from '../types';
import { parseDate, parseMoney } from './format';
import { norm } from './rules';

export interface RawEntry {
  date: DateStr;
  amount: number; // cents, signed
  payee: string;
  purpose: string;
  iban?: string;
  bookingText?: string;
  accountIban?: string;
  /** Sign could not be determined reliably (PDF import). */
  uncertainSign?: boolean;
}

export interface ParseResult {
  format: string;
  entries: RawEntry[];
  skipped: number;
  warnings: string[];
  accountIban?: string;
}

/** Bank CSV exports are often Windows-1252; fall back to it when the bytes are not valid UTF-8. */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 15).join('\n');
  const candidates = [';', ',', '\t', '|'];
  let best = ';';
  let bestScore = -1;
  for (const d of candidates) {
    const counts = sample
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => splitCsvLine(l, d).length);
    if (!counts.length) continue;
    // Prefer delimiters that give many, consistent columns.
    const max = Math.max(...counts);
    const consistent = counts.filter((c) => c === max).length;
    const score = max > 1 ? consistent * max : 0;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function splitCsvLine(line: string, d: string): string[] {
  return parseCsv(line, d)[0] || [];
}

/** RFC4180-ish CSV parser supporting quoted fields with delimiters and newlines. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

const H = {
  date: ['buchungstag', 'buchungsdatum', 'datum', 'date', 'booking date', 'transaktionsdatum', 'wertstellung', 'valutadatum', 'valuta'],
  amount: ['betrag', 'betrag (eur)', 'betrag in eur', 'amount', 'umsatz', 'summe', 'wert'],
  debit: ['soll', 'ausgang', 'zahlungsausgang', 'belastung', 'debit', 'lastschrift'],
  credit: ['haben', 'eingang', 'zahlungseingang', 'gutschrift', 'credit'],
  payee: [
    'beguenstigter/zahlungspflichtiger',
    'name zahlungsbeteiligter',
    'zahlungsempfaenger',
    'empfaenger',
    'auftraggeber/empfaenger',
    'auftraggeber',
    'gegenpartei',
    'payee',
    'counterparty',
    'name',
  ],
  purpose: ['verwendungszweck', 'buchungsdetails', 'beschreibung', 'description', 'purpose', 'text', 'details', 'notiz'],
  iban: ['kontonummer/iban', 'iban zahlungsbeteiligter', 'iban', 'kontonummer'],
  bookingText: ['buchungstext', 'umsatzart', 'transaktionstyp', 'typ', 'type', 'art'],
  accountIban: ['auftragskonto', 'eigene iban', 'konto'],
};

function pick(headers: string[], cands: string[], used: Set<number>): number | undefined {
  const hs = headers.map(norm);
  for (const c of cands) {
    const i = hs.findIndex((h, idx) => !used.has(idx) && h === c);
    if (i > -1) return i;
  }
  for (const c of cands) {
    const i = hs.findIndex((h, idx) => !used.has(idx) && h.includes(c));
    if (i > -1) return i;
  }
  return undefined;
}

export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const hs = rows[i].map(norm);
    const hasDate = hs.some((h) => H.date.some((c) => h.includes(c)));
    const hasAmount = hs.some((h) => [...H.amount, ...H.debit, ...H.credit].some((c) => h.includes(c)));
    if (hasDate && hasAmount && rows[i].length >= 3) return i;
  }
  return 0;
}

export const headerSignature = (headers: string[]) => headers.map(norm).join('|');

export function guessMapping(headers: string[], delimiter: string): CsvMapping {
  const used = new Set<number>();
  const take = (cands: string[]) => {
    const i = pick(headers, cands, used);
    if (i !== undefined) used.add(i);
    return i;
  };
  const accountIbanCol = take(H.accountIban.slice(0, 2));
  const dateCol = take(H.date) ?? 0;
  // Sparkasse exports have a "Valutadatum" next to "Buchungstag"; keep it from being picked as anything else.
  const valuta = pick(headers, ['valutadatum', 'wertstellung'], used);
  if (valuta !== undefined) used.add(valuta);
  const ibanCol = take(H.iban);
  const bookingTextCol = take(H.bookingText);
  const purposeCol = take(H.purpose);
  const amountCol = take(H.amount);
  let debitCol: number | undefined;
  let creditCol: number | undefined;
  if (amountCol === undefined) {
    debitCol = take(H.debit);
    creditCol = take(H.credit);
  }
  const payeeCol = take(H.payee);
  return {
    signature: headerSignature(headers),
    delimiter,
    dateCol,
    amountCol: amountCol ?? -1,
    debitCol,
    creditCol,
    payeeCol,
    purposeCol,
    ibanCol,
    bookingTextCol,
    accountIbanCol,
  };
}

export function rowsToEntries(rows: string[][], headerRow: number, m: CsvMapping): ParseResult {
  const entries: RawEntry[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  const headers = rows[headerRow] || [];
  const infoCol = headers.map(norm).findIndex((h) => h === 'info' || h === 'status');
  let pending = 0;
  const cell = (r: string[], i?: number) => (i === undefined || i < 0 ? '' : (r[i] || '').trim());
  for (const r of rows.slice(headerRow + 1)) {
    if (infoCol > -1 && /vorgemerkt|pending|ausstehend/i.test(r[infoCol] || '')) {
      pending++;
      continue;
    }
    const date = parseDate(cell(r, m.dateCol));
    let amount: number | null = null;
    if (m.amountCol > -1) amount = parseMoney(cell(r, m.amountCol));
    else {
      const debit = parseMoney(cell(r, m.debitCol));
      const credit = parseMoney(cell(r, m.creditCol));
      if (debit) amount = -Math.abs(debit);
      else if (credit) amount = Math.abs(credit);
      else if (debit === 0 || credit === 0) amount = 0;
    }
    if (!date || amount === null) {
      skipped++;
      continue;
    }
    entries.push({
      date,
      amount,
      payee: cell(r, m.payeeCol),
      purpose: cleanPurpose(cell(r, m.purposeCol)),
      iban: cell(r, m.ibanCol) || undefined,
      bookingText: cell(r, m.bookingTextCol) || undefined,
      accountIban: cell(r, m.accountIbanCol) || undefined,
    });
  }
  if (pending) warnings.push(`${pending} vorgemerkte (noch nicht gebuchte) Umsätze wurden übersprungen.`);
  const accountIban = entries.find((e) => e.accountIban)?.accountIban;
  return { format: 'CSV', entries, skipped, warnings, accountIban };
}

/** Removes SEPA field tags (EREF+, SVWZ+, …) and keeps the readable remittance text. */
export function cleanPurpose(s: string): string {
  if (!s) return '';
  const svwz = s.match(/SVWZ\+(.*?)(?=\s?(?:EREF|KREF|MREF|CRED|DEBT|ABWA|ABWE|IBAN|BIC)\+|$)/);
  const text = svwz ? svwz[1] : s.replace(/\b(EREF|KREF|MREF|CRED|DEBT|ABWA|ABWE)\+\S*/g, '');
  return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- MT940

export function parseMt940(text: string): ParseResult {
  const lines = text.replace(/\r/g, '').split('\n');
  // Join continuation lines to their field.
  const fields: { tag: string; value: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (m) fields.push({ tag: m[1], value: m[2] });
    else if (fields.length && line.trim() && line.trim() !== '-') fields[fields.length - 1].value += '\n' + line;
  }
  const entries: RawEntry[] = [];
  let accountIban: string | undefined;
  let skipped = 0;
  let current: RawEntry | null = null;
  for (const f of fields) {
    if (f.tag === '25') {
      const v = f.value.trim();
      if (/^[A-Z]{2}\d{2}/.test(v)) accountIban = v.split('/')[0];
    } else if (f.tag === '61') {
      if (current) entries.push(current);
      current = null;
      const m = f.value.match(/^(\d{2})(\d{2})(\d{2})(\d{4})?(R?[CD])[A-Z]?(\d+,\d*)/);
      if (!m) {
        skipped++;
        continue;
      }
      const date = `20${m[1]}-${m[2]}-${m[3]}`;
      const value = parseMoney(m[6]) || 0;
      const negative = m[5] === 'D' || m[5] === 'RC';
      current = { date, amount: negative ? -value : value, payee: '', purpose: '' };
    } else if (f.tag === '86' && current) {
      Object.assign(current, parse86(f.value));
    }
  }
  if (current) entries.push(current);
  return { format: 'MT940', entries, skipped, warnings: [], accountIban };
}

function parse86(raw: string): Partial<RawEntry> {
  const v = raw.replace(/\n/g, '');
  if (!v.includes('?')) return { purpose: cleanPurpose(v) };
  const parts = v.split('?').slice(1);
  let purpose = '';
  let payee = '';
  let iban = '';
  let bookingText = '';
  for (const p of parts) {
    const code = p.slice(0, 2);
    const val = p.slice(2);
    const n = Number(code);
    if (code === '00') bookingText = val;
    else if ((n >= 20 && n <= 29) || (n >= 60 && n <= 63)) purpose += val;
    else if (code === '31') iban = val;
    else if (code === '32' || code === '33') payee += val;
  }
  return { purpose: cleanPurpose(purpose), payee: payee.trim(), iban: iban || undefined, bookingText };
}

// ---------------------------------------------------------------- CAMT (XML)

export function parseCamt(xml: string): ParseResult {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const q = (el: Element | Document, path: string): Element | undefined => {
    let cur: Element | Document | undefined = el;
    for (const name of path.split('>')) {
      if (!cur) return undefined;
      cur = Array.from((cur as Element).getElementsByTagNameNS('*', name))[0];
    }
    return cur as Element | undefined;
  };
  const txt = (el: Element | Document | undefined, path: string) => (el ? q(el, path)?.textContent?.trim() || '' : '');
  const accountIban = txt(doc, 'Acct>Id>IBAN') || undefined;
  const entries: RawEntry[] = [];
  let skipped = 0;
  let pending = 0;
  for (const n of Array.from(doc.getElementsByTagNameNS('*', 'Ntry'))) {
    const status = txt(n, 'Sts');
    if (/PDNG/i.test(status)) {
      pending++;
      continue;
    }
    const value = parseMoney(txt(n, 'Amt'));
    const dateRaw = txt(n, 'BookgDt>Dt') || txt(n, 'BookgDt>DtTm') || txt(n, 'ValDt>Dt');
    const date = parseDate(dateRaw);
    if (value === null || !date) {
      skipped++;
      continue;
    }
    const debit = txt(n, 'CdtDbtInd') === 'DBIT';
    const party = debit ? 'Cdtr' : 'Dbtr';
    const ustrd = Array.from(n.getElementsByTagNameNS('*', 'Ustrd'))
      .map((e) => e.textContent?.trim())
      .join(' ');
    entries.push({
      date,
      amount: debit ? -Math.abs(value) : Math.abs(value),
      payee: txt(n, `RltdPties>${party}>Nm`) || txt(n, `RltdPties>${party}>Pty>Nm`),
      purpose: cleanPurpose(ustrd || txt(n, 'AddtlNtryInf')),
      iban: txt(n, `RltdPties>${party}Acct>Id>IBAN`) || undefined,
      bookingText: txt(n, 'AddtlNtryInf') || undefined,
    });
  }
  const warnings = pending ? [`${pending} vorgemerkte Umsätze wurden übersprungen.`] : [];
  return { format: 'CAMT (XML)', entries, skipped, warnings, accountIban };
}

// ---------------------------------------------------------------- dedupe

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Stable reference per booking. Identical bookings on the same day (e.g. two coffees)
 * are told apart by their occurrence index within the file.
 */
export function makeImportRefs(accountId: string, entries: RawEntry[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((e) => {
    const base = `${accountId}|${e.date}|${e.amount}|${norm(e.payee)}|${norm(e.purpose).slice(0, 60)}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return fnv1a(`${base}|${n}`);
  });
}
