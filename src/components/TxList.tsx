import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Scale, Shuffle } from 'lucide-react';
import type { Account, ID, Pot, Transaction } from '../types';
import { fmtDate } from '../lib/format';
import { useData, useNav } from '../hooks';
import { Money, PotTag } from './ui';
import { accountLabel } from './AccountSelect';

export function txTitle(tx: Transaction, potById: Map<ID, Pot>, accountById: Map<ID, Account>): string {
  if (tx.kind === 'transfer') return `Umbuchung → ${accountById.get(tx.toAccountId!)?.name || '?'}`;
  if (tx.kind === 'potTransfer') {
    const from = tx.splits.find((s) => s.amount < 0)?.potId;
    const to = tx.splits.find((s) => s.amount > 0)?.potId;
    const n = (id?: ID | null) => (id ? potById.get(id)?.name || '?' : 'Nicht verteilt');
    return `${n(from)} → ${n(to)}`;
  }
  if (tx.kind === 'adjustment') return tx.payee || 'Saldo-Abgleich';
  return tx.payee || tx.purpose || (tx.amount >= 0 ? 'Einnahme' : 'Ausgabe');
}

export function TxIcon({ tx }: { tx: Transaction }) {
  const map = {
    income: { icon: <ArrowDownLeft size={17} />, color: 'var(--ok)' },
    expense: { icon: <ArrowUpRight size={17} />, color: 'var(--bad)' },
    transfer: { icon: <ArrowLeftRight size={17} />, color: 'var(--accent)' },
    potTransfer: { icon: <Shuffle size={17} />, color: 'var(--accent)' },
    adjustment: { icon: <Scale size={17} />, color: 'var(--muted)' },
  }[tx.kind];
  return (
    <div className="tx-icon" style={{ color: map.color }}>
      {map.icon}
    </div>
  );
}

/** Signed amount from the perspective of one account (or neutral for transfers). */
export function displayAmount(tx: Transaction, accountId?: ID, potId?: ID): number {
  if (potId) return tx.splits.filter((s) => s.potId === potId).reduce((a, s) => a + s.amount, 0);
  if (tx.kind === 'transfer') {
    if (accountId === tx.toAccountId) return tx.amount;
    if (accountId === tx.accountId) return -tx.amount;
    return tx.amount;
  }
  return tx.amount;
}

export function TxList({ txs, accountId, potId, empty }: { txs: Transaction[]; accountId?: ID; potId?: ID; empty?: string }) {
  const { potById, accountById } = useData();
  const { editTx } = useNav();
  if (!txs.length) return <div className="empty small">{empty || 'Keine Buchungen'}</div>;
  return (
    <div className="list">
      {txs.map((tx) => {
        const amt = displayAmount(tx, accountId, potId);
        const neutral = (tx.kind === 'transfer' && !accountId) || (tx.kind === 'potTransfer' && !potId);
        const pots = tx.kind === 'potTransfer' ? [] : tx.splits.filter((s) => s.potId);
        const subNames = pots.flatMap((s) => {
          const p = potById.get(s.potId!);
          return s.subitemIds.map((id) => p?.subitems.find((x) => x.id === id)?.name).filter(Boolean);
        });
        return (
          <div className="list-item clickable" key={tx.id} onClick={() => editTx(tx.id)}>
            <TxIcon tx={tx} />
            <div className="grow">
              <div className="row" style={{ gap: 6 }}>
                <span className="ellipsis" style={{ fontWeight: 560 }}>
                  {txTitle(tx, potById, accountById)}
                </span>
                {tx.needsReview && <span className="badge warn">offen</span>}
              </div>
              <div className="row wrap small muted" style={{ gap: 6, marginTop: 2 }}>
                <span>{fmtDate(tx.date)}</span>
                {tx.accountId && !accountId && <span className="ellipsis">· {accountLabel(accountById.get(tx.accountId))}</span>}
                {(tx.kind === 'income' || tx.kind === 'expense') &&
                  (pots.length ? pots.map((s, i) => <PotTag key={i} pot={potById.get(s.potId!)} />) : <PotTag />)}
                {subNames.length > 0 && <span className="ellipsis">{subNames.join(', ')}</span>}
              </div>
            </div>
            <Money value={amt} signed={!neutral} colored={!neutral} className="right" />
          </div>
        );
      })}
    </div>
  );
}
