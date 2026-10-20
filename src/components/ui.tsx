import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Cents, Pot } from '../types';
import type { Status } from '../lib/calc';
import { centsToInput, fmtEur, fmtEurSigned, parseMoney } from '../lib/format';

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Schließen">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Money text field accepting German notation; reports cents (or null while invalid/empty). */
export function MoneyInput({
  value,
  onChange,
  className = 'input',
  placeholder = '0,00',
  autoFocus,
  allowNegative,
  onEnter,
}: {
  value: Cents | null | undefined;
  onChange: (c: Cents | null) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  allowNegative?: boolean;
  onEnter?: () => void;
}) {
  const [text, setText] = useState(value === null || value === undefined ? '' : centsToInput(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(value === null || value === undefined ? '' : centsToInput(value));
      last.current = value;
    }
  }, [value]);
  return (
    <input
      className={className}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => {
        setText(e.target.value);
        let c = parseMoney(e.target.value);
        if (c !== null && !allowNegative) c = Math.abs(c);
        last.current = c;
        onChange(c);
      }}
      onBlur={() => {
        if (last.current !== null && last.current !== undefined) setText(centsToInput(last.current));
      }}
      onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
    />
  );
}

export function Money({ value, signed, colored, className = '' }: { value: Cents; signed?: boolean; colored?: boolean; className?: string }) {
  const cls = colored ? (value < 0 ? 'neg' : value > 0 ? 'pos' : '') : '';
  return <span className={`num ${cls} ${className}`}>{signed ? fmtEurSigned(value) : fmtEur(value)}</span>;
}

export function StatusBadge({ status, children }: { status: Status; children: ReactNode }) {
  return <span className={`badge ${status === 'neutral' ? '' : status}`}>{children}</span>;
}

export function PotTag({ pot, fallback = 'Nicht verteilt' }: { pot?: Pot; fallback?: string }) {
  if (!pot) return <span className="badge">{fallback}</span>;
  return (
    <span className="pot-tag" style={{ ['--c' as string]: pot.color }}>
      {pot.icon} {pot.name}
    </span>
  );
}

export function Progress({ value, max, status, color }: { value: number; max: number; status?: Status; color?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`progress ${status === 'bad' ? 'bad' : status === 'warn' ? 'warn' : ''}`} style={color ? { ['--c' as string]: color } : undefined}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">{icon}</div>
      {children}
    </div>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="tiny muted">{hint}</span>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  full,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; className?: string }[];
  full?: boolean;
}) {
  return (
    <div className={`segmented${full ? ' full' : ''}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`${value === o.value ? 'active' : ''} ${o.className || ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- toasts & confirm

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
const ToastCtx = createContext<(text: string, action?: Toast['action']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.text}
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function confirmDialog(text: string): boolean {
  return window.confirm(text);
}
