/**
 * Pure FOMO logic: no network, no Next.js. Easy to test.
 *
 *  1. parseSwap()   – turns one parsed Solana tx into a buy/sell of ONE token
 *                     against SOL / USDC / USDT (from the wallet's perspective).
 *  2. buildReport() – values every swap in USD and compares it with the
 *                     token's price NOW and its PEAK after the trade.
 */

export const WSOL = "So11111111111111111111111111111111111111112";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const QUOTE_MINTS = new Set([WSOL, USDC, USDT]);
const TOKEN_ACCOUNT_RENT_SOL = 2_039_280 / 1e9;
const MIN_QUOTE_SOL = 0.001; // ignore dust
const MIN_QUOTE_USD = 0.05;

/* ───────────── types ───────────── */

type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
};

export type RpcTx = {
  blockTime?: number | null;
  meta: null | {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[] | null;
    postTokenBalances?: TokenBalance[] | null;
  };
  transaction: { message: { accountKeys: Array<string | { pubkey: string }> } };
};

export type Swap = {
  signature: string;
  timestamp: number | null; // ms
  side: "buy" | "sell";
  tokenMint: string;
  tokenAmount: number; // always positive
  /** signed, wallet perspective: negative = wallet paid */
  solAmount: number;
  usdAmount: number; // USDC + USDT, signed
  feeSol: number;
};

export type ParseResult =
  | { kind: "swap"; swap: Swap }
  | { kind: "token_to_token" }
  | { kind: "ignored" };

export type TokenMeta = {
  priceUsd: number;
  symbol: string;
  name?: string;
  pairAddress?: string;
  liquidityUsd?: number;
};

/** [tsSeconds, open, high, low, close, volume] */
export type Candle = [number, number, number, number, number, number];

export type TradeView = {
  signature: string;
  timestamp: number | null;
  side: "buy" | "sell";
  tokenMint: string;
  symbol: string;
  tokenAmount: number;
  usd: number; // cost (buy) or proceeds (sell) at trade time
  priceAtTrade: number;
  valueNowUsd: number | null;
  /** sell: valueNow - proceeds (positive = you sold too early)
   *  buy:  valueNow - cost     (negative = underwater)            */
  diffNowUsd: number | null;
  peakPriceUsd: number | null;
  /** sell only: value at peak after the sale - proceeds */
  diffPeakUsd: number | null;
  feeSol: number;
};

export type TokenSummary = {
  mint: string;
  symbol: string;
  name?: string;
  priceNowUsd: number | null;
  priced: boolean;
  buys: number;
  sells: number;
  boughtUsd: number;
  soldUsd: number;
  boughtTokens: number;
  soldTokens: number;
  heldTokens: number;
  heldValueUsd: number | null;
  pnlUsd: number | null;
  missedNowUsd: number;
  savedNowUsd: number;
  maxPotentialUsd: number;
  hasPeakData: boolean;
};

export type Totals = {
  trades: number;
  buys: number;
  sells: number;
  tokens: number;
  boughtUsd: number;
  soldUsd: number;
  soldNowValueUsd: number;
  heldValueUsd: number;
  netPnlUsd: number;
  missedNowUsd: number;
  maxPotentialUsd: number;
  savedNowUsd: number;
  underwaterBuysUsd: number;
  quickFlips: number;
  unpricedTokens: number;
};

/* ───────────── 1. parse a transaction ───────────── */

const keyOf = (k: string | { pubkey: string }) => (typeof k === "string" ? k : k.pubkey);
const rawAmount = (b: TokenBalance) =>
  Number(b.uiTokenAmount.amount) / Math.pow(10, b.uiTokenAmount.decimals);

