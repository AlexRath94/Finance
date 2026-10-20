import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Shuffle, Trash2, Wand2 } from 'lucide-react';
import { useData, useNav } from '../hooks';
import { POT_COLORS, useStore } from '../store';
import type { ID, Pot } from '../types';
import { distribute, potMonthStats, potStatus, type PotStatus } from '../lib/calc';
import { currentMonth, fmtEur, fmtMonth, shiftMonth, today, uid } from '../lib/format';
import { Field, Modal, Money, MoneyInput, Progress, StatusBadge, confirmDialog, useToast } from '../components/ui';
import { TxList } from '../components/TxList';

const ICONS = ['🏠', '🛒', '🚗', '🎉', '🛟', '🏖️', '💡', '📱', '👶', '🐶', '🎁', '💊', '📚', '👕', '🔧', '💻', '✈️', '🏋️', '🍽️', '💰', '📈', '🧾', '🎓', '🚲', '❤️', '🏦'];

function statusLabel(s: PotStatus) {
  if (s.status === 'bad') return 'Unterdeckung';
  if (s.status === 'warn') return s.reasons[0] || 'Achtung';
  return 'gedeckt';
}

export function Pots() {
  const { data, potBal, free, sortedPots } = useData();
  const { params } = useNav();
  const [month, setMonth] = useState(currentMonth());
  const [detail, setDetail] = useState<ID | null>(params.potId || null);
  const [edit, setEdit] = useState<Pot | 'new' | null>(null);
  const [distributeOpen, setDistributeOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const rows = useMemo(
    () =>
      sortedPots
        .filter((p) => showArchived || !p.archived)
        .map((p) => {
          const bal = potBal.get(p.id) || 0;
          const m = potMonthStats(data.transactions, p.id, month);
          return { pot: p, bal, m, status: potStatus(p, bal, m) };
        }),
    [sortedPots, potBal, data.transactions, month, showArchived],
  );
  const totalInPots = rows.reduce((a, r) => a + r.bal, 0);
  const shortfall = rows.filter((r) => r.bal < 0).reduce((a, r) => a - r.bal, 0);
  const detailPot = detail ? data.pots.find((p) => p.id === detail) : undefined;

  return (
    <div className="stack lg">
      <div className="page-head">
        <div>
          <h1>Töpfe</h1>
          <p className="muted">Eingezahltes Geld wird pro Topf summiert, Ausgaben werden abgezogen.</p>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={() => setDistributeOpen(true)}>
            <Wand2 size={16} /> Geld verteilen
          </button>
          <button className="btn primary" onClick={() => setEdit('new')}>
            <Plus size={16} /> Topf
          </button>
        </div>
      </div>

      <div className="grid kpi">
        <div className="card kpi-card">
          <div className="label">In Töpfen</div>
          <div className="value">{fmtEur(totalInPots)}</div>
        </div>
        <div className={`card kpi-card`} style={free < 0 ? { borderColor: 'var(--bad)' } : undefined}>
          <div className="label">Nicht verteilt</div>
          <div className={`value ${free < 0 ? 'neg' : ''}`}>{fmtEur(free)}</div>
          <div className="sub">{free < 0 ? 'Mehr verteilt als vorhanden!' : 'Frei auf Budget-Konten'}</div>
        </div>
        <div className="card kpi-card">
          <div className="label">Unterdeckung gesamt</div>
          <div className={`value ${shortfall ? 'neg' : 'pos'}`}>{fmtEur(shortfall)}</div>
          <div className="sub">{rows.filter((r) => r.bal < 0).length} Töpfe im Minus</div>
        </div>
      </div>

      <div className="row between wrap">
        <div className="row" style={{ gap: 4 }}>
          <button className="btn sm" onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <span style={{ minWidth: 140, textAlign: 'center', fontWeight: 600 }}>{fmtMonth(month)}</span>
          <button className="btn sm" onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
        </div>
        <label className="check small">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> archivierte zeigen
        </label>
      </div>

      <div className="grid pots">
        {rows.map(({ pot, bal, m, status }) => (
          <div
            key={pot.id}
            className={`card pot-card status-${status.status}`}
            style={{ ['--c' as string]: pot.color, opacity: pot.archived ? 0.6 : 1 }}
            onClick={() => setDetail(pot.id)}
          >
            <div className="row between top">
              <div className="row">
                <div className="pot-icon">{pot.icon}</div>
                <div>
                  <h3>{pot.name}</h3>
                  <div className="tiny muted">{pot.subitems.filter((s) => !s.archived).length} Unterpunkte</div>
                </div>
              </div>
              <StatusBadge status={status.status}>{statusLabel(status)}</StatusBadge>
            </div>
            <div className={`pot-balance ${bal < 0 ? 'neg' : ''}`}>{fmtEur(bal)}</div>
            <div className="stack sm">
              {pot.monthlyBudget ? (
                <>
                  <div className="row between tiny muted">
                    <span>Ausgaben {fmtEur(m.spent)}</span>
                    <span>Budget {fmtEur(pot.monthlyBudget)}</span>
                  </div>
                  <Progress value={m.spent} max={pot.monthlyBudget} status={status.status} color={pot.color} />
                </>
              ) : (
                <div className="row between tiny muted">
                  <span>Ausgaben {fmtEur(m.spent)}</span>
                  <span>Zugänge {fmtEur(m.inflow)}</span>
                </div>
              )}
              {pot.targetAmount ? (
                <>
                  <div className="row between tiny muted">
                    <span>Ziel {fmtEur(pot.targetAmount)}</span>
                    <span>{Math.max(0, Math.round((bal / pot.targetAmount) * 100))} %</span>
                  </div>
                  <Progress value={bal} max={pot.targetAmount} color={pot.color} />
                </>
              ) : null}
              {pot.monthlyContribution ? <div className="tiny muted">Soll-Zuführung {fmtEur(pot.monthlyContribution)} / Monat</div> : null}
            </div>
          </div>
        ))}
        <button className="card pot-card" style={{ ['--c' as string]: 'var(--border)', borderStyle: 'dashed', display: 'grid', placeItems: 'center', minHeight: 170, color: 'var(--muted)' }} onClick={() => setEdit('new')}>
          <span className="row">
            <Plus size={18} /> Neuer Topf
          </span>
        </button>
      </div>

      {detailPot && <PotDetail pot={detailPot} month={month} onClose={() => setDetail(null)} onEdit={() => setEdit(detailPot)} />}
      {edit && <PotEditor pot={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {distributeOpen && <DistributeModal onClose={() => setDistributeOpen(false)} />}
    </div>
  );
}

function PotDetail({ pot, month, onClose, onEdit }: { pot: Pot; month: string; onClose: () => void; onEdit: () => void }) {
  const { data, potBal } = useData();
  const { newTx } = useNav();
  const { movePot } = useStore();
  const bal = potBal.get(pot.id) || 0;
  const m = potMonthStats(data.transactions, pot.id, month);
  const status = potStatus(pot, bal, m);
  const [range, setRange] = useState<'month' | 'all'>('month');
  const txs = useMemo(
    () =>
      data.transactions
        .filter((t) => t.splits.some((s) => s.potId === pot.id) && (range === 'all' || t.date.startsWith(month)))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [data.transactions, pot.id, month, range],
  );
  const subTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of txs)
      for (const s of t.splits)
        if (s.potId === pot.id && s.amount < 0) for (const k of s.subitemIds.length ? s.subitemIds : ['_none']) map.set(k, (map.get(k) || 0) - s.amount);
    return map;
  }, [txs, pot.id]);
  const maxSub = Math.max(1, ...subTotals.values());

  return (
    <Modal
      wide
      title={
        <span className="row">
          <span className="pot-icon" style={{ ['--c' as string]: pot.color }}>
            {pot.icon}
          </span>
          {pot.name}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost icon" title="Nach vorne" onClick={() => movePot(pot.id, -1)}>
            <ArrowUp size={16} />
          </button>
          <button className="btn ghost icon" title="Nach hinten" onClick={() => movePot(pot.id, 1)} style={{ marginRight: 'auto' }}>
            <ArrowDown size={16} />
          </button>
          <button className="btn" onClick={() => newTx({ kind: 'potTransfer', splits: [{ potId: null, amount: -1, subitemIds: [] }, { potId: pot.id, amount: 1, subitemIds: [] }] })}>
            <Shuffle size={16} /> Umschichten
          </button>
          <button className="btn" onClick={onEdit}>
            <Pencil size={16} /> Bearbeiten
          </button>
          <button className="btn primary" onClick={() => newTx({ kind: 'expense', splits: [{ potId: pot.id, amount: 0, subitemIds: [] }] })}>
            <Plus size={16} /> Buchung
          </button>
        </>
      }
    >
      <div className="grid kpi">
        <div>
          <div className="label-text">Stand</div>
          <div className={`pot-balance ${bal < 0 ? 'neg' : ''}`} style={{ margin: '4px 0' }}>
            {fmtEur(bal)}
          </div>
          <StatusBadge status={status.status}>{statusLabel(status)}</StatusBadge>
        </div>
        <div>
          <div className="label-text">Ausgaben {fmtMonth(month)}</div>
          <div className="pot-balance" style={{ margin: '4px 0' }}>
            {fmtEur(m.spent)}
          </div>
          {pot.monthlyBudget ? <span className="small muted">von {fmtEur(pot.monthlyBudget)} Budget</span> : null}
        </div>
        <div>
          <div className="label-text">Zugänge {fmtMonth(month)}</div>
          <div className="pot-balance pos" style={{ margin: '4px 0' }}>
            {fmtEur(m.inflow)}
          </div>
          {pot.monthlyContribution ? <span className="small muted">Soll {fmtEur(pot.monthlyContribution)}</span> : null}
        </div>
      </div>

      <div className="row between">
        <h3>Ausgaben nach Unterpunkten</h3>
        <div className="segmented">
          <button className={range === 'month' ? 'active' : ''} onClick={() => setRange('month')}>
            Monat
          </button>
          <button className={range === 'all' ? 'active' : ''} onClick={() => setRange('all')}>
            Gesamt
          </button>
        </div>
      </div>
      {subTotals.size ? (
        <div className="stack sm">
          {[...subTotals.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([id, v]) => (
              <div key={id} className="row small">
                <span style={{ width: 150 }} className="ellipsis">
                  {id === '_none' ? <i className="muted">ohne Unterpunkt</i> : pot.subitems.find((s) => s.id === id)?.name || '?'}
                </span>
                <div className="grow">
                  <Progress value={v} max={maxSub} color={pot.color} />
                </div>
                <Money value={v} className="right" />
              </div>
            ))}
          <span className="tiny muted">Buchungen mit mehreren angekreuzten Unterpunkten zählen bei jedem davon.</span>
        </div>
      ) : (
        <div className="small muted">Keine Ausgaben im Zeitraum.</div>
      )}

      <h3>Buchungen</h3>
      <div className="card flush">
        <TxList txs={txs} potId={pot.id} />
      </div>
    </Modal>
  );
}

