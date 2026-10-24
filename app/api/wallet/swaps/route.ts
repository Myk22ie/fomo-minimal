import { NextRequest, NextResponse } from "next/server";
import { buildReport, parseSwap, WSOL, type Candle, type Swap } from "../../../../lib/fomo";
import { getCandles, getPrices, buildSolPricer } from "../../../../lib/market";
import { RPC_URL, getHoldings, getSignatures, getTx, isValidAddress, pool } from "../../../../lib/solana";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Hobby limit

const DEFAULT_DEPTH = 100;
const MAX_DEPTH = 250;
const PEAK_TOKENS = 8; // tokens (by sold volume) that get historical peak lookups
const CONCURRENCY = Math.max(1, Number(process.env.SOLANA_RPC_CONCURRENCY) || 3);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const address = params.get("address")?.trim() ?? "";
  const depth = Math.min(MAX_DEPTH, Math.max(20, Number(params.get("depth")) || DEFAULT_DEPTH));

  if (!address) return NextResponse.json({ error: "Enter a public Solana wallet address." }, { status: 400 });
  if (!isValidAddress(address)) {
    return NextResponse.json({ error: "This doesn't look like a valid Solana address (base58, 32 bytes)." }, { status: 400 });
  }

  const warnings: string[] = [];

  try {
    /* 1. signatures + transactions */
    const allSigs = await getSignatures(address, depth);
    const sigs = allSigs.filter((s) => !s.err);

    const swaps: Swap[] = [];
    let tokenToToken = 0;
    const reasons = new Map<string, number>();
    const noteReason = (e: unknown) => {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 160);
      reasons.set(msg, (reasons.get(msg) ?? 0) + 1);
    };

    const load = async (sig: { signature: string; blockTime: number | null }): Promise<boolean> => {
      try {
        const tx = await getTx(sig.signature);
        if (!tx) { noteReason("transaction not available on this RPC (pruned history)"); return false; }
        const parsed = parseSwap(tx, address, sig.signature, sig.blockTime);
        if (parsed.kind === "swap") swaps.push(parsed.swap);
        else if (parsed.kind === "token_to_token") tokenToToken++;
        return true;
      } catch (e) {
        noteReason(e);
        return false;
      }
    };

    // pass 1: normal concurrency; pass 2: retry the failures slowly
    const results = await pool(sigs, CONCURRENCY, load);
    let retry = sigs.filter((_, i) => !results[i]);
    if (retry.length > 0 && retry.length < sigs.length) {
      reasons.clear();
      await sleep(2500);
      const second = await pool(retry, 1, load);
      retry = retry.filter((_, i) => !second[i]);
    }
    const failed = retry.length;
    const topReason = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
    const customRpc = RPC_URL !== "https://api.mainnet-beta.solana.com";

    if (sigs.length > 0 && failed / sigs.length > 0.5) {
      return NextResponse.json(
        {
          error:
            `Couldn't load ${failed} of ${sigs.length} transactions. ` +
            (topReason ? `RPC said: "${topReason[0]}". ` : "") +
            (customRpc
              ? (topReason && /429|rate|too many|limit/i.test(topReason[0]) ? "Your RPC is rate-limiting you — lower SOLANA_RPC_RPS (e.g. 4) in .env.local, restart and retry." : "See the RPC message above.")
              : "You are on the PUBLIC Solana RPC — SOLANA_RPC_URL isn't being read. Put it in .env.local in the project root (next to package.json) and restart `npm run dev`."),
        },
        { status: 502 }
      );
    }
    if (failed > 0) warnings.push(`${failed} transactions couldn't be loaded and were skipped${topReason ? ` (${topReason[0]})` : ""}. Results may be incomplete — rescan or lower SOLANA_RPC_RPS.`);
    if (tokenToToken > 0) warnings.push(`${tokenToToken} token↔token swaps were skipped (no SOL/USDC leg to price them).`);

    /* 2. prices */
    const mints = [...new Set(swaps.map((s) => s.tokenMint))];
    const [prices, held] = await Promise.all([getPrices([...mints, WSOL]), mints.length ? getHoldings(address) : Promise.resolve({})]);
    const solMeta = prices[WSOL];
    delete prices[WSOL];

    /* 3. peak candles for the biggest sold tokens */
    const sellVolume = new Map<string, { sol: number; first: number }>();
    for (const s of swaps) {
      if (s.side !== "sell") continue;
      const cur = sellVolume.get(s.tokenMint) ?? { sol: 0, first: Infinity };
      cur.sol += Math.abs(s.solAmount) + Math.abs(s.usdAmount) / 150;
      cur.first = Math.min(cur.first, s.timestamp ?? Date.now());
      sellVolume.set(s.tokenMint, cur);
    }
    const peakTargets = [...sellVolume.entries()]
      .filter(([mint]) => prices[mint]?.pairAddress)
      .sort((a, b) => b[1].sol - a[1].sol)
      .slice(0, PEAK_TOKENS);

    const candles: Record<string, Candle[]> = {};
    let peakFailures = 0;
    for (const [mint, info] of peakTargets) {
      const hourly = Date.now() - info.first < 40 * 24 * 3600 * 1000;
      const c = await getCandles(prices[mint].pairAddress!, hourly ? "hour" : "day");
      if (c?.length) candles[mint] = c; else peakFailures++;
      await sleep(400); // GeckoTerminal free tier ≈ 30 req/min
    }
    if (peakFailures > 0) warnings.push(`Peak-price history was unavailable for ${peakFailures} token(s); their "max potential" falls back to the current price.`);

    const needSolHistory = swaps.some((s) => s.solAmount !== 0);
    const sol = await buildSolPricer(solMeta, needSolHistory);
    if (needSolHistory && sol.mode === "current") warnings.push("Historical SOL price was unavailable — SOL legs are valued at today's SOL price.");

    /* 4. report */
    const { trades, tokens, totals } = buildReport({ swaps, solPriceAt: sol.at, meta: prices, held, candles });

    if (tokens.some((t) => !t.priced)) {
      warnings.push(`${totals.unpricedTokens} token(s) have no live market price (dead / rugged / not on a DEX) and are excluded from missed-upside.`);
    }

    return NextResponse.json(
      {
        address,
        totals,
        tokens,
        trades,
        meta: {
          signaturesScanned: allSigs.length,
          successfulSignatures: sigs.length,
          depth,
          solPriceNow: sol.current,
          solPriceMode: sol.mode,
          peakTokens: Object.keys(candles).length,
          customRpc,
          warnings,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("FOMO scan error:", error);
    return NextResponse.json(
      { error: "Wallet scan failed. The RPC is probably rate-limiting you — set SOLANA_RPC_URL in .env.local to a dedicated endpoint (Helius / QuickNode / Alchemy) and try again." },
      { status: 502 }
    );
  }
}
