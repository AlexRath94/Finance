import { useRef, useState } from 'react';
import { Database, Download, Eye, EyeOff, Moon, RotateCcw, Send, ShieldCheck, Sparkles, Upload, Users } from 'lucide-react';
import { useData } from '../hooks';
import { DATA_VERSION, dataOf, useStore } from '../store';
import type { AppData, Metal } from '../types';
import { METALS } from '../lib/metals';
import { fmtDate, relativeTime, today, toDateStr } from '../lib/format';
import { createShareFile, isEncryptedFile, readShareFile, shareOrDownload, WrongPasswordError, type ShareFile } from '../lib/shareFile';
import { isPristine, mergeData, type MergeStats } from '../lib/sync';
import { Field, Modal, Segmented, confirmDialog, useToast } from '../components/ui';
import { buildDemoTransactions } from '../lib/demo';

const PW_KEY = 'finanzplaner-share-pw';
/** Keeps a typed password while the app is open, even if it is not remembered on the device. */
let sessionPassword = '';

function readSavedPassword(): string {
  try {
    return localStorage.getItem(PW_KEY) || sessionPassword;
  } catch {
    return sessionPassword;
  }
}

interface PendingMerge {
  data: AppData;
  stats: MergeStats;
  file?: ShareFile;
  replaceOnly: boolean;
}

