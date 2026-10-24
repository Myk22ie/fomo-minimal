
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  RotateCcw,
} from "lucide-react";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);

const numberFormat = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function CalculatorPage() {
  const [investment, setInvestment] = useState("100");
  const [entry, setEntry] = useState("100000");
  const [peak, setPeak] = useState("1000000");
  const [fee, setFee] = useState("1");

  const result = useMemo(() => {
    const values = [investment, entry, peak, fee];

    // Empty fields and malformed numbers are invalid.
    if (
      values.some((value) => value.trim() === "") ||
      values.some((value) => !Number.isFinite(Number(value)))
    ) {
      return null;
    }

    const i = Number(investment);
    const e = Number(entry);
    const p = Number(peak);
    const f = Number(fee);

    if (
      i <= 0 ||
      e <= 0 ||
      p < 0 ||
      f < 0 ||
      f >= 100
    ) {
      return null;
    }

    const grossValue = i * (p / e);
    const value = grossValue * (1 - f / 100);
    const profit = value - i;

    return {
      value,
      profit,
      multiple: value / i,
      roi: (profit / i) * 100,
      grossValue,
      grossProfit: grossValue - i,
    };
  }, [investment, entry, peak, fee]);

  const preset = (i: string, e: string, p: string) => {
    setInvestment(i);
    setEntry(e);
    setPeak(p);
    setFee("1");
  };

  const invalidMessage = (() => {
    if (
      [investment, entry, peak, fee].some(
        (value) => value.trim() === ""
      )
    ) {
      return "Fill in all fields to calculate your scenario.";
    }

    const i = Number(investment);
    const e = Number(entry);
    const p = Number(peak);
    const f = Number(fee);

    if (![i, e, p, f].every(Number.isFinite)) {
      return "Enter valid numbers in all fields.";
    }

    if (i <= 0) return "Investment must be greater than zero.";
    if (e <= 0) return "Entry market cap must be greater than zero.";
    if (p < 0) return "Peak market cap cannot be negative.";
    if (f < 0 || f >= 100) {
      return "Fees must be at least 0% and less than 100%.";
    }

    return "Check your inputs and try again.";
  })();

  return (
    <main className="page">
      <section className="intro">
        <div className="eyebrow">
          <span className="live-dot" />
          A LITTLE TOOL FOR BIG REGRETS
        </div>

        <h1>
          How much did
          <br />
          <em>you miss?</em>
        </h1>

        <p className="lede">
          The pump you sold. The token you ignored.
          Put a number on the “what if”.
        </p>

        <div className="intro-links">
          <a href="#calculator">
            Try the calculator <ArrowDownRight size={15} />
          </a>
          <Link href="/wallet">
            Scan a wallet <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      <section className="calculator" id="calculator">
        <div className="calc-head">
          <div>
            <span className="tiny-label">01 / CALCULATOR</span>
            <h2>Run a scenario</h2>
          </div>

          <button
            className="text-button"
            type="button"
            onClick={() => preset("100", "100000", "1000000")}
          >
            <RotateCcw size={13} /> Reset
          </button>
        </div>

        <div className="calc-grid">
          <div className="fields">
            <label>
              Investment <span>USD</span>
              <div className="input-wrap">
                <b>$</b>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={investment}
                  onChange={(e) => setInvestment(e.target.value)}
                  aria-label="Investment amount in USD"
                />
              </div>
            </label>

            <div className="two-fields">
              <label>
                Entry market cap <span>USD</span>
                <div className="input-wrap">
                  <b>$</b>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    value={entry}
                    onChange={(e) => setEntry(e.target.value)}
                    aria-label="Entry market capitalization in USD"
                  />
                </div>
              </label>

              <label>
                Peak market cap <span>USD</span>
                <div className="input-wrap">
                  <b>$</b>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={peak}
                    onChange={(e) => setPeak(e.target.value)}
                    aria-label="Peak market capitalization in USD"
                  />
                </div>
              </label>
            </div>

            <label>
              Fees &amp; slippage <span>%</span>
              <div className="input-wrap">
                <b>%</b>
                <input
                  type="number"
                  min="0"
                  max="99.99"
                  step="any"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  aria-label="Estimated fees and slippage percentage"
                />
              </div>
            </label>

            <div className="presets">
              <span>QUICK SCENARIOS</span>
              <button
                type="button"
                onClick={() => preset("50", "50000", "500000")}
              >
                50 → 500K
              </button>
              <button
                type="button"
                onClick={() => preset("100", "100000", "1000000")}
              >
                100 → 1M
              </button>
              <button
                type="button"
                onClick={() => preset("250", "250000", "500000")}
              >
                250 → 500K
              </button>
            </div>
          </div>

          <div className="result" aria-live="polite">
            <div className="result-label">IF YOU HELD TO THE PEAK</div>

            {result ? (
              <>
                <div key={result.value} className="big-number number-update">
                  {usd(result.value)}
                </div>

                <div className={`gain ${result.roi < 0 ? "red" : ""}`}>
                  <ArrowUpRight size={15} />
                  {result.roi > 0 ? "+" : ""}
                  {numberFormat(result.roi)}%
                  <span>hypothetical return</span>
                </div>

                <svg
                  className="mini-chart"
                  viewBox="0 0 320 100"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Illustrative token price chart, not historical market data"
                >
                  <defs>
                    <linearGradient
                      id="fomoFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#7657e8"
                        stopOpacity="0.22"
                      />
                      <stop
                        offset="100%"
                        stopColor="#7657e8"
                        stopOpacity="0"
                      />
                    </linearGradient>
                  </defs>

                  <path
                    className="chart-area"
                    d="M0 85 L35 76 L65 81 L100 57 L130 64 L165 38 L190 49 L225 25 L250 34 L285 10 L320 5 L320 100 L0 100 Z"
                    fill="url(#fomoFill)"
                  />

                  <path
                    className="chart-line"
                    d="M0 85 L35 76 L65 81 L100 57 L130 64 L165 38 L190 49 L225 25 L250 34 L285 10 L320 5"
                    fill="none"
                    stroke="#7657e8"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  <circle
                    className="chart-point"
                    cx="320"
                    cy="5"
                    r="3.5"
                    fill="#7657e8"
                  />
                </svg>

                <div className="result-lines">
                  <div>
                    <span>
                      {result.profit >= 0
                        ? "Potential profit"
                        : "Potential loss"}
                    </span>
                    <b className={result.profit >= 0 ? "green" : "red"}>
                      {result.profit > 0 ? "+" : ""}
                      {usd(result.profit)}
                    </b>
                  </div>

                  <div>
                    <span>Return multiple</span>
                    <b>{result.multiple.toFixed(2)}×</b>
                  </div>

                  <div>
                    <span>Value before fees</span>
                    <b>{usd(result.grossValue)}</b>
                  </div>

                  <div>
                    <span>Estimated fees</span>
                    <b>{usd(result.grossValue - result.value)}</b>
                  </div>
                </div>
              </>
            ) : (
              <p className="invalid">{invalidMessage}</p>
            )}

            <p className="fineprint">
              Simplified estimate based on market-cap ratios, not an
              executable trade simulation. Actual returns depend on liquidity,
              token supply, execution price and other factors. Fees are
              applied to the hypothetical exit value.
            </p>
          </div>
        </div>
      </section>

      <section className="below" style={{ gridTemplateColumns: "1fr" }}>
        <div className="below-copy">
          <span className="tiny-label">02 / THE NEXT STEP</span>
          <h2>
            Your wallet knows
            <br />
            the lore.
          </h2>
          <p>
            Scan public on-chain activity to find tokens you sold before
            they ran. No seed phrase. No private keys.
          </p>
          <Link className="outline-link" href="/wallet">
            Explore wallet scan <ArrowRight size={15} />
          </Link>
        </div>

      </section>
    </main>
  );
}
