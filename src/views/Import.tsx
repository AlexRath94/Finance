import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Check, FileUp, RefreshCw, Upload } from 'lucide-react';
import { useData, useNav } from '../hooks';
import { useStore } from '../store';
import type { CsvMapping, ID, Rule } from '../types';
import {
  decodeText,
  detectDelimiter,
  findHeaderRow,
  guessMapping,
  headerSignature,
  makeImportRefs,
  parseCamt,
  parseCsv,
  parseMt940,
  rowsToEntries,
  type ParseResult,
  type RawEntry,
} from '../lib/importers';
import { findRule } from '../lib/rules';
import { ruleToTxFields } from '../lib/applyRule';
import { fmtDate, normalizeIban } from '../lib/format';
import { AccountSelect, accountLabel } from '../components/AccountSelect';
import { Field, Money, PotTag, useToast } from '../components/ui';
import { Review } from './Review';
import { RulesView } from './Rules';

type Sub = 'upload' | 'review' | 'rules';

export function ImportView() {
  const { params } = useNav();
  const { reviewCount, data } = useData();
  const [sub, setSub] = useState<Sub>(params.review ? 'review' : 'upload');
  return (
    <div className="stack lg">
      <div className="page-head">
        <div>
          <h1>Import & Zuordnung</h1>
          <p className="muted">Kontoauszüge hochladen – Unbekanntes wird danach in einer kurzen Fragerunde zugeordnet.</p>
        </div>
      </div>
      <div className="tabs-inline">
        <button className={sub === 'upload' ? 'active' : ''} onClick={() => setSub('upload')}>
          Datei importieren
        </button>
        <button className={sub === 'review' ? 'active' : ''} onClick={() => setSub('review')}>
          Fragesession {reviewCount > 0 && <span className="badge warn">{reviewCount}</span>}
        </button>
        <button className={sub === 'rules' ? 'active' : ''} onClick={() => setSub('rules')}>
          Zuordnungsregeln <span className="badge">{data.rules.length}</span>
        </button>
      </div>
      {sub === 'upload' && <Upload_ initialAccount={params.accountId} onDone={(open) => setSub(open ? 'review' : 'upload')} />}
      {sub === 'review' && <Review />}
      {sub === 'rules' && <RulesView />}
    </div>
  );
}

interface CsvState {
  rows: string[][];
  headerRow: number;
  mapping: CsvMapping;
}

interface PreviewRow {
  entry: RawEntry;
  ref: string;
  status: 'new' | 'duplicate' | 'ignored' | 'counterpart';
  rule?: Rule;
  include: boolean;
}