export function SettingsView() {
  const { data } = useData();
  const store = useStore();
  const toast = useToast();
  const mergeRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>((localStorage.getItem('finanzplaner-theme') as 'light' | 'dark') || 'auto');
  const [password, setPassword] = useState(readSavedPassword);
  const [remember, setRemember] = useState(() => {
    try {
      return !!localStorage.getItem(PW_KEY);
    } catch {
      return false;
    }
  });
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingMerge | null>(null);
  const [askPassword, setAskPassword] = useState<{ text: string; mode: 'merge' | 'restore' } | null>(null);

  const applyTheme = (t: 'auto' | 'light' | 'dark') => {
    setTheme(t);
    if (t === 'auto') {
      localStorage.removeItem('finanzplaner-theme');
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem('finanzplaner-theme', t);
      document.documentElement.dataset.theme = t;
    }
  };

  const savePassword = (pw: string, keep: boolean) => {
    sessionPassword = pw;
    try {
      if (keep && pw) localStorage.setItem(PW_KEY, pw);
      else localStorage.removeItem(PW_KEY);
    } catch {
      /* ignore */
    }
  };

  const sendState = async () => {
    if (!password && !confirmDialog('Ohne Passwort ist die Datei unverschlüsselt und für jeden lesbar, der sie in die Hände bekommt. Trotzdem senden?')) return;
    setBusy(true);
    try {
      savePassword(password, remember);
      const file = await createShareFile(dataOf(useStore.getState()), password || undefined, data.settings.deviceName);
      const name = `finanzplaner-${(data.settings.deviceName || 'stand').toLowerCase().replace(/[^a-z0-9äöü]+/g, '-')}-${today()}.json`;
      const res = await shareOrDownload(file, name);
      if (res === 'shared') toast('Stand geteilt');
      else if (res === 'downloaded') toast('Datei gespeichert – jetzt per Messenger oder AirDrop schicken');
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (text: string, mode: 'merge' | 'restore', pw = password) => {
    try {
      const { data: remote, file } = await readShareFile(text, pw || undefined);
      if ((remote.version || 1) > DATA_VERSION) throw new Error('Datei stammt aus einer neueren App-Version');
      setAskPassword(null);
      if (mode === 'restore') {
        if (!confirmDialog(`Sicherung mit ${remote.transactions.length} Buchungen laden? Alle Daten auf diesem Gerät werden ersetzt.`)) return;
        store.replaceAll(remote);
        toast('Sicherung geladen');
        return;
      }
      const local = dataOf(useStore.getState());
      const res = mergeData(local, remote);
      setPending({ ...res, file, replaceOnly: isPristine(local) });
    } catch (e) {
      if (e instanceof WrongPasswordError) {
        if (pw) toast('Passwort passt nicht zu dieser Datei');
        setAskPassword({ text, mode });
      }
      else toast(`Fehler: ${(e as Error).message}`);
    }
  };

  const pickFile = async (f: File, mode: 'merge' | 'restore') => {
    const text = await f.text();
    if (isEncryptedFile(text) && !password) setAskPassword({ text, mode });
    else openFile(text, mode);
  };

  const exportBackup = async () => {
    const file = await createShareFile(dataOf(useStore.getState()), password || undefined, data.settings.deviceName);
    await shareOrDownload(file, `finanzplaner-sicherung-${today()}.json`);
    store.updateSettings({ lastBackupAt: Date.now() });
    toast(password ? 'Verschlüsselte Sicherung erstellt' : 'Sicherung erstellt');
  };

  const loadDemo = () => {
    if (data.transactions.length && !confirmDialog('Beispielbuchungen zusätzlich zu den vorhandenen Daten anlegen?')) return;
    store.addTransactions(buildDemoTransactions(useStore.getState()));
    toast('Beispieldaten angelegt');
  };

  return (
    <div className="stack lg" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1>Einstellungen</h1>
          <p className="muted">Teilen, Datensicherung, Darstellung und Werte für die Berechnung.</p>
        </div>
      </div>

      <div className="alert ok small">
        <ShieldCheck size={18} style={{ flexShrink: 0 }} />
        <div>
          Alle Daten liegen nur auf diesem Gerät. Die App hat keinen Server und darf technisch nur die Edelmetallkurse abrufen – jede andere
          Verbindung blockiert der Browser. {data.settings.onlinePrices ? 'Den Kursabruf kannst du im Tab „Edelmetalle“ ausschalten.' : 'Der Kursabruf ist ausgeschaltet.'}
        </div>
      </div>

      <div className="card stack">
        <div className="row">
          <Users size={18} />
          <h2>Mit Partner/in teilen</h2>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Ohne Server: Du schickst deinen Stand als verschlüsselte Datei (z. B. per Signal, WhatsApp oder AirDrop). Auf dem anderen Handy unter
          „Stand übernehmen“ öffnen – die Änderungen beider Seiten werden zusammengeführt, gelöschte Einträge bleiben gelöscht. Klappt in beide
          Richtungen. Beim allerersten Mal übernimmt das neue Handy einfach alles.
        </p>
        <div className="form-grid">
          <Field label="Dein Name" hint="Wird dem anderen beim Übernehmen angezeigt">
            <input className="input" value={data.settings.deviceName || ''} onChange={(e) => store.updateSettings({ deviceName: e.target.value })} placeholder="z. B. Sam" />
          </Field>
          <Field label="Gemeinsames Passwort" hint="Beide verwenden dasselbe – nicht mit der Datei mitschicken">
            <div className="row" style={{ gap: 4 }}>
              <input
                className="input"
                type={showPw ? 'text' : 'password'}
                value={password}
                autoComplete="new-password"
                onChange={(e) => {
                  setPassword(e.target.value);
                  savePassword(e.target.value, remember);
                }}
              />
              <button className="btn ghost icon" type="button" onClick={() => setShowPw(!showPw)} aria-label="Passwort zeigen">
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>
        </div>
        <label className="check small">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => {
              setRemember(e.target.checked);
              savePassword(password, e.target.checked);
            }}
          />
          Passwort auf diesem Gerät merken
        </label>
        <div className="row wrap">
          <button className="btn primary" onClick={sendState} disabled={busy}>
            <Send size={16} /> Meinen Stand senden
          </button>
          <button className="btn" onClick={() => mergeRef.current?.click()}>
            <Download size={16} /> Stand übernehmen
          </button>
          <input ref={mergeRef} type="file" accept=".json,application/json" hidden onChange={(e) => (e.target.files?.[0] && pickFile(e.target.files[0], 'merge'), (e.target.value = ''))} />
          {data.settings.lastSyncAt && <span className="small muted">Zuletzt übernommen {relativeTime(data.settings.lastSyncAt)}</span>}
        </div>
      </div>

      <div className="card stack">
        <div className="row">
          <Database size={18} />
          <h2>Datensicherung</h2>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Geht das Handy verloren oder wird die App gelöscht, sind die Daten nur über eine Sicherung zurückzuholen. Mit gesetztem Passwort (oben)
          wird die Sicherung verschlüsselt. „Sicherung laden“ ersetzt alle Daten auf diesem Gerät.
        </p>
        <div className="small">
          Letzte Sicherung: <b>{data.settings.lastBackupAt ? relativeTime(data.settings.lastBackupAt) : 'noch nie'}</b> · {data.transactions.length} Buchungen,{' '}
          {data.accounts.length} Konten, {data.pots.length} Töpfe, {data.rules.length} Regeln, {data.holdings.length} Edelmetall-Positionen
        </div>
        <div className="row wrap">
          <button className="btn" onClick={exportBackup}>
            <Download size={16} /> Sicherung erstellen{password ? ' (verschlüsselt)' : ''}
          </button>
          <button className="btn" onClick={() => backupRef.current?.click()}>
            <Upload size={16} /> Sicherung laden
          </button>
          <input ref={backupRef} type="file" accept=".json,application/json" hidden onChange={(e) => (e.target.files?.[0] && pickFile(e.target.files[0], 'restore'), (e.target.value = ''))} />
        </div>
      </div>

      <div className="card stack">
        <div className="row">
          <Moon size={18} />
          <h2>Darstellung</h2>
        </div>
        <Segmented
          value={theme}
          onChange={applyTheme}
          options={[
            { value: 'auto', label: 'System' },
            { value: 'light', label: 'Hell' },
            { value: 'dark', label: 'Dunkel' },
          ]}
        />
      </div>

      <div className="card stack">
        <h2>Händlerabschlag Edelmetalle</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Händler kaufen unter dem Spotpreis an. Mit diesen Abschlägen wird der „realistische Verkaufswert“ geschätzt.
        </p>
        <div className="form-grid">
          {METALS.map((m) => (
            <Field key={m.id} label={`${m.name} (%)`}>
              <input
                className="input"
                inputMode="decimal"
                value={data.settings.metalDiscount[m.id]}
                onChange={(e) =>
                  store.updateSettings({ metalDiscount: { ...data.settings.metalDiscount, [m.id as Metal]: Math.max(0, parseFloat(e.target.value.replace(',', '.')) || 0) } })
                }
              />
            </Field>
          ))}
        </div>
      </div>

      <div className="card stack">
        <h2>Ausprobieren & Zurücksetzen</h2>
        <div className="row wrap">
          <button className="btn" onClick={loadDemo}>
            <Sparkles size={16} /> Beispielbuchungen anlegen
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (confirmDialog('Wirklich ALLE Daten löschen und mit den Standard-Töpfen und -Konten neu beginnen?')) {
                store.resetAll();
                toast('Alles zurückgesetzt');
              }
            }}
          >
            <RotateCcw size={16} /> Alles zurücksetzen
          </button>
        </div>
      </div>

      {askPassword && (
        <PasswordPrompt
          onCancel={() => setAskPassword(null)}
          onSubmit={(pw) => {
            setPassword(pw);
            savePassword(pw, remember);
            openFile(askPassword.text, askPassword.mode, pw);
          }}
        />
      )}

      {pending && (
        <Modal
          title="Stand übernehmen"
          onClose={() => setPending(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPending(null)}>
                Abbrechen
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  store.mergeIn(pending.data);
                  setPending(null);
                  toast('Daten zusammengeführt');
                }}
              >
                {pending.replaceOnly ? 'Übernehmen' : 'Zusammenführen'}
              </button>
            </>
          }
        >
          <div className="small muted">
            {pending.file?.from ? `Von ${pending.file.from}` : 'Datei'}
            {pending.file ? ` · erstellt am ${fmtDate(toDateStr(new Date(pending.file.createdAt)))}` : ''}
            {pending.file?.encrypted ? ' · verschlüsselt' : ''}
          </div>
          {pending.replaceOnly && (
            <div className="alert info small">Auf diesem Gerät gibt es noch keine eigenen Daten – der Stand wird komplett übernommen.</div>
          )}
          <MergeSummary stats={pending.stats} />
        </Modal>
      )}
    </div>
  );
}

