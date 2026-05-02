// app/api/settings/route.ts
// Per-user settings API (Brave API key, etc.)
// Protected by session auth (wallet signature).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySessionAuthHeader } from "@/lib/auth";

// ---- GET /api/settings ----
// Returns the caller's settings (sensitive fields are masked).

export async function GET(req: NextRequest) {
  const address = await verifySessionAuthHeader(req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const setting = await prisma.userSetting.findUnique({
    where: { userAddress: address.toLowerCase() },
    select: { braveApiKey: true },
  });

  return NextResponse.json({
    braveApiKey: setting?.braveApiKey ? maskKey(setting.braveApiKey) : null,
    hasBraveApiKey: Boolean(setting?.braveApiKey),
  });
}

// ---- PUT /api/settings ----
// Upsert the caller's settings.

interface SettingsBody {
  braveApiKey?: string | null;
}

export async function PUT(req: NextRequest) {
  const address = await verifySessionAuthHeader(req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as SettingsBody;

  // Validate Brave API key if provided (non-null, non-empty)
  if (body.braveApiKey !== undefined && body.braveApiKey !== null) {
    const key = body.braveApiKey.trim();
    if (key && key.length < 10) {
      return NextResponse.json(
        { error: "Invalid Brave API key format" },
        { status: 400 }
      );
    }

    await prisma.userSetting.upsert({
      where: { userAddress: address.toLowerCase() },
      update: { braveApiKey: key || null },
      create: { userAddress: address.toLowerCase(), braveApiKey: key || null },
    });
  }

  return NextResponse.json({ ok: true });
}

/** Mask all but the first 4 and last 4 characters of a key. */
function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}${"*".repeat(key.length - 8)}${key.slice(-4)}`;
}
