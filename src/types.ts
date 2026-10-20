// All money values are integer cents to avoid floating point drift.
export type ID = string;
export type Cents = number;
/** ISO date, YYYY-MM-DD */
export type DateStr = string;

export type AccountType = 'giro' | 'savings' | 'daily' | 'depot' | 'cash' | 'credit' | 'loan' | 'other';

export interface Account {
  id: ID;
  /** Last local change (ms), used to merge data between devices. */
  updatedAt?: number;
  name: string;
  institution: string;
  type: AccountType;
  /** Makes this a sub-account (Unterkonto) of another account. */
  parentId?: ID;
  iban?: string;
  /** Balance before the first recorded transaction. */
  openingBalance: Cents;
  color: string;
  /** Money on this account is managed in pots (Töpfe). */
  inBudget: boolean;
  includeInNetWorth: boolean;
  archived?: boolean;
  note?: string;
  order: number;
}

export interface Subitem {
  id: ID;
  name: string;
  archived?: boolean;
}

export interface Pot {
  id: ID;
  /** Last local change (ms), used to merge data between devices. */
  updatedAt?: number;
  name: string;
  icon: string;
  color: string;
  subitems: Subitem[];
  /** Spending budget per month (positive cents). */
  monthlyBudget?: Cents;
  /** Planned monthly allocation (Soll-Zuführung). */
  monthlyContribution?: Cents;
  /** Savings goal. */
  targetAmount?: Cents;
  /** Warn when the balance falls below this. */
  minBalance?: Cents;
  archived?: boolean;
  note?: string;
  order: number;
}

export interface Split {
  /** null = not assigned to a pot ("nicht verteilt"). */
  potId: ID | null;
  /** Signed amount, same sign convention as the transaction. */
  amount: Cents;
  subitemIds: ID[];
}

export type TxKind = 'income' | 'expense' | 'transfer' | 'potTransfer' | 'adjustment';

export interface Transaction {
  id: ID;
  /** Last local change (ms), used to merge data between devices. */
  updatedAt?: number;
  date: DateStr;
  kind: TxKind;
  /**
   * income/expense/adjustment: signed (+ in, - out).
   * transfer/potTransfer: positive amount moved.
   */
  amount: Cents;
  accountId?: ID;
  toAccountId?: ID;
  splits: Split[];
  payee?: string;
  purpose?: string;
  note?: string;
  source: 'manual' | 'import';
  importRef?: string;
  /** Imported and not yet assigned in a question session. */
  needsReview?: boolean;
  createdAt: number;
}

export type RuleField = 'payee' | 'purpose' | 'any';
export type RuleAction =
  | { type: 'pot'; potId: ID; subitemIds: ID[] }
  | { type: 'transfer'; toAccountId: ID }
  | { type: 'ignore' };

export interface Rule {
  id: ID;
  /** Last local change (ms), used to merge data between devices. */
  updatedAt?: number;
  field: RuleField;
  pattern: string;
  sign: 'in' | 'out' | 'any';
  accountId?: ID;
  action: RuleAction;
  hits: number;
  enabled: boolean;
  createdAt: number;
}

export type Metal = 'gold' | 'silver' | 'platinum' | 'palladium';

export interface MetalHolding {
  id: ID;
  /** Last local change (ms), used to merge data between devices. */
  updatedAt?: number;
  metal: Metal;
  name: string;
  /** Fine metal content per piece in grams. */
  fineGrams: number;
  quantity: number;
  /** Total purchase price for all pieces (optional). */
  purchasePrice?: Cents;
  purchaseDate?: DateStr;
  location?: string;
  note?: string;
}

export interface MetalPrice {
  /** EUR per troy ounce. */
  eurPerOz: number;
  updatedAt: number;
  source: 'api' | 'manual';
}

export interface CsvMapping {
  signature: string;
  delimiter: string;
  dateCol: number;
  amountCol: number;
  /** Optional separate debit/credit columns instead of a signed amount. */
  debitCol?: number;
  creditCol?: number;
  payeeCol?: number;
  purposeCol?: number;
  ibanCol?: number;
  bookingTextCol?: number;
  accountIbanCol?: number;
}

export interface Settings {
  metalsInNetWorth: boolean;
  /** Fetch spot prices online; when off the app makes no network requests at all. */
  onlinePrices: boolean;
  /** Shown to the partner when sharing, e.g. "Sam". */
  deviceName?: string;
  lastSyncAt?: number;
  /** Dealer buy-back discount in percent, used for the "realistic" metal value. */
  metalDiscount: Record<Metal, number>;
  lastBackupAt?: number;
  lastAccountId?: ID;
}

export interface NetWorthSnapshot {
  date: DateStr;
  total: Cents;
  accounts: Cents;
  metals: Cents;
}

export interface AppData {
  version: number;
  accounts: Account[];
  pots: Pot[];
  transactions: Transaction[];
  rules: Rule[];
  holdings: MetalHolding[];
  prices: Partial<Record<Metal, MetalPrice>>;
  priceHistory: { date: DateStr; prices: Partial<Record<Metal, number>> }[];
  ignoredImportRefs: string[];
  csvMappings: CsvMapping[];
  snapshots: NetWorthSnapshot[];
  /** Deleted record ids with deletion time, so deletions survive merging. */
  tombstones: Record<ID, number>;
  settings: Settings;
}
