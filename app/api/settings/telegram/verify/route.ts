// app/api/settings/telegram/verify/route.ts
// POST — scan Telegram's getUpdates for a /register <token> message, then bind.
// No webhook needed. Protected by session auth.
//
// Telegram note: getUpdates and webhooks are mutually exclusive.
// Make sure no webhook is registered (or call deleteWebhook first).

import { NextRequest, NextResponse } from "next/server";
import { verifySessionAuthHeader } from "@/lib/auth";
import { validatePendingToken, consumeToken } from "@/lib/telegram-token-store";
import { prisma } from "@/lib/db";

interface VerifyBody {
  token: string;
}

interface TelegramUser {
  id: number;
}

interface TelegramMessage {
  from?: TelegramUser;
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface GetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function POST(req: NextRequest) {
  const address = await verifySessionAuthHeader(req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!BOT_TOKEN) {
    return NextResponse.json({ error: "Telegram bot not configured" }, { status: 503 });
  }

  const body = (await req.json()) as VerifyBody;
  if (!body.token || typeof body.token !== "string") {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  // Validate the token still belongs to this address and hasn't expired
  const entry = validatePendingToken(body.token, address);
  if (!entry) {
    return NextResponse.json(
      { error: "Token is invalid or expired. Please generate a new one." },
      { status: 400 }
    );
  }

  // Pull recent updates from Telegram (up to 100, no offset — fetches unseen messages)
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=100&allowed_updates=["message"]`;
  let updates: TelegramUpdate[];
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json()) as GetUpdatesResponse;
    if (!data.ok) {
      return NextResponse.json({ error: "Failed to reach Telegram" }, { status: 502 });
    }
    updates = data.result;
  } catch {
    return NextResponse.json({ error: "Failed to reach Telegram" }, { status: 502 });
  }

  // Scan for a message containing "/register <token>"
  const registerPattern = new RegExp(
    `^/register(?:@\\w+)?\\s+${body.token}$`,
    "i"
  );

  const match = updates.find(
    (u) => u.message?.text && registerPattern.test(u.message.text.trim())
  );

  if (!match?.message?.from) {
    // Not found yet — user hasn't sent the command
    return NextResponse.json({ bound: false });
  }

  const telegramUserId = String(match.message.from.id);

  // Persist binding
  await prisma.userSetting.upsert({
    where: { userAddress: address.toLowerCase() },
    update: { telegramUserId },
    create: { userAddress: address.toLowerCase(), telegramUserId },
  });

  // Consume the pending token so it can't be reused
  consumeToken(body.token);

  // Notify the user that the connection succeeded and that automations will message here
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: telegramUserId,
      text: "✅ Your OpenDock account is now connected to Telegram.\n\nWhenever an automation runs, its results will be sent to this chat.",
    }),
  }).catch(() => {
    // Non-fatal — binding already succeeded
  });

  return NextResponse.json({ bound: true, telegramUserId });
}
