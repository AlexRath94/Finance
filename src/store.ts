import { create, type StateCreator } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import type {
  Account,
  AppData,
  CsvMapping,
  ID,
  Metal,
  MetalHolding,
  MetalPrice,
  NetWorthSnapshot,
  Pot,
  Rule,
  Settings,
  Transaction,
} from './types';
import { today, uid } from './lib/format';

export const DATA_VERSION = 1;

const sub = (...names: string[]) => names.map((name) => ({ id: uid(), name }));

// Categorical order from the validated chart palette; pots keep their color as identity.
export const POT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#64748b', '#0e7490', '#a16207', '#9d174d'];

function defaultPots(): Pot[] {
  const pots: Omit<Pot, 'id' | 'order'>[] = [
    { name: 'Fixkosten', icon: '🏠', color: POT_COLORS[0], subitems: sub('Miete', 'Strom', 'Internet', 'Handy', 'Versicherungen', 'Rundfunk') },
    { name: 'Lebensmittel', icon: '🛒', color: POT_COLORS[1], subitems: sub('Supermarkt', 'Drogerie', 'Bäcker', 'Markt') },
    { name: 'Mobilität', icon: '🚗', color: POT_COLORS[2], subitems: sub('Tanken', 'Werkstatt', 'ÖPNV', 'Kfz-Versicherung', 'Kfz-Steuer') },
    { name: 'Freizeit', icon: '🎉', color: POT_COLORS[3], subitems: sub('Restaurant', 'Hobby', 'Ausflüge', 'Abos', 'Geschenke') },
    { name: 'Rücklagen', icon: '🛟', color: POT_COLORS[4], subitems: sub('Notgroschen', 'Anschaffungen', 'Reparaturen') },
    { name: 'Urlaub', icon: '🏖️', color: POT_COLORS[5], subitems: sub('Unterkunft', 'Anreise', 'Vor Ort') },
  ];
  return pots.map((p, i) => ({ ...p, id: uid(), order: i }));
}

function defaultAccounts(): Account[] {
  const giro = uid();
  const tr = uid();
  const base = { openingBalance: 0, archived: false } as const;
  return [
    { ...base, id: giro, name: 'Girokonto', institution: 'Sparkasse', type: 'giro', color: '#e30613', inBudget: true, includeInNetWorth: true, order: 0 },
    { ...base, id: uid(), name: 'Unterkonto Sparen', institution: 'Sparkasse', type: 'savings', parentId: giro, color: '#f05a5a', inBudget: true, includeInNetWorth: true, order: 1 },
    { ...base, id: tr, name: 'Verrechnungskonto', institution: 'Trade Republic', type: 'daily', color: '#111827', inBudget: false, includeInNetWorth: true, order: 2 },
    { ...base, id: uid(), name: 'Depot', institution: 'Trade Republic', type: 'depot', parentId: tr, color: '#374151', inBudget: false, includeInNetWorth: true, order: 3 },
    { ...base, id: uid(), name: 'Bargeld', institution: 'Bar', type: 'cash', color: '#65a30d', inBudget: true, includeInNetWorth: true, order: 4 },
  ];
}

const defaultSettings = (): Settings => ({
  metalsInNetWorth: true,
  onlinePrices: true,
  metalDiscount: { gold: 3, silver: 15, platinum: 10, palladium: 10 },
});

export function emptyData(): AppData {
  return {
    version: DATA_VERSION,
    accounts: defaultAccounts(),
    pots: defaultPots(),
    transactions: [],
    rules: [],
    holdings: [],
    prices: {},
    priceHistory: [],
    ignoredImportRefs: [],
    csvMappings: [],
    snapshots: [],
    tombstones: {},
    settings: defaultSettings(),
  };
}

// ---------------------------------------------------------------- change tracking

const TRACKED = ['accounts', 'pots', 'transactions', 'rules', 'holdings'] as const;
type Tracked = (typeof TRACKED)[number];
let tracking = true;

/**
 * Stamps records that changed (new object identity) with `updatedAt` and records deletions
 * as tombstones. All store updates are immutable, so identity tells exactly what changed.
 */
