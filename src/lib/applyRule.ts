import type { ID, Rule, Transaction } from '../types';

/**
 * Turns a signed booking on `accountId` into the transaction fields a rule action implies.
 * Returns null for "ignore" rules.
 */
export function ruleToTxFields(
  rule: Rule | undefined,
  amount: number,
  accountId: ID,
): Pick<Transaction, 'kind' | 'amount' | 'accountId' | 'toAccountId' | 'splits' | 'needsReview'> | null {
  if (rule?.action.type === 'ignore') return null;
  if (rule?.action.type === 'transfer' && rule.action.toAccountId !== accountId) {
    const other = rule.action.toAccountId;
    return amount < 0
      ? { kind: 'transfer', amount: -amount, accountId, toAccountId: other, splits: [], needsReview: false }
      : { kind: 'transfer', amount, accountId: other, toAccountId: accountId, splits: [], needsReview: false };
  }
  const kind = amount >= 0 ? 'income' : 'expense';
  if (rule?.action.type === 'pot')
    return { kind, amount, accountId, toAccountId: undefined, splits: [{ potId: rule.action.potId, amount, subitemIds: rule.action.subitemIds }], needsReview: false };
  return { kind, amount, accountId, toAccountId: undefined, splits: [], needsReview: true };
}

/** Signed amount of a transaction from the perspective of the account it was imported into. */
export function importedAmount(tx: Transaction, importAccountId: ID): number {
  if (tx.kind === 'transfer') return tx.toAccountId === importAccountId ? tx.amount : -tx.amount;
  return tx.amount;
}
