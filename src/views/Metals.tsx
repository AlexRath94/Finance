import { useEffect, useMemo, useState } from 'react';
import { Minus, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useData } from '../hooks';
import { useStore } from '../store';
import type { Metal, MetalHolding } from '../types';
import { OZ, holdingValue } from '../lib/calc';
import { METALS, PRESETS, fetchSpotPrices, metalName } from '../lib/metals';
import { fmtDate, fmtEur, fmtNum, relativeTime, today } from '../lib/format';
import { Empty, Field, Modal, Money, MoneyInput, Segmented, confirmDialog, useToast } from '../components/ui';

const STALE_MS = 15 * 60 * 1000;

export function Metals() {
  const { data } = useData();
  const store = useStore();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [edit, setEdit] = useState<MetalHolding | 'new' | null>(null);
  const [manual, setManual] = useState<Metal | null>(null);
  const [chartMetal, setChartMetal] = useState<Metal>('gold');

  const online = data.settings.onlinePrices;
  const refresh = async (silent = false) => {
    if (!useStore.getState().settings.onlinePrices) return;
    setLoading(true);
    const { prices, errors } = await fetchSpotPrices();
    setLoading(false);
    setErrors(errors);
    if (Object.keys(prices).length) {
      store.setPrices(prices);
      if (!silent) toast('Kurse aktualisiert');
    }
  };

  useEffect(() => {
    const newest = Math.max(0, ...Object.values(data.prices).map((p) => p?.updatedAt || 0));
    if (online && Date.now() - newest > STALE_MS) refresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => {
    const byMetal = METALS.map((m) => {
      const hs = data.holdings.filter((h) => h.metal === m.id);
      const grams = hs.reduce((a, h) => a + h.fineGrams * h.quantity, 0);
      const value = hs.reduce((a, h) => a + holdingValue(h, data.prices[m.id]?.eurPerOz), 0);
      const cost = hs.reduce((a, h) => a + (h.purchasePrice || 0), 0);
      const costKnown = hs.filter((h) => h.purchasePrice).reduce((a, h) => a + holdingValue(h, data.prices[m.id]?.eurPerOz), 0);
      return { ...m, count: hs.reduce((a, h) => a + h.quantity, 0), grams, value, cost, costKnown, realistic: Math.round(value * (1 - (data.settings.metalDiscount[m.id] || 0) / 100)) };
    });
    const value = byMetal.reduce((a, m) => a + m.value, 0);
    const realistic = byMetal.reduce((a, m) => a + m.realistic, 0);
    const cost = byMetal.reduce((a, m) => a + m.cost, 0);
    const costKnown = byMetal.reduce((a, m) => a + m.costKnown, 0);
    return { byMetal, value, realistic, cost, gain: costKnown - cost };
  }, [data.holdings, data.prices, data.settings.metalDiscount]);

  const history = data.priceHistory.filter((h) => h.prices[chartMetal]).map((h) => ({ date: fmtDate(h.date), price: h.prices[chartMetal]! }));
  const chartColor = METALS.find((m) => m.id === chartMetal)!.color;

  return (
    <div className="stack lg">
      <div className="page-head">
        <div>
          <h1>Edelmetalle</h1>
          <p className="muted">Aktuelle Spotpreise in Euro und der Gegenwert deiner Münzen und Barren.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => refresh()} disabled={loading || !online} title={online ? undefined : 'Online-Abruf ist ausgeschaltet'}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> Kurse aktualisieren
          </button>
          <button className="btn primary" onClick={() => setEdit('new')}>
            <Plus size={16} /> Bestand
          </button>
        </div>
      </div>

      <div className="alert info small">
        <ShieldCheck size={18} style={{ flexShrink: 0 }} />
        <div className="grow">
          {online ? (
            <>
              Beim Abruf lädt die App nur die öffentlichen Kurse (gold-api.com) und den Euro-Kurs der EZB (frankfurter). Es werden keine deiner Daten
              übertragen – weder Bestände noch Konten. Die Anbieter sehen lediglich, dass jemand den Kurs abfragt (IP-Adresse), wie bei jedem Webseitenaufruf.
            </>
          ) : (
            <>Online-Abruf ist aus: Die App stellt keinerlei Verbindungen her. Kurse bitte über „manuell“ eintragen.</>
          )}
        </div>
        <label className="check" style={{ flexShrink: 0 }}>
          <input type="checkbox" checked={online} onChange={(e) => store.updateSettings({ onlinePrices: e.target.checked })} />
          Kurse online abrufen
        </label>
      </div>

      {online && errors.length > 0 && (
        <div className="alert warn small">
          <div>
            Kurse konnten nicht (vollständig) geladen werden: {errors.join('; ')}. Preise lassen sich über „manuell“ selbst eintragen.
          </div>
        </div>
      )}

      <div className="grid kpi">
        {METALS.map((m) => {
          const p = data.prices[m.id];
          return (
            <div key={m.id} className="card metal-price" style={{ ['--c' as string]: m.color }}>
              <div className="row between">
                <span style={{ fontWeight: 650 }}>{m.name}</span>
                <button className="btn ghost sm" onClick={() => setManual(m.id)}>
                  manuell
                </button>
              </div>
              {p ? (
                <>
                  <div className="big" style={{ marginTop: 6 }}>
                    {fmtEur(Math.round(p.eurPerOz * 100))} <span className="small muted">/ oz</span>
                  </div>
                  <div className="small muted num">
                    {fmtEur(Math.round((p.eurPerOz / OZ) * 100))} / g · {fmtEur(Math.round((p.eurPerOz / OZ) * 100000))} / kg
                  </div>
                  <div className="tiny muted" style={{ marginTop: 4 }}>
                    {p.source === 'manual' ? 'manuell · ' : ''}
                    {relativeTime(p.updatedAt)}
                  </div>
                </>
              ) : (
                <div className="small muted" style={{ marginTop: 10 }}>
                  {loading ? 'wird geladen…' : 'kein Kurs'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid two">
        <div className="card">
          <div className="card-head">
            <h2>Mein Bestand</h2>
          </div>
          <div className="stack">
            <div className="row between">
              <span className="muted">Wert zum Spotpreis</span>
              <span className="num" style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                {fmtEur(summary.value)}
              </span>
            </div>
            <div className="row between small">
              <span className="muted">Realistischer Verkaufswert (abzgl. Händlerabschlag)</span>
              <Money value={summary.realistic} />
            </div>
            {summary.cost > 0 && (
              <div className="row between small">
                <span className="muted">Kaufpreis erfasster Positionen · Ergebnis</span>
                <span>
                  <Money value={summary.cost} /> · <Money value={summary.gain} signed colored />
                </span>
              </div>
            )}
            <hr className="sep" />
            {summary.byMetal
              .filter((m) => m.count)
              .map((m) => (
                <div key={m.id} className="row between small">
                  <span className="row" style={{ gap: 8 }}>
                    <span className="color-dot" style={{ background: m.color }} />
                    {m.name} · {fmtNum(m.count, 0)} Stk. · {fmtNum(m.grams, 2)} g ({fmtNum(m.grams / OZ, 3)} oz)
                  </span>
                  <Money value={m.value} />
                </div>
              ))}
            <label className="check small">
              <input type="checkbox" checked={data.settings.metalsInNetWorth} onChange={(e) => store.updateSettings({ metalsInNetWorth: e.target.checked })} />
              Im Gesamtvermögen berücksichtigen
            </label>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Kursverlauf (€/oz)</h2>
            <Segmented<Metal> value={chartMetal} onChange={setChartMetal} options={METALS.slice(0, 2).map((m) => ({ value: m.id, label: m.name }))} />
          </div>
          {history.length > 1 ? (
            <div className="chart-box" style={{ height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={history} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={30} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => fmtNum(v, 0)} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }}
                    formatter={(v) => [fmtEur(Math.round(Number(v) * 100)), metalName(chartMetal)]}
                  />
                  <Line type="monotone" dataKey="price" stroke={chartColor} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty small">Der Verlauf wird bei jedem Abruf (max. einmal täglich gespeichert) aufgebaut.</div>
          )}
        </div>
      </div>

      <div className="card flush">
        {data.holdings.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Position</th>
                  <th className="right">Fein/Stk.</th>
                  <th className="right">Anzahl</th>
                  <th className="right">Feingewicht</th>
                  <th className="right">Wert</th>
                  <th className="right">Kauf · +/-</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.holdings.map((h) => {
                  const v = holdingValue(h, data.prices[h.metal]?.eurPerOz);
                  const m = METALS.find((x) => x.id === h.metal)!;
                  return (
                    <tr key={h.id}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="color-dot" style={{ background: m.color }} />
                          <div>
                            <div style={{ fontWeight: 560 }}>{h.name}</div>
                            <div className="tiny muted">
                              {m.name}
                              {h.location ? ` · ${h.location}` : ''}
                              {h.purchaseDate ? ` · gekauft ${fmtDate(h.purchaseDate)}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="right num small">{fmtNum(h.fineGrams, 3)} g</td>
                      <td className="right">
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                          <button className="btn ghost icon sm" onClick={() => h.quantity > 0 && store.updateHolding(h.id, { quantity: h.quantity - 1 })} aria-label="weniger">
                            <Minus size={13} />
                          </button>
                          <span className="num" style={{ minWidth: 24, textAlign: 'center', fontWeight: 600 }}>
                            {h.quantity}
                          </span>
                          <button className="btn ghost icon sm" onClick={() => store.updateHolding(h.id, { quantity: h.quantity + 1 })} aria-label="mehr">
                            <Plus size={13} />
                          </button>
                        </div>
                      </td>
                      <td className="right num small">
                        {fmtNum(h.fineGrams * h.quantity, 2)} g<div className="tiny muted">{fmtNum((h.fineGrams * h.quantity) / OZ, 3)} oz</div>
                      </td>
                      <td className="right">
                        <Money value={v} />
                      </td>
                      <td className="right small">
                        {h.purchasePrice ? (
                          <>
                            <Money value={h.purchasePrice} />
                            <div>
                              <Money value={v - h.purchasePrice} signed colored />
                            </div>
                          </>
                        ) : (
                          <span className="muted">–</span>
                        )}
                      </td>
                      <td className="right">
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                          <button className="btn ghost icon sm" onClick={() => setEdit(h)} aria-label="Bearbeiten">
                            <Pencil size={15} />
                          </button>
                          <button className="btn ghost icon sm" onClick={() => confirmDialog(`„${h.name}“ löschen?`) && store.deleteHolding(h.id)} aria-label="Löschen">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="🪙">
            Noch keine Münzen oder Barren erfasst.
            <div style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={() => setEdit('new')}>
                <Plus size={16} /> Ersten Bestand erfassen
              </button>
            </div>
          </Empty>
        )}
      </div>

      {edit && <HoldingEditor holding={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {manual && <ManualPrice metal={manual} onClose={() => setManual(null)} />}
    </div>
  );
}

function ManualPrice({ metal, onClose }: { metal: Metal; onClose: () => void }) {
  const { data } = useData();
  const store = useStore();
  const current = data.prices[metal]?.eurPerOz;
  const [unit, setUnit] = useState<'oz' | 'g'>('oz');
  const [value, setValue] = useState<number | null>(current ? Math.round(current * 100) : null);
  const save = () => {
    if (!value) return;
    const perOz = unit === 'oz' ? value / 100 : (value / 100) * OZ;
    store.setPrices({ [metal]: { eurPerOz: perOz, updatedAt: Date.now(), source: 'manual' } });
    onClose();
  };
  return (
    <Modal
      title={`${metalName(metal)}preis manuell setzen`}
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={save} disabled={!value}>
          Übernehmen
        </button>
      }
    >
      <Segmented value={unit} onChange={setUnit} options={[{ value: 'oz', label: '€ pro Unze' }, { value: 'g', label: '€ pro Gramm' }]} />
      <MoneyInput className="input amount" value={value} onChange={setValue} autoFocus onEnter={save} />
      <span className="small muted">Wird beim nächsten erfolgreichen Abruf wieder durch den Live-Kurs ersetzt.</span>
    </Modal>
  );
}

function HoldingEditor({ holding, onClose }: { holding?: MetalHolding; onClose: () => void }) {
  const store = useStore();
  const { data } = useData();
  const [metal, setMetal] = useState<Metal>(holding?.metal || 'gold');
  const [name, setName] = useState(holding?.name || '');
  const [fineGrams, setFineGrams] = useState<string>(holding ? String(holding.fineGrams).replace('.', ',') : '');
  const [quantity, setQuantity] = useState<string>(holding ? String(holding.quantity) : '1');
  const [price, setPrice] = useState<number | null>(holding?.purchasePrice ?? null);
  const [date, setDate] = useState(holding?.purchaseDate || '');
  const [location, setLocation] = useState(holding?.location || '');
  const [note, setNote] = useState(holding?.note || '');
  const [gross, setGross] = useState('');
  const [purity, setPurity] = useState('');

  const groups = useMemo(() => {
    const map = new Map<string, typeof PRESETS>();
    PRESETS.filter((p) => p.metal === metal).forEach((p) => map.set(p.group, [...(map.get(p.group) || []), p]));
    return [...map.entries()];
  }, [metal]);

  const grams = parseFloat(fineGrams.replace(',', '.'));
  const qty = parseFloat(quantity.replace(',', '.'));
  const valid = name.trim() && grams > 0 && qty >= 0;
  const preview = valid ? holdingValue({ fineGrams: grams, quantity: qty } as MetalHolding, data.prices[metal]?.eurPerOz) : 0;

  const applyGross = (g: string, p: string) => {
    const gv = parseFloat(g.replace(',', '.'));
    let pv = parseFloat(p.replace(',', '.'));
    if (pv > 1) pv = pv / 1000; // 999,9 or 916 notation
    if (gv > 0 && pv > 0) setFineGrams(fmtNum(gv * pv, 4).replace(/\./g, ''));
  };

  const save = () => {
    if (!valid) return;
    const h = {
      metal,
      name: name.trim(),
      fineGrams: grams,
      quantity: qty,
      purchasePrice: price || undefined,
      purchaseDate: date || undefined,
      location: location.trim() || undefined,
      note: note.trim() || undefined,
    };
    if (holding) store.updateHolding(holding.id, h);
    else store.addHolding(h);
    onClose();
  };

  return (
    <Modal
      title={holding ? 'Bestand bearbeiten' : 'Bestand hinzufügen'}
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={save} disabled={!valid}>
          Speichern
        </button>
      }
    >
      <Segmented<Metal> full value={metal} onChange={setMetal} options={METALS.map((m) => ({ value: m.id, label: m.name }))} />
      <Field label="Vorlage (Münze / Barren)">
        <select
          className="input"
          value=""
          onChange={(e) => {
            const p = PRESETS.find((x) => x.name === e.target.value && x.metal === metal);
            if (p) {
              setName(p.name);
              setFineGrams(String(p.fineGrams).replace('.', ','));
            }
          }}
        >
          <option value="">– Vorlage wählen oder unten frei eintragen –</option>
          {groups.map(([g, ps]) => (
            <optgroup key={g} label={g}>
              {ps.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({fmtNum(p.fineGrams, 3)} g fein)
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="Bezeichnung">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Krügerrand 1 oz" />
        </Field>
        <Field label="Feingewicht pro Stück (g)" hint="1 oz = 31,1035 g">
          <input className="input" inputMode="decimal" value={fineGrams} onChange={(e) => setFineGrams(e.target.value)} />
        </Field>
        <Field label="Anzahl">
          <input className="input" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
      </div>
      <details>
        <summary className="small" style={{ cursor: 'pointer' }}>
          Feingewicht aus Raugewicht und Feinheit berechnen
        </summary>
        <div className="form-grid" style={{ marginTop: 10 }}>
          <Field label="Raugewicht (g)">
            <input className="input" inputMode="decimal" value={gross} onChange={(e) => (setGross(e.target.value), applyGross(e.target.value, purity))} />
          </Field>
          <Field label="Feinheit" hint="z. B. 999,9 / 916 / 0,925">
            <input className="input" inputMode="decimal" value={purity} onChange={(e) => (setPurity(e.target.value), applyGross(gross, e.target.value))} />
          </Field>
        </div>
      </details>
      <div className="form-grid">
        <Field label="Kaufpreis gesamt (€)" hint="optional, für Gewinn/Verlust">
          <MoneyInput value={price} onChange={setPrice} placeholder="optional" />
        </Field>
        <Field label="Kaufdatum">
          <input className="input" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Lagerort">
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="optional" />
        </Field>
      </div>
      <Field label="Notiz">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
      </Field>
      {valid && (
        <div className="alert info small">
          Aktueller Gegenwert: <b>{fmtEur(preview)}</b> ({fmtNum((grams * qty) / OZ, 4)} oz fein)
        </div>
      )}
    </Modal>
  );
}