function trackChanges(prev: AppData, next: AppData): Partial<AppData> {
  const now = Date.now();
  const patch: Partial<Record<Tracked, { id: ID; updatedAt?: number }[]>> = {};
  let tombstones: Record<ID, number> | undefined;
  for (const key of TRACKED) {
    const before = prev[key] as { id: ID; updatedAt?: number }[];
    const after = next[key] as { id: ID; updatedAt?: number }[];
    if (before === after || !after) continue;
    const old = new Map(before.map((r) => [r.id, r]));
    patch[key] = after.map((r) => (old.get(r.id) === r ? r : { ...r, updatedAt: now }));
    const ids = new Set(after.map((r) => r.id));
    for (const r of before) if (!ids.has(r.id)) (tombstones ??= { ...next.tombstones })[r.id] = now;
  }
  return tombstones ? { ...(patch as Partial<AppData>), tombstones } : (patch as Partial<AppData>);
}

const tracked =
  <T extends AppData>(config: StateCreator<T, [], []>): StateCreator<T, [], []> =>
  (set, get, api) => {
    const wrap =
      (inner: typeof set) =>
      (partial: T | Partial<T> | ((s: T) => T | Partial<T>), replace?: boolean) => {
        if (!tracking) return (inner as (p: unknown, r?: boolean) => void)(partial, replace);
        const prev = get();
        const resolved = typeof partial === 'function' ? partial(prev) : partial;
        const extra = trackChanges(prev, { ...prev, ...resolved });
        (inner as (p: unknown, r?: boolean) => void)({ ...resolved, ...extra }, replace);
      };
    api.setState = wrap(api.setState) as typeof api.setState;
    return config(wrap(set) as typeof set, get, api);
  };

/** Runs a store update without stamping change times (used when loading or merging data). */
export function untracked(fn: () => void) {
  tracking = false;
  try {
    fn();
  } finally {
    tracking = true;
  }
}

// ---------------------------------------------------------------- device storage

/**
 * Data is kept in IndexedDB on the device (larger and more durable than localStorage).
 * Older versions stored in localStorage; that copy is read once and then removed.
 */
