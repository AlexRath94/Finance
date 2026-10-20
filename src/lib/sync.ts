import type { AppData, ID } from '../types';

type Rec = { id: ID; updatedAt?: number };
const TRACKED = ['accounts', 'pots', 'transactions', 'rules', 'holdings'] as const;

export interface MergeStats {
  added: number;
  updated: number;
  removed: number;
  byKind: Record<(typeof TRACKED)[number], { added: number; updated: number; removed: number }>;
}

/** True for a device that only holds the untouched default setup (e.g. a freshly installed partner phone). */
export function isPristine(d: AppData): boolean {
  return (
    !d.transactions.length &&
    !d.holdings.length &&
    !d.rules.length &&
    !Object.keys(d.tombstones || {}).length &&
    [...d.accounts, ...d.pots].every((r) => !r.updatedAt)
  );
}

function mergeList<T extends Rec>(local: T[], remote: T[], tombstones: Record<ID, number>): T[] {
  const map = new Map<ID, T>();
  for (const r of local) map.set(r.id, r);
  for (const r of remote) {
    const mine = map.get(r.id);
    // Last writer wins; on a tie the local version stays.
    if (!mine || (r.updatedAt || 0) > (mine.updatedAt || 0)) map.set(r.id, r);
  }
  // A deletion wins unless the record was changed again after it was deleted.
  return [...map.values()].filter((r) => !(r.id in tombstones) || (r.updatedAt || 0) > tombstones[r.id]);
}

/**
 * Merges the partner's data into the local data. Records are merged individually by their
 * change time, deletions travel as tombstones, and bookings both partners imported from the
 * same statement are de-duplicated by their import reference.
 */
export function mergeData(local: AppData, remote: AppData): { data: AppData; stats: MergeStats } {
  const tombstones: Record<ID, number> = { ...(local.tombstones || {}) };
  for (const [id, at] of Object.entries(remote.tombstones || {})) tombstones[id] = Math.max(tombstones[id] || 0, at);

  const pristine = isPristine(local);
  const merged = {} as Pick<AppData, (typeof TRACKED)[number]>;
  for (const key of TRACKED) {
    const mine = (pristine ? [] : local[key] || []) as Rec[];
    (merged as Record<string, Rec[]>)[key] = mergeList(mine, (remote[key] || []) as Rec[], tombstones);
  }

  // Same statement imported on both phones -> keep one booking per import reference.
  const winner = new Map<string, AppData['transactions'][number]>();
  for (const t of merged.transactions) {
    if (!t.importRef) continue;
    const other = winner.get(t.importRef);
    if (!other || (t.updatedAt || 0) > (other.updatedAt || 0)) winner.set(t.importRef, t);
  }
  merged.transactions = merged.transactions.filter((t) => {
    if (!t.importRef || winner.get(t.importRef) === t) return true;
    tombstones[t.id] = Math.max(tombstones[t.id] || 0, t.updatedAt || 0);
    return false;
  });

  const prices = { ...local.prices };
  for (const [m, p] of Object.entries(remote.prices || {}) as [keyof AppData['prices'], NonNullable<AppData['prices'][keyof AppData['prices']]>][])
    if (!prices[m] || p.updatedAt > prices[m]!.updatedAt) prices[m] = p;

  const byDate = <T extends { date: string }>(a: T[] = [], b: T[] = []) => {
    const map = new Map<string, T>();
    for (const x of b) map.set(x.date, x);
    for (const x of a) map.set(x.date, x);
    return [...map.values()].sort((x, y) => x.date.localeCompare(y.date));
  };
  const mappings = new Map(remote.csvMappings?.map((m) => [m.signature, m]));
  for (const m of local.csvMappings || []) mappings.set(m.signature, m);

  const data: AppData = {
    ...local,
    ...merged,
    tombstones,
    prices,
    priceHistory: byDate(local.priceHistory, remote.priceHistory).slice(-730),
    snapshots: byDate(local.snapshots, remote.snapshots).slice(-1500),
    ignoredImportRefs: [...new Set([...(local.ignoredImportRefs || []), ...(remote.ignoredImportRefs || [])])],
    csvMappings: [...mappings.values()],
    settings: local.settings,
  };
  return { data, stats: diffStats(local, data) };
}

function diffStats(before: AppData, after: AppData): MergeStats {
  const stats: MergeStats = { added: 0, updated: 0, removed: 0, byKind: {} as MergeStats['byKind'] };
  for (const key of TRACKED) {
    const old = new Map((before[key] as Rec[]).map((r) => [r.id, r]));
    const s = { added: 0, updated: 0, removed: 0 };
    const now = new Set<ID>();
    for (const r of after[key] as Rec[]) {
      now.add(r.id);
      const o = old.get(r.id);
      if (!o) s.added++;
      else if (o !== r) s.updated++;
    }
    for (const id of old.keys()) if (!now.has(id)) s.removed++;
    stats.byKind[key] = s;
    stats.added += s.added;
    stats.updated += s.updated;
    stats.removed += s.removed;
  }
  return stats;
}
