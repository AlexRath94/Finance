import { useMemo, useState, type ReactNode } from 'react';
import { Check, FileUp, List, Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import { useData, useNav } from '../hooks';
import { useStore } from '../store';
import type { Account, AccountType, ID } from '../types';
import { accountTotal, childrenOf } from '../lib/calc';
import { fmtEur, maskIban, normalizeIban, today } from '../lib/format';
import { Field, Modal, Money, MoneyInput, confirmDialog, useToast } from '../components/ui';
import { AccountSelect } from '../components/AccountSelect';
import { TxList } from '../components/TxList';

export const ACCOUNT_TYPES: Record<AccountType, string> = {
  giro: 'Girokonto',
  savings: 'Sparkonto',
  daily: 'Tagesgeld / Verrechnung',
  depot: 'Depot',
  cash: 'Bargeld',
  credit: 'Kreditkarte',
  loan: 'Kredit / Darlehen',
  other: 'Sonstiges',
};

const COLORS = ['#e30613', '#f05a5a', '#111827', '#374151', '#2a78d6', '#1baf7a', '#eda100', '#6250d6', '#65a30d', '#0e7490', '#db2777', '#64748b'];

export function Accounts() {
  const { data, balances } = useData();
  const [edit, setEdit] = useState<Account | 'new' | null>(null);
  const [detail, setDetail] = useState<ID | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const accounts = data.accounts.filter((a) => showArchived || !a.archived);
  const institutions = useMemo(() => {
    const roots = accounts.filter((a) => !a.parentId || !accounts.some((p) => p.id === a.parentId));
    const map = new Map<string, Account[]>();
    for (const r of roots.sort((a, b) => a.order - b.order)) {
      const key = r.institution || 'Sonstige';
      map.set(key, [...(map.get(key) || []), r]);
    }
    return [...map.entries()];
  }, [accounts]);

  const totalOf = (a: Account) => accountTotal(accounts, balances, a.id);
  const grand = accounts.filter((a) => a.includeInNetWorth && !a.archived).reduce((s, a) => s + (balances.get(a.id) || 0), 0);
  const budget = accounts.filter((a) => a.inBudget && !a.archived).reduce((s, a) => s + (balances.get(a.id) || 0), 0);

  const renderRow = (a: Account, depth: number): ReactNode => {
    const kids = childrenOf(accounts, a.id);
    const own = balances.get(a.id) || 0;
    return (
      <div key={a.id}>
        <div className={`account-row${depth ? ' child' : ''}${depth > 1 ? ' lvl2' : ''}`} onClick={() => setDetail(a.id)} style={{ opacity: a.archived ? 0.55 : 1 }}>
          <span className="color-dot" style={{ background: a.color, width: 12, height: 12 }} />
          <div className="grow">
            <div className="row" style={{ gap: 6 }}>
              <span style={{ fontWeight: 580 }} className="ellipsis">
                {a.name}
              </span>
              {a.inBudget && <span className="badge info">Töpfe</span>}
              {!a.includeInNetWorth && <span className="badge">nicht im Vermögen</span>}
              {a.archived && <span className="badge">archiviert</span>}
            </div>
            <div className="tiny muted">
              {ACCOUNT_TYPES[a.type]}
              {a.iban ? ` · ${maskIban(a.iban)}` : ''}
            </div>
          </div>
          <div className="right">
            <Money value={own} className={own < 0 ? 'neg' : ''} />
            {kids.length > 0 && (
              <div className="tiny muted num">inkl. Unterkonten {fmtEur(totalOf(a))}</div>
            )}
          </div>
        </div>
        {kids.map((k) => renderRow(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className="stack lg">
      <div className="page-head">
        <div>
          <h1>Konten</h1>
          <p className="muted">Jede Bank mit ihren Konten und Unterkonten – einzeln und zusammen.</p>
        </div>
        <button className="btn primary" onClick={() => setEdit('new')}>
          <Plus size={16} /> Konto
        </button>
      </div>

      <div className="grid kpi">
        <div className="card kpi-card">
          <div className="label">Summe aller Konten</div>
          <div className="value">{fmtEur(grand)}</div>
          <div className="sub">die im Gesamtvermögen zählen</div>
        </div>
        <div className="card kpi-card">
          <div className="label">Budget-Konten (Töpfe)</div>
          <div className="value">{fmtEur(budget)}</div>
          <div className="sub">wird auf Töpfe verteilt</div>
        </div>
        {institutions.slice(0, 3).map(([name, roots]) => (
          <div className="card kpi-card" key={name}>
            <div className="label">{name}</div>
            <div className="value">{fmtEur(roots.reduce((s, r) => s + totalOf(r), 0))}</div>
            <div className="sub">{roots.length} Konto/Konten</div>
          </div>
        ))}
      </div>

      {institutions.map(([name, roots]) => (
        <div className="card flush" key={name}>
          <div className="inst-head">
            <span>{name}</span>
            <Money value={roots.reduce((s, r) => s + totalOf(r), 0)} />
          </div>
          {roots.map((r) => renderRow(r, 0))}
        </div>
      ))}
      <label className="check small">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> archivierte Konten zeigen
      </label>

      {edit && <AccountEditor account={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {detail && data.accounts.find((a) => a.id === detail) && (
        <AccountDetail account={data.accounts.find((a) => a.id === detail)!} onClose={() => setDetail(null)} onEdit={(a) => setEdit(a)} />
      )}
    </div>
  );
}

function AccountDetail({ account, onClose, onEdit }: { account: Account; onClose: () => void; onEdit: (a: Account) => void }) {
  const { data, balances } = useData();
  const { go } = useNav();
  const [reconcile, setReconcile] = useState(false);
  const own = balances.get(account.id) || 0;
  const total = accountTotal(data.accounts, balances, account.id);
  const txs = useMemo(
    () =>
      data.transactions
        .filter((t) => t.accountId === account.id || t.toAccountId === account.id)
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
        .slice(0, 30),
    [data.transactions, account.id],
  );
  const kids = data.accounts.filter((a) => a.parentId === account.id);
  return (
    <Modal
      wide
      title={
        <span className="row">
          <span className="color-dot" style={{ background: account.color, width: 14, height: 14 }} />
          {account.institution} · {account.name}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => go('import', { accountId: account.id })} style={{ marginRight: 'auto' }}>
            <FileUp size={16} /> Auszug importieren
          </button>
          <button className="btn" onClick={() => setReconcile(true)}>
            <Scale size={16} /> Saldo abgleichen
          </button>
          <button className="btn" onClick={() => onEdit(account)}>
            <Pencil size={16} /> Bearbeiten
          </button>
          <button className="btn primary" onClick={() => go('transactions', { accountId: account.id })}>
            <List size={16} /> Alle Buchungen
          </button>
        </>
      }
    >
      <div className="grid kpi">
        <div>
          <div className="label-text">Kontostand</div>
          <div className={`pot-balance ${own < 0 ? 'neg' : ''}`} style={{ margin: '4px 0' }}>
            {fmtEur(own)}
          </div>
        </div>
        {kids.length > 0 && (
          <div>
            <div className="label-text">inkl. {kids.length} Unterkonten</div>
            <div className="pot-balance" style={{ margin: '4px 0' }}>
              {fmtEur(total)}
            </div>
          </div>
        )}
        <div>
          <div className="label-text">Art</div>
          <div style={{ marginTop: 8 }}>{ACCOUNT_TYPES[account.type]}</div>
          {account.iban && <div className="small muted">{account.iban}</div>}
        </div>
      </div>
      {account.note && <div className="small muted">{account.note}</div>}
      <h3>Letzte Buchungen</h3>
      <div className="card flush">
        <TxList txs={txs} accountId={account.id} />
      </div>
      {reconcile && <ReconcileModal account={account} current={own} onClose={() => setReconcile(false)} />}
    </Modal>
  );
}

function ReconcileModal({ account, current, onClose }: { account: Account; current: number; onClose: () => void }) {
  const { addTransaction } = useStore();
  const toast = useToast();
  const [actual, setActual] = useState<number | null>(current);
  const [date, setDate] = useState(today());
  const diff = (actual ?? current) - current;
  const save = () => {
    if (diff) {
      addTransaction({
        date,
        kind: 'adjustment',
        amount: diff,
        accountId: account.id,
        splits: [],
        payee: account.type === 'depot' ? 'Wertanpassung Depot' : 'Saldo-Abgleich',
        source: 'manual',
      });
      toast(`Korrektur über ${fmtEur(diff)} gebucht`);
    }
    onClose();
  };
  return (
    <Modal
      title="Saldo abgleichen"
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={save}>
          <Check size={16} /> Übernehmen
        </button>
      }
    >
      <p className="small muted" style={{ margin: 0 }}>
        Tatsächlichen Kontostand laut Bank-App eintragen. Die Differenz wird als Korrekturbuchung erfasst
        {account.inBudget ? ' und landet bei „Nicht verteilt“' : ''}. Für Depots so den aktuellen Depotwert pflegen.
      </p>
      <div className="form-grid">
        <Field label="Tatsächlicher Stand (€)">
          <MoneyInput className="input amount" allowNegative value={actual} onChange={setActual} autoFocus />
        </Field>
        <Field label="Datum">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="row between">
        <span className="muted">Bisher in der App</span>
        <Money value={current} />
      </div>
      <div className="row between">
        <span className="muted">Differenz</span>
        <Money value={diff} signed colored />
      </div>
    </Modal>
  );
}

function AccountEditor({ account, onClose }: { account?: Account; onClose: () => void }) {
  const { data } = useData();
  const { addAccount, updateAccount, deleteAccount } = useStore();
  const toast = useToast();
  const [form, setForm] = useState<Omit<Account, 'id' | 'order'>>(
    account || {
      name: '',
      institution: '',
      type: 'giro',
      openingBalance: 0,
      color: COLORS[data.accounts.length % COLORS.length],
      inBudget: true,
      includeInNetWorth: true,
    },
  );
  const set = (patch: Partial<Account>) => setForm({ ...form, ...patch });
  const institutions = [...new Set(data.accounts.map((a) => a.institution).filter(Boolean))];
  const txCount = account ? data.transactions.filter((t) => t.accountId === account.id || t.toAccountId === account.id).length : 0;

  // Prevent cycles: an account cannot become a sub-account of its own descendants.
  const descendants = useMemo(() => {
    const ids = new Set<ID>();
    if (!account) return ids;
    const walk = (id: ID) => data.accounts.filter((a) => a.parentId === id).forEach((a) => (ids.add(a.id), walk(a.id)));
    walk(account.id);
    return ids;
  }, [account, data.accounts]);

  const save = () => {
    if (!form.name.trim()) return;
    const clean = { ...form, name: form.name.trim(), institution: form.institution.trim(), iban: form.iban ? normalizeIban(form.iban) : undefined };
    if (account) updateAccount(account.id, clean);
    else addAccount(clean);
    toast(account ? 'Konto gespeichert' : 'Konto angelegt');
    onClose();
  };

  return (
    <Modal
      title={account ? 'Konto bearbeiten' : 'Neues Konto'}
      onClose={onClose}
      footer={
        <>
          {account && (
            <>
              <button
                className="btn danger"
                onClick={() => {
                  if (confirmDialog(`Konto „${account.name}“ löschen?${txCount ? ` ${txCount} Buchungen werden ebenfalls gelöscht. Tipp: stattdessen archivieren.` : ''}`)) {
                    deleteAccount(account.id);
                    onClose();
                  }
                }}
              >
                <Trash2 size={16} /> Löschen
              </button>
              <button className="btn" style={{ marginRight: 'auto' }} onClick={() => (updateAccount(account.id, { archived: !account.archived }), onClose())}>
                {account.archived ? 'Reaktivieren' : 'Archivieren'}
              </button>
            </>
          )}
          <button className="btn primary" onClick={save} disabled={!form.name.trim()}>
            <Check size={16} /> Speichern
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Bank / Institut">
          <input className="input" list="institutions" value={form.institution} onChange={(e) => set({ institution: e.target.value })} placeholder="z. B. Sparkasse" autoFocus />
          <datalist id="institutions">
            {[...new Set([...institutions, 'Sparkasse', 'Trade Republic', 'Bar'])].map((i) => (
              <option key={i} value={i} />
            ))}
          </datalist>
        </Field>
        <Field label="Kontoname">
          <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="z. B. Girokonto" />
        </Field>
        <Field label="Kontoart">
          <select className="input" value={form.type} onChange={(e) => set({ type: e.target.value as AccountType })}>
            {Object.entries(ACCOUNT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Unterkonto von">
          <AccountSelect
            accounts={data.accounts.filter((a) => a.id !== account?.id && !descendants.has(a.id))}
            value={form.parentId}
            onChange={(id) => set({ parentId: id })}
            placeholder="– Hauptkonto –"
          />
        </Field>
        <Field label="IBAN" hint="Für die automatische Konto-Erkennung beim Import">
          <input className="input" value={form.iban || ''} onChange={(e) => set({ iban: e.target.value })} placeholder="DE…" />
        </Field>
        <Field label="Anfangssaldo (€)" hint="Stand vor der ersten erfassten Buchung">
          <MoneyInput allowNegative value={form.openingBalance} onChange={(v) => set({ openingBalance: v ?? 0 })} />
        </Field>
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="label-text" style={{ marginRight: 6 }}>
          Farbe
        </span>
        {COLORS.map((c) => (
          <button key={c} type="button" onClick={() => set({ color: c })} aria-label={c} style={{ width: 26, height: 26, borderRadius: 7, background: c, border: form.color === c ? '3px solid var(--text)' : '2px solid var(--surface)', cursor: 'pointer' }} />
        ))}
      </div>
      <div className="stack sm">
        <label className="check">
          <input type="checkbox" checked={form.inBudget} onChange={(e) => set({ inBudget: e.target.checked })} />
          Geld auf diesem Konto in Töpfen verwalten (Budget-Konto)
        </label>
        <label className="check">
          <input type="checkbox" checked={form.includeInNetWorth} onChange={(e) => set({ includeInNetWorth: e.target.checked })} />
          Im Gesamtvermögen berücksichtigen
        </label>
      </div>
      <Field label="Notiz">
        <input className="input" value={form.note || ''} onChange={(e) => set({ note: e.target.value || undefined })} placeholder="optional" />
      </Field>
    </Modal>
  );
}
