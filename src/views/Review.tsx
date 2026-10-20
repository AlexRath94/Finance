import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Ban, CheckCircle2, ChevronRight, PiggyBank, SkipForward, SlidersHorizontal, Undo2 } from 'lucide-react';
import { useData, useNav } from '../hooks';
import { useStore } from '../store';
import type { ID, Rule, RuleAction, Transaction } from '../types';
import { fmtDate } from '../lib/format';
import { ruleMatches, suggestPattern } from '../lib/rules';
import { ruleToTxFields } from '../lib/applyRule';
import { AccountSelect, accountLabel } from '../components/AccountSelect';
import { SubitemChecklist } from '../components/PotPicker';
import { Money, Progress, Segmented, useToast } from '../components/ui';

type Mode = 'pot' | 'transfer' | 'ignore';

interface UndoState {
  tx: Transaction;
  deleted: boolean;
  ruleId?: ID;
  autoAssigned: Transaction[];
  ignoredRef?: string;
}

export function Review() {
  const { data, activePots, potById, accountById } = useData();
  const store = useStore();
  const { editTx } = useNav();
  const toast = useToast();

  const queue = useMemo(
    () => data.transactions.filter((t) => t.needsReview).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt),
    [data.transactions],
  );
  const [startCount] = useState(queue.length);
  const [skipped, setSkipped] = useState<ID[]>([]);
  const current = queue.find((t) => !skipped.includes(t.id)) || (skipped.length ? undefined : queue[0]);

  const [mode, setMode] = useState<Mode>('pot');
  const [potId, setPotId] = useState<ID | null>(null);
  const [subs, setSubs] = useState<ID[]>([]);
  const [toAccount, setToAccount] = useState<ID | undefined>();
  const [remember, setRemember] = useState(true);
  const [ruleField, setRuleField] = useState<Rule['field']>('payee');
  const [pattern, setPattern] = useState('');
  const [undo, setUndo] = useState<UndoState | null>(null);

  // Reset the answer form whenever a new question comes up.
  useEffect(() => {
    if (!current) return;
    setMode('pot');
    setPotId(null);
    setSubs([]);
    setToAccount(undefined);
    const s = suggestPattern(current.payee, current.purpose);
    setRuleField(s.field);
    setPattern(s.pattern);
    setRemember(!!s.pattern);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const draftRule = (action: RuleAction): Rule | null =>
    current && remember && pattern.trim()
      ? { id: '_draft', field: ruleField, pattern: pattern.trim(), sign: current.amount < 0 ? 'out' : 'in', action, hits: 0, enabled: true, createdAt: 0 }
      : null;

  const similar = useMemo(() => {
    if (!current || !remember || !pattern.trim()) return 0;
    const r = draftRule({ type: 'ignore' });
    return r ? queue.filter((t) => t.id !== current.id && ruleMatches(r, { payee: t.payee, purpose: t.purpose, amount: t.amount, accountId: t.accountId })).length : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, remember, pattern, ruleField, queue]);

  const answer = (m: Mode = mode) => {
    if (!current || !current.accountId) return;
    let action: RuleAction;
    if (m === 'pot') {
      if (!potId) return toast('Bitte einen Topf wählen');
      action = { type: 'pot', potId, subitemIds: subs };
    } else if (m === 'transfer') {
      if (!toAccount) return toast('Bitte das Gegenkonto wählen');
      action = { type: 'transfer', toAccountId: toAccount };
    } else action = { type: 'ignore' };

    const rule = draftRule(action);
    const state: UndoState = { tx: current, deleted: false, autoAssigned: [] };
    const fields = ruleToTxFields({ action } as Rule, current.amount, current.accountId);
    if (!fields) {
      store.deleteTransactions([current.id]);
      if (current.importRef) {
        store.ignoreImportRefs([current.importRef]);
        state.ignoredRef = current.importRef;
      }
      state.deleted = true;
    } else store.updateTransaction(current.id, fields);

    if (rule) {
      const { id: _draft, hits: _h, enabled: _e, createdAt: _c, ...ruleData } = rule;
      state.ruleId = store.addRule(ruleData);
      // Apply the new rule to the other open questions right away.
      const matches = queue.filter((t) => t.id !== current.id && ruleMatches(rule, { payee: t.payee, purpose: t.purpose, amount: t.amount, accountId: t.accountId }));
      const toDelete: ID[] = [];
      for (const t of matches) {
        state.autoAssigned.push(t);
        const f = ruleToTxFields(rule, t.amount, t.accountId!);
        if (f) store.updateTransaction(t.id, f);
        else toDelete.push(t.id);
      }
      if (toDelete.length) {
        store.deleteTransactions(toDelete);
        store.ignoreImportRefs(matches.filter((t) => toDelete.includes(t.id) && t.importRef).map((t) => t.importRef!));
      }
      if (matches.length) {
        store.countRuleHits(matches.map(() => state.ruleId!));
        toast(`${matches.length} weitere Buchung${matches.length === 1 ? '' : 'en'} automatisch zugeordnet`);
      }
    }
    setUndo(state);
  };

  const doUndo = () => {
    if (!undo) return;
    const s = useStore.getState();
    const restore = [undo.tx, ...undo.autoAssigned];
    const ids = new Set(restore.map((t) => t.id));
    useStore.setState({
      transactions: [...s.transactions.filter((t) => !ids.has(t.id)), ...restore],
      rules: undo.ruleId ? s.rules.filter((r) => r.id !== undo.ruleId) : s.rules,
      ignoredImportRefs: s.ignoredImportRefs.filter((r) => r !== undo.ignoredRef && !undo.autoAssigned.some((t) => t.importRef === r)),
    });
    setSkipped((sk) => sk.filter((id) => id !== undo.tx.id));
    setUndo(null);
  };

  // Keyboard: 1–9 picks a pot, Enter saves, S skips.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || document.querySelector('.modal')) return;
      if (/^[1-9]$/.test(e.key) && mode === 'pot') {
        const p = activePots[+e.key - 1];
        if (p) {
          setPotId(p.id);
          setSubs([]);
        }
      } else if (e.key === 'Enter') answer();
      else if (e.key.toLowerCase() === 's' && current) setSkipped((s) => [...s, current.id]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const total = Math.max(startCount, queue.length);
  const done = total - queue.length;

  if (!current) {
    return (
      <div className="card stack" style={{ textAlign: 'center', padding: 40, alignItems: 'center' }}>
        <CheckCircle2 size={44} color="var(--ok)" />
        <h2>{queue.length ? `${queue.length} übersprungene Fragen offen` : 'Alles zugeordnet!'}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {queue.length ? 'Übersprungene Buchungen bleiben „offen“ und können jederzeit hier geklärt werden.' : 'Es gibt keine offenen importierten Buchungen.'}
        </p>
        <div className="row">
          {undo && (
            <button className="btn" onClick={doUndo}>
              <Undo2 size={16} /> Letzte Antwort rückgängig
            </button>
          )}
          {queue.length > 0 && (
            <button className="btn primary" onClick={() => setSkipped([])}>
              Übersprungene erneut durchgehen
            </button>
          )}
        </div>
      </div>
    );
  }

  const pot = potId ? potById.get(potId) : undefined;
  const acc = current.accountId ? accountById.get(current.accountId) : undefined;
  const isOut = current.amount < 0;

  return (
    <div className="stack lg" style={{ maxWidth: 860 }}>
      <div className="stack sm">
        <div className="row between small">
          <span className="muted">
            Frage {done + 1} von {total}
            {skipped.length ? ` · ${skipped.length} übersprungen` : ''}
          </span>
          {undo && (
            <button className="btn sm ghost" onClick={doUndo}>
              <Undo2 size={14} /> Rückgängig
            </button>
          )}
        </div>
        <Progress value={done} max={total} />
      </div>

      <div className="question-card stack lg">
        <div className="row between top wrap">
          <div className="stack sm" style={{ gap: 2, minWidth: 0, flex: 1 }}>
            <span className="small muted">
              {fmtDate(current.date)} · {accountLabel(acc)}
            </span>
            <h2 style={{ fontSize: '1.3rem', wordBreak: 'break-word' }}>{current.payee || current.purpose || 'Unbekannte Buchung'}</h2>
            {current.payee && current.purpose && <span className="small muted" style={{ wordBreak: 'break-word' }}>{current.purpose}</span>}
          </div>
          <div className={`question-amount ${isOut ? 'neg' : 'pos'}`}>
            <Money value={current.amount} signed />
          </div>
        </div>

        <div className="stack">
          <span style={{ fontWeight: 600 }}>{isOut ? 'Wofür war diese Ausgabe?' : 'Woher kommt dieses Geld / wohin soll es?'}</span>
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'pot', label: <><PiggyBank size={15} /> Topf</> },
              { value: 'transfer', label: <><ArrowLeftRight size={15} /> Umbuchung eigenes Konto</> },
              { value: 'ignore', label: <><Ban size={15} /> Ignorieren</> },
            ]}
          />
        </div>

        {mode === 'pot' && (
          <div className="stack">
            <div className="pot-btn-grid">
              {activePots.map((p, i) => (
                <button
                  key={p.id}
                  className={`pot-btn${potId === p.id ? ' selected' : ''}`}
                  style={{ ['--c' as string]: p.color }}
                  onClick={() => {
                    setPotId(p.id);
                    setSubs([]);
                  }}
                >
                  <span style={{ fontSize: '1.15rem' }}>{p.icon}</span>
                  <span className="grow ellipsis">{p.name}</span>
                  {i < 9 && <span className="kbd">{i + 1}</span>}
                </button>
              ))}
            </div>
            {pot && (
              <div className="stack sm">
                <span className="label-text">Unterpunkte (optional, mehrere möglich)</span>
                <SubitemChecklist pot={pot} selected={subs} onChange={setSubs} />
              </div>
            )}
          </div>
        )}

        {mode === 'transfer' && (
          <div className="stack sm">
            <span className="label-text">{isOut ? 'Geld ging auf Konto' : 'Geld kam von Konto'}</span>
            <AccountSelect accounts={data.accounts} value={toAccount} onChange={setToAccount} placeholder="– Konto wählen –" exclude={current.accountId} />
            <span className="tiny muted">Umbuchungen zwischen eigenen Konten verändern weder Töpfe noch Gesamtvermögen.</span>
          </div>
        )}

        {mode === 'ignore' && (
          <div className="small muted">Die Buchung wird entfernt und bei künftigen Importen übersprungen (z. B. interne Verrechnungen).</div>
        )}

        <div className="stack sm" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>Merken und künftig automatisch so zuordnen</span>
          </label>
          {remember && (
            <div className="row wrap">
              <select className="input sm" style={{ width: 'auto' }} value={ruleField} onChange={(e) => setRuleField(e.target.value as Rule['field'])}>
                <option value="payee">Empfänger enthält</option>
                <option value="purpose">Verwendungszweck enthält</option>
                <option value="any">Empfänger oder Zweck enthält</option>
              </select>
              <input className="input sm grow" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Suchbegriff" />
              {similar > 0 && <span className="badge ok">+{similar} weitere offene passen</span>}
            </div>
          )}
        </div>

        <div className="row between wrap">
          <div className="row">
            <button className="btn" onClick={() => setSkipped((s) => [...s, current.id])}>
              <SkipForward size={16} /> Überspringen <span className="kbd">S</span>
            </button>
            <button className="btn ghost" onClick={() => editTx(current.id)} title="Aufteilen auf mehrere Töpfe, Notiz usw.">
              <SlidersHorizontal size={16} /> Erweitert
            </button>
          </div>
          <button className="btn primary lg" onClick={() => answer()}>
            Speichern & weiter <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