export function parseSwap(tx: RpcTx, wallet: string, signature: string, blockTime?: number | null): ParseResult {
  const meta = tx.meta;
  if (!meta || meta.err) return { kind: "ignored" };

  const idx = tx.transaction.message.accountKeys.map(keyOf).indexOf(wallet);
  if (idx < 0) return { kind: "ignored" };

  // wallet-owned token accounts: pre / post
  type Acc = { mint: string; pre: number; post: number; inPre: boolean; inPost: boolean };
  const accs = new Map<number, Acc>();
  for (const b of meta.preTokenBalances ?? []) {
    if (b.owner !== wallet) continue;
    accs.set(b.accountIndex, { mint: b.mint, pre: rawAmount(b), post: 0, inPre: true, inPost: false });
  }
  for (const b of meta.postTokenBalances ?? []) {
    if (b.owner !== wallet) continue;
    const a = accs.get(b.accountIndex);
    if (a) { a.post = rawAmount(b); a.inPost = true; }
    else accs.set(b.accountIndex, { mint: b.mint, pre: 0, post: rawAmount(b), inPre: false, inPost: true });
  }

  const mintDelta = new Map<string, number>();
  let rentAdj = 0; // undo rent paid / refunded for opening / closing token accounts
  for (const a of accs.values()) {
    mintDelta.set(a.mint, (mintDelta.get(a.mint) ?? 0) + (a.post - a.pre));
    if (a.inPost && !a.inPre) rentAdj += TOKEN_ACCOUNT_RENT_SOL;
    if (a.inPre && !a.inPost) rentAdj -= TOKEN_ACCOUNT_RENT_SOL;
  }

  const feeSol = meta.fee / 1e9;
  const feePaidByWallet = idx === 0 ? feeSol : 0;
  const nativeDelta = (meta.postBalances[idx] - meta.preBalances[idx]) / 1e9 + feePaidByWallet + rentAdj;

  const solDelta = nativeDelta + (mintDelta.get(WSOL) ?? 0);
  const usdDelta = (mintDelta.get(USDC) ?? 0) + (mintDelta.get(USDT) ?? 0);

  const others = [...mintDelta.entries()]
    .filter(([mint, d]) => !QUOTE_MINTS.has(mint) && Math.abs(d) > 0)
    .map(([mint, amount]) => ({ mint, amount }));

  const qSol = Math.abs(solDelta) > MIN_QUOTE_SOL;
  const qUsd = Math.abs(usdDelta) > MIN_QUOTE_USD;

  if (others.length === 0) return { kind: "ignored" };

  if (others.length === 2 && !qSol && !qUsd && Math.sign(others[0].amount) !== Math.sign(others[1].amount)) {
    return { kind: "token_to_token" };
  }
  if (others.length !== 1) return { kind: "ignored" };

  const token = others[0];
  const s = Math.sign(token.amount);

  if (!qSol && !qUsd) return { kind: "ignored" }; // plain transfer
  // quote must move in the opposite direction, otherwise it's an airdrop / LP / etc.
  if ((qSol && Math.sign(solDelta) === s) || (qUsd && Math.sign(usdDelta) === s)) return { kind: "ignored" };

  return {
    kind: "swap",
    swap: {
      signature,
      timestamp: blockTime == null ? (tx.blockTime == null ? null : tx.blockTime * 1000) : blockTime * 1000,
      side: s > 0 ? "buy" : "sell",
      tokenMint: token.mint,
      tokenAmount: Math.abs(token.amount),
      solAmount: qSol ? solDelta : 0,
      usdAmount: qUsd ? usdDelta : 0,
      feeSol,
    },
  };
}

/* ───────────── 2. build the report ───────────── */

export type ReportInput = {
  swaps: Swap[];
  solPriceAt: (tsMs: number | null) => number;
  meta: Record<string, TokenMeta | undefined>;
  held: Record<string, number>;
  candles: Record<string, Candle[] | undefined>;
};

const short = (m: string) => `${m.slice(0, 4)}…${m.slice(-4)}`;

function sanitizeHigh(c: Candle): number {
  const [, o, h, , cl] = c;
  const body = Math.max(o, cl);
  // drop absurd one-tick wicks (bad prints on thin pools)
  return body > 0 && h > body * 20 ? body : h;
}

export function peakAfter(candles: Candle[] | undefined, afterMs: number | null): number | null {
  if (!candles?.length || afterMs == null) return null;
  let peak: number | null = null;
  for (const c of candles) {
    if (c[0] * 1000 <= afterMs) continue; // candle must start after the sale
    const h = sanitizeHigh(c);
    if (peak == null || h > peak) peak = h;
  }
  return peak;
}

export function countQuickFlips(swaps: Swap[]): number {
  const byToken = new Map<string, Swap[]>();
  for (const s of swaps) byToken.set(s.tokenMint, [...(byToken.get(s.tokenMint) ?? []), s]);
  let n = 0;
  for (const list of byToken.values()) {
    list.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    for (let i = 1; i < list.length; i++) {
      const p = list[i - 1], c = list[i];
      if (p.side !== c.side && p.timestamp != null && c.timestamp != null && c.timestamp - p.timestamp <= 3_600_000) n++;
    }
  }
  return n;
}

