import type { Candle, TokenMeta } from "./fomo";
import { WSOL } from "./fomo";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, tries = 2): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json;version=20230302" },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429) { await sleep(2500 * (i + 1)); continue; }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      await sleep(500);
    }
  }
  return null;
}

type DexPair = {
  chainId: string;
  pairAddress: string;
  baseToken: { address: string; symbol: string; name: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
};

/** current USD price + best pool for each mint (DexScreener, no API key) */
export async function getPrices(mints: string[]): Promise<Record<string, TokenMeta>> {
  const unique = [...new Set(mints)];
  const best: Record<string, TokenMeta> = {};
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const data = await getJson<{ pairs?: DexPair[] | null }>(
      `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`
    );
    for (const p of data?.pairs ?? []) {
      if (p.chainId !== "solana") continue;
      const mint = p.baseToken.address;
      if (!chunk.includes(mint)) continue;
      const price = Number(p.priceUsd);
      if (!Number.isFinite(price) || price <= 0) continue;
      const liq = p.liquidity?.usd ?? 0;
      if (!best[mint] || liq > (best[mint].liquidityUsd ?? 0)) {
        best[mint] = { priceUsd: price, symbol: p.baseToken.symbol, name: p.baseToken.name, pairAddress: p.pairAddress, liquidityUsd: liq };
      }
    }
  }
  return best;
}

/** OHLCV candles (newest first from API → we return oldest first). GeckoTerminal, no key. */
export async function getCandles(pool: string, timeframe: "hour" | "day"): Promise<Candle[] | null> {
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/${timeframe}?aggregate=1&limit=1000&currency=usd`;
  const data = await getJson<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(url);
  const list = data?.data?.attributes?.ohlcv_list;
  if (!list) return null;
  return (list as Candle[]).filter((c) => c.length >= 5 && c[2] > 0).sort((a, b) => a[0] - b[0]);
}

/** Historical SOL/USD lookup (hourly for the last ~40d, daily before that). Falls back to current price. */
export async function buildSolPricer(solMeta: TokenMeta | undefined, needHistory: boolean) {
  const current = solMeta?.priceUsd && solMeta.priceUsd > 0 ? solMeta.priceUsd : 150;
  let hourly: Candle[] | null = null;
  let daily: Candle[] | null = null;

  if (needHistory && solMeta?.pairAddress) {
    daily = await getCandles(solMeta.pairAddress, "day");
    await sleep(400);
    hourly = await getCandles(solMeta.pairAddress, "hour");
  }

  const find = (list: Candle[] | null, tsSec: number, span: number) => {
    if (!list?.length) return null;
    let lo = 0, hi = list.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid][0] <= tsSec) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (ans < 0) return null;
    const c = list[ans];
    if (tsSec - c[0] > span) return null;
    return (c[1] + c[4]) / 2;
  };

  const historical = Boolean(hourly?.length || daily?.length);
  return {
    mode: historical ? ("historical" as const) : ("current" as const),
    current,
    at(tsMs: number | null): number {
      if (tsMs == null) return current;
      const s = tsMs / 1000;
      return find(hourly, s, 3600) ?? find(daily, s, 86400) ?? current;
    },
  };
}

export { WSOL };
