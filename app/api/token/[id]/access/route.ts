// app/api/token/[id]/access/route.ts
// Public endpoint: returns on-chain authorization status + active rent order for a token.
//
// GET /api/token/<id>/access?address=0x...
// Returns:
//   { isOwner, isAuthorized, rentOrder: { orderId, pricePerSecond, maxDuration } | null }

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { zgTestnet } from "@/lib/chain";
import { INFT_ADDRESS, INFT_ABI } from "@/lib/contracts";
import { prisma } from "@/lib/db";

const publicClient = createPublicClient({ chain: zgTestnet, transport: http() });

function isUintString(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const address = req.nextUrl.searchParams.get("address") ?? "";

  let isOwner = false;
  let isAuthorized = false;

  if (address) {
    try {
      const [owner, authorizedUsers] = await Promise.all([
        publicClient.readContract({
          address: INFT_ADDRESS,
          abi: INFT_ABI,
          functionName: "ownerOf",
          args: [BigInt(id)],
        }) as Promise<string>,
        publicClient.readContract({
          address: INFT_ADDRESS,
          abi: INFT_ABI,
          functionName: "authorizedUsersOf",
          args: [BigInt(id)],
        }) as Promise<string[]>,
      ]);
      const addr = address.toLowerCase();
      isOwner = owner.toLowerCase() === addr;
      isAuthorized = isOwner || authorizedUsers.some((u) => u.toLowerCase() === addr);
    } catch {
      // Token not found on chain — treat as unauthorized
    }
  }

  // Read rent order from DB cache
  const token = await prisma.agentToken.findUnique({
    where: { tokenId: id },
    select: { rentOrderId: true, rentPricePerSecond: true, rentMaxDuration: true },
  });

  const rentOrder =
    isUintString(token?.rentOrderId) && isUintString(token?.rentPricePerSecond)
      ? {
          orderId: token.rentOrderId,
          pricePerSecond: token.rentPricePerSecond,
          maxDuration: token.rentMaxDuration ?? 0,
        }
      : null;

  return NextResponse.json({ isOwner, isAuthorized, rentOrder });
}
