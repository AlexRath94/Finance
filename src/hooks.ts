import { createContext, useContext, useMemo } from 'react';
import { dataOf, useStore } from './store';
import { accountBalances, netWorth, potBalances, unassigned } from './lib/calc';
import type { ID } from './types';

/** Store data plus memoized balances that most views need. */
export function useData() {
  const store = useStore();
  const data = useMemo(() => dataOf(store), [store]);
  const balances = useMemo(() => accountBalances(data), [data.accounts, data.transactions]);
  const potBal = useMemo(() => potBalances(data), [data.pots, data.transactions]);
  const free = useMemo(() => unassigned(data, balances, potBal), [data, balances, potBal]);
  const worth = useMemo(() => netWorth(data, balances), [data, balances]);
  const sortedPots = useMemo(() => [...data.pots].sort((a, b) => a.order - b.order), [data.pots]);
  const activePots = useMemo(() => sortedPots.filter((p) => !p.archived), [sortedPots]);
  const potById = useMemo(() => new Map(data.pots.map((p) => [p.id, p])), [data.pots]);
  const accountById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);
  const reviewCount = useMemo(() => data.transactions.filter((t) => t.needsReview).length, [data.transactions]);
  return { store, data, balances, potBal, free, worth, sortedPots, activePots, potById, accountById, reviewCount };
}

export type Tab = 'dashboard' | 'transactions' | 'pots' | 'accounts' | 'import' | 'metals' | 'settings';

export interface NavParams {
  accountId?: ID;
  potId?: ID;
  review?: boolean;
  filter?: 'unassigned';
}

export interface NavCtx {
  tab: Tab;
  params: NavParams;
  go: (tab: Tab, params?: NavParams) => void;
  newTx: (preset?: Partial<import('./types').Transaction>) => void;
  editTx: (id: ID) => void;
}

export const Nav = createContext<NavCtx>(null as unknown as NavCtx);
export const useNav = () => useContext(Nav);
