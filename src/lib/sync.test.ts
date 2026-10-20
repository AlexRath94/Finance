import { describe, expect, it } from 'vitest';
import { dataOf, emptyData, useStore } from '../store';
import { mergeData } from './sync';
import { createShareFile, readShareFile, WrongPasswordError } from './shareFile';
import type { AppData, Transaction } from '../types';

const tx = (id: string, updatedAt: number, extra: Partial<Transaction> = {}): Transaction => ({
  id, updatedAt, date: '2026-10-01', kind: 'expense', amount: -100, splits: [], source: 'manual', createdAt: 0, ...extra,
});

function base(): AppData {
  const d = emptyData();
  d.accounts = d.accounts.map((a) => ({ ...a, updatedAt: 1 }));
  return d;
}

describe('change tracking in the store', () => {
  it('stamps changed records and records deletions', () => {
    const s = useStore.getState();
    s.resetAll();
    const id = s.addTransaction({ date: '2026-10-01', kind: 'expense', amount: -500, accountId: s.accounts[0].id, splits: [], source: 'manual' });
    const created = useStore.getState().transactions.find((t) => t.id === id)!;
    expect(created.updatedAt).toBeGreaterThan(0);
    const untouched = useStore.getState().accounts[1];
    useStore.getState().updateAccount(useStore.getState().accounts[0].id, { name: 'Neu' });
    expect(useStore.getState().accounts[0].updatedAt).toBeGreaterThan(0);
    expect(useStore.getState().accounts[1]).toBe(untouched);
    useStore.getState().deleteTransactions([id]);
    expect(useStore.getState().tombstones[id]).toBeGreaterThan(0);
    expect(dataOf(useStore.getState()).tombstones[id]).toBeDefined();
  });
});

describe('mergeData', () => {
  it('keeps the newer version of each record and both sides additions', () => {
    const a = base();
    const b = structuredClone(a);
    a.transactions = [tx('shared', 10, { payee: 'alt' }), tx('onlyA', 5)];
    b.transactions = [tx('shared', 20, { payee: 'neu' }), tx('onlyB', 6)];
    const { data, stats } = mergeData(a, b);
    expect(data.transactions.map((t) => t.id).sort()).toEqual(['onlyA', 'onlyB', 'shared']);
    expect(data.transactions.find((t) => t.id === 'shared')!.payee).toBe('neu');
    expect(stats.byKind.transactions).toEqual({ added: 1, updated: 1, removed: 0 });
  });

  it('applies deletions from the partner unless edited afterwards', () => {
    const a = base();
    a.transactions = [tx('x', 10), tx('y', 50)];
    const b = structuredClone(a);
    b.transactions = [];
    b.tombstones = { x: 20, y: 30 };
    const { data } = mergeData(a, b);
    expect(data.transactions.map((t) => t.id)).toEqual(['y']);
    expect(data.tombstones.x).toBe(20);
  });

  it('de-duplicates the same statement imported on both phones', () => {
    const a = base();
    const b = structuredClone(a);
    a.transactions = [tx('a1', 10, { importRef: 'ref1', source: 'import' })];
    b.transactions = [tx('b1', 12, { importRef: 'ref1', source: 'import' })];
    const { data } = mergeData(a, b);
    expect(data.transactions.map((t) => t.id)).toEqual(['b1']);
    expect(data.tombstones.a1).toBeDefined();
  });

  it('takes everything over on an untouched device without duplicating default pots', () => {
    const fresh = emptyData();
    const remote = base();
    remote.pots = remote.pots.map((p) => ({ ...p, updatedAt: 3 }));
    remote.transactions = [tx('t', 4)];
    const { data } = mergeData(fresh, remote);
    expect(data.pots.map((p) => p.id)).toEqual(remote.pots.map((p) => p.id));
    expect(data.accounts.map((a) => a.id)).toEqual(remote.accounts.map((a) => a.id));
    expect(data.settings).toBe(fresh.settings);
  });
});

describe('share file', () => {
  it('round-trips encrypted data and rejects a wrong password', async () => {
    const d = base();
    d.transactions = [tx('t', 1, { payee: 'Geheim' })];
    const file = await createShareFile(d, 'pass123', 'Sam');
    const text = JSON.stringify(file);
    expect(text).not.toContain('Geheim');
    const { data } = await readShareFile(text, 'pass123');
    expect(data.transactions[0].payee).toBe('Geheim');
    await expect(readShareFile(text, 'falsch')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('reads plain backups of the first version', async () => {
    const d = base();
    const { data } = await readShareFile(JSON.stringify(d));
    expect(data.accounts.length).toBe(d.accounts.length);
  });
});
