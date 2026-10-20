import { describe, expect, it } from 'vitest';
import { parseDate, parseMoney } from './format';
import { detectDelimiter, findHeaderRow, guessMapping, makeImportRefs, parseCsv, parseMt940, rowsToEntries } from './importers';
import { findRule, suggestPattern } from './rules';
import { accountBalances, distribute, potBalances, unassigned } from './calc';
import { parseStatementLines, type PdfLine } from './pdfLines';
import { ruleToTxFields } from './applyRule';
import { emptyData } from '../store';
import type { Rule, Transaction } from '../types';

describe('parseMoney', () => {
  it.each([
    ['1.234,56', 123456],
    ['-12,30', -1230],
    ['12,30 €', 1230],
    ['1,234.56', 123456],
    ['12.5', 1250],
    ['1.000', 100000],
    ['45,00-', -4500],
    ['45,00 S', -4500],
    ['45,00 H', 4500],
    ['abc', null],
    ['', null],
  ])('%s -> %s', (input, expected) => expect(parseMoney(input)).toBe(expected));
});

describe('parseDate', () => {
  it('handles German and ISO formats', () => {
    expect(parseDate('02.01.26')).toBe('2026-01-02');
    expect(parseDate('2.1.2026')).toBe('2026-01-02');
    expect(parseDate('2026-01-02')).toBe('2026-01-02');
    expect(parseDate('02.01.', 2025)).toBe('2025-01-02');
    expect(parseDate('32.01.2026')).toBeNull();
  });
});

// All IBANs in these tests are public example/test IBANs, not real accounts.
const SPARKASSE_CAMT = `"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"
"DE12500105170648489890";"02.01.26";"02.01.26";"FOLGELASTSCHRIFT";"Strom Abschlag Januar";"DE98ZZZ09999999999";"M123";"";"";"";"";"Stadtwerke Musterstadt";"DE02120300000000202051";"BYLADEM1001";"-89,00";"EUR";"Umsatz gebucht"
"DE12500105170648489890";"01.01.26";"01.01.26";"GUTSCHR. UEBERWEISUNG";"Gehalt 01/2026";"";"";"";"";"";"";"Arbeitgeber GmbH";"DE02100500000054540402";"BELADEBEXXX";"3.200,00";"EUR";"Umsatz gebucht"
"DE12500105170648489890";"03.01.26";"03.01.26";"KARTENZAHLUNG";"REWE SAGT DANKE";"";"";"";"";"";"";"REWE Markt GmbH";"";"";"-23,45";"EUR";"Umsatz vorgemerkt"`;

describe('Sparkasse CSV-CAMT', () => {
  const delimiter = detectDelimiter(SPARKASSE_CAMT);
  const rows = parseCsv(SPARKASSE_CAMT, delimiter);
  const header = findHeaderRow(rows);
  const mapping = guessMapping(rows[header], delimiter);

  it('detects columns', () => {
    expect(delimiter).toBe(';');
    expect(header).toBe(0);
    expect(rows[0][mapping.dateCol]).toBe('Buchungstag');
    expect(rows[0][mapping.amountCol]).toBe('Betrag');
    expect(rows[0][mapping.payeeCol!]).toBe('Beguenstigter/Zahlungspflichtiger');
    expect(rows[0][mapping.purposeCol!]).toBe('Verwendungszweck');
    expect(rows[0][mapping.accountIbanCol!]).toBe('Auftragskonto');
  });

  it('parses bookings and skips pending ones', () => {
    const res = rowsToEntries(rows, header, mapping);
    expect(res.entries).toHaveLength(2);
    expect(res.entries[0]).toMatchObject({ date: '2026-01-02', amount: -8900, payee: 'Stadtwerke Musterstadt', purpose: 'Strom Abschlag Januar' });
    expect(res.entries[1].amount).toBe(320000);
    expect(res.accountIban).toBe('DE12500105170648489890');
    expect(res.warnings[0]).toMatch(/vorgemerkt/);
  });

  it('creates stable, distinct import refs', () => {
    const e = { date: '2026-01-02', amount: -350, payee: 'Bäcker', purpose: '' };
    const a = makeImportRefs('acc', [e, e]);
    expect(a[0]).not.toBe(a[1]);
    expect(makeImportRefs('acc', [e, e])).toEqual(a);
  });
});

