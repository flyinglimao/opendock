"use client";

import { useEffect, useState } from "react";

interface Props {
  tokenId: string;
  agentName: string;
  systemPrompt: string;
  AgentConsole: React.ComponentType<{ tokenId: string; agentName: string; systemPrompt: string }>;
}

/**
 * Client wrapper that:
 * - Shows "data still syncing" banner if systemPrompt is empty (0G not yet accessible).
 * - Polls /api/token/[id]/status every 15 s until data is available, then reloads.
 */
export default function AgentAvailabilityGate({ tokenId, agentName, systemPrompt, AgentConsole }: Props) {
  const isAvailable = systemPrompt.length > 0;
  const [syncing, setSyncing] = useState(!isAvailable);

  useEffect(() => {
    if (isAvailable) return;

    let stopped = false;
    async function poll() {
      while (!stopped) {
        try {
          const res = await fetch(`/api/token/${tokenId}/status`, { cache: "no-store" });
          const data = (await res.json()) as { available: boolean };
          if (data.available) {
            // Data is ready — reload the page to get full server-rendered content
            window.location.reload();
            return;
          }
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 15000));
      }
    }
    poll();
    return () => { stopped = true; };
  }, [isAvailable, tokenId]);

  if (!isAvailable && syncing) {
    return (
      <div className="w-full flex flex-col items-center justify-center py-20 gap-6 text-on-surface-variant">
        <div className="relative">
          <span className="material-symbols-outlined text-6xl text-outline" style={{ fontSize: 64 }}>
            cloud_sync
          </span>
          <span className="absolute bottom-0 right-0 inline-block w-4 h-4 border-2 border-outline-variant border-t-primary rounded-full animate-spin" />
        </div>
        <div className="text-center flex flex-col gap-sm">
          <h2 className="font-h2 text-h2 font-semibold text-on-surface">
            Agent data is syncing with 0G network
          </h2>
          <p className="font-body-sub text-body-sub text-on-surface-variant max-w-sm">
            This usually takes a few minutes. The page will automatically refresh when ready.
          </p>
          <p className="font-data-mono text-data-mono text-outline text-xs mt-sm">
            Checking every 15 seconds…
          </p>
        </div>
      </div>
    );
  }

  return <AgentConsole tokenId={tokenId} agentName={agentName} systemPrompt={systemPrompt} />;
}
