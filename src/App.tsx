import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Coins, FileUp, LayoutDashboard, Landmark, PiggyBank, Plus, Settings as SettingsIcon, Wallet } from 'lucide-react';
import { Nav, useData, type NavCtx, type NavParams, type Tab } from './hooks';
import type { Transaction } from './types';
import { ToastProvider } from './components/ui';
import { TransactionModal } from './components/TransactionModal';
import { Dashboard } from './views/Dashboard';
import { Transactions } from './views/Transactions';
import { Pots } from './views/Pots';
import { Accounts } from './views/Accounts';
import { ImportView } from './views/Import';
import { Metals } from './views/Metals';
import { SettingsView } from './views/Settings';
import { metalsTotal } from './lib/calc';
import { useStore } from './store';

const TABS: { id: Tab; label: string; icon: typeof Wallet }[] = [
  { id: 'dashboard', label: 'Übersicht', icon: LayoutDashboard },
  { id: 'transactions', label: 'Buchungen', icon: ArrowLeftRight },
  { id: 'pots', label: 'Töpfe', icon: PiggyBank },
  { id: 'accounts', label: 'Konten', icon: Landmark },
  { id: 'import', label: 'Import', icon: FileUp },
  { id: 'metals', label: 'Edelmetalle', icon: Coins },
  { id: 'settings', label: 'Einstellungen', icon: SettingsIcon },
];

function readHash(): Tab {
  const h = window.location.hash.replace('#/', '') as Tab;
  return TABS.some((t) => t.id === h) ? h : 'dashboard';
}

/** Waits until the data has been loaded from the device storage. */
export default function App() {
  const [ready, setReady] = useState(() => useStore.persist.hasHydrated());
  useEffect(() => {
    if (ready) return;
    const unsub = useStore.persist.onFinishHydration(() => setReady(true));
    if (useStore.persist.hasHydrated()) setReady(true);
    return unsub;
  }, [ready]);
  if (!ready) return <div className="empty">Daten werden geladen…</div>;
  return <Main />;
}

function Main() {
  const [tab, setTab] = useState<Tab>(readHash);
  const [params, setParams] = useState<NavParams>({});
  const [txModal, setTxModal] = useState<{ tx?: Transaction; preset?: Partial<Transaction> } | null>(null);
  const { data, worth, reviewCount, store } = useData();

  useEffect(() => {
    const onHash = () => setTab(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Daily net-worth snapshot for the history chart.
  useEffect(() => {
    store.recordSnapshot({ total: worth.total, accounts: worth.accounts, metals: metalsTotal(data).total });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worth.total, worth.accounts]);

  const go = useCallback((t: Tab, p: NavParams = {}) => {
    setParams(p);
    setTab(t);
    if (window.location.hash !== `#/${t}`) window.history.pushState(null, '', `#/${t}`);
    window.scrollTo({ top: 0 });
  }, []);

  const nav: NavCtx = useMemo(
    () => ({
      tab,
      params,
      go,
      newTx: (preset) => setTxModal({ preset }),
      editTx: (id) => {
        const tx = data.transactions.find((t) => t.id === id);
        if (tx) setTxModal({ tx });
      },
    }),
    [tab, params, go, data.transactions],
  );

  const View = { dashboard: Dashboard, transactions: Transactions, pots: Pots, accounts: Accounts, import: ImportView, metals: Metals, settings: SettingsView }[tab];

  const navButtons = TABS.map((t) => (
    <button key={t.id} className={`nav-btn${tab === t.id ? ' active' : ''}`} onClick={() => go(t.id)}>
      <t.icon size={19} />
      <span>{t.label}</span>
      {t.id === 'import' && reviewCount > 0 && <span className="nav-badge">{reviewCount}</span>}
    </button>
  ));

  return (
    <ToastProvider>
      <Nav.Provider value={nav}>
        <div className="app">
          <aside className="sidebar">
            <div className="brand">
              <div className="brand-logo">
                <Wallet size={17} />
              </div>
              Finanzplaner
            </div>
            {navButtons}
            <div className="sidebar-foot tiny muted">Daten bleiben auf diesem Gerät.</div>
          </aside>
          <main className="main">
            <View key={tab + JSON.stringify(params)} />
          </main>
          <nav className="bottom-nav">{navButtons}</nav>
          {tab !== 'import' && tab !== 'settings' && (
            <button className="fab" onClick={() => setTxModal({})}>
              <Plus size={20} />
              <span>Buchung</span>
            </button>
          )}
          {txModal && <TransactionModal tx={txModal.tx} preset={txModal.preset} onClose={() => setTxModal(null)} />}
        </div>
      </Nav.Provider>
    </ToastProvider>
  );
}
