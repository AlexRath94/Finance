import type { Account, AppData, Cents, ID, Metal, MetalHolding, Pot, Transaction } from '../types';
import { monthOf } from './format';

export const OZ = 31.1034768;

/** Effect of a transaction on the given account (cents). */
export function accountDelta(tx: Transaction, accountId: ID): Cents {
  switch (tx.kind) {
    case 'income':
    case 'expense':
    case 'adjustment':
      return tx.accountId === accountId ? tx.amount : 0;
    case 'transfer':
      return (tx.accountId === accountId ? -tx.amount : 0) + (tx.toAccountId === accountId ? tx.amount : 0);
    default:
      return 0;
  }
}

/** Own balance of every account (without sub-accounts). */
export function accountBalances(data: Pick<AppData, 'accounts' | 'transactions'>): Map<ID, Cents> {
  const map = new Map<ID, Cents>();
  for (const a of data.accounts) map.set(a.id, a.openingBalance);
  for (const tx of data.transactions) {
    if (tx.kind === 'potTransfer') continue;
    if (tx.accountId && map.has(tx.accountId)) map.set(tx.accountId, map.get(tx.accountId)! + accountDelta(tx, tx.accountId));
    if (tx.kind === 'transfer' && tx.toAccountId && map.has(tx.toAccountId))
      map.set(tx.toAccountId, map.get(tx.toAccountId)! + accountDelta(tx, tx.toAccountId));
  }
  return map;
}

export function childrenOf(accounts: Account[], parentId: ID | undefined): Account[] {
  return accounts.filter((a) => (a.parentId || undefined) === parentId).sort((a, b) => a.order - b.order);
}

/** Balance of an account including all of its sub-accounts. */
export function accountTotal(accounts: Account[], balances: Map<ID, Cents>, id: ID): Cents {
  let sum = balances.get(id) || 0;
  for (const c of accounts.filter((a) => a.parentId === id)) sum += accountTotal(accounts, balances, c.id);
  return sum;
}

export function potBalances(data: Pick<AppData, 'pots' | 'transactions'>): Map<ID, Cents> {
  const map = new Map<ID, Cents>();
  for (const p of data.pots) map.set(p.id, 0);
  for (const tx of data.transactions) {
    if (tx.kind === 'transfer' || tx.kind === 'adjustment') continue;
    for (const s of tx.splits) if (s.potId && map.has(s.potId)) map.set(s.potId, map.get(s.potId)! + s.amount);
  }
  return map;
}

/** Money on budget accounts that is not assigned to any pot. */
export function unassigned(data: AppData, balances = accountBalances(data), pots = potBalances(data)): Cents {
  let budget = 0;
  for (const a of data.accounts) if (a.inBudget && !a.archived) budget += balances.get(a.id) || 0;
  let inPots = 0;
  for (const v of pots.values()) inPots += v;
  return budget - inPots;
}

export interface PotMonth {
  inflow: Cents;
  spent: Cents;
  bySubitem: Map<ID | '_none', Cents>;
}

export function potMonthStats(transactions: Transaction[], potId: ID, month: string): PotMonth {
  const res: PotMonth = { inflow: 0, spent: 0, bySubitem: new Map() };
  for (const tx of transactions) {
    if (monthOf(tx.date) !== month || tx.kind === 'transfer' || tx.kind === 'adjustment') continue;
    for (const s of tx.splits) {
      if (s.potId !== potId) continue;
      if (s.amount >= 0) res.inflow += s.amount;
      else {
        res.spent -= s.amount;
        const keys = s.subitemIds.length ? s.subitemIds : ['_none' as const];
        // Amount is shown under every ticked sub-item; it is not divided between them.
        for (const k of keys) res.bySubitem.set(k, (res.bySubitem.get(k) || 0) - s.amount);
      }
    }
  }
  return res;
}

export type Status = 'ok' | 'warn' | 'bad' | 'neutral';

export interface PotStatus {
  status: Status;
  reasons: string[];
}

export function potStatus(pot: Pot, balance: Cents, month: PotMonth): PotStatus {
  const reasons: string[] = [];
  let status: Status = 'ok';
  if (balance < 0) {
    status = 'bad';
    reasons.push('Unterdeckung');
  } else if (pot.minBalance && balance < pot.minBalance) {
    status = 'warn';
    reasons.push('unter Mindeststand');
  }
  if (pot.monthlyBudget) {
    if (month.spent > pot.monthlyBudget) {
      if (status !== 'bad') status = 'warn';
      reasons.push('Monatsbudget überschritten');
    } else if (month.spent > pot.monthlyBudget * 0.9 && status === 'ok') {
      status = 'warn';
      reasons.push('Budget fast aufgebraucht');
    }
  }
  return { status, reasons };
}

export interface MonthSummary {
  income: Cents;
  expense: Cents;
}

/** Income/expense on budget-relevant or all accounts for a month (transfers excluded). */
export function monthSummary(data: AppData, month: string, accountFilter?: (a: Account) => boolean): MonthSummary {
  const ok = new Set(data.accounts.filter(accountFilter || (() => true)).map((a) => a.id));
  const res = { income: 0, expense: 0 };
  for (const tx of data.transactions) {
    if (monthOf(tx.date) !== month) continue;
    if (tx.kind !== 'income' && tx.kind !== 'expense') continue;
    if (!tx.accountId || !ok.has(tx.accountId)) continue;
    if (tx.amount >= 0) res.income += tx.amount;
    else res.expense -= tx.amount;
  }
  return res;
}

export function holdingValue(h: MetalHolding, eurPerOz: number | undefined): Cents {
  if (!eurPerOz) return 0;
  return Math.round(((h.fineGrams * h.quantity) / OZ) * eurPerOz * 100);
}

export function metalsTotal(data: AppData): { total: Cents; byMetal: Record<Metal, Cents> } {
  const byMetal: Record<Metal, Cents> = { gold: 0, silver: 0, platinum: 0, palladium: 0 };
  for (const h of data.holdings) byMetal[h.metal] += holdingValue(h, data.prices[h.metal]?.eurPerOz);
  return { total: Object.values(byMetal).reduce((a, b) => a + b, 0), byMetal };
}

export interface NetWorth {
  accounts: Cents;
  metals: Cents;
  total: Cents;
  byInstitution: { name: string; value: Cents }[];
}

export function netWorth(data: AppData, balances = accountBalances(data)): NetWorth {
  let accounts = 0;
  const inst = new Map<string, Cents>();
  for (const a of data.accounts) {
    if (a.archived || !a.includeInNetWorth) continue;
    const v = balances.get(a.id) || 0;
    accounts += v;
    const key = a.institution || 'Sonstige';
    inst.set(key, (inst.get(key) || 0) + v);
  }
  const metals = data.settings.metalsInNetWorth ? metalsTotal(data).total : 0;
  return {
    accounts,
    metals,
    total: accounts + metals,
    byInstitution: [...inst.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
  };
}

/** Splits amount proportionally to weights, keeping the exact total. */
export function distribute(total: Cents, weights: number[]): Cents[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const res = raw.map((r) => Math.trunc(r));
  let rest = total - res.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: Math.abs(r - res[i]) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest !== 0 && k < order.length; k++) {
    const step = rest > 0 ? 1 : -1;
    res[order[k].i] += step;
    rest -= step;
  }
  return res;
}

export function splitTotal(tx: Transaction): Cents {
  return tx.splits.reduce((a, s) => a + s.amount, 0);
}
