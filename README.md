# fomo. — Solana wallet FOMO scanner

## Pages
- `/` — interactive FOMO calculator (what-if scenarios)
- `/wallet` — **paste a public Solana address → see how much you potentially missed**
- `/about` — methodology and limitations

## Run
1. `npm install`
2. Copy `.env.example` to `.env.local` and put a real RPC URL in it (see below)
3. `npm run dev` → http://localhost:3000/wallet

## RPC (important)
The public `api.mainnet-beta.solana.com` endpoint is heavily rate-limited and
will often fail on `getTransaction` bursts. Create a free key at Helius,
QuickNode or Alchemy and set `SOLANA_RPC_URL` in `.env.local`. Restart `npm run dev`.

## What the wallet scan does
1. Loads the last N signatures (100 / 250) and each transaction (`getTransaction`, jsonParsed).
2. Detects swaps from the wallet's own balance changes: one token vs SOL / wSOL / USDC / USDT.
   Plain transfers, airdrops, LP and token↔token swaps are ignored. Token-account rent is netted out.
3. Values each trade in USD (historical SOL price from GeckoTerminal).
4. Prices: current price from DexScreener, peak-after-sell from GeckoTerminal OHLCV (top 8 sold tokens).
5. Outputs, per sell: `tokens sold × price now − proceeds` (= missed upside) and the same at the peak price.

If you still get skipped transactions / 429s, lower `SOLANA_RPC_RPS` (e.g. 4).

No API keys are needed for DexScreener / GeckoTerminal (free tiers, rate-limited).

## Code map
- `lib/fomo.ts` — pure logic (swap parsing + FOMO math), no network
- `lib/solana.ts` — RPC client with retries, pagination, holdings
- `lib/market.ts` — DexScreener / GeckoTerminal clients, SOL price history
- `app/api/wallet/swaps/route.ts` — orchestration
- `app/wallet/page.tsx`, `wallet.css` — UI

## Limits
Estimates, not tax or financial advice. Peak prices are theoretical ceilings; dead / rugged tokens
have no live price and are excluded; history outside the scanned window is not counted.
