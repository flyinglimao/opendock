// app/api/settings/telegram/token/route.ts
// POST — generate a short-lived Telegram registration token for the caller.
// Protected by session auth.

import { NextRequest, NextResponse } from "next/server";
import { verifySessionAuthHeader } from "@/lib/auth";
import { createRegistrationToken } from "@/lib/telegram-token-store";

export async function POST(req: NextRequest) {
  const address = await verifySessionAuthHeader(req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token, expiresAt } = createRegistrationToken(address);

  return NextResponse.json({ token, expiresAt });
}
