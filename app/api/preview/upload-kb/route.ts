import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { verifySessionAuthHeader } from "@/lib/auth";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  const address = await verifySessionAuthHeader(req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const files = formData.getAll("files") as File[];

  if (!files.length) {
    return NextResponse.json({ files: [] });
  }

  const now = new Date();
  const datePath = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("/");
  const sessionId = randomUUID();

  const uploaded = await Promise.all(
    files.map(async (file) => {
      const blob = await put(`preview/${datePath}/${sessionId}/${file.name}`, file, {
        access: "public",
      });
      return { name: file.name, url: blob.url };
    })
  );

  return NextResponse.json({ files: uploaded });
}
