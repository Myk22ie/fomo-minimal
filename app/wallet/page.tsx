"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import "./wallet.css";

type Trade = {
  signature: string; timestamp: number | null; side: "buy" | "sell"; tokenMint: string; symbol: string;
  tokenAmount: number; usd: number; priceAtTrade: number; valueNowUsd: number | null; diffNowUsd: number | null;
  peakPriceUsd: number | null; diffPeakUsd: number | null; feeSol: number;
};
type Token = {
  mint: string; symbol: string; name?: string; priceNowUsd: number | null; priced: boolean; buys: number; sells: number;
  boughtUsd: number; soldUsd: number; heldTokens: number; heldValueUsd: number | null; pnlUsd: number | null;
  missedNowUsd: number; savedNowUsd: number; maxPotentialUsd: number; hasPeakData: boolean;
};
type Totals = {
  trades: number; buys: number; sells: number; tokens: number; boughtUsd: number; soldUsd: number; soldNowValueUsd: number;
  heldValueUsd: number; netPnlUsd: number; missedNowUsd: number; maxPotentialUsd: number; savedNowUsd: number;
  underwaterBuysUsd: number; quickFlips: number; unpricedTokens: number;
};
type Report = {
  address: string; totals: Totals; tokens: Token[]; trades: Trade[];
  meta: { signaturesScanned: number; depth: number; solPriceNow: number; solPriceMode: "historical" | "current"; peakTokens: number; customRpc: boolean; warnings: string[] };
};