describe('generic CSV with debit/credit columns', () => {
  it('maps Soll/Haben', () => {
    const text = 'Datum,Empfänger,Beschreibung,Soll,Haben\n05.02.2026,Aral,Tanken,"68,50",\n06.02.2026,Max,Rückzahlung,,"20,00"';
    const d = detectDelimiter(text);
    const rows = parseCsv(text, d);
    const m = guessMapping(rows[0], d);
    const res = rowsToEntries(rows, 0, m);
    expect(res.entries.map((e) => e.amount)).toEqual([-6850, 2000]);
    expect(res.entries[0].payee).toBe('Aral');
  });
});

describe('MT940', () => {
  const text = `:20:STARTUMSE
:25:DE12500105170648489890
:28C:00001/001
:60F:C260101EUR1000,00
:61:2601020102DR89,00NDDTNONREF
:86:105?00FOLGELASTSCHRIFT?20EREF+123?21SVWZ+Strom Abschlag?22 Januar?30BYLADEM1001?31DE02120300000000202051?32Stadtwerke Musterstadt
:61:2601010101CR3200,00NTRFNONREF
:86:166?00GUTSCHR. UEBERWEISUNG?20SVWZ+Gehalt 01/2026?32Arbeitgeber GmbH
:62F:C260102EUR4111,00
-`;
  it('parses entries', () => {
    const res = parseMt940(text);
    expect(res.accountIban).toBe('DE12500105170648489890');
    expect(res.entries).toHaveLength(2);
    expect(res.entries[0]).toMatchObject({ date: '2026-01-02', amount: -8900, payee: 'Stadtwerke Musterstadt', purpose: 'Strom Abschlag Januar' });
    expect(res.entries[1]).toMatchObject({ amount: 320000, payee: 'Arbeitgeber GmbH', purpose: 'Gehalt 01/2026' });
  });
});

describe('rules', () => {
  const rule: Rule = { id: 'r', field: 'payee', pattern: 'rewe|edeka', sign: 'out', action: { type: 'pot', potId: 'p', subitemIds: [] }, hits: 0, enabled: true, createdAt: 0 };
  it('matches case-insensitive alternatives and respects sign', () => {
    expect(findRule([rule], { payee: 'REWE Markt GmbH', amount: -100 })).toBe(rule);
    expect(findRule([rule], { payee: 'Edeka Center', amount: -100 })).toBe(rule);
    expect(findRule([rule], { payee: 'REWE', amount: 100 })).toBeUndefined();
  });
  it('suggests a short pattern', () => {
    expect(suggestPattern('REWE Markt GmbH//Berlin/DE', '').pattern).toBe('REWE Markt GmbH');
    expect(suggestPattern('', 'SEPA Lastschrift Netflix International').pattern).toBe('Netflix International');
  });
  it('builds transfer fields for both directions', () => {
    const t: Rule = { ...rule, action: { type: 'transfer', toAccountId: 'tr' } };
    expect(ruleToTxFields(t, -5000, 'giro')).toMatchObject({ kind: 'transfer', amount: 5000, accountId: 'giro', toAccountId: 'tr' });
    expect(ruleToTxFields(t, 5000, 'giro')).toMatchObject({ kind: 'transfer', amount: 5000, accountId: 'tr', toAccountId: 'giro' });
    expect(ruleToTxFields({ ...rule, action: { type: 'ignore' } }, -1, 'giro')).toBeNull();
    expect(ruleToTxFields(undefined, -1, 'giro')).toMatchObject({ kind: 'expense', needsReview: true });
  });
});

