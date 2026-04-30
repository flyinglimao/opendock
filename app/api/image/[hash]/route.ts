// app/api/image/[hash]/route.ts
// Proxy an image stored on 0G Storage by its root hash.
// The ERC-721 metadata `image` field points here.
//
// GET /api/image/0x1234...abcd
//   → streams the raw image bytes from 0G with correct Content-Type.

import { NextRequest, NextResponse } from "next/server";

const ZG_INDEXER =
  process.env.NEXT_PUBLIC_ZG_INDEXER_URL ??
  "https://indexer-storage-testnet-turbo.0g.ai";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;
  if (!hash || !hash.startsWith("0x")) {
    return NextResponse.json({ error: "Invalid hash" }, { status: 400 });
  }

  // Content-type hint passed as ?type=image%2Fwebp (set by the uploader).
  const typeHint = req.nextUrl.searchParams.get("type") || "image/webp";

  try {
    const { Indexer } = await import("@0gfoundation/0g-ts-sdk");
    const indexer = new Indexer(ZG_INDEXER);
    const [blob, err] = await indexer.downloadToBlob(hash);
    if (err !== null || !blob) {
      console.error("[image] downloadToBlob error", err);
      return NextResponse.json({ error: "File not available" }, { status: 404 });
    }

    const buffer = await blob.arrayBuffer();
    const contentType = blob.type || typeHint;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Immutable — hash is a content address, so it never changes.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("[image] error", err);
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
