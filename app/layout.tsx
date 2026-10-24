import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { Activity, ArrowUpRight } from "lucide-react";

export const metadata: Metadata = {
  title: "fomo — measure what you missed",
  description: "A minimal crypto FOMO calculator and wallet analytics concept."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>
    <header className="topbar">
      <Link href="/" className="wordmark"><span className="mark"><Activity size={16}/></span>fomo<span className="dot">.</span></Link>
      <nav className="nav">
        <Link href="/">Calculator</Link>
        <Link href="/wallet">Wallet scan</Link>
        <Link href="/about">About</Link>
      </nav>
      <Link className="top-cta" href="/wallet">Scan wallet <ArrowUpRight size={14}/></Link>
    </header>
    {children}
    <footer className="footer"><Link href="/" className="footer-brand">fomo<span className="dot">.</span></Link><span>ON-CHAIN REGRETS, MEASURED.</span><span>Illustrative analytics · Not financial advice</span></footer>
  </body></html>;
}