const KIND_LABEL: Record<keyof MergeStats['byKind'], string> = {
  transactions: 'Buchungen',
  pots: 'Töpfe',
  accounts: 'Konten',
  rules: 'Regeln',
  holdings: 'Edelmetalle',
};

function MergeSummary({ stats }: { stats: MergeStats }) {
  const rows = (Object.keys(KIND_LABEL) as (keyof MergeStats['byKind'])[]).filter((k) => {
    const s = stats.byKind[k];
    return s.added || s.updated || s.removed;
  });
  if (!rows.length) return <div className="alert ok small">Beide Stände sind bereits gleich – es ändert sich nichts.</div>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th />
          <th className="right">neu</th>
          <th className="right">geändert</th>
          <th className="right">gelöscht</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((k) => (
          <tr key={k}>
            <td>{KIND_LABEL[k]}</td>
            <td className="right num">{stats.byKind[k].added}</td>
            <td className="right num">{stats.byKind[k].updated}</td>
            <td className="right num">{stats.byKind[k].removed}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PasswordPrompt({ onSubmit, onCancel }: { onSubmit: (pw: string) => void; onCancel: () => void }) {
  const [pw, setPw] = useState('');
  return (
    <Modal
      title="Datei ist verschlüsselt"
      onClose={onCancel}
      footer={
        <button className="btn primary" onClick={() => onSubmit(pw)} disabled={!pw}>
          Öffnen
        </button>
      }
    >
      <Field label="Gemeinsames Passwort">
        <input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pw && onSubmit(pw)} />
      </Field>
      <span className="small muted">Bei falschem Passwort wird erneut gefragt.</span>
    </Modal>
  );
}