export function buildReport(input: ReportInput) {
  const { swaps, solPriceAt, meta, held, candles } = input;

  const trades: TradeView[] = swaps.map((s) => {
    const m = meta[s.tokenMint];
    const usd = Math.abs(s.solAmount * solPriceAt(s.timestamp) + s.usdAmount);
    const priceNow = m && m.priceUsd > 0 ? m.priceUsd : null;
    const valueNow = priceNow == null ? null : s.tokenAmount * priceNow;
    let diffNow: number | null = null;
    let peakPrice: number | null = null;
    let diffPeak: number | null = null;

    if (valueNow != null) diffNow = valueNow - usd;

    if (s.side === "sell" && priceNow != null) {
      const p = peakAfter(candles[s.tokenMint], s.timestamp);
      peakPrice = Math.max(p ?? 0, priceNow);
      diffPeak = s.tokenAmount * peakPrice - usd;
    }

    return {
      signature: s.signature,
      timestamp: s.timestamp,
      side: s.side,
      tokenMint: s.tokenMint,
      symbol: m?.symbol || short(s.tokenMint),
      tokenAmount: s.tokenAmount,
      usd,
      priceAtTrade: s.tokenAmount > 0 ? usd / s.tokenAmount : 0,
      valueNowUsd: valueNow,
      diffNowUsd: diffNow,
      peakPriceUsd: peakPrice,
      diffPeakUsd: diffPeak,
      feeSol: s.feeSol,
    };
  });

  trades.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  // per token
  const tokens = new Map<string, TokenSummary>();
  for (const t of trades) {
    const m = meta[t.tokenMint];
    const priceNow = m && m.priceUsd > 0 ? m.priceUsd : null;
    let s = tokens.get(t.tokenMint);
    if (!s) {
      s = {
        mint: t.tokenMint, symbol: t.symbol, name: m?.name, priceNowUsd: priceNow, priced: priceNow != null,
        buys: 0, sells: 0, boughtUsd: 0, soldUsd: 0, boughtTokens: 0, soldTokens: 0, heldTokens: 0,
        heldValueUsd: null, pnlUsd: null, missedNowUsd: 0, savedNowUsd: 0, maxPotentialUsd: 0,
        hasPeakData: (candles[t.tokenMint]?.length ?? 0) > 0,
      };
      tokens.set(t.tokenMint, s);
    }
    if (t.side === "buy") { s.buys++; s.boughtUsd += t.usd; s.boughtTokens += t.tokenAmount; }
    else {
      s.sells++; s.soldUsd += t.usd; s.soldTokens += t.tokenAmount;
      if (t.diffNowUsd != null) {
        s.missedNowUsd += Math.max(0, t.diffNowUsd);
        s.savedNowUsd += Math.max(0, -t.diffNowUsd);
        s.maxPotentialUsd += Math.max(0, t.diffPeakUsd ?? t.diffNowUsd);
      }
    }
  }

  for (const s of tokens.values()) {
    const actual = held[s.mint] ?? 0;
    // only count tokens that were actually acquired inside the scanned window
    s.heldTokens = Math.min(actual, Math.max(0, s.boughtTokens - s.soldTokens));
    if (s.priceNowUsd != null) {
      s.heldValueUsd = s.heldTokens * s.priceNowUsd;
      s.pnlUsd = s.soldUsd + s.heldValueUsd - s.boughtUsd;
    } else if (s.heldTokens === 0) {
      s.heldValueUsd = 0;
      s.pnlUsd = s.soldUsd - s.boughtUsd;
    }
  }

  const list = [...tokens.values()].sort((a, b) => b.missedNowUsd - a.missedNowUsd || b.soldUsd - a.soldUsd);

  const sells = trades.filter((t) => t.side === "sell");
  const buys = trades.filter((t) => t.side === "buy");
  const pricedSells = sells.filter((t) => t.valueNowUsd != null);

  const totals: Totals = {
    trades: trades.length,
    buys: buys.length,
    sells: sells.length,
    tokens: list.length,
    boughtUsd: sum(buys.map((t) => t.usd)),
    soldUsd: sum(sells.map((t) => t.usd)),
    soldNowValueUsd: sum(pricedSells.map((t) => t.valueNowUsd ?? 0)),
    heldValueUsd: sum(list.map((t) => t.heldValueUsd ?? 0)),
    netPnlUsd: sum(list.map((t) => t.pnlUsd ?? 0)),
    missedNowUsd: sum(list.map((t) => t.missedNowUsd)),
    maxPotentialUsd: sum(list.map((t) => t.maxPotentialUsd)),
    savedNowUsd: sum(list.map((t) => t.savedNowUsd)),
    underwaterBuysUsd: sum(buys.map((t) => (t.diffNowUsd != null ? Math.max(0, -t.diffNowUsd) : 0))),
    quickFlips: countQuickFlips(swaps),
    unpricedTokens: list.filter((t) => !t.priced).length,
  };

  return { trades, tokens: list, totals };
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
