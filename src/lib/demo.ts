import type { AppData, Pot, Transaction } from '../types';
import { shiftMonth, currentMonth, today } from './format';

type NewTx = Omit<Transaction, 'id' | 'createdAt'>;

/** A few months of plausible bookings on the first budget account, assigned to the existing pots. */
export function buildDemoTransactions(data: AppData): NewTx[] {
  const account = data.accounts.find((a) => a.inBudget && !a.archived && a.type === 'giro') || data.accounts.find((a) => a.inBudget);
  if (!account) return [];
  const pots = data.pots.filter((p) => !p.archived);
  const byName = (n: string) => pots.find((p) => p.name === n);
  const sub = (p: Pot | undefined, n: string) => (p?.subitems.find((s) => s.name === n)?.id ? [p.subitems.find((s) => s.name === n)!.id] : []);
  const out: NewTx[] = [];
  const now = today();
  const add = (date: string, amount: number, payee: string, pot?: Pot, subName?: string, review = false) => {
    if (date > now) return;
    out.push({
      date,
      kind: amount >= 0 ? 'income' : 'expense',
      amount,
      accountId: account.id,
      payee,
      splits: pot && !review ? [{ potId: pot.id, amount, subitemIds: subName ? sub(pot, subName) : [] }] : [],
      source: review ? 'import' : 'manual',
      needsReview: review || undefined,
    });
  };
  const fix = byName('Fixkosten');
  const food = byName('Lebensmittel');
  const mob = byName('Mobilität');
  const fun = byName('Freizeit');
  for (let i = 2; i >= 0; i--) {
    const m = shiftMonth(currentMonth(), -i);
    const d = (day: number) => `${m}-${String(day).padStart(2, '0')}`;
    // Salary distributed to pots, rest stays unassigned.
    const salary = 320000;
    const parts: [Pot | undefined, number][] = [
      [fix, 120000],
      [food, 50000],
      [mob, 25000],
      [fun, 30000],
      [byName('Rücklagen'), 40000],
      [byName('Urlaub'), 20000],
    ];
    if (d(1) <= now)
      out.push({
        date: d(1),
        kind: 'income',
        amount: salary,
        accountId: account.id,
        payee: 'Arbeitgeber GmbH',
        splits: parts.filter(([p]) => p).map(([p, a]) => ({ potId: p!.id, amount: a, subitemIds: [] })),
        source: 'manual',
      });
    add(d(2), -95000, 'Hausverwaltung Miete', fix, 'Miete');
    add(d(5), -8900, 'Stadtwerke Strom', fix, 'Strom');
    add(d(6), -3999, 'Telekom', fix, 'Internet');
    add(d(4), -6734, 'REWE', food, 'Supermarkt');
    add(d(11), -4512, 'EDEKA', food, 'Supermarkt');
    add(d(13), -1890, 'dm Drogerie', food, 'Drogerie');
    add(d(19), -7321, 'REWE', food, 'Supermarkt');
    add(d(8), -6850, 'Aral Tankstelle', mob, 'Tanken');
    add(d(22), -7120, 'Shell', mob, 'Tanken');
    add(d(15), -5400, 'Pizzeria Da Mario', fun, 'Restaurant');
    add(d(17), -1299, 'Netflix', fun, 'Abos');
  }
  const m = currentMonth();
  add(`${m}-03`, -2349, 'Amazon EU S.a.r.l.', undefined, undefined, true);
  add(`${m}-07`, -1150, 'Bäckerei Schmidt', undefined, undefined, true);
  add(`${m}-09`, -15000, 'Werkstatt Müller', undefined, undefined, true);
  return out;
}
