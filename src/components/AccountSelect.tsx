import type { Account, ID } from '../types';

/** Accounts in tree order (parents followed by their sub-accounts) with depth. */
export function accountTree(accounts: Account[], includeArchived = false): { account: Account; depth: number }[] {
  const list = accounts.filter((a) => includeArchived || !a.archived);
  const ids = new Set(list.map((a) => a.id));
  const res: { account: Account; depth: number }[] = [];
  const walk = (parent: ID | undefined, depth: number) => {
    list
      .filter((a) => (a.parentId && ids.has(a.parentId) ? a.parentId : undefined) === parent)
      .sort((a, b) => a.institution.localeCompare(b.institution) || a.order - b.order)
      .forEach((a) => {
        res.push({ account: a, depth });
        walk(a.id, depth + 1);
      });
  };
  walk(undefined, 0);
  return res;
}

export const accountLabel = (a?: Account) => (a ? `${a.institution ? a.institution + ' · ' : ''}${a.name}` : '–');

export function AccountSelect({
  accounts,
  value,
  onChange,
  placeholder,
  exclude,
  className = 'input',
}: {
  accounts: Account[];
  value: ID | undefined;
  onChange: (id: ID | undefined) => void;
  placeholder?: string;
  exclude?: ID;
  className?: string;
}) {
  return (
    <select className={className} value={value || ''} onChange={(e) => onChange(e.target.value || undefined)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {accountTree(accounts)
        .filter(({ account }) => account.id !== exclude)
        .map(({ account, depth }) => (
          <option key={account.id} value={account.id}>
            {'   '.repeat(depth)}
            {depth ? '└ ' : ''}
            {accountLabel(account)}
          </option>
        ))}
    </select>
  );
}