const usd = (n: number | null | undefined, sign = false) => {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const body = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    maximumFractionDigits: abs >= 1000 ? 0 : 2,
  }).format(abs);
  if (n < 0) return `−${body}`;
  return sign && n > 0 ? `+${body}` : body;
};
const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
const price = (n: number | null) => {
  if (n == null) return "—";
  if (n >= 1) return usd(n);
  if (n <= 0) return "$0";
  const decimals = Math.min(14, Math.max(2, 2 - Math.floor(Math.log10(n))));
  return `$${n.toFixed(decimals).replace(/0+$/, "")}`;
};
const when = (ms: number | null) =>
  ms == null ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 5)}…${s.slice(-5)}` : s);
const tone = (n: number | null) => (n == null || n === 0 ? "" : n > 0 ? "pos" : "neg");

const DEPTHS = [
  { value: 100, label: "Last 100 txs (fast)" },
  { value: 250, label: "Last 250 txs" },
];

export default function WalletPage() {
  const [address, setAddress] = useState("");
  const [depth, setDepth] = useState(100);
  const [report, setReport] = useState<Report | null>(null);
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("all");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [showAllTrades, setShowAllTrades] = useState(false);

  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [loading]);

  async function scan(event?: FormEvent) {
    event?.preventDefault();
    const a = address.trim();
    if (!a) { setError("Paste a public Solana wallet address."); return; }
    setLoading(true); setError(""); setReport(null); setFilter("all"); setShowAllTrades(false);
    try {
      const res = await fetch(`/api/wallet/swaps?address=${encodeURIComponent(a)}&depth=${depth}`, { cache: "no-store" });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch { throw new Error("Server returned a non-JSON response. Check the terminal running `npm run dev`."); }
      if (!res.ok) throw new Error(json.error || "Wallet scan failed.");
      setReport(json as Report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet scan failed.");
    } finally {
      setLoading(false);
    }
  }

  const visibleTrades = useMemo(() => {
    if (!report) return [];
    const list = filter === "all" ? report.trades : report.trades.filter((t) => t.side === filter);
    return showAllTrades ? list : list.slice(0, 25);
  }, [report, filter, showAllTrades]);
  const totalVisible = report ? (filter === "all" ? report.trades.length : report.trades.filter((t) => t.side === filter).length) : 0;

  const t = report?.totals;
  const hasAnything = !!t && t.trades > 0;

  return (
    <main className="page subpage fw">
      <div className="eyebrow"><span className="live-dot" /> WALLET FOMO SCANNER · SOLANA</div>
      <h1 className="sub-title">How much did you<br /><em>leave on the table?</em></h1>
      <p className="lede">Paste a public wallet. We read its swaps, then compare what you sold with what those tokens are worth today and at their peak afterwards.</p>

      <form className="fw-form" onSubmit={scan}>
        <label htmlFor="fw-address">PUBLIC WALLET ADDRESS</label>
        <input id="fw-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 7xKX…gAsU" autoComplete="off" spellCheck={false} />
        <div className="fw-form-row">
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Scan depth">
            {DEPTHS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <button type="submit" disabled={loading}>{loading ? `Scanning… ${elapsed}s` : "Calculate my FOMO"}</button>
        </div>
        <p className="fw-privacy">Public address only — never enter a seed phrase or private key.</p>
      </form>

      {loading && <div className="fw-note">Reading transactions and prices. 100 txs usually take 10–40 s on a good RPC, longer on the public one.</div>}
      {error && <div className="fw-error" role="alert">{error}</div>}

      {report && t && (
        <section className="fw-results">
          <div className="fw-addr">
            <span>{short(report.address)}</span>
            <a href={`https://solscan.io/account/${report.address}`} target="_blank" rel="noreferrer">Solscan ↗</a>
          </div>

          {!hasAnything ? (
            <div className="fw-empty">
              <b>No swaps found in the last {report.meta.signaturesScanned} transactions.</b>
              <p>Only trades of one token against SOL / USDC / USDT are counted. Transfers, staking and token↔token swaps are ignored. Try a deeper scan or a wallet that trades on a DEX.</p>
            </div>
          ) : (
            <>
              <div className="fw-hero">
                <div className="fw-hero-label">POTENTIALLY MISSED AFTER YOUR SELLS</div>
                <div className="fw-hero-number">{usd(t.missedNowUsd)}</div>
                <p className="fw-hero-sub">
                  You sold tokens for <b>{usd(t.soldUsd)}</b>. The same tokens are worth <b>{usd(t.soldNowValueUsd)}</b> today.
                </p>
                <div className="fw-hero-grid">
                  <div><span>Max potential (peak after each sell)</span><b className="neg">{usd(t.maxPotentialUsd)}</b></div>
                  <div><span>Saved by selling (price fell after)</span><b className="pos">{usd(t.savedNowUsd)}</b></div>
                  <div><span>Net result in this window</span><b className={tone(t.netPnlUsd)}>{usd(t.netPnlUsd, true)}</b></div>
                  <div><span>Buys now below your entry</span><b className="neg">{usd(t.underwaterBuysUsd)}</b></div>
                </div>
              </div>

              <div className="fw-stats">
                <div><span>Trades</span><b>{t.trades}</b></div>
                <div><span>Buys / Sells</span><b>{t.buys} / {t.sells}</b></div>
                <div><span>Tokens</span><b>{t.tokens}</b></div>
                <div><span>Bought</span><b>{usd(t.boughtUsd)}</b></div>
                <div><span>Sold</span><b>{usd(t.soldUsd)}</b></div>
                <div><span>Held now</span><b>{usd(t.heldValueUsd)}</b></div>
                <div><span>Quick flips (&lt;1h)</span><b>{t.quickFlips}</b></div>
                <div><span>SOL price</span><b>{usd(report.meta.solPriceNow)}</b></div>
              </div>

              {report.meta.warnings.length > 0 && (
                <ul className="fw-warnings">{report.meta.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              )}

              <h2 className="fw-h2">By token</h2>
              <div className="fw-table-wrap">
                <table className="fw-table">
                  <thead>
                    <tr><th>Token</th><th>Bought</th><th>Sold</th><th>Missed (now)</th><th>Max potential</th><th>Held</th><th>Net P&amp;L</th></tr>
                  </thead>
                  <tbody>
                    {report.tokens.map((tk) => (
                      <tr key={tk.mint}>
                        <td>
                          <a href={`https://dexscreener.com/solana/${tk.mint}`} target="_blank" rel="noreferrer"><b>{tk.symbol}</b></a>
                          <small>{tk.priced ? `${price(tk.priceNowUsd)} now` : "no live price"}</small>
                        </td>
                        <td>{usd(tk.boughtUsd)}<small>{tk.buys}×</small></td>
                        <td>{usd(tk.soldUsd)}<small>{tk.sells}×</small></td>
                        <td className={tk.missedNowUsd > 0 ? "neg" : ""}>{tk.sells && tk.priced ? usd(tk.missedNowUsd) : "—"}</td>
                        <td className={tk.maxPotentialUsd > 0 ? "neg" : ""}>
                          {tk.sells && tk.priced ? usd(tk.maxPotentialUsd) : "—"}
                          {tk.sells > 0 && tk.priced && !tk.hasPeakData && <small>no peak data</small>}
                        </td>
                        <td>{tk.heldValueUsd == null ? "—" : usd(tk.heldValueUsd)}</td>
                        <td className={tone(tk.pnlUsd)}>{usd(tk.pnlUsd, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="fw-toolbar">
                <h2 className="fw-h2">Trades <span>({totalVisible})</span></h2>
                <div className="fw-filters">
                  {(["all", "buy", "sell"] as const).map((f) => (
                    <button key={f} className={filter === f ? "on" : ""} onClick={() => { setFilter(f); setShowAllTrades(false); }}>
                      {f === "all" ? "All" : f === "buy" ? "Buys" : "Sells"}
                    </button>
                  ))}
                  <button onClick={() => scan()} disabled={loading}>↻ Rescan</button>
                </div>
              </div>

              <div className="fw-trades">
                {visibleTrades.map((tr, i) => (
                  <article className="fw-trade" key={`${tr.signature}-${tr.side}-${i}`}>
                    <div className={`fw-badge ${tr.side}`}>{tr.side === "buy" ? "BUY" : "SELL"}</div>
                    <div className="fw-trade-main">
                      <b>{tr.symbol}</b>
                      <small>{when(tr.timestamp)} · {compact(tr.tokenAmount)} tokens @ {price(tr.priceAtTrade)}</small>
                    </div>
                    <div className="fw-trade-nums">
                      <b>{usd(tr.usd)}</b>
                      {tr.diffNowUsd == null ? (
                        <small>no live price</small>
                      ) : tr.side === "sell" ? (
                        <small>
                          now worth {usd(tr.valueNowUsd)} ·{" "}
                          {tr.diffNowUsd > 0
                            ? <span className="neg">missed {usd(tr.diffNowUsd)}</span>
                            : <span className="pos">saved {usd(-tr.diffNowUsd)}</span>}
                          {tr.diffPeakUsd != null && tr.diffPeakUsd > Math.max(0, tr.diffNowUsd) && <> · peak {usd(tr.diffPeakUsd)}</>}
                        </small>
                      ) : (
                        <small>now worth {usd(tr.valueNowUsd)} · <span className={tone(tr.diffNowUsd)}>{usd(tr.diffNowUsd, true)}</span></small>
                      )}
                    </div>
                    <a href={`https://solscan.io/tx/${tr.signature}`} target="_blank" rel="noreferrer" aria-label="View transaction">↗</a>
                  </article>
                ))}
              </div>
              {!showAllTrades && totalVisible > visibleTrades.length && (
                <button className="fw-more" onClick={() => setShowAllTrades(true)}>Show all {totalVisible} trades</button>
              )}

              <div className="fw-method">
                <b>How these numbers are calculated</b>
                <p><b>Missed (now)</b> = for every sell, (tokens sold × today's price) − what you received. Only positive gaps are counted; sells that dodged a dump are shown as “saved”.</p>
                <p><b>Max potential</b> = same, but using the highest price reached after the sell (top {report.meta.peakTokens} tokens by volume; hourly/daily candles). A theoretical ceiling — nobody sells the exact top, and thin pools can’t absorb it.</p>
                <p>Trade values are in USD at the time of the trade ({report.meta.solPriceMode === "historical" ? "historical SOL price" : "today’s SOL price, historical unavailable"}). Prices: DexScreener &amp; GeckoTerminal. Only swaps of one token vs SOL/USDC/USDT are counted. Not financial advice.</p>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
