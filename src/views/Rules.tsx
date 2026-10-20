import { useState } from 'react';
import { Play, Plus, Trash2 } from 'lucide-react';
import { useData } from '../hooks';
import { useStore } from '../store';
import type { ID, Rule, RuleAction } from '../types';
import { ruleMatches } from '../lib/rules';
import { ruleToTxFields } from '../lib/applyRule';
import { AccountSelect, accountLabel } from '../components/AccountSelect';
import { SubitemChecklist } from '../components/PotPicker';
import { Empty, Field, Modal, PotTag, confirmDialog, useToast } from '../components/ui';

export function RulesView() {
  const { data, potById, accountById } = useData();
  const store = useStore();
  const toast = useToast();
  const [edit, setEdit] = useState<Rule | 'new' | null>(null);

  const applyToOpen = () => {
    const open = data.transactions.filter((t) => t.needsReview && t.accountId);
    let n = 0;
    const hits: ID[] = [];
    const del: ID[] = [];
    const refs: string[] = [];
    for (const t of open) {
      const rule = data.rules.find((r) => ruleMatches(r, { payee: t.payee, purpose: t.purpose, amount: t.amount, accountId: t.accountId }));
      if (!rule) continue;
      const f = ruleToTxFields(rule, t.amount, t.accountId!);
      if (f) store.updateTransaction(t.id, f);
      else {
        del.push(t.id);
        if (t.importRef) refs.push(t.importRef);
      }
      hits.push(rule.id);
      n++;
    }
    store.deleteTransactions(del);
    store.ignoreImportRefs(refs);
    store.countRuleHits(hits);
    toast(n ? `${n} offene Buchungen zugeordnet` : 'Keine offene Buchung passt zu einer Regel');
  };

  const describe = (a: RuleAction) => {
    if (a.type === 'pot') {
      const p = potById.get(a.potId);
      const subs = a.subitemIds.map((id) => p?.subitems.find((s) => s.id === id)?.name).filter(Boolean);
      return (
        <span className="row wrap" style={{ gap: 6 }}>
          <PotTag pot={p} fallback="Topf gelöscht" />
          {subs.length > 0 && <span className="small muted">{subs.join(', ')}</span>}
        </span>
      );
    }
    if (a.type === 'transfer') return <span className="badge info">Umbuchung ↔ {accountLabel(accountById.get(a.toAccountId))}</span>;
    return <span className="badge">ignorieren</span>;
  };

  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="small muted" style={{ margin: 0, maxWidth: 640 }}>
          Regeln entstehen automatisch in der Fragesession und ordnen künftige Importe zu. Die erste passende Regel (von oben) gewinnt. Mehrere Suchbegriffe
          mit „|“ trennen, z. B. <code>rewe|edeka|aldi</code>.
        </p>
        <div className="row">
          <button className="btn" onClick={applyToOpen}>
            <Play size={16} /> Auf offene anwenden
          </button>
          <button className="btn primary" onClick={() => setEdit('new')}>
            <Plus size={16} /> Regel
          </button>
        </div>
      </div>
      <div className="card flush">
        {data.rules.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Aktiv</th>
                  <th>Wenn</th>
                  <th>Dann</th>
                  <th className="right">Treffer</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rules.map((r) => (
                  <tr key={r.id} className={`clickable${r.enabled ? '' : ' dim'}`} onClick={() => setEdit(r)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={r.enabled} onChange={(e) => store.updateRule(r.id, { enabled: e.target.checked })} />
                    </td>
                    <td>
                      <div className="small muted">
                        {r.field === 'payee' ? 'Empfänger' : r.field === 'purpose' ? 'Verwendungszweck' : 'Empfänger/Zweck'} enthält
                        {r.sign === 'in' ? ' · nur Eingänge' : r.sign === 'out' ? ' · nur Ausgänge' : ''}
                        {r.accountId ? ` · ${accountById.get(r.accountId)?.name}` : ''}
                      </div>
                      <b>{r.pattern}</b>
                    </td>
                    <td>{describe(r.action)}</td>
                    <td className="right num">{r.hits}</td>
                    <td className="right" onClick={(e) => e.stopPropagation()}>
                      <button className="btn ghost icon sm" onClick={() => confirmDialog('Regel löschen?') && store.deleteRule(r.id)} aria-label="Löschen">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="🧭">Noch keine Regeln. Sie entstehen beim Beantworten der Fragesession.</Empty>
        )}
      </div>
      {edit && <RuleEditor rule={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RuleEditor({ rule, onClose }: { rule?: Rule; onClose: () => void }) {
  const { data, activePots, potById } = useData();
  const store = useStore();
  const [field, setField] = useState<Rule['field']>(rule?.field || 'payee');
  const [pattern, setPattern] = useState(rule?.pattern || '');
  const [sign, setSign] = useState<Rule['sign']>(rule?.sign || 'any');
  const [accountId, setAccountId] = useState<ID | undefined>(rule?.accountId);
  const [type, setType] = useState<RuleAction['type']>(rule?.action.type || 'pot');
  const [potId, setPotId] = useState<ID | undefined>(rule?.action.type === 'pot' ? rule.action.potId : activePots[0]?.id);
  const [subs, setSubs] = useState<ID[]>(rule?.action.type === 'pot' ? rule.action.subitemIds : []);
  const [toAccount, setToAccount] = useState<ID | undefined>(rule?.action.type === 'transfer' ? rule.action.toAccountId : undefined);
  const pot = potId ? potById.get(potId) : undefined;

  const valid = pattern.trim() && (type !== 'pot' || potId) && (type !== 'transfer' || toAccount);
  const save = () => {
    if (!valid) return;
    const action: RuleAction =
      type === 'pot' ? { type, potId: potId!, subitemIds: subs } : type === 'transfer' ? { type, toAccountId: toAccount! } : { type: 'ignore' };
    const r = { field, pattern: pattern.trim(), sign, accountId, action };
    if (rule) store.updateRule(rule.id, r);
    else store.addRule(r);
    onClose();
  };

  return (
    <Modal
      title={rule ? 'Regel bearbeiten' : 'Neue Regel'}
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={save} disabled={!valid}>
          Speichern
        </button>
      }
    >
      <div className="form-grid">
        <Field label="Feld">
          <select className="input" value={field} onChange={(e) => setField(e.target.value as Rule['field'])}>
            <option value="payee">Empfänger enthält</option>
            <option value="purpose">Verwendungszweck enthält</option>
            <option value="any">Empfänger oder Zweck enthält</option>
          </select>
        </Field>
        <Field label="Suchbegriff(e)" hint="Groß/klein egal, Alternativen mit |">
          <input className="input" value={pattern} onChange={(e) => setPattern(e.target.value)} autoFocus />
        </Field>
        <Field label="Richtung">
          <select className="input" value={sign} onChange={(e) => setSign(e.target.value as Rule['sign'])}>
            <option value="any">Ein- und Ausgänge</option>
            <option value="out">nur Ausgänge</option>
            <option value="in">nur Eingänge</option>
          </select>
        </Field>
        <Field label="Nur für Konto">
          <AccountSelect accounts={data.accounts} value={accountId} onChange={setAccountId} placeholder="alle Konten" />
        </Field>
      </div>
      <Field label="Dann">
        <select className="input" value={type} onChange={(e) => setType(e.target.value as RuleAction['type'])}>
          <option value="pot">Topf zuordnen</option>
          <option value="transfer">Umbuchung mit eigenem Konto</option>
          <option value="ignore">Ignorieren</option>
        </select>
      </Field>
      {type === 'pot' && (
        <>
          <select className="input" value={potId} onChange={(e) => (setPotId(e.target.value), setSubs([]))}>
            {activePots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon} {p.name}
              </option>
            ))}
          </select>
          {pot && <SubitemChecklist pot={pot} selected={subs} onChange={setSubs} />}
        </>
      )}
      {type === 'transfer' && <AccountSelect accounts={data.accounts} value={toAccount} onChange={setToAccount} placeholder="– Gegenkonto –" />}
    </Modal>
  );
}
