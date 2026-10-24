
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();

  if (!address || !ADDRESS_REGEX.test(address)) {
    return NextResponse.json(
      { error: "Enter a valid Solana wallet address." },
      { status: 400 }
    );
  }

  const rpcUrl =
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [
          address,
          {
            limit: 20,
            commitment: "confirmed",
          },
        ],
      }),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Solana RPC is temporarily unavailable. Try again." },
        { status: 502 }
      );
    }

    const data = await response.json();

    if (data.error) {
      return NextResponse.json(
        { error: "Could not retrieve wallet activity. Try again later." },
        { status: 502 }
      );
    }

    const transactions = (data.result ?? []).map(
      (tx: {
        signature: string;
        blockTime: number | null;
        err: unknown;
        confirmationStatus?: string;
      }) => ({
        signature: tx.signature,
        blockTime: tx.blockTime,
        success: tx.err === null,
        confirmationStatus: tx.confirmationStatus ?? "confirmed",
      })
    );

    return NextResponse.json({
      address,
      transactions,
      count: transactions.length,
      source: "Solana RPC",
    });
  } catch {
    return NextResponse.json(
      { error: "Network error while contacting Solana RPC." },
      { status: 502 }
    );
  }
}
