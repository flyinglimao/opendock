// app/api/token/[id]/route.ts
// ERC-721 metadata endpoint.
// Reads the metadataHash from the contract, downloads the JSON from 0G Storage,
// and returns it with proper Content-Type.

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { zgTestnet } from "@/lib/chain";
import { INFT_ADDRESS, INFT_ABI } from "@/lib/contracts";

const ZG_INDEXER = process.env.NEXT_PUBLIC_ZG_INDEXER_URL ??
  "https://indexer-storage-testnet-turbo.0g.ai";

const publicClient = createPublicClient({
  chain: zgTestnet,
  transport: http(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tokenId = BigInt(id);

  // 1. Read metadataHash from contract
  let metadataHash: `0x${string}`;
  try {
    metadataHash = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: INFT_ABI,
      functionName: "metadataHashOf",
      args: [tokenId],
    })) as `0x${string}`;
  } catch {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  // 2. Download metadata JSON from 0G Storage
  // The indexer exposes a download endpoint at /file/<rootHash>
  const downloadUrl = `${ZG_INDEXER}/file/${metadataHash}`;
  let metadata: unknown;
  try {
    const res = await fetch(downloadUrl, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`0G returned ${res.status}`);
    metadata = await res.json();
  } catch (err) {
    console.error("0G download failed:", err);
    // Fallback — return a minimal metadata object so marketplaces don't break
    metadata = {
      name: `OpenDock Agent #${id}`,
      description: "",
      image: "",
    };
  }

  return NextResponse.json(metadata, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
