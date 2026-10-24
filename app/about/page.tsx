import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
export default function AboutPage(){return <main className="page subpage about-page">
 <div className="eyebrow"><span className="live-dot"/> A NOTE ON THE MATH</div>
 <h1 className="sub-title">Regret is easy.<br/><em>Math is harder.</em></h1>
 <p className="lede">FOMO is a small analytics project for exploring crypto what-ifs without pretending the past was tradable with perfect hindsight.</p>
 <div className="about-grid"><article><span>01</span><h2>Scenario calculator</h2><p>Estimate a hypothetical position using investment size and the ratio between entry and peak market cap, less an adjustable fee assumption.</p></article><article><span>02</span><h2>Wallet analysis</h2><p>Read-only analysis of a public Solana address: swaps are detected from on-chain balance changes, valued in USD, and compared with the token's price today and its peak after each sell.</p></article><article><span>03</span><h2>Honest limitations</h2><p>Liquidity, slippage, token supply changes, partial fills and failed transactions can make a theoretical peak impossible to realize.</p></article></div>
 <div className="about-callout"><ShieldCheck size={19}/><div><b>Privacy by default</b><p>Never share seed phrases or private keys. Public wallet addresses can still reveal sensitive transaction history.</p></div></div>
 <Link href="/" className="outline-link">Back to calculator <ArrowRight size={15}/></Link>
 </main>}