describe('balances', () => {
  it('computes accounts, pots and unassigned money consistently', () => {
    const data = emptyData();
    const giro = data.accounts[0];
    const tr = data.accounts.find((a) => a.institution === 'Trade Republic')!;
    giro.openingBalance = 100000;
    const [fix, food] = data.pots;
    const tx = (t: Partial<Transaction>): Transaction => ({ id: Math.random() + '', date: '2026-01-01', kind: 'expense', amount: 0, splits: [], source: 'manual', createdAt: 0, ...t });
    data.transactions = [
      tx({ kind: 'income', amount: 300000, accountId: giro.id, splits: [{ potId: fix.id, amount: 100000, subitemIds: [] }, { potId: food.id, amount: 50000, subitemIds: [] }] }),
      tx({ kind: 'expense', amount: -60000, accountId: giro.id, splits: [{ potId: food.id, amount: -60000, subitemIds: [] }] }),
      tx({ kind: 'transfer', amount: 20000, accountId: giro.id, toAccountId: tr.id }),
      tx({ kind: 'potTransfer', amount: 5000, splits: [{ potId: null, amount: -5000, subitemIds: [] }, { potId: food.id, amount: 5000, subitemIds: [] }] }),
    ];
    const bal = accountBalances(data);
    expect(bal.get(giro.id)).toBe(100000 + 300000 - 60000 - 20000);
    expect(bal.get(tr.id)).toBe(20000);
    const pots = potBalances(data);
    expect(pots.get(fix.id)).toBe(100000);
    expect(pots.get(food.id)).toBe(-5000);
    // Budget accounts: giro (320000) + Sparkasse sub-account (0) + cash (0); pots hold 95000.
    expect(unassigned(data, bal, pots)).toBe(320000 - 95000);
  });

  it('distributes with exact totals', () => {
    expect(distribute(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(distribute(1000, [1, 1, 1]).reduce((a, b) => a + b)).toBe(1000);
  });
});

describe('PDF statement lines', () => {
  const line = (...tokens: [string, number][]): PdfLine => ({ page: 1, tokens: tokens.map(([text, x]) => ({ text, x, right: x + text.length * 5 })) });
  it('derives signs from in/out columns and keeps descriptions', () => {
    const lines = [
      line(['Kontoauszug 1/2026', 40]),
      line(['Datum', 40], ['Beschreibung', 120], ['Zahlungseingang', 380], ['Zahlungsausgang', 470], ['Saldo', 560]),
      line(['02.01.2026', 40], ['Kartenzahlung', 120], ['REWE Markt', 200], ['23,45 €', 480], ['976,55 €', 560]),
      line(['Filiale 123 Berlin', 120]),
      line(['05.01.2026', 40], ['Überweisung', 120], ['Max Mustermann', 200], ['50,00 €', 390], ['1.026,55 €', 560]),
    ];
    const res = parseStatementLines(lines);
    expect(res.entries).toHaveLength(2);
    expect(res.entries[0]).toMatchObject({ date: '2026-01-02', amount: -2345, payee: 'REWE Markt', purpose: 'Filiale 123 Berlin' });
    expect(res.entries[1]).toMatchObject({ amount: 5000, payee: 'Max Mustermann' });
  });
  it('uses running balance when no column headers exist', () => {
    const lines = [
      line(['Alter Kontostand', 40], ['1.000,00', 500]),
      line(['02.01.', 40], ['Lastschrift', 100], ['Stadtwerke', 170], ['89,00', 420], ['911,00', 500]),
      line(['03.01.', 40], ['Gutschrift', 100], ['Erstattung', 170], ['11,00', 420], ['922,00', 500]),
    ];
    const res = parseStatementLines(lines);
    expect(res.entries.map((e) => e.amount)).toEqual([-8900, 1100]);
    expect(res.entries.every((e) => !e.uncertainSign)).toBe(true);
  });
});
