import type { ID, Rule } from '../types';

export interface MatchInput {
  payee?: string;
  purpose?: string;
  amount: number;
  accountId?: ID;
}

export const norm = (s?: string) =>
  (s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();

export function ruleMatches(rule: Rule, e: MatchInput): boolean {
  if (!rule.enabled || !rule.pattern.trim()) return false;
  if (rule.sign === 'in' && e.amount < 0) return false;
  if (rule.sign === 'out' && e.amount >= 0) return false;
  if (rule.accountId && e.accountId && rule.accountId !== e.accountId) return false;
  const hay =
    rule.field === 'payee' ? norm(e.payee) : rule.field === 'purpose' ? norm(e.purpose) : norm(`${e.payee} ${e.purpose}`);
  // Several alternatives can be separated with "|".
  return rule.pattern
    .split('|')
    .map(norm)
    .filter(Boolean)
    .some((p) => hay.includes(p));
}

export function findRule(rules: Rule[], e: MatchInput): Rule | undefined {
  return rules.find((r) => ruleMatches(r, e));
}

const NOISE = /^(sepa|lastschrift|gutschrift|ueberweisung|überweisung|kartenzahlung|dauerauftrag|folgelastschrift|erstlastschrift|svwz\+?|eref\+?|kref\+?|mref\+?|online|karte|debitk|nr\.?|\d+)$/i;

/** Suggests a short, reusable rule pattern for an entry. */
export function suggestPattern(payee?: string, purpose?: string): { field: Rule['field']; pattern: string } {
  const p = (payee || '').trim();
  if (p) {
    // Strip trailing location/branch noise like "REWE Markt GmbH//Berlin/DE" -> "REWE Markt GmbH"
    const cleaned = p.split(/\/\/|\s{2,}|,/)[0].replace(/\s+\d[\d\s]*$/, '').trim();
    return { field: 'payee', pattern: cleaned || p };
  }
  const words = (purpose || '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !NOISE.test(w))
    .slice(0, 2);
  return { field: 'purpose', pattern: words.join(' ') };
}
