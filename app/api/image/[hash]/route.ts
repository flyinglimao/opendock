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

// Map common image extensions to MIME types (fallback if 0G doesn't set it).
function guessMimeFromHash(_hash: string): string {
  return "image/png"; // default; the stored file determines actual bytes
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;
  if (!hash || !hash.startsWith("0x")) {
    return NextResponse.json({ error: "Invalid hash" }, { status: 400 });
  }

  // Content-type hint passed as ?type=image%2Fpng (set by the uploader).
  // Falls back to sniffing the response or a generic default.
  const typeHint = req.nextUrl.searchParams.get("type") || null;

  const downloadUrl = `${ZG_INDEXER}/file/${hash}`;
  let upstream: Response;
  try {
    upstream = await fetch(downloadUrl, {
      // Allow caching at edge/CDN level — image content is immutable.
      next: { revalidate: 86400 },
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `0G returned ${upstream.status}` },
        { status: 404 }
      );
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  // Detect content-type: prefer caller's hint, then upstream header, then guess.
  const contentType =
    typeHint ||
    upstream.headers.get("content-type") ||
    guessMimeFromHash(hash);

  const body = await upstream.arrayBuffer();

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Immutable — hash is a content address, so it never changes.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
