import { useMemo } from 'react';
import { AlertTriangle, ArrowRight, Coins, Landmark, PiggyBank, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useData, useNav } from '../hooks';
import { metalsTotal, monthSummary, potMonthStats, potStatus } from '../lib/calc';
import { currentMonth, fmtDate, fmtEur, fmtMonth, shiftMonth } from '../lib/format';
import { EXPENSE, INCOME, OTHER, SERIES } from '../lib/chartColors';
import { Money, Progress, StatusBadge } from '../components/ui';
import { TxList } from '../components/TxList';

const tooltipStyle = {
  contentStyle: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 },
  labelStyle: { color: 'var(--muted)' },
  itemStyle: { color: 'var(--text)' },
};
const eurTick = (v: number) =>
  Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(1).replace('.', ',').replace(',0', '')}k` : `${Math.round(v / 100)}`;

export function Dashboard() {
  const { data, potBal, free, worth, activePots, reviewCount } = useData();
  const { go } = useNav();
  const month = currentMonth();
  const metals = metalsTotal(data);
  const summary = monthSummary(data, month, (a) => a.inBudget);

  const potRows = useMemo(
    () =>
      activePots.map((p) => {
        const bal = potBal.get(p.id) || 0;
        const m = potMonthStats(data.transactions, p.id, month);
        return { pot: p, bal, month: m, status: potStatus(p, bal, m) };
      }),
    [activePots, potBal, data.transactions, month],
  );
  const problems = potRows.filter((r) => r.status.status === 'bad' || r.status.status === 'warn');

  const allocation = useMemo(() => {
    const rows = worth.byInstitution.filter((r) => r.value > 0).map((r) => ({ name: r.name, value: r.value }));
    if (data.settings.metalsInNetWorth && metals.total > 0) rows.push({ name: 'Edelmetalle', value: metals.total });
    rows.sort((a, b) => b.value - a.value);
    // Slots are fixed by entity order; beyond 7 entities fold into "Sonstige".
    if (rows.length > 8) {
      const rest = rows.splice(7);
      rows.push({ name: 'Sonstige', value: rest.reduce((a, r) => a + r.value, 0) });
    }
    return rows;
  }, [worth, metals.total, data.settings.metalsInNetWorth]);

  const allocationTotal = Math.max(1, allocation.reduce((a, r) => a + r.value, 0));
  const history = data.snapshots.slice(-180).map((s) => ({ date: fmtDate(s.date), total: s.total }));

  const months = useMemo(() => {
    const res = [];
    for (let i = 5; i >= 0; i--) {
      const m = shiftMonth(month, -i);
      const s = monthSummary(data, m, (a) => a.inBudget);
      res.push({ month: new Date(m + '-01').toLocaleDateString('de-DE', { month: 'short' }), Einnahmen: s.income, Ausgaben: s.expense });
    }
    return res;
  }, [data, month]);

  const recent = useMemo(
    () => [...data.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 8),
    [data.transactions],
  );

  return (
    <div className="stack lg">
      <div className="page-head">
        <div>
          <h1>Übersicht</h1>
          <p className="muted">{fmtMonth(month)}</p>
        </div>
      </div>

      {(reviewCount > 0 || free < 0 || problems.length > 0) && (
        <div className="stack sm">
          {reviewCount > 0 && (
            <div className="alert warn">
              <AlertTriangle size={18} className="warn-text" />
              <div className="grow">
                <b>{reviewCount} importierte Buchung{reviewCount === 1 ? '' : 'en'}</b> noch keinem Topf zugeordnet.
              </div>
              <button className="btn sm" onClick={() => go('import', { review: true })}>
                Jetzt zuordnen <ArrowRight size={14} />
              </button>
            </div>
          )}
          {free < 0 && (
            <div className="alert bad">
              <AlertTriangle size={18} className="neg" />
              <div className="grow">
                Es ist <b>{fmtEur(-free)} mehr auf Töpfe verteilt</b>, als auf den Budget-Konten vorhanden ist.
              </div>
              <button className="btn sm" onClick={() => go('pots')}>
                Töpfe prüfen
              </button>
            </div>
          )}
          {problems.map((r) => (
            <div key={r.pot.id} className={`alert ${r.status.status}`}>
              <span>{r.pot.icon}</span>
              <div className="grow">
                <b>{r.pot.name}</b>: {r.status.reasons.join(', ')} – Stand <Money value={r.bal} colored />
                {r.pot.monthlyBudget ? (
                  <span className="muted small"> · Monat {fmtEur(r.month.spent)} von {fmtEur(r.pot.monthlyBudget)}</span>
                ) : null}
              </div>
              <button className="btn sm" onClick={() => go('pots', { potId: r.pot.id })}>
                Öffnen
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid kpi">
        <div className="card kpi-card hero">
          <div className="label">
            <Wallet size={15} /> Gesamtvermögen
          </div>
          <div className="value">{fmtEur(worth.total)}</div>
          <div className="sub">
            Konten {fmtEur(worth.accounts)} · Edelmetalle {fmtEur(worth.metals)}
          </div>
        </div>
        <div className="card kpi-card" style={{ cursor: 'pointer' }} onClick={() => go('accounts')}>
          <div className="label">
            <Landmark size={15} /> Konten
          </div>
          <div className="value">{fmtEur(worth.accounts)}</div>
          <div className="sub">{data.accounts.filter((a) => !a.archived).length} Konten</div>
        </div>
        <div className="card kpi-card" style={{ cursor: 'pointer' }} onClick={() => go('pots')}>
          <div className="label">
            <PiggyBank size={15} /> Nicht verteilt
          </div>
          <div className={`value ${free < 0 ? 'neg' : ''}`}>{fmtEur(free)}</div>
          <div className="sub">frei auf Budget-Konten</div>
        </div>
        <div className="card kpi-card" style={{ cursor: 'pointer' }} onClick={() => go('metals')}>
          <div className="label">
            <Coins size={15} /> Edelmetalle
          </div>
          <div className="value">{fmtEur(metals.total)}</div>
          <div className="sub">{data.holdings.length} Positionen</div>
        </div>
        <div className="card kpi-card">
          <div className="label">
            <TrendingUp size={15} /> Einnahmen {new Date().toLocaleDateString('de-DE', { month: 'long' })}
          </div>
          <div className="value pos">{fmtEur(summary.income)}</div>
          <div className="sub row" style={{ gap: 4 }}>
            <TrendingDown size={13} /> Ausgaben {fmtEur(summary.expense)}
          </div>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <div className="card-head">
            <h2>Vermögensaufteilung</h2>
          </div>
          {allocation.length ? (
            <div className="row wrap" style={{ alignItems: 'center' }}>
              <div style={{ width: 190, height: 190, flexShrink: 0 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={allocation} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={1} stroke="var(--surface)" strokeWidth={2}>
                      {allocation.map((r, i) => (
                        <Cell key={r.name} fill={r.name === 'Sonstige' ? OTHER : SERIES[i]} />
                      ))}
                    </Pie>
                    <Tooltip {...tooltipStyle} formatter={(v) => fmtEur(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="stack sm grow">
                {allocation.map((r, i) => (
                  <div key={r.name} className="row between small">
                    <span className="row" style={{ gap: 8 }}>
                      <span className="color-dot" style={{ background: r.name === 'Sonstige' ? OTHER : SERIES[i] }} />
                      {r.name}
                    </span>
                    <span className="num">
                      {fmtEur(r.value)} <span className="muted">({Math.round((r.value / allocationTotal) * 100)} %)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty small">Noch keine Kontostände erfasst. Unter „Konten“ Anfangssalden eintragen.</div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Verlauf Gesamtvermögen</h2>
          </div>
          {history.length > 1 ? (
            <div className="chart-box">
              <ResponsiveContainer>
                <LineChart data={history} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={30} />
                  <YAxis tickFormatter={eurTick} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [fmtEur(Number(v)), 'Gesamt']} />
                  <Line type="monotone" dataKey="total" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty small">Der Verlauf wird ab heute täglich aufgezeichnet.</div>
          )}
        </div>
      </div>

      <div className="grid two">
        <div className="card flush">
          <div className="card-head" style={{ padding: '16px 18px 0' }}>
            <h2>Töpfe</h2>
            <button className="btn sm ghost" onClick={() => go('pots')}>
              Alle <ArrowRight size={14} />
            </button>
          </div>
          <div className="list">
            {potRows.map(({ pot, bal, month: m, status }) => (
              <div key={pot.id} className="list-item clickable" onClick={() => go('pots', { potId: pot.id })}>
                <div className="pot-icon" style={{ ['--c' as string]: pot.color, width: 32, height: 32, fontSize: '1rem' }}>
                  {pot.icon}
                </div>
                <div className="grow stack sm" style={{ gap: 4 }}>
                  <div className="row between">
                    <span style={{ fontWeight: 560 }}>{pot.name}</span>
                    <Money value={bal} className={bal < 0 ? 'neg' : ''} />
                  </div>
                  {pot.monthlyBudget ? (
                    <Progress value={m.spent} max={pot.monthlyBudget} status={status.status} color={pot.color} />
                  ) : pot.targetAmount ? (
                    <Progress value={bal} max={pot.targetAmount} color={pot.color} />
                  ) : null}
                </div>
                {status.status !== 'ok' && <StatusBadge status={status.status}>{status.status === 'bad' ? 'Unterdeckung' : 'Achtung'}</StatusBadge>}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Einnahmen & Ausgaben</h2>
            <div className="legend">
              <span>
                <span className="color-dot" style={{ background: INCOME }} /> Einnahmen
              </span>
              <span>
                <span className="color-dot" style={{ background: EXPENSE }} /> Ausgaben
              </span>
            </div>
          </div>
          <div className="chart-box">
            <ResponsiveContainer>
              <BarChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={eurTick} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={48} />
                <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--surface-2)' }} formatter={(v, n) => [fmtEur(Number(v)), n]} />
                <Bar dataKey="Einnahmen" fill={INCOME} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="Ausgaben" fill={EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="tiny muted">Nur Budget-Konten, ohne Umbuchungen.</div>
        </div>
      </div>

      <div className="card flush">
        <div className="card-head" style={{ padding: '16px 18px 0' }}>
          <h2>Letzte Buchungen</h2>
          <button className="btn sm ghost" onClick={() => go('transactions')}>
            Alle <ArrowRight size={14} />
          </button>
        </div>
        <TxList txs={recent} empty="Noch keine Buchungen – unten rechts „+ Buchung“ oder einen Kontoauszug importieren." />
      </div>
    </div>
  );
}
