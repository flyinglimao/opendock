// Trigger expiry for all on-chain rentals that have passed their duration.
//
// Flow:
//   1. Query DB for AgentTokens that have an active rent order.
//   2. For each rentOrderId, fetch RentalStarted events to collect rentalIds.
//   3. For each rentalId, call getActiveRental on-chain.
//   4. If expired and not yet revoked, send expireRent() via the server relayer wallet.
//
// Protected by CRON_SECRET env var (if set). Intended for cron / admin use.

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem } from "viem";
import { Contract } from "ethers";
import { zgTestnet } from "@/lib/chain";
import { prisma } from "@/lib/db";
import { getAgentComputeRelayerSigner } from "@/lib/agent-compute-wallet";
import { MARKETPLACE_ADDRESS, MARKETPLACE_ABI } from "@/lib/contracts";

const RENTAL_STARTED_EVENT = parseAbiItem(
  "event RentalStarted(uint256 indexed rentalId,uint256 indexed rentOrderId,address indexed renter,uint256 tokenId,uint256 duration)"
);
const RENTAL_LOG_FROM_BLOCK = BigInt(
  process.env.MARKETPLACE_RENTAL_FROM_BLOCK ??
    process.env.NEXT_PUBLIC_MARKETPLACE_RENTAL_FROM_BLOCK ??
    "0"
);
const EXPIRE_RENT_ABI = ["function expireRent(uint256 rentalId)"] as const;

const publicClient = createPublicClient({
  chain: zgTestnet,
  transport: http(
    process.env.NEXT_PUBLIC_ZG_EVM_RPC ??
      process.env.ZG_EVM_RPC ??
      zgTestnet.rpcUrls.default.http[0]
  ),
});

function hasMarketplace(): boolean {
  return Boolean(MARKETPLACE_ADDRESS && MARKETPLACE_ADDRESS !== "0x");
}

function checkAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured — allow (dev mode)
  const auth = req.headers.get("Authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasMarketplace()) {
    return NextResponse.json(
      { error: "Marketplace contract is not configured" },
      { status: 503 }
    );
  }

  if (!process.env.OPENDOCK_AGENT_RELAYER_PRIVATE_KEY) {
    return NextResponse.json(
      { error: "OPENDOCK_AGENT_RELAYER_PRIVATE_KEY is not configured" },
      { status: 503 }
    );
  }

  // 1. Query DB for tokens that have (or had) an active rent order.
  const tokens = await prisma.agentToken.findMany({
    where: { rentOrderId: { not: null } },
    select: { tokenId: true, rentOrderId: true },
  });

  if (tokens.length === 0) {
    return NextResponse.json({ checked: 0, expired: [], errors: [] });
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const expired: string[] = [];
  const errors: { rentalId: string; error: string }[] = [];

  // 2. For each rentOrderId, find all associated rentalIds via events.
  const rentalIdSet = new Set<bigint>();
  await Promise.all(
    tokens.map(async ({ rentOrderId }) => {
      if (!rentOrderId) return;
      try {
        const logs = await publicClient.getLogs({
          address: MARKETPLACE_ADDRESS,
          event: RENTAL_STARTED_EVENT,
          args: { rentOrderId: BigInt(rentOrderId) },
          fromBlock: RENTAL_LOG_FROM_BLOCK,
          toBlock: "latest",
        });
        for (const log of logs) {
          if (log.args.rentalId !== undefined) {
            rentalIdSet.add(log.args.rentalId);
          }
        }
      } catch {
        // Skip if event query fails for this order.
      }
    })
  );

  if (rentalIdSet.size === 0) {
    return NextResponse.json({ checked: 0, expired: [], errors: [] });
  }

  // 3. Check each rental on-chain and expire if eligible.
  const relayer = getAgentComputeRelayerSigner();
  const marketplace = new Contract(MARKETPLACE_ADDRESS, EXPIRE_RENT_ABI, relayer);

  await Promise.all(
    [...rentalIdSet].map(async (rentalId) => {
      try {
        const rental = await publicClient.readContract({
          address: MARKETPLACE_ADDRESS,
          abi: MARKETPLACE_ABI,
          functionName: "getActiveRental",
          args: [rentalId],
        });

        // Skip if already revoked or not yet expired.
        if (rental.revoked) return;
        if (now < rental.startTime + rental.duration) return;

        // 4. Send expireRent via the relayer wallet.
        const tx = await marketplace.expireRent(rentalId);
        await tx.wait();
        expired.push(rentalId.toString());
      } catch (err) {
        errors.push({
          rentalId: rentalId.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })
  );

  return NextResponse.json({
    checked: rentalIdSet.size,
    expired,
    errors,
  });
}
