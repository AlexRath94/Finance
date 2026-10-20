import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { ID, Pot } from '../types';
import { useStore } from '../store';

/** Pot selection as colored chips. `null` stands for "nicht verteilt". */
export function PotChips({
  pots,
  value,
  onChange,
  allowNone = true,
  noneLabel = 'Nicht verteilt',
}: {
  pots: Pot[];
  value: ID | null;
  onChange: (id: ID | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  return (
    <div className="chips">
      {pots.map((p) => (
        <button
          type="button"
          key={p.id}
          className={`chip${value === p.id ? ' selected' : ''}`}
          style={{ ['--c' as string]: p.color }}
          onClick={() => onChange(value === p.id && allowNone ? null : p.id)}
        >
          <span>{p.icon}</span>
          {p.name}
        </button>
      ))}
      {allowNone && (
        <button type="button" className={`chip${value === null ? ' selected' : ''}`} onClick={() => onChange(null)}>
          <span className="dot" style={{ background: 'var(--muted)' }} />
          {noneLabel}
        </button>
      )}
    </div>
  );
}

/** Tickable sub-items of a pot with inline creation of new ones. */
export function SubitemChecklist({ pot, selected, onChange }: { pot: Pot; selected: ID[]; onChange: (ids: ID[]) => void }) {
  const addSubitem = useStore((s) => s.addSubitem);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const visible = pot.subitems.filter((s) => !s.archived || selected.includes(s.id));
  const toggle = (id: ID) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const commit = () => {
    if (name.trim()) {
      const id = addSubitem(pot.id, name);
      if (!selected.includes(id)) onChange([...selected, id]);
    }
    setName('');
    setAdding(false);
  };
  return (
    <div className="chips" style={{ ['--c' as string]: pot.color }}>
      {visible.map((s) => (
        <label key={s.id} className={`subitem-check${selected.includes(s.id) ? ' checked' : ''}`}>
          <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
          {s.name}
        </label>
      ))}
      {adding ? (
        <input
          className="input sm"
          style={{ width: 170 }}
          autoFocus
          placeholder="Neuer Unterpunkt…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              setAdding(false);
            }
          }}
          onBlur={commit}
        />
      ) : (
        <button type="button" className="chip add" onClick={() => setAdding(true)}>
          <Plus size={14} /> Unterpunkt
        </button>
      )}
    </div>
  );
}