const deviceStorage = createJSONStorage(() => ({
  async getItem(name: string) {
    try {
      const v = await idbGet<string>(name);
      if (v != null) return v;
    } catch {
      /* IndexedDB unavailable */
    }
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  async setItem(name: string, value: string) {
    try {
      await idbSet(name, value);
      localStorage.removeItem(name);
    } catch {
      try {
        localStorage.setItem(name, value);
      } catch {
        /* storage full or blocked */
      }
    }
  },
  async removeItem(name: string) {
    try {
      await idbDel(name);
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
}));

export type NewTx = Omit<Transaction, 'id' | 'createdAt'>;

interface Actions {
  addAccount(a: Omit<Account, 'id' | 'order'>): ID;
  updateAccount(id: ID, patch: Partial<Account>): void;
  deleteAccount(id: ID): void;

  addPot(p: Omit<Pot, 'id' | 'order'>): ID;
  updatePot(id: ID, patch: Partial<Pot>): void;
  deletePot(id: ID): void;
  movePot(id: ID, dir: -1 | 1): void;
  addSubitem(potId: ID, name: string): ID;
  renameSubitem(potId: ID, subId: ID, name: string): void;
  deleteSubitem(potId: ID, subId: ID): void;

  addTransaction(tx: NewTx): ID;
  addTransactions(txs: NewTx[]): void;
  updateTransaction(id: ID, patch: Partial<Transaction>): void;
  deleteTransactions(ids: ID[]): void;
  ignoreImportRefs(refs: string[]): void;

  addRule(r: Omit<Rule, 'id' | 'createdAt' | 'hits' | 'enabled'>): ID;
  updateRule(id: ID, patch: Partial<Rule>): void;
  deleteRule(id: ID): void;
  countRuleHits(ids: ID[]): void;

  addHolding(h: Omit<MetalHolding, 'id'>): void;
  updateHolding(id: ID, patch: Partial<MetalHolding>): void;
  deleteHolding(id: ID): void;
  setPrices(p: Partial<Record<Metal, MetalPrice>>): void;

  saveCsvMapping(m: CsvMapping): void;
  updateSettings(patch: Partial<Settings>): void;
  recordSnapshot(s: Omit<NetWorthSnapshot, 'date'>): void;
  replaceAll(data: AppData): void;
  mergeIn(data: AppData): void;
  resetAll(): void;
}

export type Store = AppData & Actions;

export const useStore = create<Store>()(
  persist(
    tracked<Store>((set, get) => ({
      ...emptyData(),

      addAccount(a) {
        const id = uid();
        set((s) => ({ accounts: [...s.accounts, { ...a, id, order: s.accounts.length }] }));
        return id;
      },
      updateAccount(id, patch) {
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
      },
      deleteAccount(id) {
        set((s) => {
          const acc = s.accounts.find((a) => a.id === id);
          return {
            // Sub-accounts move up one level instead of disappearing.
            accounts: s.accounts.filter((a) => a.id !== id).map((a) => (a.parentId === id ? { ...a, parentId: acc?.parentId } : a)),
            transactions: s.transactions.filter((t) => t.accountId !== id && t.toAccountId !== id),
          };
        });
      },

      addPot(p) {
        const id = uid();
        set((s) => ({ pots: [...s.pots, { ...p, id, order: Math.max(-1, ...s.pots.map((x) => x.order)) + 1 }] }));
        return id;
      },
      updatePot(id, patch) {
        set((s) => ({ pots: s.pots.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
      },
      deletePot(id) {
        set((s) => ({
          pots: s.pots.filter((p) => p.id !== id),
          transactions: s.transactions.map((t) =>
            t.splits.some((sp) => sp.potId === id)
              ? { ...t, splits: t.splits.map((sp) => (sp.potId === id ? { ...sp, potId: null, subitemIds: [] } : sp)) }
              : t,
          ),
          rules: s.rules.filter((r) => !(r.action.type === 'pot' && r.action.potId === id)),
        }));
      },
      movePot(id, dir) {
        const sorted = [...get().pots].sort((a, b) => a.order - b.order);
        const i = sorted.findIndex((p) => p.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= sorted.length) return;
        [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
        set({ pots: sorted.map((p, k) => ({ ...p, order: k })) });
      },
      addSubitem(potId, name) {
        const existing = get()
          .pots.find((p) => p.id === potId)
          ?.subitems.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
        if (existing) {
          if (existing.archived) get().updatePot(potId, { subitems: get().pots.find((p) => p.id === potId)!.subitems.map((x) => (x.id === existing.id ? { ...x, archived: false } : x)) });
          return existing.id;
        }
        const id = uid();
        set((s) => ({ pots: s.pots.map((p) => (p.id === potId ? { ...p, subitems: [...p.subitems, { id, name: name.trim() }] } : p)) }));
        return id;
      },
      renameSubitem(potId, subId, name) {
        set((s) => ({
          pots: s.pots.map((p) => (p.id === potId ? { ...p, subitems: p.subitems.map((x) => (x.id === subId ? { ...x, name } : x)) } : p)),
        }));
      },
      deleteSubitem(potId, subId) {
        set((s) => ({
          pots: s.pots.map((p) => (p.id === potId ? { ...p, subitems: p.subitems.filter((x) => x.id !== subId) } : p)),
          transactions: s.transactions.map((t) =>
            t.splits.some((sp) => sp.subitemIds.includes(subId))
              ? { ...t, splits: t.splits.map((sp) => ({ ...sp, subitemIds: sp.subitemIds.filter((x) => x !== subId) })) }
              : t,
          ),
        }));
      },

      addTransaction(tx) {
        const id = uid();
        set((s) => ({
          transactions: [...s.transactions, { ...tx, id, createdAt: Date.now() }],
          settings: tx.accountId && tx.source === 'manual' ? { ...s.settings, lastAccountId: tx.accountId } : s.settings,
        }));
        return id;
      },
      addTransactions(txs) {
        const now = Date.now();
        set((s) => ({ transactions: [...s.transactions, ...txs.map((t, i) => ({ ...t, id: uid(), createdAt: now + i }))] }));
      },
      updateTransaction(id, patch) {
        set((s) => ({ transactions: s.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
      },
      deleteTransactions(ids) {
        const del = new Set(ids);
        set((s) => ({ transactions: s.transactions.filter((t) => !del.has(t.id)) }));
      },
      ignoreImportRefs(refs) {
        set((s) => ({ ignoredImportRefs: [...new Set([...s.ignoredImportRefs, ...refs])] }));
      },

      addRule(r) {
        const id = uid();
        set((s) => ({ rules: [{ ...r, id, hits: 0, enabled: true, createdAt: Date.now() }, ...s.rules] }));
        return id;
      },
      updateRule(id, patch) {
        set((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
      },
      deleteRule(id) {
        set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }));
      },
      countRuleHits(ids) {
        if (!ids.length) return;
        const count = new Map<ID, number>();
        ids.forEach((i) => count.set(i, (count.get(i) || 0) + 1));
        set((s) => ({ rules: s.rules.map((r) => (count.has(r.id) ? { ...r, hits: r.hits + count.get(r.id)! } : r)) }));
      },

      addHolding(h) {
        set((s) => ({ holdings: [...s.holdings, { ...h, id: uid() }] }));
      },
      updateHolding(id, patch) {
        set((s) => ({ holdings: s.holdings.map((h) => (h.id === id ? { ...h, ...patch } : h)) }));
      },
      deleteHolding(id) {
        set((s) => ({ holdings: s.holdings.filter((h) => h.id !== id) }));
      },
      setPrices(p) {
        set((s) => {
          const prices = { ...s.prices, ...p };
          const d = today();
          const point = Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, v!.eurPerOz]));
          const history = s.priceHistory.filter((h) => h.date !== d);
          history.push({ date: d, prices: point });
          history.sort((a, b) => a.date.localeCompare(b.date));
          return { prices, priceHistory: history.slice(-730) };
        });
      },

      saveCsvMapping(m) {
        set((s) => ({ csvMappings: [m, ...s.csvMappings.filter((x) => x.signature !== m.signature)] }));
      },
      updateSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
      },
      recordSnapshot(snap) {
        const d = today();
        set((s) => {
          const last = s.snapshots[s.snapshots.length - 1];
          if (last && last.date === d && last.total === snap.total && last.metals === snap.metals) return {};
          return { snapshots: [...s.snapshots.filter((x) => x.date !== d), { ...snap, date: d }].slice(-1500) };
        });
      },
      replaceAll(data) {
        untracked(() => set({ ...emptyData(), ...data, settings: { ...defaultSettings(), ...data.settings } }));
      },
      mergeIn(data) {
        // Shared data comes from the partner; device-specific settings stay as they are.
        untracked(() => set({ ...data, settings: { ...get().settings, lastSyncAt: Date.now() } }));
      },
      resetAll() {
        untracked(() => set(emptyData()));
      },
    })),
    {
      name: 'finanzplaner-data',
      version: DATA_VERSION,
      storage: deviceStorage,
      // Settings saved before a field existed get its default instead of undefined.
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<AppData>;
        return { ...current, ...p, tombstones: p.tombstones || {}, settings: { ...defaultSettings(), ...p.settings } };
      },
      partialize: (s) => {
        const { version, accounts, pots, transactions, rules, holdings, prices, priceHistory, ignoredImportRefs, csvMappings, snapshots, tombstones, settings } = s;
        return { version, accounts, pots, transactions, rules, holdings, prices, priceHistory, ignoredImportRefs, csvMappings, snapshots, tombstones, settings };
      },
    },
  ),
);

/** Plain data snapshot (without actions) for calculations and backups. */
export function dataOf(s: Store): AppData {
  const { version, accounts, pots, transactions, rules, holdings, prices, priceHistory, ignoredImportRefs, csvMappings, snapshots, tombstones, settings } = s;
  return { version, accounts, pots, transactions, rules, holdings, prices, priceHistory, ignoredImportRefs, csvMappings, snapshots, tombstones, settings };
}
