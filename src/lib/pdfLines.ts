import type { ParseResult, RawEntry } from './importers';
import { parseMoney } from './format';
import { norm } from './rules';

export interface PdfToken {
  text: string;
  x: number;
  right: number;
}
export interface PdfLine {
  page: number;
  tokens: PdfToken[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mae: 3, mar: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12,
};

const AMOUNT = /^([+-]?)\s?(\d{1,3}(?:[.\s]\d{3})*,\d{2})\s?(?:€|EUR)?\s?([+-]|S|H)?$/;
const OPENING = /alter kontostand|anfangssaldo|saldo alt|uebertrag|eroeffnungssaldo|kontostand am|saldo vortrag|vortrag/;
const STOP = /seite \d|neuer kontostand|kontostand|endsaldo|saldo neu|uebertrag|auszug|rechnungsabschluss|iban:|bic:|blz|sparkasse .*\d{5}|www\.|telefon|datum.*(beschreibung|erlaeuterung|vorgang)/;
const BOOKING_TYPES =
  /^(lastschrift|folgelastschrift|erstlastschrift|kartenzahlung|kartentransaktion|karte|ueberweisung|überweisung|echtzeitueberweisung|echtzeitüberweisung|gutschrift|dauerauftrag|lohn\/gehalt|gehalt|zinsen|entgelt|abschluss|bargeldauszahlung|auszahlung|einzahlung|sparplan|handel|zinszahlung|praemie|prämie)\b[^\s]*/i;

function lineText(l: PdfLine) {
  return l.tokens.map((t) => t.text).join(' ');
}

function parseLeadingDate(text: string, year: number): { date: string; length: number } | null {
  let m = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?/);
  if (m) {
    let y = m[3] ? +m[3] : year;
    if (y < 100) y += 2000;
    if (+m[2] < 1 || +m[2] > 12 || +m[1] < 1 || +m[1] > 31) return null;
    return { date: `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, length: m[0].length };
  }
  m = text.match(/^(\d{1,2})\.?\s+([A-Za-zÄäÖöÜü]{3,9})\.?(?:\s+(\d{4}))?/);
  if (m) {
    const mon = MONTHS[norm(m[2]).slice(0, 3)];
    if (!mon) return null;
    const y = m[3] ? +m[3] : year;
    return { date: `${y}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}`, length: m[0].length };
  }
  return null;
}

function detectYear(lines: PdfLine[]): number {
  const counts = new Map<number, number>();
  for (const l of lines) {
    for (const m of lineText(l).matchAll(/\b\d{1,2}\.\d{1,2}\.(20\d{2})\b|\b(20\d{2})\b/g)) {
      const y = +(m[1] || m[2]);
      counts.set(y, (counts.get(y) || 0) + (m[1] ? 3 : 1));
    }
  }
  let best = new Date().getFullYear();
  let max = 0;
  for (const [y, c] of counts) if (c > max) [best, max] = [y, c];
  return best;
}

interface Columns {
  inX?: number;
  outX?: number;
  balanceX?: number;
}

function detectColumns(lines: PdfLine[]): Columns {
  for (const l of lines) {
    const t = norm(lineText(l));
    const hasIn = /eingang|haben|gutschrift/.test(t);
    const hasOut = /ausgang|soll|belastung/.test(t);
    if (!(hasIn && hasOut)) continue;
    const center = (re: RegExp) => {
      const tok = l.tokens.find((k) => re.test(norm(k.text)));
      return tok ? (tok.x + tok.right) / 2 : undefined;
    };
    return {
      inX: center(/eingang|haben|gutschrift/),
      outX: center(/ausgang|soll|belastung/),
      balanceX: center(/saldo|kontostand/),
    };
  }
  return {};
}

function amountTokens(l: PdfLine) {
  const res: { tok: PdfToken; value: number; sign: 1 | -1 | 0 }[] = [];
  l.tokens.forEach((tok, i) => {
    let text = tok.text;
    // "12,34" followed by a separate "€" or "-" token
    const next = l.tokens[i + 1]?.text;
    if (next && /^[-+SH]$/.test(next)) text += next;
    const m = text.match(AMOUNT);
    if (!m) return;
    const value = Math.abs(parseMoney(m[2]) || 0);
    let sign: 1 | -1 | 0 = 0;
    if (m[1] === '-' || m[3] === '-' || m[3] === 'S') sign = -1;
    else if (m[1] === '+' || m[3] === '+' || m[3] === 'H') sign = 1;
    res.push({ tok, value, sign });
  });
  return res;
}

export function parseStatementLines(lines: PdfLine[]): Omit<ParseResult, 'format'> {
  const year = detectYear(lines);
  const cols = detectColumns(lines);
  const entries: RawEntry[] = [];
  const extra: string[][] = [];
  let prevBalance: number | null = null;
  let uncertain = 0;
  let current = -1;

  for (const l of lines) {
    const text = lineText(l);
    const n = norm(text);
    const amounts = amountTokens(l);
    if (OPENING.test(n) && amounts.length) {
      const a = amounts[amounts.length - 1];
      prevBalance = a.value * (a.sign || 1);
      current = -1;
      continue;
    }
    const lead = parseLeadingDate(text, year);
    if (lead && amounts.length) {
      let picked = amounts[0];
      let sign: 1 | -1 | 0 = 0;
      let balance: number | null = null;
      if (cols.inX !== undefined && cols.outX !== undefined) {
        const candidates = amounts.filter((a) => {
          const c = (a.tok.x + a.tok.right) / 2;
          if (cols.balanceX === undefined) return true;
          const dB = Math.abs(c - cols.balanceX);
          return dB > Math.min(Math.abs(c - cols.inX!), Math.abs(c - cols.outX!));
        });
        const bal = amounts.find((a) => !candidates.includes(a));
        if (bal) balance = bal.value * (bal.sign || 1);
        if (candidates.length) {
          picked = candidates[0];
          const c = (picked.tok.x + picked.tok.right) / 2;
          sign = Math.abs(c - cols.inX) < Math.abs(c - cols.outX) ? 1 : -1;
        }
      }
      if (!sign && picked.sign) sign = picked.sign;
      if (amounts.length >= 2 && balance === null) {
        const last = amounts[amounts.length - 1];
        if (last !== picked) balance = last.value * (last.sign || 1);
      }
      if (!sign && balance !== null && prevBalance !== null) {
        const diff = balance - prevBalance;
        if (Math.abs(Math.abs(diff) - picked.value) <= 1) sign = diff >= 0 ? 1 : -1;
      }
      if (balance !== null) prevBalance = balance;
      const isUncertain = !sign;
      if (isUncertain) uncertain++;
      // Description = text between the date(s) and the first amount.
      const firstAmountIdx = l.tokens.indexOf(amounts[0].tok);
      let desc = l.tokens
        .slice(0, firstAmountIdx)
        .map((t) => t.text)
        .join(' ')
        .slice(lead.length)
        .trim();
      desc = desc.replace(/^(\d{1,2}\.\d{1,2}\.(\d{2,4})?\s*)+/, '').trim();
      const typeMatch = desc.match(BOOKING_TYPES);
      const bookingText = typeMatch ? typeMatch[0] : undefined;
      const rest = typeMatch ? desc.slice(typeMatch[0].length).trim() : desc;
      entries.push({
        date: lead.date,
        amount: picked.value * (sign || -1),
        payee: rest,
        purpose: '',
        bookingText,
        uncertainSign: isUncertain || undefined,
      });
      extra.push([]);
      current = entries.length - 1;
      continue;
    }
    if (current > -1) {
      if (STOP.test(n) || extra[current].length >= 4 || (amounts.length && amounts.length === l.tokens.length)) {
        if (STOP.test(n)) current = -1;
        continue;
      }
      extra[current].push(text.trim());
    }
  }

  entries.forEach((e, i) => {
    const more = extra[i];
    if (!e.payee && more.length) e.payee = more.shift()!;
    e.purpose = more.join(' ').replace(/\s+/g, ' ').trim();
  });

  const warnings = ['PDF-Auslesen ist heuristisch – bitte die Vorschau prüfen.'];
  if (uncertain)
    warnings.push(`${uncertain} Buchung(en) ohne eindeutiges Vorzeichen – als Ausgabe angenommen, in der Vorschau umschaltbar.`);
  if (!entries.length) warnings.push('Keine Buchungszeilen erkannt. CSV-, MT940- oder CAMT-Export der Bank funktioniert zuverlässiger.');
  return { entries, skipped: 0, warnings };
}
