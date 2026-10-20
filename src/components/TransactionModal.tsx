import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus, Shuffle, Split as SplitIcon, Trash2, Wand2 } from 'lucide-react';
import type { ID, Split, Transaction, TxKind } from '../types';
import { useData } from '../hooks';
import { useStore } from '../store';
import { distribute } from '../lib/calc';
import { fmtEur, today } from '../lib/format';
import { findRule } from '../lib/rules';
import { AccountSelect } from './AccountSelect';
import { PotChips, SubitemChecklist } from './PotPicker';
import { Field, Modal, Money, MoneyInput, Segmented, confirmDialog, useToast } from './ui';

type UiKind = Exclude<TxKind, 'adjustment'>;
interface UiSplit {
  potId: ID | null;
  amount: number | null; // positive cents
  subitemIds: ID[];
}

export function TransactionModal({
  tx,
  preset,
  onClose,
}: {
  tx?: Transaction;
  preset?: Partial<Transaction>;
  onClose: () => void;
}) {
  const { data, activePots, potById } = useData();
  const { addTransaction, updateTransaction, deleteTransactions } = useStore();
  const toast = useToast();
  const src = tx || preset || {};
  const initialKind: UiKind = (src.kind === 'adjustment' ? 'expense' : src.kind) || 'expense';

  const [kind, setKind] = useState<UiKind>(initialKind);
  const [amount, setAmount] = useState<number | null>(src.amount !== undefined ? Math.abs(src.amount) : null);
  const [date, setDate] = useState(src.date || today());
  const defaultAccount = data.settings.lastAccountId && data.accounts.some((a) => a.id === data.settings.lastAccountId && !a.archived)
    ? data.settings.lastAccountId
    : data.accounts.find((a) => !a.archived && a.inBudget)?.id;
  const [accountId, setAccountId] = useState<ID | undefined>(src.accountId || defaultAccount);
  const [toAccountId, setToAccountId] = useState<ID | undefined>(src.toAccountId);
  const [payee, setPayee] = useState(src.payee || '');
  const [note, setNote] = useState(src.note || '');
  const initialSplits: UiSplit[] =
    src.kind === 'potTransfer'
      ? []
      : (src.splits || []).map((s) => ({ potId: s.potId, amount: Math.abs(s.amount), subitemIds: s.subitemIds }));
  const [splitMode, setSplitMode] = useState(initialSplits.length > 1);
  const [single, setSingle] = useState<{ potId: ID | null; subitemIds: ID[] }>({
    potId: initialSplits[0]?.potId ?? null,
    subitemIds: initialSplits[0]?.subitemIds ?? [],
  });
  const [splits, setSplits] = useState<UiSplit[]>(initialSplits.length > 1 ? initialSplits : []);
  const [fromPot, setFromPot] = useState<ID | null>(
    src.kind === 'potTransfer' ? (src.splits?.find((s) => s.amount < 0)?.potId ?? null) : null,
  );
  const [toPot, setToPot] = useState<ID | null>(
    src.kind === 'potTransfer' ? (src.splits?.find((s) => s.amount > 0)?.potId ?? null) : activePots[0]?.id ?? null,
  );
  const [error, setError] = useState('');

  const payees = useMemo(() => {
    const set = new Set<string>();
    for (const t of data.transactions) if (t.payee) set.add(t.payee);
    return [...set].sort((a, b) => a.localeCompare(b)).slice(0, 400);
  }, [data.transactions]);

  const splitSum = splits.reduce((a, s) => a + (s.amount || 0), 0);
  const remaining = (amount || 0) - splitSum;
  const pot = single.potId ? potById.get(single.potId) : undefined;

  const onPayeeChange = (v: string) => {
    setPayee(v);
    if (tx || single.potId || splitMode) return;
    // Suggest the pot from the last booking with this payee, or from a matching rule.
    const prev = [...data.transactions].reverse().find((t) => t.payee && t.payee.toLowerCase() === v.trim().toLowerCase() && t.splits.length);
    if (prev && prev.splits[0].potId) {
      setSingle({ potId: prev.splits[0].potId, subitemIds: prev.splits[0].subitemIds });
      return;
    }
    const rule = v.length > 2 ? findRule(data.rules, { payee: v, amount: kind === 'income' ? 1 : -1, accountId }) : undefined;
    if (rule?.action.type === 'pot') setSingle({ potId: rule.action.potId, subitemIds: rule.action.subitemIds });
  };

  const enterSplitMode = () => {
    setSplits([
      { potId: single.potId, amount: amount, subitemIds: single.subitemIds },
      { potId: null, amount: null, subitemIds: [] },
    ]);
    setSplitMode(true);
  };

  const distributeByContribution = () => {
    const withContribution = activePots.filter((p) => p.monthlyContribution && p.monthlyContribution > 0);
    if (!withContribution.length || !amount) {
      toast('Keine Soll-Zuführungen hinterlegt – im Topf unter „Bearbeiten“ eintragen.');
      return;
    }
    const wanted = withContribution.map((p) => p.monthlyContribution!);
    const total = wanted.reduce((a, b) => a + b, 0);
    const amounts = total <= amount ? wanted : distribute(amount, wanted);
    setSplits(withContribution.map((p, i) => ({ potId: p.id, amount: amounts[i], subitemIds: [] })));
    setSplitMode(true);
  };

  const build = (): Omit<Transaction, 'id' | 'createdAt'> | null => {
    if (!amount || amount <= 0) return fail('Bitte einen Betrag eingeben.');
    const base = { date, payee: payee.trim() || undefined, note: note.trim() || undefined, source: tx?.source || ('manual' as const), importRef: tx?.importRef, purpose: tx?.purpose };
    if (kind === 'potTransfer') {
      if (fromPot === toPot) return fail('Quelle und Ziel müssen verschieden sein.');
      return { ...base, kind, amount, splits: [{ potId: fromPot, amount: -amount, subitemIds: [] }, { potId: toPot, amount, subitemIds: [] }], needsReview: false };
    }
    if (!accountId) return fail('Bitte ein Konto wählen.');
    if (kind === 'transfer') {
      if (!toAccountId || toAccountId === accountId) return fail('Bitte ein anderes Zielkonto wählen.');
      return { ...base, kind, amount, accountId, toAccountId, splits: [], needsReview: false };
    }
    const sign = kind === 'income' ? 1 : -1;
    let out: Split[];
    if (splitMode) {
      if (remaining < 0) return fail(`Die Aufteilung übersteigt den Betrag um ${fmtEur(-remaining)}.`);
      out = splits.filter((s) => s.amount).map((s) => ({ potId: s.potId, amount: sign * (s.amount || 0), subitemIds: s.potId ? s.subitemIds : [] }));
    } else {
      out = single.potId ? [{ potId: single.potId, amount: sign * amount, subitemIds: single.subitemIds }] : [];
    }
    const assigned = out.some((s) => s.potId);
    return { ...base, kind, amount: sign * amount, accountId, splits: out, needsReview: tx?.needsReview && !assigned ? true : false };
  };

  function fail(msg: string): null {
    setError(msg);
    return null;
  }

  const save = (again: boolean) => {
    const t = build();
    if (!t) return;
    if (tx) {
      updateTransaction(tx.id, { ...t, toAccountId: t.toAccountId });
      toast('Buchung aktualisiert');
      onClose();
      return;
    }
    addTransaction(t);
    toast(`${kind === 'income' ? 'Einnahme' : kind === 'expense' ? 'Ausgabe' : 'Umbuchung'} über ${fmtEur(amount!)} gespeichert`);
    if (again) {
      setAmount(null);
      setPayee('');
      setNote('');
      setSingle({ potId: null, subitemIds: [] });
      setSplits([]);
      setSplitMode(false);
      setError('');
    } else onClose();
  };

  const remove = () => {
    if (tx && confirmDialog('Diese Buchung löschen?')) {
      deleteTransactions([tx.id]);
      toast('Buchung gelöscht');
      onClose();
    }
  };

  return (
    <Modal
      title={tx ? 'Buchung bearbeiten' : 'Neue Buchung'}
      onClose={onClose}
      footer={
        <>
          {tx && (
            <button className="btn danger" onClick={remove} style={{ marginRight: 'auto' }}>
              <Trash2 size={16} /> Löschen
            </button>
          )}
          {!tx && (
            <button className="btn" onClick={() => save(true)}>
              Speichern & weitere
            </button>
          )}
          <button className="btn primary" onClick={() => save(false)}>
            Speichern
          </button>
        </>
      }
    >
      <form
        className="stack lg"
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
      >
        <Segmented<UiKind>
          full
          value={kind}
          onChange={(k) => {
            setKind(k);
            setError('');
          }}
          options={[
            { value: 'expense', label: <><ArrowUpRight size={16} /> Ausgabe</>, className: 'expense' },
            { value: 'income', label: <><ArrowDownLeft size={16} /> Einnahme</>, className: 'income' },
            { value: 'transfer', label: <><ArrowLeftRight size={16} /> Umbuchung</> },
            { value: 'potTransfer', label: <><Shuffle size={16} /> Umschichten</> },
          ]}
        />

        <div className="form-grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
          <Field label="Betrag (€)">
            <MoneyInput className="input amount" value={amount} onChange={setAmount} autoFocus={!tx} />
          </Field>
          <Field label="Datum">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ height: 54 }} />
          </Field>
        </div>

        {kind !== 'potTransfer' && (
          <div className="form-grid">
            <Field label={kind === 'transfer' ? 'Von Konto' : 'Konto'}>
              <AccountSelect accounts={data.accounts} value={accountId} onChange={setAccountId} placeholder="– Konto wählen –" />
            </Field>
            {kind === 'transfer' ? (
              <Field label="Auf Konto">
                <AccountSelect accounts={data.accounts} value={toAccountId} onChange={setToAccountId} placeholder="– Zielkonto –" exclude={accountId} />
              </Field>
            ) : (
              <Field label={kind === 'income' ? 'Von (Zahler)' : 'Empfänger / Beschreibung'}>
                <input className="input" list="payees" value={payee} onChange={(e) => onPayeeChange(e.target.value)} placeholder={kind === 'income' ? 'z. B. Arbeitgeber' : 'z. B. REWE'} />
                <datalist id="payees">
                  {payees.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </Field>
            )}
          </div>
        )}

        {kind === 'potTransfer' && (
          <div className="stack">
            <div className="stack sm">
              <span className="label-text">Von Topf</span>
              <PotChips pots={activePots} value={fromPot} onChange={setFromPot} />
            </div>
            <div className="stack sm">
              <span className="label-text">Nach Topf</span>
              <PotChips pots={activePots} value={toPot} onChange={setToPot} />
            </div>
          </div>
        )}

        {(kind === 'income' || kind === 'expense') && !splitMode && (
          <div className="stack">
            <div className="row between">
              <span className="label-text">Topf</span>
              <div className="row">
                {kind === 'income' && (
                  <button type="button" className="btn sm ghost" onClick={distributeByContribution} title="Nach den Soll-Zuführungen der Töpfe verteilen">
                    <Wand2 size={14} /> Auf Töpfe verteilen
                  </button>
                )}
                <button type="button" className="btn sm ghost" onClick={enterSplitMode}>
                  <SplitIcon size={14} /> Aufteilen
                </button>
              </div>
            </div>
            <PotChips pots={activePots} value={single.potId} onChange={(id) => setSingle({ potId: id, subitemIds: [] })} />
            {pot && (
              <div className="stack sm">
                <span className="label-text">Unterpunkte in {pot.name}</span>
                <SubitemChecklist pot={pot} selected={single.subitemIds} onChange={(ids) => setSingle({ ...single, subitemIds: ids })} />
              </div>
            )}
          </div>
        )}

        {(kind === 'income' || kind === 'expense') && splitMode && (
          <div className="stack">
            <div className="row between">
              <span className="label-text">Aufteilung auf Töpfe</span>
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => {
                  const first = splits.find((s) => s.potId);
                  setSingle({ potId: first?.potId ?? null, subitemIds: first?.subitemIds ?? [] });
                  setSplitMode(false);
                }}
              >
                Ein Topf
              </button>
            </div>
            {splits.map((s, i) => {
              const p = s.potId ? potById.get(s.potId) : undefined;
              const upd = (patch: Partial<UiSplit>) => setSplits(splits.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div className="split-row" key={i}>
                  <div className="stack sm">
                    <select className="input sm" value={s.potId || ''} onChange={(e) => upd({ potId: e.target.value || null, subitemIds: [] })}>
                      <option value="">Nicht verteilt</option>
                      {activePots.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.icon} {p.name}
                        </option>
                      ))}
                    </select>
                    {p && <SubitemChecklist pot={p} selected={s.subitemIds} onChange={(ids) => upd({ subitemIds: ids })} />}
                  </div>
                  <MoneyInput className="input sm right" value={s.amount} onChange={(v) => upd({ amount: v })} />
                  <button type="button" className="btn ghost icon sm" onClick={() => setSplits(splits.filter((_, j) => j !== i))} aria-label="Zeile entfernen">
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
            <div className="row between wrap">
              <div className="row">
                <button type="button" className="btn sm" onClick={() => setSplits([...splits, { potId: null, amount: remaining > 0 ? remaining : null, subitemIds: [] }])}>
                  <Plus size={14} /> Zeile
                </button>
                {kind === 'income' && (
                  <button type="button" className="btn sm" onClick={distributeByContribution}>
                    <Wand2 size={14} /> Soll-Zuführungen
                  </button>
                )}
              </div>
              <span className={`small ${remaining < 0 ? 'neg' : remaining > 0 ? 'warn-text' : 'pos'}`}>
                {remaining === 0 ? 'Vollständig verteilt' : remaining > 0 ? <>Rest <Money value={remaining} /> → nicht verteilt</> : <>Zu viel verteilt: <Money value={-remaining} /></>}
              </span>
            </div>
          </div>
        )}

        <Field label="Notiz">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
        </Field>
        {tx?.purpose && <div className="small muted">Verwendungszweck: {tx.purpose}</div>}
        {error && <div className="alert bad small">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
