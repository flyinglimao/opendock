// app/agents/[id]/page.tsx
// Server component: reads on-chain token data + ERC-721 metadata, then renders the page.

import { createPublicClient, http } from "viem";
import { zgTestnet } from "@/lib/chain";
import { INFT_ADDRESS, INFT_ABI } from "@/lib/contracts";
import { notFound } from "next/navigation";
import AgentConsole from "./AgentConsole";
import type { Metadata } from "next";

// ---- Public viem client (server-side) ----
const publicClient = createPublicClient({
  chain: zgTestnet,
  transport: http(),
});

const ZG_INDEXER =
  process.env.NEXT_PUBLIC_ZG_INDEXER_URL ??
  "https://indexer-storage-testnet-turbo.0g.ai";

interface Erc721Metadata {
  name?: string;
  description?: string;
  image?: string;
  systemPrompt?: string;
}

async function fetchMetadata(metadataHash: `0x${string}`): Promise<Erc721Metadata> {
  try {
    const res = await fetch(`${ZG_INDEXER}/file/${metadataHash}`, {
      next: { revalidate: 3600 },
    });
    if (res.ok) return res.json();
  } catch { /* fall through */ }
  return {};
}

// ---- generateMetadata ----
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params;
  try {
    const metadataHash = (await publicClient.readContract({
      address: INFT_ADDRESS,
      abi: INFT_ABI,
      functionName: "metadataHashOf",
      args: [BigInt(id)],
    })) as `0x${string}`;
    const meta = await fetchMetadata(metadataHash);
    return {
      title: `${meta.name ?? `Agent #${id}`} — OpenDock`,
      description: meta.description ?? "An AI Agent on OpenDock",
    };
  } catch {
    return { title: `Agent #${id} — OpenDock` };
  }
}

// ---- Page ----
export default async function AgentDetailPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tokenId = BigInt(id);

  // Read on-chain data
  let owner: string;
  let metadataHash: `0x${string}`;
  try {
    [owner, metadataHash] = await Promise.all([
      publicClient.readContract({
        address: INFT_ADDRESS,
        abi: INFT_ABI,
        functionName: "ownerOf",
        args: [tokenId],
      }) as Promise<string>,
      publicClient.readContract({
        address: INFT_ADDRESS,
        abi: INFT_ABI,
        functionName: "metadataHashOf",
        args: [tokenId],
      }) as Promise<`0x${string}`>,
    ]);
  } catch {
    notFound();
  }

  const meta = await fetchMetadata(metadataHash!);
  const agentName = meta.name ?? `Agent #${id}`;
  const description = meta.description ?? "";
  const image = meta.image ?? "";

  const ownerStr = owner! as string;

  return (
    <main className="flex-1 max-w-[1280px] mx-auto w-full px-6 py-xl flex flex-col md:flex-row gap-gutter">
      {/* Left Column */}
      <div className="w-full md:w-1/3 flex flex-col gap-lg">
        {/* Agent Image */}
        <div className="rounded-xl overflow-hidden shadow-[0px_4px_20px_rgba(0,0,0,0.05)] bg-surface-container-lowest aspect-square border border-outline-variant/30 relative flex items-center justify-center">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={agentName} className="object-cover w-full h-full" />
          ) : (
            <span className="material-symbols-outlined text-outline" style={{ fontSize: 80 }}>smart_toy</span>
          )}
        </div>

        {/* On-chain info */}
        <div className="bg-surface-container-lowest rounded-xl p-lg shadow-[0px_4px_20px_rgba(0,0,0,0.05)] border border-outline-variant/30 flex flex-col gap-md">
          <div className="flex flex-col gap-xs">
            <span className="font-label-caps text-label-caps font-semibold text-on-surface-variant">Token ID</span>
            <span className="font-data-mono text-data-mono text-on-surface font-bold">#{id}</span>
          </div>

          <div className="flex flex-col gap-xs">
            <span className="font-label-caps text-label-caps font-semibold text-on-surface-variant">Owner</span>
            <a
              href={`https://chainscan-galileo.0g.ai/address/${ownerStr}`}
              target="_blank" rel="noopener noreferrer"
              className="font-data-mono text-data-mono text-primary truncate hover:underline"
            >
              {ownerStr.slice(0, 6)}…{ownerStr.slice(-4)}
            </a>
          </div>

          <div className="flex flex-col gap-xs">
            <span className="font-label-caps text-label-caps font-semibold text-on-surface-variant">Contract</span>
            <a
              href={`https://chainscan-galileo.0g.ai/address/${INFT_ADDRESS}`}
              target="_blank" rel="noopener noreferrer"
              className="font-data-mono text-data-mono text-on-surface truncate hover:underline"
            >
              {INFT_ADDRESS.slice(0, 6)}…{INFT_ADDRESS.slice(-4)}
            </a>
          </div>

          <div className="flex flex-col gap-xs">
            <span className="font-label-caps text-label-caps font-semibold text-on-surface-variant">Metadata Hash</span>
            <span className="font-data-mono text-data-mono text-on-surface break-all text-xs">
              {metadataHash!}
            </span>
          </div>
        </div>
      </div>

      {/* Right Column */}
      <div className="w-full md:w-2/3 flex flex-col gap-lg">
        {/* Agent Info */}
        <div className="flex flex-col gap-sm">
          <div className="flex items-center gap-3">
            <h1 className="font-h1 text-h1 font-bold text-on-surface">{agentName}</h1>
            <div className="w-2 h-2 rounded-full bg-[#10B981] ml-2" title="Live" />
          </div>
          {description && (
            <p className="font-body-main text-body-main text-on-surface-variant mt-sm leading-relaxed max-w-3xl">
              {description}
            </p>
          )}
        </div>

        {/* Interaction Console — client component */}
        <AgentConsole tokenId={id} agentName={agentName} systemPrompt={meta.systemPrompt ?? ""} />
      </div>
    </main>
  );
}
