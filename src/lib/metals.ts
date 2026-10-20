import type { Metal, MetalPrice } from '../types';
import { OZ } from './calc';

export const METALS: { id: Metal; name: string; symbol: string; color: string }[] = [
  { id: 'gold', name: 'Gold', symbol: 'XAU', color: '#d4a017' },
  { id: 'silver', name: 'Silber', symbol: 'XAG', color: '#9aa4b1' },
  { id: 'platinum', name: 'Platin', symbol: 'XPT', color: '#7f8fa6' },
  { id: 'palladium', name: 'Palladium', symbol: 'XPD', color: '#b08d74' },
];

export const metalName = (m: Metal) => METALS.find((x) => x.id === m)!.name;

export interface Preset {
  metal: Metal;
  group: string;
  name: string;
  fineGrams: number;
}

const oz = (f: number) => OZ * f;

/** Common bullion coins and bars with their fine metal content. */
export const PRESETS: Preset[] = [
  // Gold – Anlagemünzen
  ...['Krügerrand', 'Maple Leaf', 'Wiener Philharmoniker', 'American Eagle', 'American Buffalo', 'Britannia', 'Känguru / Nugget', 'Libertad', 'Lunar (Perth Mint)', 'Arche Noah']
    .map((n) => ({ metal: 'gold' as Metal, group: 'Goldmünzen 1 oz', name: `${n} 1 oz`, fineGrams: oz(1) })),
  ...['Krügerrand', 'Maple Leaf', 'Wiener Philharmoniker', 'Britannia', 'Känguru']
    .flatMap((n) => [
      { metal: 'gold' as Metal, group: 'Goldmünzen Teilunzen', name: `${n} 1/2 oz`, fineGrams: oz(0.5) },
      { metal: 'gold' as Metal, group: 'Goldmünzen Teilunzen', name: `${n} 1/4 oz`, fineGrams: oz(0.25) },
      { metal: 'gold' as Metal, group: 'Goldmünzen Teilunzen', name: `${n} 1/10 oz`, fineGrams: oz(0.1) },
    ]),
  { metal: 'gold', group: 'Goldmünzen sonstige', name: 'China Panda 30 g', fineGrams: 30 },
  { metal: 'gold', group: 'Goldmünzen sonstige', name: '20 Mark Kaiserreich', fineGrams: 7.168 },
  { metal: 'gold', group: 'Goldmünzen sonstige', name: '10 Mark Kaiserreich', fineGrams: 3.584 },
  { metal: 'gold', group: 'Goldmünzen sonstige', name: 'Vreneli 20 Franken', fineGrams: 5.806 },
  { metal: 'gold', group: 'Goldmünzen sonstige', name: 'Sovereign', fineGrams: 7.322 },
  { metal: 'gold', group: 'Goldmünzen sonstige', name: '1 Dukat Österreich', fineGrams: 3.44 },
  { metal: 'gold', group: 'Goldmünzen sonstige', name: '4 Dukaten Österreich', fineGrams: 13.76 },
  { metal: 'gold', group: 'Goldmünzen sonstige', name: '100 Kronen Österreich', fineGrams: 30.487 },
  { metal: 'gold', group: 'Goldmünzen sonstige', name: '100 Euro Deutschland (1/2 oz)', fineGrams: oz(0.5) },
  { metal: 'gold', group: 'Goldmünzen sonstige', name: '50 Euro Deutschland (1/4 oz)', fineGrams: oz(0.25) },
  { metal: 'gold', group: 'Goldmünzen sonstige', name: '20 Euro Deutschland (1/8 oz)', fineGrams: oz(0.125) },
  ...[1, 2, 5, 10, 20, 50, 100, 250, 500, 1000].map((g) => ({
    metal: 'gold' as Metal, group: 'Goldbarren', name: `Goldbarren ${g >= 1000 ? g / 1000 + ' kg' : g + ' g'}`, fineGrams: g,
  })),
  { metal: 'gold', group: 'Goldbarren', name: 'Goldbarren 1 oz', fineGrams: oz(1) },
  // Silber
  ...['Maple Leaf', 'Wiener Philharmoniker', 'Krügerrand', 'Britannia', 'Känguru', 'American Eagle', 'Arche Noah', 'Libertad', 'Lunar (Perth Mint)', 'Kookaburra', 'Koala']
    .map((n) => ({ metal: 'silver' as Metal, group: 'Silbermünzen 1 oz', name: `${n} 1 oz`, fineGrams: oz(1) })),
  { metal: 'silver', group: 'Silbermünzen sonstige', name: 'China Panda 30 g', fineGrams: 30 },
  { metal: 'silver', group: 'Silbermünzen sonstige', name: '10 Euro Gedenkmünze (925er, bis 2010)', fineGrams: 16.65 },
  { metal: 'silver', group: 'Silbermünzen sonstige', name: '10 Euro Gedenkmünze (625er, 2011–2015)', fineGrams: 10 },
  { metal: 'silver', group: 'Silbermünzen sonstige', name: '20 Euro Gedenkmünze (925er)', fineGrams: 16.65 },
  { metal: 'silver', group: 'Silbermünzen sonstige', name: '5 DM Gedenkmünze (625er)', fineGrams: 7 },
  { metal: 'silver', group: 'Silbermünzen sonstige', name: '10 DM Gedenkmünze (925er)', fineGrams: 14.34 },
  ...[2, 5, 10].map((n) => ({ metal: 'silver' as Metal, group: 'Silbermünzen sonstige', name: `Kookaburra / Lunar ${n} oz`, fineGrams: oz(n) })),
  { metal: 'silver', group: 'Silbermünzen sonstige', name: 'Kookaburra 1 kg', fineGrams: 1000 },
  ...[100, 250, 500, 1000, 5000].map((g) => ({
    metal: 'silver' as Metal, group: 'Silberbarren', name: `Silberbarren ${g >= 1000 ? g / 1000 + ' kg' : g + ' g'}`, fineGrams: g,
  })),
  { metal: 'silver', group: 'Silberbarren', name: 'Silberbarren 1 oz', fineGrams: oz(1) },
  // Platin / Palladium
  ...['Maple Leaf', 'Wiener Philharmoniker', 'Platypus', 'Britannia'].map((n) => ({
    metal: 'platinum' as Metal, group: 'Platin', name: `Platin ${n} 1 oz`, fineGrams: oz(1),
  })),
  ...[10, 20, 50, 100].map((g) => ({ metal: 'platinum' as Metal, group: 'Platin', name: `Platinbarren ${g} g`, fineGrams: g })),
  { metal: 'palladium', group: 'Palladium', name: 'Palladium Maple Leaf 1 oz', fineGrams: oz(1) },
  ...[10, 20, 50, 100].map((g) => ({ metal: 'palladium' as Metal, group: 'Palladium', name: `Palladiumbarren ${g} g`, fineGrams: g })),
];

