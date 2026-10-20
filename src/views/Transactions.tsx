import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { useData, useNav } from '../hooks';
import type { Transaction, TxKind } from '../types';
import { currentMonth, fmtDate, fmtMonth, monthOf, shiftMonth } from '../lib/format';
import { AccountSelect, accountLabel } from '../components/AccountSelect';
import { TxList, displayAmount, txTitle } from '../components/TxList';
import { Money } from '../components/ui';
import { accountTotal } from '../lib/calc';
import { exportFile } from '../lib/fileExport';

export function Transactions() {
  const { data, activePots, potById, accountById, balances } = useData();
  const { params } = useNav();
  const [q, setQ] = useState('');
  const [accountId, setAccountId] = useState<string | undefined>(params.accountId);
  const [potFilter, setPotFilter] = useState<string>(params.potId || (params.filter === 'unassigned' ? '_none' : ''));
  const [kind, setKind] = useState<TxKind | ''>('');
  const [month, setMonth] = useState<string>(params.accountId || params.potId || params.filter ? '' : currentMonth());
  const [onlyOpen, setOnlyOpen] = useState(false);

  // An account filter includes its sub-accounts.
  const accountIds = useMemo(() => {
    if (!accountId) return null;
    const ids = new Set([accountId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const a of data.accounts) if (a.parentId && ids.has(a.parentId) && !ids.has(a.id)) ids.add(a.id), (grew = true);
    }
    return ids;
  }, [accountId, data.accounts]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.transactions
      .filter((t) => {
        if (month && monthOf(t.date) !== month) return false;
        if (kind && t.kind !== kind) return false;
        if (onlyOpen && !t.needsReview) return false;
        if (accountIds && !(t.accountId && accountIds.has(t.accountId)) && !(t.toAccountId && accountIds.has(t.toAccountId))) return false;
        if (potFilter === '_none') {
          if (t.kind !== 'income' && t.kind !== 'expense') return false;
          if (t.splits.some((s) => s.potId)) return false;
        } else if (potFilter && !t.splits.some((s) => s.potId === potFilter)) return false;
        if (needle) {
          const hay = `${t.payee || ''} ${t.purpose || ''} ${t.note || ''} ${(Math.abs(t.amount) / 100).toFixed(2).replace('.', ',')}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }, [data.transactions, q, month, kind, onlyOpen, accountIds, potFilter]);

  const sums = useMemo(() => {
    let inc = 0;
    let out = 0;
    for (const t of filtered) {
      const v = displayAmount(t, accountId, potFilter && potFilter !== '_none' ? potFilter : undefined);
      if (t.kind === 'transfer' && !accountId) continue;
      if (t.kind === 'potTransfer' && !(potFilter && potFilter !== '_none')) continue;
      if (v >= 0) inc += v;
      else out -= v;
    }
    return { inc, out };
  }, [filtered, accountId, potFilter]);

  const exportCsv = () => {
    const rows = [['Datum', 'Art', 'Betrag', 'Konto', 'Zielkonto', 'Empfänger/Titel', 'Verwendungszweck', 'Töpfe', 'Unterpunkte', 'Notiz']];
    const kinds: Record<TxKind, string> = { income: 'Einnahme', expense: 'Ausgabe', transfer: 'Umbuchung', potTransfer: 'Topf-Umschichtung', adjustment: 'Saldo-Abgleich' };
    for (const t of filtered as Transaction[]) {
      const pots = t.splits.map((s) => (s.potId ? potById.get(s.potId)?.name : 'Nicht verteilt')).join(' | ');
      const subs = t.splits
        .flatMap((s) => s.subitemIds.map((id) => potById.get(s.potId || '')?.subitems.find((x) => x.id === id)?.name))
        .filter(Boolean)
        .join(' | ');
      rows.push([
        fmtDate(t.date),
        kinds[t.kind],
        (t.amount / 100).toFixed(2).replace('.', ','),
        accountLabel(accountById.get(t.accountId || '')),
        t.toAccountId ? accountLabel(accountById.get(t.toAccountId)) : '',
        txTitle(t, potById, accountById),
        t.purpose || '',
        pots,
        subs,
        t.note || '',
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    exportFile(`buchungen-${month || 'alle'}.csv`, '\uFEFF' + csv, 'text/csv;charset=utf-8');
  };

  const acc = accountId ? accountById.get(accountId) : undefined;

  return (
    <div className="stack lg">
      <div className="page-head">
        <div>
          <h1>Buchungen</h1>
          <p className="muted">
            {acc ? (
              <>
                {accountLabel(acc)} · Stand <Money value={accountTotal(data.accounts, balances, acc.id)} colored />
              </>
            ) : (
              'Alle Zu- und Abgänge'
            )}
          </p>
        </div>
        <button className="btn" onClick={exportCsv} disabled={!filtered.length}>
          <Download size={16} /> CSV-Export
        </button>
      </div>

      <div className="card stack">
        <div className="row wrap">
          <div className="row" style={{ gap: 4 }}>
            <button className="btn icon sm" onClick={() => setMonth(shiftMonth(month || currentMonth(), -1))} aria-label="Vormonat">
              <ChevronLeft size={16} />
            </button>
            <select className="input sm" style={{ width: 170 }} value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">Alle Monate</option>
              {Array.from({ length: 36 }, (_, i) => shiftMonth(currentMonth(), -i)).map((m) => (
                <option key={m} value={m}>
                  {fmtMonth(m)}
                </option>
              ))}
              {month && !Array.from({ length: 36 }, (_, i) => shiftMonth(currentMonth(), -i)).includes(month) && <option value={month}>{fmtMonth(month)}</option>}
            </select>
            <button className="btn icon sm" onClick={() => setMonth(shiftMonth(month || currentMonth(), 1))} aria-label="Folgemonat">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="row grow" style={{ minWidth: 200, position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 10, color: 'var(--muted)' }} />
            <input className="input sm" style={{ paddingLeft: 32 }} placeholder="Suchen (Empfänger, Zweck, Betrag)…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="row wrap">
          <AccountSelect className="input sm" accounts={data.accounts} value={accountId} onChange={setAccountId} placeholder="Alle Konten" />
          <select className="input sm" value={potFilter} onChange={(e) => setPotFilter(e.target.value)}>
            <option value="">Alle Töpfe</option>
            <option value="_none">– Nicht verteilt –</option>
            {activePots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon} {p.name}
              </option>
            ))}
          </select>
          <select className="input sm" value={kind} onChange={(e) => setKind(e.target.value as TxKind | '')}>
            <option value="">Alle Arten</option>
            <option value="expense">Ausgaben</option>
            <option value="income">Einnahmen</option>
            <option value="transfer">Umbuchungen</option>
            <option value="potTransfer">Topf-Umschichtungen</option>
            <option value="adjustment">Saldo-Abgleiche</option>
          </select>
          <label className="check small">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> nur offene
          </label>
        </div>
        <div className="row wrap small">
          <span className="muted">{filtered.length} Buchungen</span>
          <span>
            Zugänge <Money value={sums.inc} className="pos" />
          </span>
          <span>
            Abgänge <Money value={-sums.out} className="neg" />
          </span>
          <span>
            Saldo <Money value={sums.inc - sums.out} colored signed />
          </span>
        </div>
      </div>

      <div className="card flush">
        <TxList txs={filtered} accountId={accountId} potId={potFilter && potFilter !== '_none' ? potFilter : undefined} empty="Keine Buchungen für diese Filter." />
      </div>
    </div>
  );
}
