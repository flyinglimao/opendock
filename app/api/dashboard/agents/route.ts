import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, getAddress, http, isAddress } from "viem";
import { prisma } from "@/lib/db";
import { zgTestnet } from "@/lib/chain";
import {
  INFT_ABI,
  INFT_ADDRESS,
  MARKETPLACE_ABI,
  MARKETPLACE_ADDRESS,
} from "@/lib/contracts";

const publicClient = createPublicClient({
  chain: zgTestnet,
  transport: http(
    process.env.NEXT_PUBLIC_ZG_EVM_RPC ??
      process.env.ZG_EVM_RPC ??
      zgTestnet.rpcUrls.default.http[0]
  ),
});

interface DashboardAgent {
  tokenId: string;
  name: string | null;
  description: string | null;
  image: string | null;
  metadataReady: boolean;
  owner: string | null;
  rentOrderId: string | null;
  rentPricePerSecond: string | null;
  rentMaxDuration: number | null;
  activeRental: boolean;
}

async function classifyAgent(
  token: DashboardAgent,
  account: string
): Promise<{ owned: DashboardAgent | null; rented: DashboardAgent | null }> {
  try {
    const [owner, authorizedUsers, activeRental] = await Promise.all([
      publicClient.readContract({
        address: INFT_ADDRESS,
        abi: INFT_ABI,
        functionName: "ownerOf",
        args: [BigInt(token.tokenId)],
      }) as Promise<string>,
      publicClient.readContract({
        address: INFT_ADDRESS,
        abi: INFT_ABI,
        functionName: "authorizedUsersOf",
        args: [BigInt(token.tokenId)],
      }) as Promise<string[]>,
      MARKETPLACE_ADDRESS && MARKETPLACE_ADDRESS !== "0x"
        ? (publicClient.readContract({
            address: MARKETPLACE_ADDRESS,
            abi: MARKETPLACE_ABI,
            functionName: "isActivelyRented",
            args: [INFT_ADDRESS, BigInt(token.tokenId)],
          }) as Promise<boolean>)
        : Promise.resolve(false),
    ]);
    const normalizedOwner = getAddress(owner);
    const isOwned = normalizedOwner.toLowerCase() === account.toLowerCase();
    const isAuthorized = authorizedUsers.some(
      (user) => user.toLowerCase() === account.toLowerCase()
    );
    const item = { ...token, owner: normalizedOwner, activeRental };
    return {
      owned: isOwned ? item : null,
      rented: !isOwned && isAuthorized ? item : null,
    };
  } catch {
    const owner = token.owner ? getAddress(token.owner) : null;
    const isOwned = owner?.toLowerCase() === account.toLowerCase();
    const item = { ...token, owner, activeRental: false };
    return { owned: isOwned ? item : null, rented: null };
  }
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json(
      { error: "valid address is required" },
      { status: 400 }
    );
  }

  const account = getAddress(address);
  const tokens = await prisma.agentToken.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      tokenId: true,
      name: true,
      description: true,
      image: true,
      metadataReady: true,
      owner: true,
      rentOrderId: true,
      rentPricePerSecond: true,
      rentMaxDuration: true,
    },
  });

  const classified = await Promise.all(
    tokens.map((token) => classifyAgent({ ...token, activeRental: false }, account))
  );

  return NextResponse.json({
    address: account,
    owned: classified.flatMap((item) => (item.owned ? [item.owned] : [])),
    rented: classified.flatMap((item) => (item.rented ? [item.rented] : [])),
  });
}