async function getJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    // Plain anonymous GET: no cookies, no referrer, nothing from the app's data is sent.
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function usdToEur(): Promise<number> {
  const sources: [string, (j: any) => number][] = [
    ['https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR', (j) => j.rates.EUR],
    ['https://api.frankfurter.app/latest?from=USD&to=EUR', (j) => j.rates.EUR],
  ];
  for (const [url, read] of sources) {
    try {
      const rate = Number(read(await getJson(url)));
      if (rate > 0) return rate;
    } catch {
      /* try next source */
    }
  }
  throw new Error('Wechselkurs USD→EUR nicht abrufbar');
}

/** The only hosts the app ever contacts (also enforced by the Content-Security-Policy in vite.config.ts). */
export const PRICE_HOSTS = ['https://api.gold-api.com', 'https://api.frankfurter.dev', 'https://api.frankfurter.app'];

/**
 * Fetches spot prices (EUR per troy ounce) from free public APIs without key.
 * gold-api.com quotes in USD, converted with the ECB rate from frankfurter.
 */
export async function fetchSpotPrices(): Promise<{ prices: Partial<Record<Metal, MetalPrice>>; errors: string[] }> {
  const errors: string[] = [];
  const prices: Partial<Record<Metal, MetalPrice>> = {};
  let rate: number;
  try {
    rate = await usdToEur();
  } catch (e) {
    return { prices, errors: [(e as Error).message] };
  }
  await Promise.all(
    METALS.map(async (m) => {
      try {
        const j = await getJson(`https://api.gold-api.com/price/${m.symbol}`);
        const usd = Number(j.price);
        if (!(usd > 0)) throw new Error('ungültige Antwort');
        prices[m.id] = { eurPerOz: usd * rate, updatedAt: Date.now(), source: 'api' };
      } catch (e) {
        errors.push(`${m.name}: ${(e as Error).message}`);
      }
    }),
  );
  return { prices, errors };
}
