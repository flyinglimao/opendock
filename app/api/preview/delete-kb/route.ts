import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { verifySessionAuthHeader } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const address = await verifySessionAuthHeader(req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { urls } = (await req.json()) as { urls?: unknown };
  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  // Only allow deleting blobs under the preview/ prefix.
  const safeUrls = (urls as unknown[]).filter((u): u is string => {
    if (typeof u !== "string") return false;
    try {
      return new URL(u).pathname.includes("/preview/");
    } catch {
      return false;
    }
  });

  if (safeUrls.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  await del(safeUrls);
  return NextResponse.json({ deleted: safeUrls.length });
}
