// Admin endpoint to delete preview KB blobs older than 1 day.
// Blobs are stored at: preview/YYYY/MM/DD/<sessionId>/<filename>
// Run this at 00:00 UTC daily (or manually) to purge stale test uploads.
//
// Protected by CRON_SECRET (same as other admin endpoints).

import { NextRequest, NextResponse } from "next/server";
import { list, del } from "@vercel/blob";

function checkAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured — allow in dev
  const auth = req.headers.get("Authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function parseDateFromPath(pathname: string): Date | null {
  // Expected: preview/YYYY/MM/DD/...
  const parts = pathname.split("/");
  if (parts.length < 4 || parts[0] !== "preview") return null;
  const year = parseInt(parts[1], 10);
  const month = parseInt(parts[2], 10);
  const day = parseInt(parts[3], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  // Cutoff: midnight UTC today — delete anything from strictly before today.
  const cutoff = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );

  const toDelete: string[] = [];
  let cursor: string | undefined;

  do {
    const result = await list({ prefix: "preview/", cursor, limit: 1000 });
    for (const blob of result.blobs) {
      const blobDate = parseDateFromPath(blob.pathname);
      if (blobDate && blobDate < cutoff) {
        toDelete.push(blob.url);
      }
    }
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  let deleted = 0;
  const BATCH = 100;
  for (let i = 0; i < toDelete.length; i += BATCH) {
    await del(toDelete.slice(i, i + BATCH));
    deleted += Math.min(BATCH, toDelete.length - i);
  }

  return NextResponse.json({ deleted, cutoff: cutoff.toISOString() });
}
