// app/api/token/[id]/rent-order/route.ts
// Owner-only endpoint: store the marketplace rent order ID after calling listRent on-chain.
//
// POST /api/token/<id>/rent-order
//   Authorization: Bearer <base64(JSON({address, timestamp, signature}))>
//   Body: { orderId: string, pricePerSecond: string, maxDuration: number }
//   Returns: { ok: true }
//
// DELETE /api/token/<id>/rent-order
//   Authorization: same (owner only)
//   Clears the stored rent order from DB.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAuthHeader, checkOnChainAuth } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const address = await verifyAuthHeader(id, req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { isOwner } = await checkOnChainAuth(id, address);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden: owner only" }, { status: 403 });
  }

  const body = (await req.json()) as {
    orderId: string;
    pricePerSecond: string;
    maxDuration: number;
  };

  if (!body.orderId) {
    return NextResponse.json({ error: "orderId required" }, { status: 400 });
  }

  await prisma.agentToken.update({
    where: { tokenId: id },
    data: {
      rentOrderId: body.orderId,
      rentPricePerSecond: body.pricePerSecond,
      rentMaxDuration: body.maxDuration,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const address = await verifyAuthHeader(id, req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { isOwner } = await checkOnChainAuth(id, address);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden: owner only" }, { status: 403 });
  }

  await prisma.agentToken.update({
    where: { tokenId: id },
    data: {
      rentOrderId: null,
      rentPricePerSecond: null,
      rentMaxDuration: null,
    },
  });

  return NextResponse.json({ ok: true });
}
