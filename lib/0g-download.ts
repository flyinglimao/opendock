// lib/0g-download.ts
// Server-side helper to download files from 0G Storage via the SDK.
// Direct HTTP fetch to the indexer URL does not work — files must be
// retrieved through the SDK which resolves storage nodes internally.

const ZG_INDEXER =
  process.env.NEXT_PUBLIC_ZG_INDEXER_URL ??
  "https://indexer-storage-testnet-turbo.0g.ai";

/**
 * Download a file from 0G Storage by its root hash.
 * Returns the parsed JSON, or null if unavailable.
 */
export async function downloadZGJson<T = unknown>(rootHash: string): Promise<T | null> {
  try {
    const { Indexer } = await import("@0gfoundation/0g-storage-ts-sdk");
    const indexer = new Indexer(ZG_INDEXER);
    const [blob, err] = await indexer.downloadToBlob(rootHash);
    if (err !== null || !blob) return null;
    const text = await blob.text();
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