function Upload_({ initialAccount, onDone }: { initialAccount?: ID; onDone: (openReview: boolean) => void }) {
  const { data, potById, accountById } = useData();
  const store = useStore();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [accountId, setAccountId] = useState<ID | undefined>(initialAccount);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [csv, setCsv] = useState<CsvState | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);

  const reset = () => {
    setResult(null);
    setCsv(null);
    setRows([]);
    setFileName('');
    setError('');
  };

  const handleFile = async (file: File) => {
    reset();
    setBusy(true);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const name = file.name.toLowerCase();
      let res: ParseResult;
      if (name.endsWith('.pdf') || file.type === 'application/pdf') {
        const { parsePdf } = await import('../lib/pdfImport');
        res = await parsePdf(buf);
      } else {
        const text = decodeText(buf);
        if (/^\s*<\?xml|<Document[\s>]/.test(text.slice(0, 500))) res = parseCamt(text);
        else if (/^:20:|\n:20:|:61:/.test(text.slice(0, 3000))) res = parseMt940(text);
        else {
          const delimiter = detectDelimiter(text);
          const all = parseCsv(text, delimiter);
          const headerRow = findHeaderRow(all);
          const sig = headerSignature(all[headerRow] || []);
          const mapping = data.csvMappings.find((m) => m.signature === sig) || guessMapping(all[headerRow] || [], delimiter);
          setCsv({ rows: all, headerRow, mapping });
          res = rowsToEntries(all, headerRow, mapping);
          res.format = data.csvMappings.some((m) => m.signature === sig) ? 'CSV (gespeicherte Zuordnung)' : 'CSV';
        }
      }
      applyResult(res);
    } catch (e) {
      setError(`Datei konnte nicht gelesen werden: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const applyResult = (res: ParseResult, acc = accountId) => {
    setResult(res);
    let target = acc;
    if (res.accountIban) {
      const match = data.accounts.find((a) => a.iban && normalizeIban(a.iban) === normalizeIban(res.accountIban));
      if (match) target = match.id;
    }
    if (target !== acc) setAccountId(target);
    buildPreview(res.entries, target);
  };

  const buildPreview = (entries: RawEntry[], acc: ID | undefined) => {
    if (!acc) {
      setRows(entries.map((entry) => ({ entry, ref: '', status: 'new', include: true })));
      return;
    }
    const refs = makeImportRefs(acc, entries);
    const existing = new Set(data.transactions.filter((t) => t.importRef).map((t) => t.importRef!));
    const ignored = new Set(data.ignoredImportRefs);
    const transfers = data.transactions.filter((t) => t.kind === 'transfer' && (t.accountId === acc || t.toAccountId === acc));
    const usedTransfers = new Set<ID>();
    setRows(
      entries.map((entry, i) => {
        const ref = refs[i];
        if (existing.has(ref)) return { entry, ref, status: 'duplicate', include: false };
        if (ignored.has(ref)) return { entry, ref, status: 'ignored', include: false };
        // A transfer booked from the other account already covers this movement.
        const counterpart = transfers.find(
          (t) =>
            !usedTransfers.has(t.id) &&
            t.amount === Math.abs(entry.amount) &&
            (entry.amount > 0 ? t.toAccountId === acc : t.accountId === acc) &&
            Math.abs(new Date(t.date).getTime() - new Date(entry.date).getTime()) <= 4 * 86400000,
        );
        if (counterpart) {
          usedTransfers.add(counterpart.id);
          return { entry, ref, status: 'counterpart', include: false };
        }
        const rule = findRule(data.rules, { payee: entry.payee, purpose: entry.purpose, amount: entry.amount, accountId: acc });
        return { entry, ref, status: 'new', rule, include: true };
      }),
    );
  };

  const updateMapping = (patch: Partial<CsvMapping>) => {
    if (!csv) return;
    const mapping = { ...csv.mapping, ...patch };
    const next = { ...csv, mapping };
    setCsv(next);
    const res = rowsToEntries(csv.rows, csv.headerRow, mapping);
    applyResult(res);
  };
  const updateHeaderRow = (headerRow: number) => {
    if (!csv) return;
    const mapping = guessMapping(csv.rows[headerRow] || [], csv.mapping.delimiter);
    setCsv({ ...csv, headerRow, mapping });
    applyResult(rowsToEntries(csv.rows, headerRow, mapping));
  };

  const doImport = () => {
    if (!accountId) return;
    const chosen = rows.filter((r) => r.include);
    const txs = [];
    const ignoredRefs: string[] = [];
    const ruleHits: ID[] = [];
    let open = 0;
    for (const r of chosen) {
      const fields = ruleToTxFields(r.rule, r.entry.amount, accountId);
      if (r.rule) ruleHits.push(r.rule.id);
      if (!fields) {
        ignoredRefs.push(r.ref);
        continue;
      }
      if (fields.needsReview) open++;
      txs.push({
        ...fields,
        date: r.entry.date,
        payee: r.entry.payee || undefined,
        purpose: [r.entry.bookingText, r.entry.purpose].filter(Boolean).join(' · ') || undefined,
        source: 'import' as const,
        importRef: r.ref,
      });
    }
    store.addTransactions(txs);
    store.ignoreImportRefs(ignoredRefs);
    store.countRuleHits(ruleHits);
    if (csv) store.saveCsvMapping(csv.mapping);
    toast(`${txs.length} Buchungen importiert${open ? `, ${open} offen` : ''}`);
    reset();
    onDone(open > 0);
  };

  const counts = useMemo(() => {
    const c = { new: 0, duplicate: 0, ignored: 0, counterpart: 0, rule: 0, include: 0 };
    for (const r of rows) {
      c[r.status]++;
      if (r.rule && r.status === 'new') c.rule++;
      if (r.include) c.include++;
    }
    return c;
  }, [rows]);

  const headers = csv ? csv.rows[csv.headerRow] || [] : [];
  const colSelect = (label: string, key: keyof CsvMapping, optional = true) => (
    <Field label={label}>
      <select className="input sm" value={(csv?.mapping[key] as number | undefined) ?? -1} onChange={(e) => updateMapping({ [key]: +e.target.value < 0 ? undefined : +e.target.value } as Partial<CsvMapping>)}>
        {optional && <option value={-1}>–</option>}
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Spalte ${i + 1}`}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <div className="stack lg">
      <div className="card stack">
        <div className="form-grid">
          <Field label="Zielkonto" hint="Wird über die IBAN in der Datei automatisch erkannt, wenn hinterlegt.">
            <AccountSelect
              accounts={data.accounts}
              value={accountId}
              onChange={(id) => {
                setAccountId(id);
                if (result) buildPreview(result.entries, id);
              }}
              placeholder="– Konto wählen –"
            />
          </Field>
        </div>
        <div
          className={`dropzone${over ? ' over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
        >
          {busy ? <RefreshCw className="spin" size={28} /> : <Upload size={28} color="var(--muted)" />}
          <div style={{ fontWeight: 600, marginTop: 8 }}>{fileName || 'Kontoauszug hierher ziehen oder klicken'}</div>
          <div className="small muted" style={{ marginTop: 4 }}>
            CSV (Sparkasse CSV-CAMT / CSV-MT940, Trade Republic & andere), MT940 (.sta), CAMT (.xml), PDF (experimentell)
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".csv,.txt,.sta,.mt940,.xml,.pdf,text/csv,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </div>
        {error && <div className="alert bad small">{error}</div>}
      </div>

      {csv && (
        <details className="card" open={!result?.entries.length}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>CSV-Spalten zuordnen {result?.entries.length ? <span className="badge ok">erkannt</span> : <span className="badge warn">bitte prüfen</span>}</summary>
          <div className="stack" style={{ marginTop: 14 }}>
            <div className="form-grid">
              <Field label="Kopfzeile">
                <select className="input sm" value={csv.headerRow} onChange={(e) => updateHeaderRow(+e.target.value)}>
                  {csv.rows.slice(0, 30).map((r, i) => (
                    <option key={i} value={i}>
                      Zeile {i + 1}: {r.slice(0, 4).join(' | ').slice(0, 60)}
                    </option>
                  ))}
                </select>
              </Field>
              {colSelect('Datum', 'dateCol', false)}
              {colSelect('Betrag (mit Vorzeichen)', 'amountCol')}
              {csv.mapping.amountCol < 0 && colSelect('Soll / Ausgang', 'debitCol')}
              {csv.mapping.amountCol < 0 && colSelect('Haben / Eingang', 'creditCol')}
              {colSelect('Empfänger / Zahler', 'payeeCol')}
              {colSelect('Verwendungszweck', 'purposeCol')}
              {colSelect('Buchungstext / Typ', 'bookingTextCol')}
              {colSelect('IBAN Gegenkonto', 'ibanCol')}
            </div>
            <span className="tiny muted">Die Zuordnung wird für Dateien mit denselben Spalten gespeichert.</span>
          </div>
        </details>
      )}

      {result && (
        <div className="card stack">
          <div className="row between wrap">
            <div>
              <h2>Vorschau</h2>
              <div className="small muted">
                {result.format} · {result.entries.length} Buchungen erkannt
                {result.skipped ? ` · ${result.skipped} Zeilen übersprungen` : ''}
                {result.accountIban ? ` · Konto ${result.accountIban}` : ''}
              </div>
            </div>
            <div className="row wrap">
              <span className="badge info">{counts.new} neu</span>
              {counts.rule > 0 && <span className="badge ok">{counts.rule} per Regel</span>}
              {counts.duplicate > 0 && <span className="badge">{counts.duplicate} schon vorhanden</span>}
              {counts.counterpart > 0 && <span className="badge">{counts.counterpart} Gegenbuchungen</span>}
              {counts.ignored > 0 && <span className="badge">{counts.ignored} ignoriert</span>}
            </div>
          </div>
          {result.warnings.map((w) => (
            <div key={w} className="alert warn small">
              <AlertTriangle size={16} /> {w}
            </div>
          ))}
          {!accountId && <div className="alert warn small">Bitte zuerst das Zielkonto wählen.</div>}
          <div className="table-wrap" style={{ maxHeight: 460, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}>
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((r) => r.include)}
                      onChange={(e) => setRows(rows.map((r) => ({ ...r, include: e.target.checked })))}
                    />
                  </th>
                  <th>Datum</th>
                  <th>Empfänger / Zweck</th>
                  <th className="right">Betrag</th>
                  <th>Zuordnung</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.include ? '' : 'dim'}>
                    <td>
                      <input type="checkbox" checked={r.include} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} />
                    </td>
                    <td className="num small">{fmtDate(r.entry.date)}</td>
                    <td style={{ maxWidth: 380 }}>
                      <div className="ellipsis" style={{ fontWeight: 550 }}>
                        {r.entry.payee || r.entry.bookingText || '–'}
                      </div>
                      <div className="tiny muted ellipsis">{r.entry.purpose}</div>
                    </td>
                    <td className="right">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        {r.entry.uncertainSign && (
                          <button
                            className="btn ghost icon sm"
                            title="Vorzeichen umkehren"
                            onClick={() => {
                              const entries = rows.map((x) => x.entry);
                              entries[i] = { ...entries[i], amount: -entries[i].amount, uncertainSign: false };
                              buildPreview(entries, accountId);
                            }}
                          >
                            <ArrowLeftRight size={13} />
                          </button>
                        )}
                        <Money value={r.entry.amount} signed colored />
                      </div>
                    </td>
                    <td className="small">
                      {r.status === 'duplicate' ? (
                        <span className="badge">schon importiert</span>
                      ) : r.status === 'ignored' ? (
                        <span className="badge">ignoriert</span>
                      ) : r.status === 'counterpart' ? (
                        <span className="badge">Gegenbuchung vorhanden</span>
                      ) : r.rule?.action.type === 'pot' ? (
                        <PotTag pot={potById.get(r.rule.action.potId)} />
                      ) : r.rule?.action.type === 'transfer' ? (
                        <span className="badge info">Umbuchung {accountLabel(accountById.get(r.rule.action.toAccountId))}</span>
                      ) : r.rule?.action.type === 'ignore' ? (
                        <span className="badge">wird ignoriert</span>
                      ) : (
                        <span className="badge warn">Frage</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row between wrap">
            <button className="btn ghost" onClick={reset}>
              Verwerfen
            </button>
            <button className="btn primary lg" disabled={!accountId || !counts.include} onClick={doImport}>
              <Check size={18} /> {counts.include} Buchungen importieren
              {accountId ? ` → ${accountById.get(accountId)?.name}` : ''}
            </button>
          </div>
        </div>
      )}

      {!result && (
        <div className="card stack small">
          <h3>
            <FileUp size={16} style={{ verticalAlign: -2 }} /> So kommst du an die Dateien
          </h3>
          <div>
            <b>Sparkasse:</b> Online-Banking im Browser → Umsätze → Zeitraum wählen → Export „CSV-CAMT-Format“ (oder MT940/CAMT). Pro Unterkonto
            eine Datei; die IBAN in der Datei ordnet sie automatisch dem richtigen Konto zu, wenn sie beim Konto hinterlegt ist.
          </div>
          <div>
            <b>Trade Republic:</b> In der App bzw. im Web unter Profil → Dokumente/Kontoauszüge den Auszug laden (PDF) oder – falls angeboten – die
            Transaktionen als CSV exportieren. Bei CSV einmal die Spalten zuordnen, danach wird es gemerkt.
          </div>
          <div className="muted">
            Doppelte Buchungen werden erkannt und übersprungen – du kannst überlappende Zeiträume also gefahrlos erneut importieren. Bekannte
            Empfänger ordnet die App über deine Regeln automatisch zu – je mehr Fragen du beantwortest, desto weniger
            werden es.
          </div>
        </div>
      )}
    </div>
  );
}
