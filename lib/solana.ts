import type { RpcTx } from "./fomo";

export const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── base58 validation: a Solana address is exactly 32 bytes ── */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function isValidAddress(address: string): boolean {
  if (address.length < 32 || address.length > 44) return false;
  let n = BigInt(0);
  for (const ch of address) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return false;
    n = n * BigInt(58) + BigInt(i);
  }
  let bytes = 0;
  while (n > BigInt(0)) { n >>= BigInt(8); bytes++; }
  const leadingZeros = address.length - address.replace(/^1+/, "").length;
  return bytes + leadingZeros === 32;
}

export class RpcError extends Error {
  constructor(message: string, public retryable = false, public retryAfterMs = 0) { super(message); }
}

/* global rate limiter: at most RPS request *starts* per second across all workers */
const RPS = Math.max(1, Number(process.env.SOLANA_RPC_RPS) || 8);
let nextSlot = 0;
async function waitSlot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 1000 / RPS;
  if (at > now) await sleep(at - now);
}

export async function rpc<T>(method: string, params: unknown[], attempts = 6): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await waitSlot();
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 140);
        const ra = Number(res.headers.get("retry-after"));
        const retryable = res.status === 429 || res.status >= 500;
        throw new RpcError(`HTTP ${res.status}${body ? `: ${body}` : ""}`, retryable, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0);
      }
      const json = await res.json();
      if (json.error) {
        const msg = String(json.error.message ?? "RPC error");
        const retryable = /rate|too many|limit|busy|timeout|unavailable|try again/i.test(msg) || json.error.code === -32005;
        throw new RpcError(msg, retryable);
      }
      return json.result as T;
    } catch (e) {
      lastError = e;
      const retryable = e instanceof RpcError ? e.retryable : true; // network errors / timeouts
      if (!retryable || i === attempts - 1) break;
      const wait = e instanceof RpcError && e.retryAfterMs ? e.retryAfterMs : 700 * 2 ** i;
      await sleep(wait + Math.random() * 300);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("RPC failed");
}

export type SigInfo = { signature: string; blockTime: number | null; err: unknown };

/** newest → oldest, paginated until `max` signatures are collected */
export async function getSignatures(address: string, max: number): Promise<SigInfo[]> {
  const out: SigInfo[] = [];
  let before: string | undefined;
  while (out.length < max) {
    const page = await rpc<SigInfo[]>("getSignaturesForAddress", [
      address,
      { limit: Math.min(1000, max - out.length), before, commitment: "confirmed" },
    ]);
    if (!page.length) break;
    out.push(...page);
    before = page[page.length - 1].signature;
    if (page.length < Math.min(1000, max)) break;
  }
  return out.slice(0, max);
}

let txVersion = 1; // highest tx version we ask the RPC to return; auto-raised if the RPC reports a newer one

export async function getTx(signature: string): Promise<RpcTx | null> {
  for (let i = 0; i < 4; i++) {
    try {
      return await rpc<RpcTx | null>("getTransaction", [
        signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: txVersion, commitment: "confirmed" },
      ]);
    } catch (e) {
      const m = e instanceof Error ? /version \((\d+)\)/i.exec(e.message) : null;
      if (m && Number(m[1]) > txVersion) { txVersion = Number(m[1]); continue; }
      throw e;
    }
  }
  throw new Error("Unsupported transaction version");
}

/** run async jobs with limited concurrency */
export async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    })
  );
  return results;
}

/** current token balances (ui amounts) by mint, both token programs */
export async function getHoldings(owner: string): Promise<Record<string, number>> {
  const held: Record<string, number> = {};
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    try {
      const res = await rpc<{
        value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } } } }[];
      }>("getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed" }]);
      for (const { account } of res.value) {
        const { mint, tokenAmount } = account.data.parsed.info;
        held[mint] = (held[mint] ?? 0) + Number(tokenAmount.amount) / Math.pow(10, tokenAmount.decimals);
      }
    } catch {
      /* holdings are optional – report still works without them */
    }
  }
  return held;
}