function PotEditor({ pot, onClose }: { pot?: Pot; onClose: () => void }) {
  const { addPot, updatePot, deletePot, renameSubitem, deleteSubitem, addSubitem } = useStore();
  const { data } = useData();
  const toast = useToast();
  const [name, setName] = useState(pot?.name || '');
  const [icon, setIcon] = useState(pot?.icon || '💰');
  const [color, setColor] = useState(pot?.color || POT_COLORS[data.pots.length % POT_COLORS.length]);
  const [budget, setBudget] = useState<number | null>(pot?.monthlyBudget ?? null);
  const [contribution, setContribution] = useState<number | null>(pot?.monthlyContribution ?? null);
  const [target, setTarget] = useState<number | null>(pot?.targetAmount ?? null);
  const [minBalance, setMinBalance] = useState<number | null>(pot?.minBalance ?? null);
  const [note, setNote] = useState(pot?.note || '');
  const [newSubs, setNewSubs] = useState<string[]>([]);
  const [subName, setSubName] = useState('');
  const livePot = pot ? data.pots.find((p) => p.id === pot.id) : undefined;

  const save = () => {
    if (!name.trim()) return;
    const patch = {
      name: name.trim(),
      icon,
      color,
      monthlyBudget: budget || undefined,
      monthlyContribution: contribution || undefined,
      targetAmount: target || undefined,
      minBalance: minBalance || undefined,
      note: note.trim() || undefined,
    };
    if (pot) updatePot(pot.id, patch);
    else addPot({ ...patch, subitems: newSubs.map((n) => ({ id: uid(), name: n })) });
    toast(pot ? 'Topf gespeichert' : 'Topf angelegt');
    onClose();
  };

  const addSub = () => {
    const n = subName.trim();
    if (!n) return;
    if (pot) addSubitem(pot.id, n);
    else setNewSubs([...newSubs, n]);
    setSubName('');
  };

  return (
    <Modal
      title={pot ? 'Topf bearbeiten' : 'Neuer Topf'}
      onClose={onClose}
      footer={
        <>
          {pot && (
            <>
              <button
                className="btn danger"
                onClick={() => {
                  if (confirmDialog(`Topf „${pot.name}“ löschen? Zugeordnete Buchungen werden „nicht verteilt“.`)) {
                    deletePot(pot.id);
                    onClose();
                  }
                }}
              >
                <Trash2 size={16} /> Löschen
              </button>
              <button className="btn" style={{ marginRight: 'auto' }} onClick={() => (updatePot(pot.id, { archived: !pot.archived }), onClose())}>
                {pot.archived ? 'Reaktivieren' : 'Archivieren'}
              </button>
            </>
          )}
          <button className="btn primary" onClick={save} disabled={!name.trim()}>
            <Check size={16} /> Speichern
          </button>
        </>
      }
    >
      <div className="form-grid" style={{ gridTemplateColumns: '80px 1fr' }}>
        <Field label="Symbol">
          <input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} style={{ textAlign: 'center', fontSize: '1.3rem', padding: 5 }} />
        </Field>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="z. B. Lebensmittel" />
        </Field>
      </div>
      <div className="chips">
        {ICONS.map((i) => (
          <button key={i} type="button" className={`chip${icon === i ? ' selected' : ''}`} style={{ padding: '4px 8px' }} onClick={() => setIcon(i)}>
            {i}
          </button>
        ))}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {POT_COLORS.map((c) => (
          <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} style={{ width: 28, height: 28, borderRadius: 8, background: c, border: color === c ? '3px solid var(--text)' : '2px solid var(--surface)', cursor: 'pointer' }} />
        ))}
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 34, height: 30, border: 0, background: 'none' }} />
      </div>
      <div className="form-grid">
        <Field label="Monatsbudget (Ausgaben)" hint="Warnung bei Überschreitung">
          <MoneyInput value={budget} onChange={setBudget} placeholder="optional" />
        </Field>
        <Field label="Soll-Zuführung / Monat" hint="Für „Geld verteilen“">
          <MoneyInput value={contribution} onChange={setContribution} placeholder="optional" />
        </Field>
        <Field label="Sparziel" hint="Fortschrittsbalken">
          <MoneyInput value={target} onChange={setTarget} placeholder="optional" />
        </Field>
        <Field label="Mindeststand" hint="Gelb, wenn darunter">
          <MoneyInput value={minBalance} onChange={setMinBalance} placeholder="optional" />
        </Field>
      </div>
      <Field label="Notiz">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
      </Field>

      <div className="stack sm">
        <span className="label-text">Unterpunkte</span>
        {(livePot ? livePot.subitems : newSubs.map((n, i) => ({ id: String(i), name: n, archived: false }))).map((s) => (
          <SubitemRow
            key={s.id}
            name={s.name}
            onRename={(n) => (livePot ? renameSubitem(livePot.id, s.id, n) : setNewSubs(newSubs.map((x, i) => (String(i) === s.id ? n : x))))}
            onDelete={() => {
              if (!livePot) setNewSubs(newSubs.filter((_, i) => String(i) !== s.id));
              else if (confirmDialog(`Unterpunkt „${s.name}“ löschen? Er wird aus allen Buchungen entfernt.`)) deleteSubitem(livePot.id, s.id);
            }}
          />
        ))}
        <div className="row">
          <input
            className="input sm"
            placeholder="Neuer Unterpunkt…"
            value={subName}
            onChange={(e) => setSubName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSub())}
          />
          <button className="btn sm" onClick={addSub}>
            <Plus size={14} /> Hinzufügen
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SubitemRow({ name, onRename, onDelete }: { name: string; onRename: (n: string) => void; onDelete: () => void }) {
  const [value, setValue] = useState(name);
  return (
    <div className="row">
      <input className="input sm" value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => value.trim() && value !== name && onRename(value.trim())} />
      <button className="btn ghost icon sm" onClick={onDelete} aria-label="Löschen">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

/** Moves unassigned money into pots (e.g. after the salary arrived). */
function DistributeModal({ onClose }: { onClose: () => void }) {
  const { free, activePots, potBal } = useData();
  const { addTransactions } = useStore();
  const toast = useToast();
  const [amounts, setAmounts] = useState<Record<ID, number | null>>({});
  const sum = Object.values(amounts).reduce<number>((a, b) => a + (b || 0), 0);
  const rest = free - sum;

  const fillContributions = () => {
    const pots = activePots.filter((p) => p.monthlyContribution);
    const wanted = pots.map((p) => p.monthlyContribution!);
    const total = wanted.reduce((a, b) => a + b, 0);
    const values = total <= free || free <= 0 ? wanted : distribute(free, wanted);
    setAmounts(Object.fromEntries(pots.map((p, i) => [p.id, values[i]])));
  };
  const fillShortfalls = () => {
    const next: Record<ID, number | null> = { ...amounts };
    for (const p of activePots) {
      const b = potBal.get(p.id) || 0;
      const need = Math.max(0, (p.minBalance || 0) - b);
      if (need > 0) next[p.id] = need;
    }
    setAmounts(next);
  };

  const save = () => {
    const txs = activePots
      .filter((p) => amounts[p.id])
      .map((p) => ({
        date: today(),
        kind: 'potTransfer' as const,
        amount: Math.abs(amounts[p.id]!),
        splits: [
          { potId: null, amount: -amounts[p.id]!, subitemIds: [] },
          { potId: p.id, amount: amounts[p.id]!, subitemIds: [] },
        ],
        payee: 'Verteilung',
        source: 'manual' as const,
      }));
    addTransactions(txs);
    toast(`${fmtEur(sum)} auf ${txs.length} Töpfe verteilt`);
    onClose();
  };

  return (
    <Modal
      title="Geld auf Töpfe verteilen"
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={save} disabled={!sum}>
          Verteilen
        </button>
      }
    >
      <div className={`alert ${free < 0 ? 'bad' : 'info'}`}>
        <div className="grow">
          Nicht verteilt: <b><Money value={free} /></b>
          <div className="small muted">Negative Beträge nehmen Geld aus einem Topf zurück.</div>
        </div>
      </div>
      <div className="row wrap">
        <button className="btn sm" onClick={fillContributions}>
          <Wand2 size={14} /> Soll-Zuführungen eintragen
        </button>
        <button className="btn sm" onClick={fillShortfalls}>
          Unterdeckungen ausgleichen
        </button>
        <button className="btn sm ghost" onClick={() => setAmounts({})}>
          Leeren
        </button>
      </div>
      <div className="stack sm">
        {activePots.map((p) => {
          const b = potBal.get(p.id) || 0;
          return (
            <div key={p.id} className="row">
              <span className="pot-icon" style={{ ['--c' as string]: p.color, width: 32, height: 32, fontSize: '1rem' }}>
                {p.icon}
              </span>
              <div className="grow">
                <div style={{ fontWeight: 560 }}>{p.name}</div>
                <div className="tiny muted">
                  Stand <Money value={b} className={b < 0 ? 'neg' : ''} />
                  {p.monthlyContribution ? ` · Soll ${fmtEur(p.monthlyContribution)}` : ''}
                </div>
              </div>
              <div style={{ width: 130 }}>
                <MoneyInput className="input sm right" allowNegative value={amounts[p.id] ?? null} onChange={(v) => setAmounts({ ...amounts, [p.id]: v })} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="row between">
        <span>Summe {fmtEur(sum)}</span>
        <span className={rest < 0 ? 'neg' : 'muted'}>Danach nicht verteilt: {fmtEur(rest)}</span>
      </div>
    </Modal>
  );
}
